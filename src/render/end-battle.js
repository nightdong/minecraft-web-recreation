import * as THREE from 'three';
import { B } from '../core/blocks.js';
import { dragonParts } from '../core/end-fight.js';
import { intersectBox } from '../core/world.js';
import { texturedBox } from './mesher.js';
import { ownedMesh, disposeOwnedObject } from './resources.js';

const vector = p => new THREE.Vector3(p.x, p.y, p.z);
const blend = (a, b, amount) => a + (b - a) * amount;

export function createDragonModel(atlas, sharedMaterial) {
  const root = new THREE.Group(), material = sharedMaterial.clone(), emissive = new THREE.MeshBasicMaterial({ color: 0xd06bff });
  const model = { root, material, wings: [], tail: [], neck: [], legs: [] };
  const box = (size, pos, parent = root, texture = 'dragon_skin', mat = material) => {
    const geometry = texturedBox(atlas, texture, size, true), mesh = ownedMesh(new THREE.Mesh(geometry, mat)); mesh.position.set(...pos); parent.add(mesh); return mesh;
  };
  const bone = (from, to, parent, thickness = .25) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), mesh = box([thickness, a.distanceTo(b), thickness], a.clone().add(b).multiplyScalar(.5).toArray(), parent);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize()); return mesh;
  };
  box([3.3, 2.8, 5.5], [0, 0, 0]);
  for (let i = -2; i <= 2; i++) box([.5, .65, .7], [0, 1.55, i], root, 'dragon_spine');
  for (let i = 0; i < 4; i++) {
    const neck = box([1.2, 1.2, 1.35], [0, .15 + i * .15, 3 + i * .95]); model.neck.push(neck);
    box([.3, .6, .5], [0, .85 + i * .15, 3 + i * .95], root, 'dragon_spine');
  }
  model.head = new THREE.Group(); model.head.position.set(0, .7, 6.7); root.add(model.head);
  box([2.1, 1.6, 2.2], [0, 0, .3], model.head); box([2, .8, 2], [0, -.35, 1.6], model.head);
  for (const side of [-1, 1]) {
    box([.36, .27, .8], [side * 1.06, .14, .66], model.head, 'dragon_eye', emissive);
    const horn = box([.4, 1.1, .5], [side * .77, 1.18, -.3], model.head, 'dragon_spine'); horn.rotation.x = -.22;
    box([.25, .18, .3], [side * .55, -.1, 2.57], model.head, 'dragon_spine');
  }
  model.jaw = new THREE.Group(); model.jaw.position.set(0, -.7, .1); model.head.add(model.jaw);
  box([2, .33, 2.8], [0, -.12, 1.1], model.jaw);
  for (let i = 0; i < 8; i++) {
    const size = Math.max(.25, 1.25 - i * .13), tail = box([size, size, 1.65], [0, .1 + i * .08, -3.3 - i * 1.4]); model.tail.push(tail);
    box([Math.max(.15, size * .3), size * .6, .5], [0, .3 + size / 2 + i * .08, -3.3 - i * 1.4], root, 'dragon_spine');
  }
  for (const side of [-1, 1]) {
    const wing = new THREE.Group(); wing.position.set(side * 1.5, .9, 1.3); root.add(wing); model.wings.push(wing);
    const points = [[0, 0, 0], [side * 4.5, .2, 1.2], [side * 11, .1, -1.2], [side * 7.5, 0, -6.4], [side * 2, -.1, -4.5]];
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4]); geometry.computeVertexNormals();
    const membrane = ownedMesh(new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: 0x201d25, side: THREE.DoubleSide }))); wing.add(membrane);
    bone(points[0], points[1], wing, .42); bone(points[1], points[2], wing, .27); bone(points[1], points[3], wing, .15); bone(points[0], points[4], wing, .18);
    for (const z of [-1.9, 1.3]) {
      const leg = new THREE.Group(); leg.position.set(side * 1.2, -.9, z); root.add(leg); model.legs.push(leg);
      bone([0, 0, 0], [side * .7, -1.6, -.6], leg, .65); bone([side * .7, -1.6, -.6], [side * .65, -2.8, .1], leg, .45);
      box([.75, .35, 1.3], [side * .65, -2.8, .45], leg);
      for (const x of [-.2, .2]) box([.16, .2, .5], [side * .65 + x, -2.8, 1.1], leg, 'dragon_spine');
    }
  }
  return model;
}

