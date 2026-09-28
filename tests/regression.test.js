import test from 'node:test';
import assert from 'node:assert/strict';
import { B, I, items } from '../src/core/blocks.js';
import { Inventory, makeStack } from '../src/core/inventory.js';
import { Game } from '../src/game/game.js';
import { World } from '../src/core/world.js';
import { Player } from '../src/core/physics.js';
import { validateSave, sanitizeSettings } from '../src/game/storage.js';
import { EntitySystem } from '../src/game/entities.js';
import { InventoryScreen } from '../src/ui/inventory.js';
import * as THREE from 'three';
import { ownedMesh, disposeOwnedObject } from '../src/render/resources.js';

// Exercise the production interaction method. Only rendering/audio are stubbed.
test('read-only diagnostics remain valid while cold startup is waiting for IndexedDB',()=>{
  const game=Object.assign(Object.create(Game.prototype),{world:null,player:null,screen:'loading',locked:false,activeWorld:false,fps:60});
  const value=game.diagnostics();assert.equal(value.screen,'loading');assert.equal(value.player,null);assert.equal(value.activeWorld,false);
});
function miningFixture(block, held) {
  const inventory = new Inventory(); if (held) inventory.add(makeStack(held));
  return {
    player: { inventory, selected: 0, health: 20, creative: false, onGround: true, underwater: false, eye: {}, direction: {} },
    screen: 'playing', input: { left: true }, target: { id: block, x: 0, y: 1, z: 0 },
    entities: { hitTest: () => null }, graphics: { burst() {} }, audio: { play() {} },
    attackCooldown: 0, maxAttackCooldown: .625, placeCooldown: 0, miningCooldown: 0, digSound: 1, swing: 0, mining: 0,
    updateTarget() {}, startSwing() {}, broken: 0, breakBlock() { this.broken++; }
  };
}

test('block items do not masquerade as pickaxes, axes or shovels', () => {
  for (const item of Object.values(items)) if (item.block !== undefined) {
    assert.equal(item.tool, undefined, `Block item ${item.id} must not inherit its required harvesting tool`);
    assert.equal(item.tier, undefined, `Block item ${item.id} must not inherit the harvesting tier`);
  }
  assert.equal(items[I.WOOD_PICKAXE].tool, 'pickaxe');
});

test('empty-hand interaction breaks tall grass without dereferencing a missing item', () => {
  const game = miningFixture(B.TALL_GRASS);
  assert.doesNotThrow(() => Game.prototype.interactTick.call(game));
  assert.equal(game.broken, 1);
});

test('collecting a log does not prevent mining the next log while holding it', () => {
  const game = miningFixture(B.OAK_LOG, B.OAK_LOG);
  Game.prototype.interactTick.call(game);
  assert.ok(Number.isFinite(game.mining) && game.mining > 0, `Mining progress must be finite and positive, got ${game.mining}`);
  assert.ok(Math.abs(game.mining - .05 / 3) < 1e-9);
});

function saveFixture() {
  const game = Object.create(Game.prototype);
  Object.assign(game, {
    world: new World('regressions'), player: new Player({ x: .5, y: 120, z: .5 }),
    worldId: 'fixture', worldName: 'Regression', difficulty: 'normal', activeWorld: true, screen: 'pause',
    worldSnapshots: {}, entitySnapshots: {}, earned: new Set(), stats: { crafted: 0 }, initialSpawn: { x: .5, y: 120, z: .5 }, playTime: 0,
    entities: { toJSON: () => ({ mobs: [], drops: [], spawned: [] }) }, ui: { inventory: { opened: false } }
  });
  return game;
}

test('a save snapshot cannot be mutated by later gameplay or another save', () => {
  const game = saveFixture();
  const chest = game.world.container(0, 120, 0, 'chest'); chest.slots[0] = makeStack(B.DIRT, 5);
  game.player.armor[0] = makeStack(364);
  const before = game.snapshot(false), serialized = JSON.stringify(before);
  game.player.pos.x += 10; game.player.armor[0].durability--;
  chest.slots[0].count--; game.stats.crafted++;
  game.world.set(0, 122, 0, B.STONE); game.snapshot(false);
  assert.equal(JSON.stringify(before), serialized, 'Pending writes must contain a detached, atomic snapshot');
});
test('active-play autosaves reuse a thumbnail without forcing a synchronous GPU readback',()=>{
  const game=saveFixture();game.screen='playing';game.lastThumbnail={id:game.worldId,value:'data:image/jpeg;base64,cached'};
  let requested=false;game.canvas={get width(){requested=true;throw new Error('Readback is forbidden in active autosave');}};
  const data=game.snapshot(true);assert.equal(data.thumbnail,game.lastThumbnail.value);assert.equal(requested,false);
});

