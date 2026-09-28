import test from 'node:test';
import assert from 'node:assert/strict';
import { B } from '../src/core/blocks.js';
import { World } from '../src/core/world.js';
import { Player } from '../src/core/physics.js';

function fixture() {
  const world = new World('circuits');
  for (let x = -4; x <= 24; x++) for (let z = -4; z <= 4; z++) world.set(x, 115, z, B.STONE, 0, false);
  return world;
}
const tick = (world, count = 1, bodies = []) => { for (let i = 0; i < count; i++) world.tick(.05, bodies); };
const set = (world, x, z, id, state = 0, y = 116) => { assert.ok(Number.isInteger(id), 'Circuit block must be registered'); world.set(x, y, z, id, state); };

test('redstone dust attenuates from 15 to zero and powers a real lamp', () => {
  const world = fixture(); set(world, 0, 0, B.LEVER, 8);
  for (let x = 1; x <= 16; x++) set(world, x, 0, B.WIRE);
  set(world, 4, 1, B.REDSTONE_LAMP); tick(world);
  assert.equal(world.getState(1, 116, 0), 15); assert.equal(world.getState(15, 116, 0), 1); assert.equal(world.getState(16, 116, 0), 0);
  assert.equal(world.get(4, 116, 1), B.REDSTONE_LAMP_ON);
  set(world, 0, 0, B.LEVER, 0); tick(world, 5);
  assert.equal(world.getState(1, 116, 0), 0); assert.equal(world.get(4, 116, 1), B.REDSTONE_LAMP);
});

test('wire loops cannot sustain power after the source is switched off', () => {
  const world = fixture(); set(world, 0, 0, B.LEVER, 8);
  for (const [x, z] of [[1, 0], [2, 0], [3, 0], [3, 1], [3, 2], [2, 2], [1, 2], [1, 1]]) set(world, x, z, B.WIRE);
  tick(world); assert.ok(world.getState(2, 116, 2) > 0);
  set(world, 0, 0, B.LEVER); tick(world, 4);
  for (const [x, z] of [[1, 0], [2, 0], [3, 0], [3, 1], [3, 2], [2, 2], [1, 2], [1, 1]]) assert.equal(world.getState(x, 116, z), 0);
});

test('dust connections climb full blocks and cross chunk boundaries', () => {
  const world = fixture(); set(world, 14, 0, B.LEVER, 8); set(world, 15, 0, B.WIRE);
  set(world, 16, 0, B.STONE); set(world, 16, 0, B.WIRE, 0, 117); set(world, 17, 0, B.STONE); set(world, 17, 0, B.WIRE, 0, 117);
  tick(world); assert.equal(world.getState(16, 117, 0), 14); assert.equal(world.getState(17, 117, 0), 13);
  set(world, 15, 0, B.STONE, 0, 117); tick(world); assert.equal(world.getState(17, 117, 0), 0, 'A ceiling blocks a rising wire');
});

test('repeaters restore signal strength only after their selected delay and only forward', () => {
  const world = fixture(); set(world, 0, 0, B.LEVER, 8); set(world, 1, 0, B.WIRE); set(world, 2, 0, B.REPEATER, 1 | 12);
  set(world, 3, 0, B.WIRE); set(world, 2, 1, B.WIRE);
  tick(world, 8); assert.equal(world.getState(3, 116, 0), 0);
  tick(world); assert.equal(world.getState(3, 116, 0), 15); assert.equal(world.getState(2, 116, 1), 0);
});

test('a side-facing powered repeater locks another repeater', () => {
  const world = fixture(); set(world, 0, 0, B.LEVER, 8); set(world, 1, 0, B.WIRE); set(world, 2, 0, B.REPEATER, 1);
  set(world, 2, -1, B.REPEATER, 2 | 16); set(world, 2, -2, B.REDSTONE_BLOCK); set(world, 3, 0, B.WIRE);
  tick(world, 10); assert.equal(world.getState(3, 116, 0), 0); assert.ok(world.getState(2, 116, 0) & 32);
  world.set(2, 116, -1, B.AIR); tick(world, 4); assert.equal(world.getState(3, 116, 0), 15);
});

