import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/core/world.js';
import { B } from '../src/core/blocks.js';

function worldPair() {
  const a = new World('local-lighting-equivalence'), b = new World(a.seed);
  for (let z = -3; z <= 3; z++) for (let x = -3; x <= 3; x++) { a.ensure(x, z); b.ensure(x, z); }
  a.updateBlockLight(); b.updateBlockLight(); return [a, b];
}
function compare(a, b) {
  b.lightDirtyChunks = new Set(b.chunks.keys()); b.blockLightingDirty = true;
  a.updateBlockLight(); b.updateBlockLight();
  assert.equal(a.chunks.size, b.chunks.size);
  for (const [key, chunk] of a.chunks) assert.deepEqual(chunk.glow, b.chunks.get(key).glow, `Light mismatch in ${key}`);
}

test('localized lighting matches a complete flood after source, wall and boundary edits', () => {
  const [a, b] = worldPair();
  const edits = [[0, 120, 0, B.TORCH], [15, 120, 1, B.GLOWSTONE], [16, 120, 1, B.STONE], [17, 120, 1, B.TORCH],
    [-17, 120, -1, B.LAVA], [16, 120, 1, B.AIR], [15, 120, 1, B.AIR], [-17, 120, -1, B.STONE],
    [0, 120, 0, B.AIR], [17, 120, 1, B.AIR]];
  for (const edit of edits) { a.set(...edit); b.set(...edit); compare(a, b); }
});

test('changing one interior light does not recompute every loaded chunk', () => {
  const [a] = worldPair(); a.set(8, 120, 8, B.TORCH); a.updateBlockLight();
  assert.equal(a.lightingStats?.lastChunks, 9, 'Only the changed chunk and its eight neighbors can be affected by a level-15 source');
  assert.equal(a.chunks.size, 49);
});

test('lighting remains exact when a source chunk is unloaded and then returns', () => {
  const [a, b] = worldPair();
  for (const world of [a, b]) world.set(47, 120, 0, B.GLOWSTONE);
  compare(a, b); a.unload('2,0'); b.unload('2,0'); compare(a, b);
  a.ensure(2, 0); b.ensure(2, 0); compare(a, b);
});
