import test from 'node:test';
import assert from 'node:assert/strict';
import { World, Terrain } from '../src/core/world.js';
import { B, I } from '../src/core/blocks.js';
import { endFrames, activateEndPortal, strongholds, nearestStronghold, fortressCenter, endPillars, END_SPAWN } from '../src/core/adventure.js';
import { recipes, Inventory, makeStack, canCraft } from '../src/core/inventory.js';
import { validateSave } from '../src/game/storage.js';
import { Player } from '../src/core/physics.js';

test('End portal activation requires twelve inserted eyes facing one coherent interior', () => {
  const world = new World('eye-frame'), center = { x: 0, y: 120, z: 0 }, frames = endFrames(center);
  assert.equal(frames.length, 12);
  frames.forEach((p, i) => world.set(p.x, p.y, p.z, B.END_PORTAL_FRAME, p.state | (i < 11 ? 4 : 0)));
  assert.equal(activateEndPortal(world, frames[0]), null);
  const last = frames.at(-1); world.set(last.x, last.y, last.z, B.END_PORTAL_FRAME, ((last.state + 1) & 3) | 4);
  assert.equal(activateEndPortal(world, last), null);
  world.set(last.x, last.y, last.z, B.END_PORTAL_FRAME, last.state | 4);
  assert.deepEqual(activateEndPortal(world, last), center);
  for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) assert.equal(world.get(x, 120, z), B.END_PORTAL);
});

test('new seed generation includes a connected stronghold portal room with reproducible frame positions', () => {
  const seed = 'adventure-structures', world = new World(seed), location = strongholds(seed)[0];
  assert.equal(world.generationVersion, 2);
  const center = { x: location.x + 24, y: location.y + 2, z: location.z };
  for (const p of endFrames(center)) { assert.equal(world.get(p.x, p.y, p.z), B.END_PORTAL_FRAME); assert.equal(world.getState(p.x, p.y, p.z) & 3, p.state); }
  assert.equal(world.get(location.x + 8, location.y + 1, location.z), B.AIR, 'The corridor connects entrance and portal room');
  const again = new World(seed); for (const p of endFrames(center)) assert.equal(again.get(p.x, p.y, p.z), B.END_PORTAL_FRAME);
  assert.deepEqual(nearestStronghold(seed, { x: location.x + 24, z: location.z }), location);
});

test('legacy saved generation does not silently acquire new structures in old terrain', () => {
  const world = new World('adventure-structures', { edits: [], containers: [], dimension: 'overworld' });
  assert.equal(world.generationVersion, 1);
  const expected = new Terrain(world.seed, 'overworld', 1).generate(1, -1), actual = world.ensure(1, -1);
  assert.deepEqual(actual.data, expected.data); assert.equal(world.toJSON().generationVersion, 1);
});

test('Nether fortress floors and blaze spawners are deterministic and aligned across chunk boundaries', () => {
  const seed = 'fortress-regression', world = new World(seed, { dimension: 'nether', generationVersion: 2 }), c = fortressCenter(seed, 0, 0);
  assert.equal(world.get(c.x + 35, c.y + 1, c.z), B.SPAWNER); assert.equal(world.getState(c.x + 35, c.y + 1, c.z), 1);
  for (let x = c.x - 30; x < c.x + 30; x++) assert.equal(world.get(x, c.y, c.z), B.NETHER_BRICKS);
});

test('End terrain has a safe spawn platform, a void below its island and ten crystal pillars', () => {
  const world = new World('end-regression', { dimension: 'end', generationVersion: 2 });
  assert.equal(world.get(END_SPAWN.x, END_SPAWN.y - 1, END_SPAWN.z), B.OBSIDIAN);
  assert.equal(world.get(END_SPAWN.x, END_SPAWN.y, END_SPAWN.z), B.AIR);
  assert.equal(world.get(10, 50, 10), B.END_STONE); assert.equal(world.get(300, 50, 300), B.AIR);
  assert.equal(world.get(0, -1, 0), B.AIR, 'The End has a real void rather than an invisible global bedrock floor');
  assert.equal(endPillars(world.seed).length, 10);
  for (const pillar of endPillars(world.seed)) assert.equal(world.get(pillar.x, pillar.y + 1, pillar.z), B.BEDROCK);
  assert.equal(world.endFight.state.health, 200);
});

test('eyes are crafted from real blaze powder and pearls, not granted by entering a dimension', () => {
  const recipe = recipes.find(recipe => recipe.output.id === I.EYE_OF_ENDER), powder = recipes.find(recipe => recipe.output.id === I.BLAZE_POWDER);
  assert.ok(recipe); assert.equal(powder.output.count, 2);
  const inventory = new Inventory(); inventory.add(makeStack(I.ENDER_PEARL));
  assert.equal(canCraft(recipe, inventory), false); inventory.add(makeStack(I.BLAZE_POWDER)); assert.equal(canCraft(recipe, inventory), true);
});

test('End fight state and new generation version survive validated world saves', () => {
  const world = new World('end-save', { dimension: 'end', generationVersion: 2 });
  world.endFight.destroyCrystal(2); world.endFight.state.health = 127;
  const player = new Player(END_SPAWN), data = { format: 1, name: 'End save', seed: world.seed, dimension: 'end', player: player.toJSON(), worlds: { end: world.toJSON() } };
  assert.equal(validateSave(data), data);
  const loaded = new World(world.seed, JSON.parse(JSON.stringify(data.worlds.end)));
  assert.equal(loaded.endFight.state.health, 127); assert.equal(loaded.endFight.state.crystals[2], false); assert.equal(loaded.generationVersion, 2);
  const bad = structuredClone(data); bad.worlds.end.endFight.health = -10; assert.throws(() => validateSave(bad));
});