test('redstone torches invert the power of the block they are attached to', () => {
  const world = fixture(); set(world, 0, 0, B.STONE); set(world, 1, 0, B.REDSTONE_TORCH, 1);
  set(world, 0, 0, B.LEVER, 8, 117); set(world, 2, 0, B.REDSTONE_LAMP);
  tick(world, 8); assert.equal(world.get(1, 116, 0), B.REDSTONE_TORCH_OFF);
  set(world, 0, 0, B.LEVER, 0, 117); tick(world, 4);
  assert.equal(world.get(1, 116, 0), B.REDSTONE_TORCH); assert.equal(world.get(2, 116, 0), B.REDSTONE_LAMP_ON);
});

test('buttons have a finite pulse and pressure plates react to actual bodies', () => {
  const world = fixture(); set(world, 0, 0, B.STONE_BUTTON); set(world, 1, 0, B.WIRE);
  world.redstone.interact(0, 116, 0); tick(world); assert.equal(world.getState(1, 116, 0), 15);
  tick(world, 20); assert.equal(world.getState(1, 116, 0), 0);
  set(world, 0, 0, B.STONE_PLATE); const player = new Player({ x: .5, y: 116, z: .5 });
  tick(world, 1, [player]); assert.equal(world.getState(1, 116, 0), 15);
  player.pos.x = 7; tick(world, 12, [player]); assert.equal(world.getState(1, 116, 0), 0);
});

test('redstone opens both halves of doors and ignites TNT once', () => {
  const world = fixture(); set(world, 0, 0, B.LEVER, 8); set(world, 1, 0, B.WIRE); set(world, 2, 0, B.WIRE);
  set(world, 3, 0, B.DOOR); set(world, 3, 0, B.DOOR_TOP, 0, 117); set(world, 2, 1, B.TNT);
  tick(world, 3); assert.ok(world.getState(3, 116, 0) & 4); assert.ok(world.getState(3, 117, 0) & 4);
  assert.equal(world.get(2, 116, 1), B.AIR); assert.equal(world.events.filter(e => e.type === 'prime').length, 1);
  set(world, 0, 0, B.LEVER); tick(world, 2); assert.equal(world.getState(3, 116, 0) & 4, 0);
});

test('pistons push twelve blocks, refuse thirteen, and never move obsidian', () => {
  for (const count of [12, 13]) {
    const world = fixture(); set(world, 0, 0, B.PISTON, 1);
    for (let x = 1; x <= count; x++) set(world, x, 0, B.STONE);
    set(world, 0, 1, B.LEVER, 8); tick(world, 2);
    assert.equal(!!(world.getState(0, 116, 0) & 8), count === 12);
    if (count === 12) { assert.equal(world.get(1, 116, 0), B.PISTON_HEAD); assert.equal(world.get(13, 116, 0), B.STONE); }
    else assert.equal(world.get(14, 116, 0), B.AIR);
  }
  const world = fixture(); set(world, 0, 0, B.PISTON, 1); set(world, 1, 0, B.OBSIDIAN); set(world, 0, 1, B.LEVER, 8);
  tick(world, 2); assert.equal(world.getState(0, 116, 0) & 8, 0); assert.equal(world.get(1, 116, 0), B.OBSIDIAN);
});

test('pistons retract without duplicating pushed blocks and push the player out of the head', () => {
  const world = fixture(); set(world, 0, 0, B.PISTON, 1); set(world, 0, 1, B.LEVER, 8);
  const player = new Player({ x: 1.5, y: 116, z: .5 }); tick(world, 2, [player]);
  assert.ok(player.pos.x >= 2.3); assert.equal(world.get(1, 116, 0), B.PISTON_HEAD);
  set(world, 0, 1, B.LEVER); tick(world, 2, [player]);
  assert.equal(world.get(1, 116, 0), B.AIR); assert.equal(world.getState(0, 116, 0) & 8, 0);
});

test('saving mid-repeater-delay restores the remaining tick count and not an instant signal', () => {
  const world = fixture(); set(world, 0, 0, B.LEVER, 8); set(world, 1, 0, B.WIRE); set(world, 2, 0, B.REPEATER, 1 | 12); set(world, 3, 0, B.WIRE);
  tick(world, 4);
  const restored = new World(world.seed, JSON.parse(JSON.stringify(world.toJSON()))); restored.ensure(0, 0); restored.ensure(-1, 0);
  tick(restored, 4); assert.equal(restored.getState(3, 116, 0), 0);
  tick(restored); assert.equal(restored.getState(3, 116, 0), 15);
});
