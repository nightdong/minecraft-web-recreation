import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/core/world.js';
import { B, I } from '../src/core/blocks.js';
import { Player } from '../src/core/physics.js';
import { makeStack } from '../src/core/inventory.js';

function flat(seed = 'environment-regression') {
  const world = new World(seed);
  for (let x = -5; x <= 8; x++) for (let z = -5; z <= 8; z++) world.set(x, 119, z, B.STONE, 0, false);
  return world;
}
const advance = (world, ticks) => { for (let i = 0; i < ticks; i++) world.tick(); };

test('wall torches and ladders detach when their actual supporting block is removed', () => {
  const world = flat();
  world.set(0, 120, 0, B.STONE); world.set(1, 120, 0, B.TORCH, 1);
  world.set(3, 120, 0, B.STONE); world.set(4, 120, 0, B.LADDER, 1);
  advance(world, 20); assert.equal(world.get(1, 120, 0), B.TORCH);
  world.set(0, 120, 0, B.AIR); world.set(3, 120, 0, B.AIR); advance(world, 40);
  assert.equal(world.get(1, 120, 0), B.AIR); assert.equal(world.get(4, 120, 0), B.AIR);
  assert.equal(world.events.filter(e => e.type === 'drop' && (e.id === B.TORCH || e.stack?.id === B.TORCH)).length, 1);
});

test('removing farmland uproots its crop and removing sand uproots a cactus column', () => {
  const world = flat(); world.set(0, 119, 0, B.FARMLAND); world.set(0, 120, 0, B.WHEAT3);
  world.set(4, 119, 0, B.SAND); world.set(4, 120, 0, B.CACTUS); world.set(4, 121, 0, B.CACTUS);
  world.set(0, 119, 0, B.STONE); world.set(4, 119, 0, B.STONE); advance(world, 60);
  assert.equal(world.get(0, 120, 0), B.AIR);
  assert.equal(world.get(4, 120, 0), B.AIR); assert.equal(world.get(4, 121, 0), B.AIR);
});

test('a newly requested chest container has no invented loot unless it is a real natural chest', () => {
  const world = flat(); assert.ok(world.container(7, 120, 7, 'chest').slots.every(s => s === null));
  world.set(1, 120, 1, B.CHEST); const chest = world.container(1, 120, 1, 'chest');
  chest.slots[0] = makeStack(I.DIAMOND); world.set(1, 120, 1, B.AIR); world.set(1, 120, 1, B.CHEST);
  assert.ok(world.container(1, 120, 1, 'chest').slots.every(s => s === null), 'A replaced chest must not retain a ghost inventory');
});

test('switching smelting recipes resets progress instead of finishing a new input immediately', () => {
  const world = flat(); world.set(0, 120, 0, B.FURNACE, 0, false);
  const furnace = world.container(0, 120, 0, 'furnace');
  furnace.slots[0] = makeStack(B.SAND); furnace.slots[1] = makeStack(I.COAL);
  advance(world, 190); assert.equal(furnace.slots[2], null);
  furnace.slots[0] = makeStack(B.IRON_ORE); advance(world, 20);
  assert.equal(furnace.slots[2], null); assert.ok(furnace.progress < 2);
});

test('farmland hydrates near water and dries back to dirt when unplanted', () => {
  const world = flat(); world.set(0, 119, 0, B.FARMLAND); world.set(3, 119, 0, B.WATER);
  advance(world, 120); assert.equal(world.getState(0, 119, 0) & 7, 7);
  world.set(3, 119, 0, B.STONE); advance(world, 2000);
  assert.equal(world.get(0, 119, 0), B.DIRT);
});

test('fire is an actual damaging block, can be extinguished, and persists on netherrack', () => {
  assert.ok(Number.isInteger(B.FIRE));
  const world = flat(); world.set(0, 119, 0, B.NETHERRACK); world.set(0, 120, 0, B.FIRE);
  advance(world, 500); assert.equal(world.get(0, 120, 0), B.FIRE);
  const player = new Player({ x: .5, y: 120, z: .5 });
  for (let i = 0; i < 30; i++) player.tick(world, { keys: new Set() });
  assert.ok(player.health < 20); assert.ok(player.burnTime > 0);
  world.set(0, 120, 0, B.WATER); player.tick(world, { keys: new Set() }); assert.equal(player.burnTime, 0);
});

test('fire consumes flammable material, activates TNT, but does not consume stone', () => {
  assert.ok(Number.isInteger(B.FIRE));
  const world = flat(); world.set(0, 119, 0, B.NETHERRACK); world.set(0, 120, 0, B.FIRE);
  world.set(1, 120, 0, B.PLANKS); world.set(-1, 120, 0, B.TNT); world.set(0, 120, 1, B.STONE);
  advance(world, 1600);
  assert.notEqual(world.get(1, 120, 0), B.PLANKS); assert.equal(world.get(0, 120, 1), B.STONE);
  assert.equal(world.events.filter(event => event.type === 'prime' && event.x === -1).length, 1);
});

test('rain extinguishes exposed fire but a solid roof shelters it', () => {
  const world = flat(); world.weather = 1; world.weatherTimer = 1000;
  for (const x of [0, 4]) { world.set(x, 119, 0, B.STONE); world.set(x, 120, 0, B.FIRE); }
  world.set(4, 124, 0, B.STONE);
  advance(world, 100);
  assert.equal(world.get(0, 120, 0), B.AIR); assert.equal(world.get(4, 120, 0), B.FIRE);
});
