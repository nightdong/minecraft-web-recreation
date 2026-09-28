import test from 'node:test';
import assert from 'node:assert/strict';
import { FlatFaceCollector } from '../src/render/greedy.js';
import { FACES, meshChunk } from '../src/render/mesher.js';
import { World } from '../src/core/world.js';
import { B, blocks } from '../src/core/blocks.js';

const names = [...new Set(blocks.filter(Boolean).flatMap(block => Array.isArray(block.texture) ? block.texture : [block.texture]))];
const atlas = { uv: name => { const i = Math.max(0, names.indexOf(name)); return [i / 256, 0, (i + .5) / 256, .5]; } };

test('greedy rectangles cover every input cell exactly once, in all six orientations', () => {
  for (let f = 0; f < 6; f++) {
    const collector = new FlatFaceCollector(), face = FACES[f], axis = face.n.findIndex(v => v), tangents = [0, 1, 2].filter(a => a !== axis), result = [];
    for (let u = 0; u < 6; u++) for (let v = 0; v < 5; v++) {
      const origin = [0, 0, 0]; origin[tangents[0]] = u; origin[tangents[1]] = v;
      const vertices = face.v.map(point => point.map((value, a) => value + origin[a]));
      collector.add(f, vertices, [0, 0, .5, .5], [1, 1, 1], [15, 0]);
    }
    const count = collector.flush(face => result.push(face)); assert.equal(count.inputFaces, 30); assert.equal(count.outputFaces, 1);
    assert.equal(result[0].width * result[0].height, 30);
    const points = result[0].vertices;
    for (const a of tangents) assert.equal(Math.max(...points.map(p => p[a])) - Math.min(...points.map(p => p[a])), a === tangents[0] ? 6 : 5);
  }
});

test('texture changes, differing light and a missing cell cannot be bridged by a greedy face', () => {
  const collector = new FlatFaceCollector(), result = [];
  for (let x = 0; x < 5; x++) if (x !== 2) collector.add(2, FACES[2].v.map(v => [v[0] + x, v[1], v[2]]), x === 4 ? [.5, 0, 1, .5] : [0, 0, .5, .5], [1, 1, 1], [x === 3 ? 14 : 15, 0]);
  collector.flush(face => result.push(face)); assert.equal(result.length, 3);
  assert.equal(result.reduce((n, r) => n + r.width * r.height, 0), 4);
});

function surfaceCells(geometry) {
  const result = new Map(); if (!geometry) return result;
  const { position: p, normal: n, color: c, voxelLight: l, uv, voxelTile: tile } = geometry.attributes;
  for (let i = 0; i < p.count; i += 4) {
    const points = [0, 1, 2, 3].map(v => [p.getX(i + v), p.getY(i + v), p.getZ(i + v)]);
    if (points.some(p => p[1] < 120)) continue;
    const a = points[0], b = points[1], d = points[3], width = Math.round(Math.hypot(...b.map((v, k) => v - a[k]))), height = Math.round(Math.hypot(...d.map((v, k) => v - a[k])));
    if (!width || !height) continue;
    const bounds = tile && tile.getZ(i) > 0 ? [tile.getX(i), tile.getY(i), tile.getZ(i), tile.getW(i)] : [uv.getX(i), uv.getY(i), uv.getX(i + 2), uv.getY(i + 2)];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const u = (x + .5) / width, v = (y + .5) / height;
      const center = a.map((value, k) => value + (b[k] - value) * u + (d[k] - value) * v);
      const light = [l.getX(i), l.getY(i)], color = [c.getX(i), c.getY(i), c.getZ(i)];
      const key = [...center, n.getX(i), n.getY(i), n.getZ(i)].map(n => n.toFixed(5)).join(',');
      assert.equal(result.has(key), false, `Overlapping face at ${key}`);
      result.set(key, [...bounds, ...light, ...color].map(n => n.toFixed(5)).join(','));
    }
  }
  return result;
}

test('optimized production meshes retain texture, exposed area and lighting while reducing triangles', () => {
  const world = new World('greedy-integrity');
  for (let z = 1; z < 15; z++) for (let x = 1; x < 15; x++) world.set(x, 120, z, x < 7 ? B.STONE : B.PLANKS, 0, false);
  for (let y = 121; y < 124; y++) world.set(8, y, 8, B.STONE, 0, false);
  world.set(4, 121, 4, B.TORCH, 0, false);
  const reference = meshChunk(world, world.ensure(0, 0), atlas, true, false), optimized = meshChunk(world, world.ensure(0, 0), atlas, true, true);
  assert.deepEqual(surfaceCells(optimized.solid), surfaceCells(reference.solid));
  assert.ok(optimized.solid.index.count < reference.solid.index.count, 'Real production mesh must have fewer triangles without losing faces');
  for (const meshes of [reference, optimized]) for (const geometry of Object.values(meshes)) geometry?.dispose();
});
