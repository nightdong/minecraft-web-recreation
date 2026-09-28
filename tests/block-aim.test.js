import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/core/world.js';
import { B, selectionShapes } from '../src/core/blocks.js';
import { blockAimPoints } from './block-aim.mjs';

const direction = (from, to) => { const d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z); return { x: (to.x - from.x) / d, y: (to.y - from.y) / d, z: (to.z - from.z) / d }; };
test('a steep real mining ray can reach the requested front face when its center is occluded', () => {
  const world = new World('mining-visible-surface'), position = { x: 6, y: 119, z: 8 }, eye = { x: 6.4, y: 121.3, z: 10 };
  world.set(6, 119, 8, B.OBSIDIAN, 0, false); world.set(6, 120, 8, B.OBSIDIAN, 0, false);
  assert.equal(world.raycast(eye, direction(eye, { x: 6.5, y: 119.5, z: 8.5 }), 6).y, 120, 'The old center ray hits the upper frame block');
  const hits = blockAimPoints(position, B.OBSIDIAN, 0, eye).map(point => world.raycast(eye, direction(eye, point), 6));
  assert.ok(hits.some(hit => hit?.x === 6 && hit.y === 119 && hit.z === 8), 'A real surface ray must hit the intended frame block without deleting its neighbor');
});

test('mining aim candidates stay inside the production selection shapes of partial blocks', () => {
  for (const id of [B.TORCH, B.OAK_STAIRS, B.CHEST, B.IRON_BARS]) {
    const points = blockAimPoints({ x: 0, y: 0, z: 0 }, id, 0, { x: 3, y: 3, z: 3 }), shapes = selectionShapes(id, 0);
    assert.ok(points.length > 0);
    for (const p of points) assert.ok(shapes.some(box => p.x >= box[0] && p.x <= box[3] && p.y >= box[1] && p.y <= box[4] && p.z >= box[2] && p.z <= box[5]));
  }
});
