import * as THREE from 'three';
import { B, blocks, items, boxFor, selectionShapes } from '../core/blocks.js';
import { chunkKey, SEA } from '../core/world.js';
import { clamp, lerp, hash, Noise } from '../core/noise.js';
import { meshChunk, texturedBox, blockGeometry, extrudedItem, FACES } from './mesher.js';
import { crackTextures } from './textures.js';
import { ownedMesh, disposeOwnedObject } from './resources.js';
import { fluidAt } from '../core/fluids.js';
import { createChestModel, animateChest } from './chests.js';
import { MeshWorkerPool } from './mesh-pool.js';
import { captureNeighborhood } from './mesh-snapshot.js';
import { precipitationAt, precipitationHeight, animationStep } from '../core/weather.js';
import { ParticlePool } from './particle-pool.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
export class VoxelRenderer {
  constructor(canvas, atlas, settings) {
    this.canvas = canvas; this.atlas = atlas; this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.autoClear = false; this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.info.autoReset = false;
    this.scene = new THREE.Scene(); this.scene.fog = new THREE.Fog('#b5d5ee', 45, 90);
    this.camera = new THREE.PerspectiveCamera(settings.fov || 70, 1, .03, 900); this.camera.rotation.order = 'YXZ';
    this.chunkMeshes = new Map(); this.queue = []; this.center = ''; this.time = 0;
    this.meshPool = new MeshWorkerPool(atlas); this.pendingMeshes = new Map(); this.meshGeneration = 0; this.discardedMeshes = 0;
    this.day = { value: 1 }; this.nightTint = { value: new THREE.Color(1, 1, 1) }; this.ambient = { value: .008 };
    this.effectTime = { value: 0 }; this.sunDirection = { value: V(1,1,0).normalize() }; this.waterDetail = { value: 1 }; this.flameIntensity = { value: 1 };
    this.scratchEye = V(); this.scratchDirection = V();
    this.skyColors = ['#050b1a','#82adc5','#111b29','#c8d4cf','#626f79','#909998'].map(c=>new THREE.Color(c));
    this.solidMaterial = this.makeMaterial(); this.cutoutMaterial = this.makeMaterial({ side: THREE.DoubleSide });
    this.waterMaterial = this.makeMaterial({ transparent: true, opacity: .66, depthWrite: false, side: THREE.DoubleSide });
    this.entityMaterial = new THREE.MeshLambertMaterial({ map: atlas.texture, vertexColors: true, alphaTest: .45 });
    this.itemMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.geometryCache = new Map();
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x7b7053, 2.0); this.scene.add(this.hemi);
    this.sunLight = new THREE.DirectionalLight(0xffffff, .75); this.sunLight.position.set(60, 100, 40); this.scene.add(this.sunLight);
    this.createSky(); this.createClouds(); this.createSelection(); this.createViewmodel(); this.createParticles(); this.createWeather();
    this.resize(); window.addEventListener('resize', () => this.resize());
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.contextLost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.contextLost = false; this.center = ''; });
  }
  makeMaterial(options = {}) {
    const material = new THREE.MeshBasicMaterial({ map: this.atlas.texture, vertexColors: true, alphaTest: .4, fog: true, ...options });
    material.defaultAttributeValues = { voxelTile: [0, 0, 0, 0] };
    material.onBeforeCompile = shader => {
      shader.uniforms.voxelDay = this.day; shader.uniforms.voxelTint = this.nightTint; shader.uniforms.voxelAmbient = this.ambient;
      shader.uniforms.voxelTime = this.effectTime; shader.uniforms.voxelSun = this.sunDirection; shader.uniforms.voxelWaterDetail = this.waterDetail;
      shader.uniforms.voxelFlame = this.flameIntensity;
      shader.uniforms.voxelAnimationTop = this.atlas.animationTop; shader.uniforms.voxelAnimationOffset = this.atlas.animationOffset;
      shader.vertexShader = `uniform float voxelDay; uniform vec3 voxelTint; uniform float voxelAmbient; uniform float voxelFlame; uniform vec3 voxelSun; attribute vec2 voxelLight; attribute vec4 voxelTile; varying vec2 vVoxelLight; varying vec4 vVoxelTile; varying vec3 vVoxelWorld; varying vec3 vVoxelNormal; varying vec3 vVoxelLighting;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>
        vVoxelLight = voxelLight / 15.0; vVoxelTile = voxelTile; vVoxelWorld = (modelMatrix * vec4(position,1.0)).xyz; vVoxelNormal = normalize(mat3(modelMatrix) * normal);
        vec3 skyLight = vVoxelLight.x * vVoxelLight.x * voxelDay * voxelTint;
        vec3 blockLight = pow(max(vVoxelLight.y,0.0),1.55) * vec3(1.0,0.79,0.55) * voxelFlame;
        float directional = 0.92 + 0.08 * max(dot(vVoxelNormal,voxelSun),0.0);
        vVoxelLighting = max(skyLight * directional,blockLight) + voxelAmbient;`);
      shader.fragmentShader = `uniform float voxelDay; uniform vec3 voxelTint; uniform float voxelAmbient; varying vec2 vVoxelLight; varying vec4 vVoxelTile;
        uniform float voxelAnimationTop; uniform vec2 voxelAnimationOffset;
        uniform float voxelTime; uniform vec3 voxelSun; uniform float voxelWaterDetail; varying vec3 vVoxelWorld; varying vec3 vVoxelNormal; varying vec3 vVoxelLighting;
        vec2 animateVoxelUV(vec2 uv) { return uv + (uv.y < voxelAnimationTop ? voxelAnimationOffset : vec2(0.0)); }
        ${shader.fragmentShader}`;
      // Repeated atlas tiles retain their original 16x16 texel scale. Derivatives
      // are taken before fract(), avoiding false mip levels at every block edge.
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', `( vVoxelTile.z > 0.0 ? textureGrad( map, animateVoxelUV( mix( vVoxelTile.xy, vVoxelTile.zw, fract( vMapUv ) ) ), dFdx( vMapUv ) * ( vVoxelTile.zw - vVoxelTile.xy ), dFdy( vMapUv ) * ( vVoxelTile.zw - vVoxelTile.xy ) ) : texture2D( map, animateVoxelUV( vMapUv ) ) )`));
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= vVoxelLighting;
        ${options.transparent ? `
        if (voxelWaterDetail > 0.5 && vVoxelNormal.y > 0.5) {
          vec3 eyeDirection = normalize(cameraPosition - vVoxelWorld);
          vec2 ripple = vec2(sin(vVoxelWorld.x * 1.7 + vVoxelWorld.z * 0.8 + voxelTime * 1.2), cos(vVoxelWorld.z * 1.5 - vVoxelWorld.x * 0.7 + voxelTime * 0.9)) * 0.055;
          vec3 waterNormal = normalize(vec3(ripple.x,1.0,ripple.y));
          float fresnel = pow(1.0 - max(dot(eyeDirection,waterNormal),0.0),3.0);
          float glint = pow(max(dot(reflect(-voxelSun,waterNormal),eyeDirection),0.0),90.0) * voxelDay * vVoxelLight.x;
          diffuseColor.rgb = mix(diffuseColor.rgb,vec3(0.22,0.36,0.43) * voxelDay, fresnel * 0.3 * vVoxelLight.x) + vec3(1.0,0.86,0.6) * glint * 0.24;
          diffuseColor.a = mix(diffuseColor.a,0.86,fresnel);
        }` : ''}`);
    };
    material.customProgramCacheKey = () => `voxel-light-tiled-atmosphere-v5-${!!options.transparent}`; return material;
  }
  resize() {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,2) * (this.settings.pixelScale || 1));
    const w = innerWidth, h = innerHeight; this.renderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.viewCamera) { this.viewCamera.aspect = w / h; this.viewCamera.updateProjectionMatrix(); }
  }
  createSky() {
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(430, 24, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false,
      uniforms: { zenith: { value: new THREE.Color('#75a2f6') }, horizon: { value: new THREE.Color('#b8d7f3') }, dusk: { value: 0 }, sunDir: { value: V(1, 0, 0) } },
      vertexShader: 'varying vec3 vDirection; void main(){vDirection=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `varying vec3 vDirection; uniform vec3 zenith; uniform vec3 horizon; uniform float dusk; uniform vec3 sunDir;
      void main(){float h=pow(clamp(vDirection.y,0.0,1.0),0.38);vec3 c=mix(horizon,zenith,h);
      float glow=pow(max(dot(normalize(vDirection.xz),normalize(sunDir.xz)),0.0),3.0)*pow(1.0-abs(vDirection.y),8.0)*dusk;
      c=mix(c,vec3(0.95,0.30,0.075),glow*0.7);gl_FragColor=vec4(c,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`
    })); this.sky.renderOrder = -10000; this.scene.add(this.sky);
    const makeCelestial = moon => {
      const c = document.createElement('canvas'); c.width = c.height = 32; const ctx = c.getContext('2d');
      if (moon) {
        ctx.fillStyle = '#cecec3'; ctx.fillRect(1, 1, 30, 30); ctx.fillStyle = '#f1f1e8'; ctx.fillRect(3, 3, 26, 26);
        for (const [x, y, w, h] of [[7, 6, 7, 5], [19, 13, 6, 8], [10, 22, 5, 4]]) { ctx.fillStyle = '#b3b4ac'; ctx.fillRect(x, y, w, h); }
      } else { ctx.fillStyle = '#ffedb4'; ctx.fillRect(0, 0, 32, 32); ctx.fillStyle = '#fff7cf'; ctx.fillRect(2, 2, 28, 28); ctx.fillStyle = '#fffef1'; ctx.fillRect(5, 5, 22, 22); }
      const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(moon ? 25 : 30, moon ? 25 : 30), new THREE.MeshBasicMaterial({ map: t, fog: false, depthWrite: false, transparent: true }));
      mesh.renderOrder = -9000; this.scene.add(mesh); return mesh;
    };
    this.sun = makeCelestial(false); this.moon = makeCelestial(true);
    const stars = [], sizes = [];
    for (let i = 0; i < 750; i++) {
      const a = hash(i, 21, 0, 6) * Math.PI * 2, y = hash(i, 22, 0, 6) * 2 - 1, r = Math.sqrt(1 - y * y);
      stars.push(Math.cos(a) * r * 380, y * 380, Math.sin(a) * r * 380); sizes.push(1);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(stars, 3));
    this.stars = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.stars.renderOrder = -9500; this.scene.add(this.stars);
  }
  createClouds() {
    const positions = [], colors = [], indices = [], n = new Noise(9844), length = 42, grid = [];
    for (let z = 0; z < length; z++) for (let x = 0; x < length; x++) grid[x + z * length] = n.fbm(x / 5, z / 5, 2) > -.045;
    for (let z = 0; z < length; z++) for (let x = 0; x < length; x++) if (grid[x + z * length]) {
      for (let f = 0; f < 6; f++) {
        const face = FACES[f], nx = x + face.n[0], nz = z + face.n[2];
        if (!face.n[1] && nx >= 0 && nx < length && nz >= 0 && nz < length && grid[nx + nz * length]) continue;
        const start = positions.length / 3;
        for (const v of face.v) { positions.push((x + v[0] - length / 2) * 12, v[1] * 4, (z + v[2] - length / 2) * 12); const shade = f === 3 ? .7 : f === 2 ? 1 : .86; colors.push(shade, shade, shade); }
        indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); g.setIndex(indices);
    this.clouds = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, fog: false, transparent: true, opacity: .94 }));
    this.clouds.position.y = 140; this.scene.add(this.clouds);
  }
  createSelection() {
    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.003, 1.003, 1.003)), new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: .72 }));
    this.outline.visible = false; this.scene.add(this.outline);
    this.crackTextures = crackTextures();
    this.cracks = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006), new THREE.MeshBasicMaterial({ map: this.crackTextures[0], transparent: true, alphaTest: .02, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    this.cracks.visible = false; this.scene.add(this.cracks);
  }
  selection(hit, progress = 0) {
    this.outline.visible = !!hit; this.cracks.visible = !!hit && progress > 0;
    if (!hit) return;
    const shapes = selectionShapes(hit.id, hit.state), bounds = shapes[0].slice();
    for (const shape of shapes) for (let axis = 0; axis < 3; axis++) { bounds[axis] = Math.min(bounds[axis], shape[axis]); bounds[axis + 3] = Math.max(bounds[axis + 3], shape[axis + 3]); }
    this.outline.position.set(hit.x + (bounds[0] + bounds[3]) / 2, hit.y + (bounds[1] + bounds[4]) / 2, hit.z + (bounds[2] + bounds[5]) / 2);
    this.outline.scale.set(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]);
    this.cracks.position.copy(this.outline.position); this.cracks.scale.copy(this.outline.scale);
    const tex = this.crackTextures[Math.min(9, Math.floor(progress * 10))];
    if (this.cracks.material.map !== tex) { this.cracks.material.map = tex; this.cracks.material.needsUpdate = true; }
  }
  createViewmodel() {
    this.viewScene = new THREE.Scene(); this.viewCamera = new THREE.PerspectiveCamera(70, 1, .01, 10);
    this.viewScene.add(new THREE.AmbientLight(0xffffff, 1.7)); const l = new THREE.DirectionalLight(0xffffff, .65); l.position.set(-2, 4, 3); this.viewScene.add(l);
    this.viewLight = this.viewScene.children[0]; this.heldRoot = new THREE.Group(); this.viewScene.add(this.heldRoot);
    this.arm = new THREE.Group(); this.heldRoot.add(this.arm);
    const arm = new THREE.Mesh(texturedBox(this.atlas, 'skin', [.22, .65, .22], true), this.entityMaterial); this.arm.add(arm);
    const sleeve = new THREE.Mesh(texturedBox(this.atlas, 'shirt', [.225, .23, .225], true), this.entityMaterial); sleeve.position.y = -.24; this.arm.add(sleeve);
    this.heldId = -1; this.equip = 0;
  }
  makeItem(id, size = 1) {
    const item = items[id]; if (!item) return new THREE.Group();
    let geometry = this.geometryCache.get(id);
    if (!geometry) {
      if (item.block !== undefined && !['cross', 'crop', 'torch', 'door', 'ladder'].includes(blocks[id].shape)) geometry = blockGeometry(this.atlas, id);
      else if (item.block === undefined) geometry = extrudedItem(this.atlas, item);
      else {
        geometry = new THREE.PlaneGeometry(1, 1); const mesh = ownedMesh(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: this.atlas.itemTexture(id), transparent: true, alphaTest: .4, side: THREE.DoubleSide }))); mesh.scale.setScalar(size); return mesh;
      }
      this.geometryCache.set(id, geometry);
    }
    const mesh = new THREE.Mesh(geometry, item.block !== undefined ? this.entityMaterial : this.itemMaterial); mesh.scale.setScalar(size); return mesh;
  }
  viewmodel(player, game, dt) {
    const id = player.inventory.slots[player.selected]?.id || 0;
    if (id !== this.heldId) {
      if (this.heldMesh) disposeOwnedObject(this.heldMesh);
      this.heldId = id; this.equip = 1;
      if (id) { this.heldMesh = this.makeItem(id, items[id].block !== undefined ? .36 : .7); this.heldRoot.add(this.heldMesh); }
      else this.heldMesh = null;
    }
    this.equip = Math.max(0, this.equip - dt * 5);
    const walking = player.onGround ? Math.min(1, player.walkSpeed / 4.3) : .1;
    const bob = this.settings.bobbing ? Math.sin(player.walkDistance * 1.7) * walking : 0;
    const swing = Math.sin((game.swing || 0) * Math.PI), ease = Math.sin(Math.sqrt(game.swing || 0) * Math.PI);
    const eat = game.eating > 0 ? Math.sin(game.eating * 32) * .025 : 0;
    this.heldRoot.position.set(.52 - ease * .24 + bob * .017, -.43 - this.equip * .55 + swing * .12 + Math.abs(bob) * .012 + eat, -.79 - swing * .13);
    this.heldRoot.rotation.set(-swing * .75, -.35 - ease * .45, -.13 - ease * .32);
    this.arm.visible = !id;
    this.arm.position.set(.03, -.16, .03); this.arm.rotation.set(-.25, -.2, .23);
    if (this.heldMesh) {
      const block = items[id].block !== undefined;
      this.heldMesh.rotation.set(block ? .2 : .1, block ? -.35 : .15, block ? 0 : -.15);
      if (game.eating > 0) { this.heldRoot.position.x = .05; this.heldRoot.position.y = -.25 + eat; this.heldRoot.position.z = -.55; this.heldMesh.rotation.z = -1; }
    }
    const lit = game.world?.getLight(Math.floor(player.pos.x), Math.floor(player.pos.y + 1), Math.floor(player.pos.z)) || [15, 0];
    this.viewLight.intensity = .2 + Math.max(lit[0] / 15 * this.day.value, lit[1] / 15) * 1.8;
  }
  createParticles() {
    this.particlePool = new ParticlePool(768); this.particles = this.particlePool.active; this.particlePalettes = new Map(); this.particleColor = new THREE.Color();
    this.particleMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), 768);
    this.particleMesh.count = 0; this.particleMesh.frustumCulled = false; this.scene.add(this.particleMesh); this.particleDummy = new THREE.Object3D();
  }
  burst(x, y, z, id, count = 24, force = 1) {
    let palette = this.particlePalettes.get(id);
    if (!palette) {
      const tex = this.atlas.tileCanvases.get(blocks[id] ? (Array.isArray(blocks[id].texture) ? blocks[id].texture[0] : blocks[id].texture) : 'stone');
      const data = tex?.getContext('2d').getImageData(0,0,16,16).data; palette=[];
      for(let i=0;i<256;i+=8)if(!data||data[i*4+3]>128)palette.push(data?new THREE.Color(data[i*4]/255,data[i*4+1]/255,data[i*4+2]/255).convertSRGBToLinear():new THREE.Color(0xffffff));
      if(!palette.length)palette.push(new THREE.Color('#777777'));this.particlePalettes.set(id,palette);
    }
    this.particlePool.emit(x,y,z,palette,count,force,this.settings.particleLimit || 512);
  }
  tickParticles(dt, world) {
    this.particlePool.tick(dt,world);
    if (!this.particles.length && !this.particleMesh.count) return;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const d = this.particleDummy; d.position.copy(p.pos); d.scale.setScalar(p.size * Math.min(1, p.life * 5)); d.rotation.set(p.life, p.life * 3, 0); d.updateMatrix();
      this.particleMesh.setMatrixAt(i, d.matrix); this.particleMesh.setColorAt(i, this.particleColor.copy(p.color).multiplyScalar(Math.max(.2,this.day.value)));
    }
    this.particleMesh.count = this.particles.length; this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
  }
  createWeather() {
    const positions = new Float32Array(600 * 6), geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.rain = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xaabbd6, transparent: true, opacity: .4, depthWrite: false }));
    this.rain.frustumCulled = false; this.rain.visible = false; this.scene.add(this.rain); this.rainAmount = 0;
    const snowGeometry = new THREE.BufferGeometry(); snowGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(600 * 3), 3));
    this.snow = new THREE.Points(snowGeometry, new THREE.PointsMaterial({ color: 0xeeeeee, size: .075, transparent: true, opacity: .8, depthWrite: false }));
    this.snow.frustumCulled = false; this.snow.visible = false; this.scene.add(this.snow);
  }
  updateWeather(world, player, dt) {
    this.rainAmount = lerp(this.rainAmount, world.weather && world.dimension === 'overworld' ? 1 : 0, dt * .3);
    this.rain.visible = this.rainAmount > .02 && !!this.settings.weather;
    this.snow.visible = this.rain.visible;
    if (!this.rain.visible) return;
    this.rain.material.opacity = this.rainAmount * .42;
    this.snow.material.opacity = this.rainAmount * .8;
    const attr = this.rain.geometry.attributes.position;
    const snowAttr = this.snow.geometry.attributes.position;
    for (let i = 0; i < 600; i++) {
      const x = player.pos.x + (hash(i, 1, 0, 63) - .5) * 34, z = player.pos.z + (hash(i, 2, 0, 63) - .5) * 34;
      const y = player.pos.y + 13 - ((hash(i, 3, 0, 63) * 22 + this.time * 19) % 22);
      const type = precipitationAt(world, x, z), ground = precipitationHeight(world, x, z);
      const above = type === 'rain' && y > ground;
      attr.setXYZ(i * 2, x, above ? y : -1000, z); attr.setXYZ(i * 2 + 1, x - .03, above ? Math.max(ground, y - .9) : -1000, z + .08);
      const sx = x + Math.sin(this.time * 1.4 + i) * .6, sz = z + Math.cos(this.time * .9 + i * .7) * .6;
      const sy = player.pos.y + 13 - ((hash(i, 4, 0, 63) * 22 + this.time * 2.8) % 22);
      snowAttr.setXYZ(i, sx, precipitationAt(world, sx, sz) === 'snow' && sy > precipitationHeight(world, sx, sz) ? sy : -1000, sz);
    }
    attr.needsUpdate = true; snowAttr.needsUpdate = true;
  }
  build(world, chunk) {
    const pending = this.pendingMeshes.get(chunk.key); if (pending) return pending.promise;
    const token = { generation: this.meshGeneration, promise: null }; this.pendingMeshes.set(chunk.key, token);
    token.promise = (async () => {
      try {
        const smooth = this.settings.smoothLighting !== false;
        let geometries;
        if (this.meshPool.failed) {
          geometries = meshChunk(world, chunk, this.atlas, smooth); world.dirty.delete(chunk.key);
        } else {
          const snapshot = captureNeighborhood(world, chunk); world.dirty.delete(chunk.key);
          try { geometries = await this.meshPool.run(snapshot, chunk.key, smooth); }
          catch (error) {
            if (token.generation !== this.meshGeneration) return false;
            geometries = meshChunk(world, chunk, this.atlas, smooth); world.dirty.delete(chunk.key);
          }
        }
        // Any edit/light change since capture makes this result obsolete. Never
        // replace a newer world with geometry from an earlier simulation tick.
        if (token.generation !== this.meshGeneration || world.chunks.get(chunk.key) !== chunk || world.dirty.has(chunk.key)) {
          for (const geometry of Object.values(geometries)) geometry?.dispose(); this.discardedMeshes++; return false;
        }
        this.installChunk(world, chunk, geometries); return true;
      } finally { if (this.pendingMeshes.get(chunk.key) === token) this.pendingMeshes.delete(chunk.key); }
    })();
    return token.promise;
  }
  installChunk(world, chunk, geometries) {
    const animationKey = positions => positions.map(p => `${p.x},${p.y},${p.z}`).join('|');
    const previous = new Map((this.chunkMeshes.get(chunk.key)?.userData.chests || []).map(model => [animationKey(model.positions), model.progress]));
    this.removeChunk(chunk.key);
    const group = new THREE.Group(); group.position.set(chunk.cx * 16, 0, chunk.cz * 16);
    for (const [name, geometry] of Object.entries(geometries)) if (geometry) {
      const mesh = new THREE.Mesh(geometry, name === 'solid' ? this.solidMaterial : name === 'cutout' ? this.cutoutMaterial : this.waterMaterial);
      if (name === 'liquid') mesh.renderOrder = 2; group.add(mesh);
    }
    group.userData.chests = [];
    for (const i of chunk.chests) {
      const x = chunk.cx * 16 + (i & 15), y = i >> 8, z = chunk.cz * 16 + ((i >> 4) & 15);
      const positions = world.chestPositions(x, y, z);
      if (!positions.length || positions[0].x !== x || positions[0].z !== z) continue;
      const model = createChestModel(this.atlas, this.entityMaterial, positions, chunk.state[i]);
      model.progress = previous.get(animationKey(positions)) || 0;
      model.root.position.x -= chunk.cx * 16; model.root.position.z -= chunk.cz * 16;
      group.add(model.root); group.userData.chests.push(model);
    }
    this.scene.add(group); this.chunkMeshes.set(chunk.key, group); world.dirty.delete(chunk.key);
  }
  removeChunk(key) {
    const old = this.chunkMeshes.get(key); if (!old) return;
    old.traverse(o => { if (o.geometry && !o.userData.ownsGeometry) o.geometry.dispose(); });
    disposeOwnedObject(old); this.chunkMeshes.delete(key);
  }
  updateChests(game, dt) {
    const active = game.screen === 'chest' ? game.ui.inventory.container?.positions || [] : [];
    for (const group of this.chunkMeshes.values()) for (const model of group.userData.chests || []) {
      const open = model.positions.some(p => active.some(a => a.x === p.x && a.y === p.y && a.z === p.z));
      const p = model.positions[0], samples = [[0, 0, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].map(([x, y, z]) => game.world.getLight(p.x + x, p.y + y, p.z + z));
      const sky = Math.max(...samples.map(light => light[0])), glow = Math.max(...samples.map(light => light[1]));
      animateChest(model, open, dt, Math.max(.09, sky / 15 * this.day.value, glow / 15));
    }
  }
  chestDiagnostics() {
    return [...this.chunkMeshes.values()].flatMap(group => (group.userData.chests || []).map(model => ({ positions: model.positions.map(p => ({ ...p })), open: model.progress, lidAngle: model.lid.rotation.x })));
  }
  reset() { this.meshGeneration++; this.pendingMeshes.clear(); for (const key of this.chunkMeshes.keys()) this.removeChunk(key); this.center = ''; this.queue = []; this.caveAmount = 0; this.particlePool.reset(); this.selection(null); }
  async warm(world, position, progress = () => {}) {
    this.reset();
    const cx = Math.floor(position.x / 16), cz = Math.floor(position.z / 16), jobs = [];
    for (let z = -3; z <= 3; z++) for (let x = -3; x <= 3; x++) jobs.push({ x: cx + x, z: cz + z, d: x * x + z * z });
    jobs.sort((a, b) => a.d - b.d);
    for (let i = 0; i < jobs.length; i++) {
      world.ensure(jobs[i].x, jobs[i].z); progress(i / jobs.length * .45);
      if (i % 3 === 0) await nextFrame();
    }
    const visible = jobs.filter(j => j.d <= 8);
    for (let i = 0; i < visible.length; i += 2) {
      await Promise.all(visible.slice(i,i+2).map(j=>this.build(world,world.ensure(j.x,j.z))));
      progress(.45 + Math.min(visible.length,i+2) / visible.length * .55); await nextFrame();
    }
  }
  prepareNeighborhood(world, job, deadline) {
    for(let z=-1;z<=1;z++)for(let x=-1;x<=1;x++)if(!world.chunks.has(chunkKey(job.x+x,job.z+z))){world.ensure(job.x+x,job.z+z);if(performance.now()>=deadline)return false;}
    for(let z=-1;z<=1;z++)for(let x=-1;x<=1;x++){
      const chunk=world.chunks.get(chunkKey(job.x+x,job.z+z));
      if(chunk.lightDirty||world.blockLightingDirty){world.light(chunk);if(performance.now()>=deadline)return false;}
    }
    return true;
  }
  stream(world, position, budget = 7) {
    if (this.meshError) throw this.meshError;
    const cx = Math.floor(position.x / 16), cz = Math.floor(position.z / 16), radius = this.settings.renderDistance || 6, center = `${cx},${cz},${radius}`;
    if (center !== this.center) {
      this.center = center; this.queue = [];
      for (let z = -radius; z <= radius; z++) for (let x = -radius; x <= radius; x++) if (x * x + z * z <= radius * radius + 1) this.queue.push({ x: cx + x, z: cz + z, d: x * x + z * z });
      this.queue.sort((a, b) => a.d - b.d);
      for (const [key, chunk] of world.chunks) if (Math.max(Math.abs(chunk.cx - cx), Math.abs(chunk.cz - cz)) > radius + 3) {
        this.removeChunk(key); world.unload(key);
      }
    }
    const start = performance.now(); let done = 0;
    for (const job of this.queue) {
      const key = chunkKey(job.x, job.z); if (this.chunkMeshes.has(key) && !world.dirty.has(key)) continue;
      if (this.pendingMeshes.has(key)) continue;
      if (this.pendingMeshes.size >= 2) break;
      if (!this.prepareNeighborhood(world,job,start+budget)) break;
      this.build(world, world.ensure(job.x, job.z)).catch(error => { this.meshError = error; }); done++;
      if (performance.now() - start >= budget || done >= 2) break;
    }
  }
  streamingDiagnostics(world) {
    // queue is the ordered set of visible targets, retained for later edits.
    // Only missing/dirty targets not already in flight are waiting work.
    let queued = 0;
    for (const job of this.queue) {
      const key = chunkKey(job.x, job.z);
      if (!this.pendingMeshes.has(key) && (!this.chunkMeshes.has(key) || world.dirty.has(key))) queued++;
    }
    return { ...this.meshPool.stats, pending: this.pendingMeshes.size, queued, targets: this.queue.length, discarded: this.discardedMeshes };
  }
  updateSky(world, dt, eye) {
    const angle = world.time / 24000 * Math.PI * 2, altitude = Math.sin(angle), nether = world.dimension === 'nether', end = world.dimension === 'end';
    const daylight = end ? .65 : nether ? .17 : clamp(altitude * 3 + .32, .085, 1);
    this.day.value = daylight * (1 - this.rainAmount * .35);
    this.ambient.value = .002 + (this.settings.brightness ?? .5) * .015;
    this.nightTint.value.setRGB(lerp(.55, 1, daylight), lerp(.67, 1, daylight), 1);
    if (nether) this.nightTint.value.setRGB(1, .55, .4);
    if (end) this.nightTint.value.setRGB(.93, .89, 1);
    const skyUniforms = this.sky.material.uniforms;
    skyUniforms.zenith.value.copy(this.skyColors[0]).lerp(this.skyColors[1],daylight);
    skyUniforms.horizon.value.copy(this.skyColors[2]).lerp(this.skyColors[3],daylight);
    skyUniforms.zenith.value.lerp(this.skyColors[4],this.rainAmount*.7);
    skyUniforms.horizon.value.lerp(this.skyColors[5],this.rainAmount*.7);
    if (nether) { skyUniforms.zenith.value.set('#260b08'); skyUniforms.horizon.value.set('#481a13'); }
    if (end) { skyUniforms.zenith.value.set('#15111e'); skyUniforms.horizon.value.set('#181322'); }
    skyUniforms.dusk.value = nether || end ? 0 : (1 - clamp(Math.abs(altitude) * 4, 0, 1)) * (1 - this.rainAmount);
    const direction = this.scratchDirection.set(Math.cos(angle),altitude,-.1).normalize(); skyUniforms.sunDir.value.copy(direction); this.sunDirection.value.copy(direction);
    this.sky.position.copy(eye); this.stars.position.copy(eye); this.stars.rotation.z = angle;
    this.sun.position.copy(eye).addScaledVector(direction, 330); this.sun.lookAt(eye);
    this.moon.position.copy(eye).addScaledVector(direction, -330); this.moon.lookAt(eye);
    this.sun.visible = !nether && !end; this.moon.visible = !nether && !end; this.stars.visible = !nether && !end;
    this.sun.material.opacity = 1 - this.rainAmount * .85; this.moon.material.opacity = 1 - this.rainAmount * .85;
    this.stars.material.opacity = Math.pow(1 - daylight, 2) * (1 - this.rainAmount);
    this.hemi.intensity = .18 + daylight * 1.35; this.sunLight.intensity = daylight * .75;
    this.sunLight.position.copy(eye).addScaledVector(direction, 100); this.sunLight.target.position.copy(eye); this.sunLight.target.updateMatrixWorld();
    this.clouds.visible = this.settings.clouds !== false && !nether && !end;
    this.clouds.position.x = Math.floor(eye.x / 128) * 128 + this.time * .22 % 128;
    this.clouds.position.z = Math.floor(eye.z / 128) * 128; this.clouds.material.color.setScalar(.14 + daylight * .86 - this.rainAmount * .3);
    const r = (this.settings.renderDistance || 6) * 16;
    this.scene.fog.color.copy(skyUniforms.horizon.value); this.scene.fog.near = r * .48; this.scene.fog.far = r * .92;
    if (nether) { this.scene.fog.near = 7; this.scene.fog.far = r * .72; }
    if (end) { this.scene.fog.near = r * .65; this.scene.fog.far = r * 1.3; }
    const skylight=world.getLight(Math.floor(eye.x),Math.floor(eye.y),Math.floor(eye.z))[0]/15;
    this.caveAmount=lerp(this.caveAmount || 0,world.dimension==='overworld'&&eye.y<SEA&&skylight<.25?1:0,Math.min(1,dt*2));
    if(this.caveAmount>.01){this.scene.fog.color.lerp(this.skyColors[0],this.caveAmount*.94);this.scene.fog.near=lerp(this.scene.fog.near,8,this.caveAmount);this.scene.fog.far=lerp(this.scene.fog.far,44,this.caveAmount);}
    const submerged = fluidAt(world, eye.x, eye.y, eye.z);
    if (submerged === B.WATER) { this.scene.fog.color.set('#153a85'); this.scene.fog.near = .4; this.scene.fog.far = 17; }
    if (submerged === B.LAVA) { this.scene.fog.color.set('#cf4b0b'); this.scene.fog.near = .05; this.scene.fog.far = 2.4; }
  }
  render(game, dt) {
    if (this.contextLost) return;
    this.renderer.info.reset();
    const environmentDt = animationStep(game, dt);
    this.time += environmentDt; this.atlas.animate(this.time);
    this.effectTime.value=this.time; this.waterDetail.value=this.settings.richWater===false?0:1;
    this.flameIntensity.value=.98+.015*Math.sin(this.time*7)+.005*Math.sin(this.time*13.7);
    const { world, player } = game; if (!world || !player) return;
    const alpha = game.interpolation ?? 1;
    const eye = this.scratchEye.set(lerp(player.previous.x, player.pos.x, alpha), lerp(player.previous.y, player.pos.y, alpha) + player.eyeHeight, lerp(player.previous.z, player.pos.z, alpha));
    if (game.screen === 'title' || game.screen === 'worlds' || game.screen === 'create') {
      eye.y += 5; this.camera.position.copy(eye); this.camera.rotation.set(-.12, this.time * .018 + .9, 0, 'YXZ');
    } else {
      this.camera.position.copy(eye); this.camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
      if (this.settings.bobbing && player.onGround && !game.paused && player.perspective === 0) {
        const amount = Math.min(1, player.walkSpeed / 4.3), phase = player.walkDistance * 1.7;
        this.camera.position.y += Math.abs(Math.sin(phase)) * .045 * amount;
        this.camera.rotation.z += Math.sin(phase) * .006 * amount;
      }
      if (player.hurtTime > .25) this.camera.rotation.z += Math.sin(player.hurtTime * 24) * .055;
      if (player.perspective) {
        const direction = V(0, 0, player.perspective === 1 ? 1 : -1).applyEuler(this.camera.rotation), hit = world.raycast(eye, direction, 4.2);
        this.camera.position.addScaledVector(direction, hit ? Math.max(.2, hit.distance - .25) : 4);
        if (player.perspective === 2) this.camera.lookAt(eye);
      }
    }
    const fov = (this.settings.fov || 70) + (player.sprinting ? 8 : 0) + (player.flying && player.sprinting ? 8 : 0);
    if(Math.abs(this.camera.fov-fov)>.01){this.camera.fov=lerp(this.camera.fov,fov,Math.min(1,dt*9));this.camera.updateProjectionMatrix();}
    this.updateWeather(world, player, environmentDt); this.updateSky(world, environmentDt, this.camera.position);
    this.updateChests(game, dt);
    this.tickParticles(game.paused ? 0 : dt, world); this.viewmodel(player, game, dt);
    this.renderer.setClearColor(this.scene.fog.color, 1); this.renderer.clear(); this.renderer.render(this.scene, this.camera);
    if (game.screen === 'playing' && !player.perspective && !game.hideHUD && player.health > 0) { this.renderer.clearDepth(); this.renderer.render(this.viewScene, this.viewCamera); }
  }
}
