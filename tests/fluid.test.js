import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/core/world.js';
import { B } from '../src/core/blocks.js';
import { Player } from '../src/core/physics.js';
import { fluidSurface, fluidAt, flowVector } from '../src/core/fluids.js';
import { meshChunk } from '../src/render/mesher.js';

const tick = (world, count) => { for (let i = 0; i < count; i++) world.tick(); };
function channel(dimension = 'overworld') {
  const world = new World('fluid-system', { dimension });
  for (let x = -1; x <= 12; x++) for (let z = -1; z <= 1; z++) {
    world.set(x, 119, z, B.STONE, 0, false);
    for (let y = 120; y <= 122; y++) world.set(x, y, z, z || x === -1 || x === 12 ? B.STONE : B.AIR, 0, false);
  }
  return world;
}

test('water advances in scheduled five-tick steps and has finite horizontal reach', () => {
  const world = channel(); world.set(0, 120, 0, B.WATER);
  tick(world, 4); assert.equal(world.get(1, 120, 0), B.AIR);
  tick(world, 1); assert.equal(world.get(1, 120, 0), B.WATER);
  tick(world, 160);
  for (let x = 1; x <= 7; x++) { assert.equal(world.get(x, 120, 0), B.WATER); assert.equal(world.getState(x, 120, 0), x); }
  assert.equal(world.get(8, 120, 0), B.AIR);
});

test('two water sources regenerate a source between them, while lava does not', () => {
  for (const id of [B.WATER, B.LAVA]) {
    const world = channel(); world.set(0, 120, 0, id); world.set(2, 120, 0, id); tick(world, 180);
    assert.equal(world.get(1, 120, 0), id);
    assert.equal(world.getState(1, 120, 0) === 0, id === B.WATER);
  }
});

test('removing a source drains its entire derived flow without leaving permanent waterfalls', () => {
  const world = channel(); world.set(0, 120, 0, B.WATER); tick(world, 200);
  world.set(0, 120, 0, B.AIR); tick(world, 300);
  for (let x = 0; x <= 11; x++) assert.equal(world.get(x, 120, 0), B.AIR);
});

test('water washes away redstone dust and wall-mounted devices with exactly one item drop', () => {
  const world = channel(); world.set(1, 120, 0, B.WIRE); world.set(2, 120, 0, B.TORCH); world.set(0, 120, 0, B.WATER);
  tick(world, 80);
  assert.equal(world.get(1, 120, 0), B.WATER); assert.equal(world.get(2, 120, 0), B.WATER);
  assert.equal(world.events.filter(e => e.type === 'drop' && e.id === 260).length, 1);
  assert.equal(world.events.filter(e => e.type === 'drop' && e.id === B.TORCH).length, 1);
});

test('lava flows more slowly in the overworld than water and faster in the Nether', () => {
  for (const [dimension, delay] of [['overworld', 30], ['nether', 10]]) {
    const world = channel(dimension); world.set(0, 120, 0, B.LAVA);
    tick(world, delay - 1); assert.equal(world.get(1, 120, 0), B.AIR);
    tick(world, 1); assert.equal(world.get(1, 120, 0), B.LAVA);
  }
});

test('horizontal contact cools a lava source to obsidian and flowing lava to cobblestone', () => {
  for (const [level, result] of [[0, B.OBSIDIAN], [2, B.COBBLE]]) {
    const world = channel(); world.set(0, 120, 0, B.LAVA, level); world.set(1, 120, 0, B.WATER);
    tick(world, 40); assert.equal(world.get(0, 120, 0), result);
  }
});

test('save and reload preserves the remaining delay of a not-yet-spread fluid', () => {
  const original = channel(); original.set(0, 120, 0, B.WATER); tick(original, 2);
  const restored = new World(original.seed, JSON.parse(JSON.stringify(original.toJSON()))); restored.ensure(0, 0); restored.ensure(-1, 0);
  tick(restored, 2); assert.equal(restored.get(1, 120, 0), B.AIR);
  tick(restored, 1); assert.equal(restored.get(1, 120, 0), B.WATER);
});

