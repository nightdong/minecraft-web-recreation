import * as THREE from 'three';
import { B, blocks, isOpaque, textureFor, boxFor } from '../core/blocks.js';
import { HEIGHT, index } from '../core/world.js';
import { hash } from '../core/noise.js';
import { wireConnections } from '../core/redstone.js';
import { mechanismParts } from './mechanisms.js';
import { fluidCorner } from '../core/fluids.js';
import { FlatFaceCollector } from './greedy.js';

export const FACES = [
  { n: [1, 0, 0], v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: .75 },
  { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: .75 },
  { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1 },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: .50 },
  { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: .88 },
  { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: .88 }
];
class Builder {
  constructor() { this.positions = []; this.colors = []; this.uvs = []; this.tiles = null; this.lights = []; this.indices = []; this.normals = []; }
  face(vertices, uv, colors, lights, normal, flip = false, tile = [0, 0, 0, 0]) {
    const start = this.positions.length / 3;
    if (!this.tiles && tile[2] > 0) this.tiles = Array(start * 4).fill(0);
    const tex = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]];
    for (let i = 0; i < 4; i++) {
      this.positions.push(...vertices[i]); this.uvs.push(...tex[i]); this.colors.push(...colors[i]);
      this.lights.push(...lights[i]); this.normals.push(...normal);
      if (this.tiles) this.tiles.push(...tile);
    }
    this.indices.push(...(flip ? [0, 1, 3, 1, 2, 3] : [0, 1, 2, 0, 2, 3]).map(i => i + start));
  }
  geometry() {
    if (!this.positions.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    // Axis normals and integer light levels have exact compact representations.
    // Keep positions, UVs and AO colors at full precision; do not reduce texels.
    g.setAttribute('normal', new THREE.Int8BufferAttribute(this.normals.map(value => value * 127), 3, true));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('voxelLight', new THREE.Uint8BufferAttribute(this.lights, 2));
    if (this.tiles) g.setAttribute('voxelTile', new THREE.Float32BufferAttribute(this.tiles, 4));
    g.setIndex(this.indices); g.computeBoundingSphere(); return g;
  }
}
const shadeRGB = factor => [factor, factor, factor];
const FULL = [0, 0, 0, 1, 1, 1];