test('an explicit save arriving during autosave writes the newer state too', async () => {
  const game = saveFixture(), writes = []; let version = 1;
  game.snapshot = () => ({ id: 'fixture', updated: version, version });
  game.store = { save: data => new Promise(resolve => writes.push({ data, resolve })) };
  const first = game.save(); await Promise.resolve();
  version = 2; const second = game.save();
  writes[0].resolve(); await first; await new Promise(resolve => setImmediate(resolve));
  try { assert.equal(writes.length, 2, 'Saving on exit must not silently reuse a stale in-flight autosave'); }
  finally { for (const write of writes) write.resolve(); await second; }
  assert.equal(writes[1].data.version, 2);
});

test('save import rejects invalid inventory, armor, containers and block states', () => {
  const valid = saveFixture().snapshot(false); assert.equal(validateSave(valid), valid);
  const corruptions = [
    data => { data.player.inventory[0] = { id: 999, count: 1 }; },
    data => { data.player.inventory[0] = { id: B.DIRT, count: -1 }; },
    data => { data.player.inventory[0] = { id: B.DIRT, count: 65 }; },
    data => { data.player.armor[0] = makeStack(B.DIRT); },
    data => { data.worlds.overworld.containers = [['0,120,0', { type: 'furnace', slots: [{ id: I.COAL, count: -2 }, null, null] }]]; },
    data => { data.worlds.overworld.edits = [['0,0', [[128, [B.STONE, 999]]]]]; },
    data => { data.dimension = 'missing'; },
    data => { data.player.velocity = { x: NaN, y: 0, z: 0 }; },
    data => { data.player.fallDistance = -20; },
    data => { data.player.burnTime = 100000; }
  ];
  for (let i = 0; i < corruptions.length; i++) {
    const bad = structuredClone(valid); corruptions[i](bad);
    assert.throws(() => validateSave(bad), `Corrupt save ${i} must be rejected before changing the active world`);
  }
});

test('targeting a stair does not hit its empty upper half', () => {
  const world = new World('stair-ray'); world.set(0, 122, 0, B.OAK_STAIRS, 0, false);
  const origin = { x: .5, y: 122.75, z: -2 }, direction = { x: 0, y: 0, z: 1 };
  assert.equal(world.raycast(origin, direction, 2.25), null);
  assert.equal(world.raycast(origin, direction, 4).distance, 2.5);
});

test('opaque walls stop torch light across a chunk boundary', () => {
  const world = new World('light-wall');
  world.ensure(0, 0); world.ensure(1, 0);
  // A sealed wall reaches beyond the torch radius in both tangential axes.
  for (let z = -8; z <= 24; z++) for (let y = 103; y < 128; y++) world.set(15, y, z, B.STONE, 0, false);
  world.set(14, 120, 8, B.TORCH, 0, false);
  world.light(world.ensure(0, 0)); world.light(world.ensure(1, 0));
  assert.equal(world.getLight(16, 120, 8)[1], 0, 'A source in another chunk cannot bypass an intervening wall');
});

test('world save retains pending fluid and falling-block updates', () => {
  const world = new World('pending'); world.set(0, 121, 0, B.SAND);
  const saved = JSON.parse(JSON.stringify(world.toJSON()));
  const restored = new World(world.seed, saved);
  assert.ok(restored.updateSet.has('0,121,0'), 'Saving between placement and the next tick must not freeze the block');
});

test('in-flight sand, TNT, arrows and experience are included in entity saves', () => {
  const pos = { x: 1.5, y: 70.2, z: 2.5 }, vel = { x: .1, y: -.2, z: 0 };
  const system = { spawned: new Set(), mobs: [], drops: [], ticks: 45,
    falling: [{ id: B.SAND, pos, vel, age: 4 }], tnt: [{ pos, vel, fuse: 39 }],
    projectiles: [{ kind: 'arrow', owner: 'player', pos, vel, damage: 4, age: 3, stuck: false }],
    orbs: [{ pos, vel, amount: 7, age: 2 }] };
  const saved = JSON.parse(JSON.stringify(EntitySystem.prototype.toJSON.call(system)));
  assert.equal(saved.falling?.[0]?.id, B.SAND); assert.equal(saved.tnt?.[0]?.fuse, 39);
  assert.equal(saved.projectiles?.[0]?.kind, 'arrow'); assert.equal(saved.orbs?.[0]?.amount, 7);
  assert.equal(saved.falling[0].mesh, undefined);
});