export class EndBattleView {
  constructor(game, system) {
    this.game = game; this.system = system; this.fight = game.world.endFight; this.scene = game.graphics.scene; this.root = new THREE.Group(); this.scene.add(this.root);
    this.dragon = createDragonModel(game.atlas, game.graphics.entityMaterial); this.root.add(this.dragon.root);
    this.crystals = this.fight.pillars.map((pillar, index) => {
      const root = new THREE.Group(), spin = new THREE.Group(); root.add(spin); this.root.add(root);
      for (const [size, color, opacity] of [[1.15, 0xf1cafb, .7], [.75, 0xe250dd, .55], [.35, 0xffffff, 1]]) {
        const mesh = ownedMesh(new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshBasicMaterial({ color, wireframe: size > .9, transparent: opacity < 1, opacity, fog: false })));
        mesh.rotation.set(.5, .5, .5); spin.add(mesh);
      }
      root.position.copy(vector(this.fight.crystalPosition(index))); return { root, spin, index };
    });
    this.beam = ownedMesh(new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, 1, 4, 1, true), new THREE.MeshBasicMaterial({ color: 0xc8a0e5, side: THREE.DoubleSide, transparent: true, opacity: .75, depthWrite: false })));
    this.root.add(this.beam);
    const cloudGeometry = new THREE.BufferGeometry(); cloudGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(1200 * 3), 3));
    this.clouds = ownedMesh(new THREE.Points(cloudGeometry, new THREE.PointsMaterial({ color: 0xbd3dd0, size: .2, transparent: true, opacity: .6, depthWrite: false }))); this.clouds.frustumCulled = false; this.root.add(this.clouds);
  }
  hitTest(origin, direction, reach) {
    const s = this.fight.state, o = [origin.x, origin.y, origin.z], d = [direction.x, direction.y, direction.z]; let nearest = null;
    const check = (box, mob) => {
      const hit = intersectBox(o, d, box);
      if (hit && hit.distance <= reach && (!nearest || hit.distance < nearest.distance)) nearest = { ...hit, mob };
    };
    for (let i = 0; i < s.crystals.length; i++) if (s.crystals[i]) {
      const p = this.fight.crystalPosition(i); check([p.x - .9, p.y - .7, p.z - .9, p.x + .9, p.y + 1.1, p.z + .9], { boss: true, kind: 'crystal', index: i, pos: p, health: 1 });
    }
    if (s.health > 0) for (const part of dragonParts(s)) check(part.box, { boss: true, kind: 'dragon', part: part.name, pos: part.center, get health() { return s.health; } });
    return nearest;
  }
  hit(target, damage, cause) {
    if (target.kind === 'crystal') { const changed = this.fight.destroyCrystal(target.index); if (changed) target.health = 0; return changed; }
    return this.fight.damage(damage, target.part, cause);
  }
  tick() {
    const state = this.fight.state, world = this.game.world;
    if (state.phase === 'approach' && state.phaseTicks === 0) {
      // The generated island is not a flat y=63 test platform. Keep the full
      // landing model above its real head/legs footprint without rewriting terrain.
      let floor = 62;
      for (let z = -10; z <= 10; z += 2) for (let x = -10; x <= 10; x += 2) floor = Math.max(floor, world.surface(x + .5, z + .5));
      state.landingY = Math.max(65.5, floor + 2.8);
    }
    this.fight.tick(this.game.player);
    for (const cloud of state.clouds) if (cloud.age === 0) cloud.pos.y = world.surface(cloud.pos.x, cloud.pos.z);
    for (const event of this.fight.events.splice(0)) {
      if (event.type === 'crystalExplosion') { this.system.explode(event.position.x, event.position.y, event.position.z, 6); this.game.audio.play('explode'); }
      if (event.type === 'dragonHurt') this.game.audio.play('dragon_hurt', 'stone', .8);
      if (event.type === 'dragonBreath') this.game.audio.play('dragon_breath', 'stone', .6);
      if (event.type === 'dragonProjectile') this.system.shoot(event.position, event.direction, 1, 'mob', 'dragon_breath');
      if (event.type === 'deathParticles') this.game.graphics.burst(event.position.x - 1.5, event.position.y, event.position.z - 1.5, B.END_PORTAL_FRAME, 16, 2);
      if (event.type === 'dragonDefeated') {
        const world = this.game.world;
        for (let z = -2; z <= 2; z++) for (let x = -2; x <= 2; x++) if (x || z) world.set(x, 63, z, B.END_PORTAL, 0, false);
        world.set(0, 67, 0, B.DRAGON_EGG, 0, false);
        for (let i = 0; i < 20; i++) this.system.xp(event.xp / 20, { x: Math.sin(i) * 2, y: 67 + i * .08, z: Math.cos(i) * 2 });
        this.game.advancement('free_end'); this.game.audio.play('dragon_death');
      }
    }
  }
  render(alpha) {
    const s = this.fight.state, m = this.dragon, t = s.ticks + alpha;
    m.root.visible = !s.defeated; m.root.position.set(blend(this.fight.previous.x, s.pos.x, alpha), blend(this.fight.previous.y, s.pos.y, alpha), blend(this.fight.previous.z, s.pos.z, alpha));
    m.root.rotation.set(s.phase === 'dying' ? -.2 : 0, s.yaw, s.phase === 'dying' ? s.deathTicks * .015 : 0);
    m.material.color.setRGB(s.hurt ? 1 : 1.05, s.hurt ? .3 : 1.05, s.hurt ? .4 : 1.1);
    const flap = Math.sin(t * (s.phase === 'perch' ? .07 : .23));
    m.wings.forEach((wing, i) => { wing.rotation.z = (i ? -1 : 1) * (.25 + flap * .65); wing.rotation.y = Math.sin(t * .23 + .4) * .12 * (i ? 1 : -1); });
    m.tail.forEach((tail, i) => { tail.position.x = Math.sin(t * .07 - i * .45) * (i + 1) * .12; tail.rotation.y = Math.sin(t * .07 - i * .45) * .1; });
    m.neck.forEach((neck, i) => { neck.position.y = .15 + i * .15 + Math.sin(t * .1 - i) * .04; });
    m.jaw.rotation.x = s.phase === 'perch' ? .18 + Math.max(0, Math.sin(t * .06)) * .35 : .06;
    m.legs.forEach(leg => { leg.rotation.x = s.phase === 'perch' ? .1 : .7 + flap * .12; });
    for (const crystal of this.crystals) {
      crystal.root.visible = s.crystals[crystal.index]; crystal.spin.rotation.set(t * .017, t * .03, t * .011);
      crystal.spin.position.y = Math.sin(t * .12 + crystal.index) * .16;
    }
    this.beam.visible = s.healing >= 0 && s.health > 0;
    if (this.beam.visible) {
      const a = vector(this.fight.crystalPosition(s.healing)), b = vector(s.pos), direction = b.clone().sub(a);
      this.beam.position.copy(a).add(b).multiplyScalar(.5); this.beam.scale.y = direction.length(); this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    }
    const attribute = this.clouds.geometry.getAttribute('position'); let count = 0;
    for (const cloud of s.clouds) for (let i = 0; i < 80 && count < attribute.count; i++) {
      const r = Math.sqrt((i + .5) / 80) * Math.min(4.5, .7 + cloud.age * .07), a = i * 2.399 + t * .025;
      attribute.setXYZ(count++, cloud.pos.x + Math.cos(a) * r, cloud.pos.y + .25 + Math.sin(i * 1.2 + t * .1) * .3, cloud.pos.z + Math.sin(a) * r);
    }
    this.clouds.geometry.setDrawRange(0, count); attribute.needsUpdate = true;
  }
  diagnostics() {
    const s = this.fight.state;
    return { health: s.health, phase: s.phase, phaseTicks: s.phaseTicks, pos: { ...s.pos }, defeated: s.defeated, landingY: s.landingY,
      healing: s.healing, deathTicks: s.deathTicks, parts: dragonParts(s).map(part => ({ name: part.name, pos: part.center })),
      crystals: s.crystals.map((alive, i) => ({ index: i, alive, pos: this.fight.crystalPosition(i), cage: this.fight.pillars[i].cage })) };
  }
  dispose() { disposeOwnedObject(this.root); }
}