export function meshChunk(world, chunk, atlas, smooth = true, greedy = true) {
  const solid = new Builder(), cutout = new Builder(), liquid = new Builder();
  const flat = new FlatFaceCollector();
  const neighbors = [];
  for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) {
    const c = world.ensure(chunk.cx + x, chunk.cz + z); neighbors.push(c);
  }
  // Generate all guard chunks before propagating light so request order cannot
  // hide a light source that lives across a boundary.
  for (const neighbor of neighbors) world.light(neighbor);
  const locate = (x, z) => neighbors[(z < 0 ? 0 : z > 15 ? 2 : 1) * 3 + (x < 0 ? 0 : x > 15 ? 2 : 1)];
  const get = (x, y, z) => y < 0 ? (world.dimension === 'end' ? B.AIR : B.BEDROCK) : y >= HEIGHT ? B.AIR : locate(x, z).data[index(x & 15, y, z & 15)];
  const light = (x, y, z) => {
    if (y < 0) return [0, 0]; if (y >= HEIGHT) return [15, 0];
    const c = locate(x, z), i = index(x & 15, y, z & 15); return [c.sky[i], c.glow[i]];
  };
  const occludes = (x, y, z) => isOpaque(get(x, y, z));
  const ox = chunk.cx * 16, oz = chunk.cz * 16;
  const pushBox = (x, y, z, id, state, bounds = FULL, builder = solid, force = false, crop, part) => {
    const def = blocks[id];
    for (let f = 0; f < 6; f++) {
      const face = FACES[f], n = face.n, adjacent = get(x + n[0], y + n[1], z + n[2]);
      const axis = f < 2 ? 0 : f < 4 ? 1 : 2;
      const onEdge = n[axis] > 0 ? bounds[axis + 3] === 1 : bounds[axis] === 0;
      if (!force && onEdge && (isOpaque(adjacent) || (id === adjacent && (def.leaves || def.glass || def.liquid)))) continue;
      if (def.liquid && adjacent === id) continue;
      const vertices = face.v.map(v => [x + bounds[0] + v[0] * (bounds[3] - bounds[0]), y + bounds[1] + v[1] * (bounds[4] - bounds[1]), z + bounds[2] + v[2] * (bounds[5] - bounds[2])]);
      const tangents = [0, 1, 2].filter(a => !n[a]), ao = [], colors = [], lights = [];
      const base = light(x + n[0], y + n[1], z + n[2]);
      const selfLight = light(x, y, z);
      for (let v = 0; v < 4; v++) {
        let factor = 1, sunlight = Math.max(base[0], def.opaque ? 0 : selfLight[0]), glow = Math.max(base[1], def.light || 0);
        if (smooth && bounds === FULL && !def.liquid && !def.light) {
          const a = [x + n[0], y + n[1], z + n[2]], b = [...a], c = [...a];
          const sa = face.v[v][tangents[0]] ? 1 : -1, sb = face.v[v][tangents[1]] ? 1 : -1;
          a[tangents[0]] += sa; b[tangents[1]] += sb; c[tangents[0]] += sa; c[tangents[1]] += sb;
          const side1 = occludes(...a), side2 = occludes(...b), corner = occludes(...c);
          const count = side1 && side2 ? 3 : Number(side1) + Number(side2) + Number(corner);
          factor = [1, .84, .70, .57][count];
          const samples = [base, light(...a), light(...b), light(...c)];
          sunlight = Math.max(...samples.map(l => l[0])); glow = Math.max(...samples.map(l => l[1]));
        }
        ao.push(factor);
        const shade = Math.pow(factor * (def.light ? 1 : face.shade), 1.6);
        colors.push(shadeRGB(shade)); lights.push([sunlight, glow]);
      }
      const texture = typeof part?.texture === 'string' ? part.texture : part?.texture?.[f] || textureFor(id, f, state);
      const uv = atlas.uv(texture, crop);
      if (part?.transform) for (const vertex of vertices) {
        const transformed = part.transform([vertex[0] - x, vertex[1] - y, vertex[2] - z]);
        vertex[0] = transformed[0] + x; vertex[1] = transformed[1] + y; vertex[2] = transformed[2] + z;
      }
      if (def.shape === 'torch' && state) {
        const dir = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]][state] || [0, 0];
        for (const v of vertices) { const h = v[1] - y; v[0] += dir[0] * (.38 - h * .25); v[2] += dir[1] * (.38 - h * .25); v[1] += .18; }
      }
      const uniform = greedy && bounds === FULL && def.opaque && builder === solid && !part && colors.every(c => c.every((value, axis) => value === colors[0][axis])) && lights.every(l => l[0] === lights[0][0] && l[1] === lights[0][1]);
      if (uniform) flat.add(f, vertices, uv, colors[0], lights[0]);
      else builder.face(vertices, uv, colors, lights, n, ao[0] + ao[2] > ao[1] + ao[3]);
    }
  };
  for (let y = 0; y <= chunk.maxHeight; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const i = index(x, y, z), id = chunk.data[i]; if (!id) continue;
    const def = blocks[id], state = chunk.state[i];
    const mechanism = mechanismParts(id, state);
    if (mechanism) {
      for (const part of mechanism) pushBox(x, y, z, id, state, part.bounds, solid, true, part.crop, part);
    } else if (def.shape === 'wire') {
      const connections = wireConnections(world, x + ox, y, z + oz), arms = new Set(connections.map(c => c.direction));
      if (arms.size === 1) arms.add(([...arms][0] + 2) & 3);
      if (arms.size === 0) for (const a of [0, 1, 2, 3]) arms.add(a);
      const strips = [[.375, .375, .625, .625]];
      for (const a of arms) strips.push([[.4375, 0, .5625, .5], [.5, .4375, 1, .5625], [.4375, .5, .5625, 1], [0, .4375, .5, .5625]][a]);
      const color = [state ? .3 + state / 15 * .7 : .16, state ? .006 + state / 15 * .025 : .003, .001], lit = light(x, y, z);
      const quad = vertices => cutout.face(vertices, atlas.uv('redstone_dust'), Array(4).fill(color), Array(4).fill(lit), [0, 1, 0]);
      for (const [x0, z0, x1, z1] of strips) quad([[x + x0, y + .02, z + z1], [x + x1, y + .02, z + z1], [x + x1, y + .02, z + z0], [x + x0, y + .02, z + z0]]);
      for (const connection of connections) if (connection.y > y) {
        const [dx, dz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][connection.direction];
        const a = [x + .5 + dx * .49, y + .02, z + .5 + dz * .49];
        quad([[a[0] - dz * .0625, a[1], a[2] + dx * .0625], [a[0] + dz * .0625, a[1], a[2] - dx * .0625], [a[0] + dz * .0625, y + 1.02, a[2] - dx * .0625], [a[0] - dz * .0625, y + 1.02, a[2] + dx * .0625]]);
      }
    } else if (def.shape === 'fire') {
      const planes = [
        [[.1, 0, .1], [.9, 0, .9], [.8, 1.05, .8], [.2, 1.05, .2]],
        [[.1, 0, .9], [.9, 0, .1], [.8, 1.05, .2], [.2, 1.05, .8]],
        [[0, 0, .03], [1, 0, .03], [.95, 1, .2], [.05, 1, .2]],
        [[1, 0, .97], [0, 0, .97], [.05, 1, .8], [.95, 1, .8]],
        [[.03, 0, 1], [.03, 0, 0], [.2, 1, .05], [.2, 1, .95]],
        [[.97, 0, 0], [.97, 0, 1], [.8, 1, .95], [.8, 1, .05]]
      ];
      for (const plane of planes) cutout.face(plane.map(v => [x + v[0], y + v[1], z + v[2]]), atlas.uv('fire'), Array(4).fill([1, 1, 1]), Array(4).fill([15, 15]), [0, 1, 0]);
    } else if (def.shape === 'cross' || def.shape === 'crop') {
      const h = def.shape === 'crop' ? 1 : id === B.TALL_GRASS ? 1 : .9;
      const dx = (hash(ox + x, 0, oz + z, 51) - .5) * .25, dz = (hash(ox + x, 1, oz + z, 52) - .5) * .25;
      const planes = def.shape === 'crop' ? [
        [[0, 0, .25], [1, 0, .25], [1, 1, .25], [0, 1, .25]], [[0, 0, .75], [1, 0, .75], [1, 1, .75], [0, 1, .75]],
        [[.25, 0, 0], [.25, 0, 1], [.25, 1, 1], [.25, 1, 0]], [[.75, 0, 0], [.75, 0, 1], [.75, 1, 1], [.75, 1, 0]]
      ] : [[[.05, 0, .05], [.95, 0, .95], [.95, h, .95], [.05, h, .05]], [[.05, 0, .95], [.95, 0, .05], [.95, h, .05], [.05, h, .95]]];
      const lit = light(x, y, z);
      for (const p of planes) cutout.face(p.map(v => [x + v[0] + dx, y + v[1], z + v[2] + dz]), atlas.uv(textureFor(id, 4)), [shadeRGB(.88), shadeRGB(.88), shadeRGB(1), shadeRGB(1)], [lit, lit, lit, lit], [0, 1, 0]);
    } else if (def.shape === 'torch') pushBox(x, y, z, id, state, [.4375, 0, .4375, .5625, .625, .5625], cutout, true, [7 / 16, 2 / 16, 9 / 16, 1]);
    else if (def.liquid) {
      const visible = FACES.map(face => { const n = face.n, next = get(x + n[0], y + n[1], z + n[2]); return next !== id && !isOpaque(next); });
      if (!visible.some(Boolean)) continue;
      const heights = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dz]) => fluidCorner(world, ox + x + dx, y, oz + z + dz, id));
      const builder = id === B.WATER ? liquid : solid, self = light(x, y, z);
      FACES.forEach((face, f) => {
        if (!visible[f]) return;
        const vertices = face.v.map(v => [x + v[0], y + (v[1] ? heights[v[0] + v[2] * 2] : 0), z + v[2]]);
        const neighbor = light(x + face.n[0], y + face.n[1], z + face.n[2]);
        const illumination = [Math.max(self[0], neighbor[0]), Math.max(self[1], neighbor[1], def.light || 0)];
        const shade = def.light ? 1 : Math.pow(face.shade, 1.6);
        builder.face(vertices, atlas.uv(textureFor(id, f)), Array(4).fill([shade, shade, shade]), Array(4).fill(illumination), face.n);
      });
    } else if (def.shape === 'end_frame') {
      pushBox(x, y, z, id, 0, [0, 0, 0, 1, .8125, 1], solid);
      if (state & 4) pushBox(x, y, z, id, state, [.3125, .8125, .3125, .6875, 1, .6875], solid, true, [.3125, .3125, .6875, .6875], { texture: 'end_frame_eye' });
    } else if (def.shape === 'end_portal') {
      cutout.face([[x, y + .75, z + 1], [x + 1, y + .75, z + 1], [x + 1, y + .75, z], [x, y + .75, z]], atlas.uv('end_portal'), Array(4).fill([1, 1, 1]), Array(4).fill([0, 15]), [0, 1, 0]);
    } else if (def.shape === 'bars') {
      for (const verts of [[[.5, 0, 0], [.5, 0, 1], [.5, 1, 1], [.5, 1, 0]], [[0, 0, .5], [1, 0, .5], [1, 1, .5], [0, 1, .5]]]) cutout.face(verts.map(v => [x + v[0], y + v[1], z + v[2]]), atlas.uv('iron_bars'), Array(4).fill([.8, .8, .8]), Array(4).fill(light(x, y, z)), [0, 1, 0]);
    } else if (def.shape === 'egg') {
      for (const bounds of [[.3125, 0, .3125, .6875, .125, .6875], [.1875, .125, .1875, .8125, .3125, .8125], [.125, .3125, .125, .875, .6875, .875], [.1875, .6875, .1875, .8125, .875, .8125], [.3125, .875, .3125, .6875, 1, .6875]]) pushBox(x, y, z, id, state, bounds);
    } else if (def.shape === 'stairs') {
      pushBox(x, y, z, id, state, state & 4 ? [0, .5, 0, 1, 1, 1] : [0, 0, 0, 1, .5, 1]);
      const box = [[0, .5, .5, 1, 1, 1], [0, .5, 0, .5, 1, 1], [0, .5, 0, 1, 1, .5], [.5, .5, 0, 1, 1, 1]][state & 3];
      pushBox(x, y, z, id, state, state & 4 ? [box[0], 1 - box[4], box[2], box[3], 1 - box[1], box[5]] : box);
    } else if (def.shape === 'fence') {
      pushBox(x, y, z, id, state, [.375, 0, .375, .625, 1, .625], solid, true);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (blocks[get(x + dx, y, z + dz)]?.solid) {
        for (const bottom of [.375, .75]) {
          const box = dx ? [dx > 0 ? .5 : 0, bottom, .4375, dx > 0 ? 1 : .5, bottom + .125, .5625] : [.4375, bottom, dz > 0 ? .5 : 0, .5625, bottom + .125, dz > 0 ? 1 : .5];
          pushBox(x, y, z, id, state, box, solid, true);
        }
      }
    } else if (def.shape === 'ladder' || def.shape === 'portal') {
      let verts;
      if (def.shape === 'portal') verts = state & 1 ? [[.5, 0, 0], [.5, 0, 1], [.5, 1, 1], [.5, 1, 0]] : [[0, 0, .5], [1, 0, .5], [1, 1, .5], [0, 1, .5]];
      else verts = [ [[0, 0, .96], [1, 0, .96], [1, 1, .96], [0, 1, .96]], [[.04, 0, 0], [.04, 0, 1], [.04, 1, 1], [.04, 1, 0]], [[1, 0, .04], [0, 0, .04], [0, 1, .04], [1, 1, .04]], [[.96, 0, 1], [.96, 0, 0], [.96, 1, 0], [.96, 1, 1]] ][state & 3];
      const l = light(x, y, z); l[1] = Math.max(l[1], def.light || 0);
      cutout.face(verts.map(v => [x + v[0], y + v[1], z + v[2]]), atlas.uv(textureFor(id, 4)), Array(4).fill([1, 1, 1]), Array(4).fill(l), [0, 0, 1]);
    } else if (id === B.CHEST) continue; // Dynamic hollow chest and hinged lid are rendered separately.
    else if (id === B.CACTUS) pushBox(x, y, z, id, state, [.0625, 0, .0625, .9375, 1, .9375]);
    else pushBox(x, y, z, id, state, def.shape === 'cube' ? FULL : boxFor(id, state) || FULL, def.glass ? cutout : solid);
  }
  const merged = flat.flush(face => {
    const repeated = face.width > 1 || face.height > 1;
    solid.face(face.vertices, repeated ? [0, 0, face.width, face.height] : face.uv, Array(4).fill(face.color), Array(4).fill(face.light), FACES[face.faceIndex].n, false, repeated ? face.uv : [0, 0, 0, 0]);
  });
  const result = { solid: solid.geometry(), cutout: cutout.geometry(), liquid: liquid.geometry() };
  if (result.solid) result.solid.userData.mergedFaces = merged;
  return result;
}