test('eyes above the visible fluid surface do not count as submerged', () => {
  const world = channel(); world.set(0, 120, 0, B.WATER, 7, false);
  const player = new Player({ x: .5, y: 119, z: .5 });
  player.tick(world, { keys: new Set() });
  assert.equal(player.underwater, false, 'The eye at 120.62 is above a shallow level-seven stream');
});

test('a loaded boundary resumes a blocked stream without generating an unbounded world', () => {
  const world = channel();
  for (let x = 12; x <= 17; x++) {
    world.set(x, 119, 0, B.STONE, 0, false);
    for (let y = 120; y < 123; y++) { world.set(x, y, 0, B.AIR, 0, false); world.set(x, y, -1, B.STONE, 0, false); world.set(x, y, 1, B.STONE, 0, false); }
  }
  world.unload('1,0'); world.set(15, 120, 0, B.WATER); tick(world, 40);
  assert.equal(world.chunks.has('1,0'), false, 'Flow must not generate unloaded chunks');
  world.ensure(1, 0); tick(world, 20);
  assert.equal(world.get(16, 120, 0, false), B.WATER, 'Loading adjacent terrain must wake the boundary source');
});

test('water cancels accumulated fall damage on the actual landing tick', () => {
  const world = channel(); world.set(1, 120, 0, B.WATER, 0, false);
  const player = new Player({ x: 1.5, y: 125, z: .5 });
  player.fallDistance = 12; player.vel.y = -6;
  player.tick(world, { keys: new Set() });
  assert.equal(player.pos.y, 120);
  assert.equal(player.health, 20, 'A fast fall that enters water and lands in one tick must not apply dry-ground damage');
  assert.equal(player.inWater, true);
});

test('flowing water has a downstream current and cannot be scooped as a source', () => {
  const world = channel(); world.set(0, 120, 0, B.WATER); tick(world, 80);
  assert.ok(flowVector(world, 2, 120, 0)[0] > 0);
  assert.equal(world.raycast({ x: 2.5, y: 122, z: .5 }, { x: 0, y: -1, z: 0 }, 1.9, true), null);
  const source = world.raycast({ x: .5, y: 122, z: .5 }, { x: 0, y: -1, z: 0 }, 3, true);
  assert.equal(source.id, B.WATER); assert.ok(source.point.y < 121);
});

test('liquid mesh vertex heights agree with the surface used for immersion', () => {
  const world = channel(); world.set(0, 120, 0, B.WATER); tick(world, 80);
  const atlas = { uv: () => [0, 0, 1, 1] };
  const geometries = meshChunk(world, world.ensure(0, 0), atlas, false), g = geometries.liquid;
  assert.ok(g);
  const p = g.getAttribute('position'), n = g.getAttribute('normal'); let checked = 0;
  for (let i = 0; i < p.count; i++) {
    if (n.getY(i) !== 1 || p.getX(i) < 1 || p.getX(i) > 6 || p.getZ(i) !== 0) continue;
    const actual = p.getY(i), expected = fluidSurface(world, p.getX(i), 120, p.getZ(i));
    assert.ok(Math.abs(actual - expected) < 1e-4, `Rendered ${actual}, physical ${expected}`); checked++;
  }
  assert.ok(checked > 0);
  for (const geometry of Object.values(geometries)) geometry?.dispose();
});

test('neighboring liquid triangles share the same edge and leave the air above dry', () => {
  const world = channel(); world.set(0, 120, 0, B.WATER); tick(world, 80);
  for (let x = 1; x < 7; x++) {
    assert.ok(Math.abs(fluidSurface(world, x - 1e-6, 120, .5) - fluidSurface(world, x + 1e-6, 120, .5)) < 1e-4);
    const y = fluidSurface(world, x + .5, 120, .5);
    assert.equal(fluidAt(world, x + .5, y + .002, .5), B.AIR);
    assert.equal(fluidAt(world, x + .5, y - .002, .5), B.WATER);
  }
});