test('furnace output can join a compatible cursor stack without allowing insertion', () => {
  const view = Object.create(InventoryScreen.prototype);
  Object.assign(view, { type: 'furnace', container: { slots: [null, null, makeStack(I.IRON, 2)] }, cursor: makeStack(I.IRON),
    game: { player: { inventory: new Inventory(), addXP() {} }, advancement() {} }, render() {} });
  view.slotClick('container', 2, 0, false);
  assert.equal(view.cursor.count, 3); assert.equal(view.container.slots[2], null);
  view.cursor = makeStack(B.DIRT); view.slotClick('container', 2, 0, false);
  assert.equal(view.container.slots[2], null);
});

test('corrupt settings cannot request unbounded render distance or an invalid camera', () => {
  const settings = sanitizeSettings({ renderDistance: 1e9, fov: -Infinity, volume: -2, sensitivity: 'fast', guiScale: 2.4, clouds: 'false' });
  assert.equal(settings.renderDistance, 12); assert.equal(settings.fov, 70); assert.equal(settings.volume, 0);
  assert.equal(settings.sensitivity, .5); assert.equal(settings.guiScale, 2); assert.equal(settings.clouds, true);
});

test('disposing an entity does not destroy the shared held-item geometry or material', () => {
  const sharedGeometry = new THREE.BoxGeometry(), sharedMaterial = new THREE.MeshBasicMaterial();
  const ownGeometry = new THREE.PlaneGeometry(), ownMaterial = new THREE.MeshBasicMaterial();
  let shared = 0, own = 0;
  for (const resource of [sharedGeometry, sharedMaterial]) resource.addEventListener('dispose', () => shared++);
  for (const resource of [ownGeometry, ownMaterial]) resource.addEventListener('dispose', () => own++);
  const root = new THREE.Group(); root.add(new THREE.Mesh(sharedGeometry, sharedMaterial));
  root.add(ownedMesh(new THREE.Mesh(ownGeometry, ownMaterial)));
  const scene = new THREE.Scene(); scene.add(root); disposeOwnedObject(root); disposeOwnedObject(root);
  assert.equal(shared, 0); assert.equal(own, 2); assert.equal(root.parent, null);
  sharedGeometry.dispose(); sharedMaterial.dispose();
});

test('restored TNT uses saved position, velocity and fuse without restoring arbitrary fields', () => {
  const mesh = new THREE.Group(), entity = { pos: {}, vel: {}, width: .98, mesh };
  EntitySystem.prototype.restoreBody.call({}, entity, { pos: { x: 1.5, y: 60.8, z: 2.5 }, vel: { x: .1, y: -.2, z: 0 }, fuse: 32, width: 9999, mesh: 'untrusted' }, 'tnt');
  assert.equal(entity.width, .98); assert.equal(entity.mesh, mesh); assert.equal(entity.fuse, 32);
  assert.deepEqual(entity.pos, entity.previous); assert.equal(entity.vel.y, -.2);
});

test('cosmetic vegetation changes dirty only the affected chunk, not nine meshes', () => {
  const world = new World('dirty');
  for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) world.ensure(x, z);
  world.set(8, 120, 8, B.TALL_GRASS, 0, false); world.light(world.ensure(0, 0)); world.dirty.clear();
  world.set(8, 120, 8, B.AIR, 0, false);
  assert.deepEqual([...world.dirty], ['0,0']); assert.equal(world.blockLightingDirty, false);
});

test('saving during a fall preserves momentum, fall damage and ongoing burning', () => {
  const world = { weather: 0, ensure() {}, surface: () => 1, get: (x, y) => Math.floor(y) <= 0 ? B.STONE : B.AIR, getState: () => 0 };
  const input = { keys: new Set() }, original = new Player({ x: .5, y: 18, z: .5 });
  original.burnTime = 12; original.vel.x = .12;
  for (let i = 0; i < 8; i++) original.tick(world, input);
  const restored = new Player(original.spawnPoint, JSON.parse(JSON.stringify(original.toJSON())));
  assert.deepEqual(restored.vel, original.vel, 'Reloading must not stop mid-air momentum');
  assert.equal(restored.fallDistance, original.fallDistance);
  assert.equal(restored.burnTime, original.burnTime);
  for (let i = 0; i < 35; i++) { original.tick(world, input); restored.tick(world, input); }
  assert.deepEqual(restored.pos, original.pos);
  assert.equal(restored.health, original.health, 'Save/reload must not cancel fall or fire damage');
  assert.ok(original.health < 20);
});