export function texturedBox(atlas, textures, dimensions = [1, 1, 1], unshaded = false) {
  const geo = new THREE.BoxGeometry(...dimensions), uv = geo.attributes.uv, color = [];
  for (let f = 0; f < 6; f++) {
    const t = Array.isArray(textures) ? textures[f] || textures[0] : textures;
    const [u0, v0, u1, v1] = atlas.uv(t), shade = unshaded ? 1 : Math.pow(FACES[f].shade, 1.5);
    for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0)); color.push(shade, shade, shade); }
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(color, 3)); return geo;
}
export function blockGeometry(atlas, id) {
  const parts = mechanismParts(id, id === B.PISTON ? 2 : 0);
  if (!parts) return texturedBox(atlas, Array.from({ length: 6 }, (_, f) => textureFor(id, f)));
  const builder = new Builder();
  for (const part of parts) for (let f = 0; f < 6; f++) {
    const face = FACES[f], bounds = part.bounds;
    const vertices = face.v.map(v => {
      let point = v.map((value, axis) => bounds[axis] + value * (bounds[axis + 3] - bounds[axis]));
      if (part.transform) point = part.transform(point); return point.map(value => value - .5);
    });
    const texture = typeof part.texture === 'string' ? part.texture : part.texture?.[f] || textureFor(id, f, 2);
    builder.face(vertices, atlas.uv(texture, part.crop), Array(4).fill([face.shade, face.shade, face.shade]), Array(4).fill([15, 0]), face.n);
  }
  return builder.geometry();
}

export function extrudedItem(atlas, item) {
  const image = atlas.itemSprite(item), data = image.getContext('2d').getImageData(0, 0, 16, 16).data;
  const b = new Builder();
  const exists = (x, y) => x >= 0 && x < 16 && y >= 0 && y < 16 && data[(x + y * 16) * 4 + 3] > 100;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (exists(x, y)) {
    const i = (x + y * 16) * 4, c = new THREE.Color(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255).convertSRGBToLinear();
    for (let f = 0; f < 6; f++) {
      const face = FACES[f];
      if (f === 0 && exists(x + 1, y) || f === 1 && exists(x - 1, y) || f === 2 && exists(x, y - 1) || f === 3 && exists(x, y + 1)) continue;
      const vs = face.v.map(v => [(x + v[0]) / 16 - .5, .5 - (y + 1 - v[1]) / 16, (v[2] - .5) / 16]);
      b.face(vs, [0, 0, 1, 1], Array(4).fill([c.r * face.shade, c.g * face.shade, c.b * face.shade]), Array(4).fill([15, 0]), face.n);
    }
  }
  return b.geometry();
}
