import test from 'node:test';
import assert from 'node:assert/strict';
import { B, I, blocks, items, boxFor, textureFor } from '../src/core/blocks.js';
import { Noise, seedNumber, hash, mod } from '../src/core/noise.js';
import { Terrain, World, HEIGHT, index, intersectBox } from '../src/core/world.js';
import { Inventory, makeStack, findRecipe, takeRecipe, recipes, canCraft } from '../src/core/inventory.js';
import { Player, moveBody, collisionShapes, collides } from '../src/core/physics.js';
import { validateSave } from '../src/game/storage.js';

/** Controlled fixtures test the real production physics code, not a second implementation. */
class FlatWorld {
  constructor() { this.changes = new Map(); this.weather = 0; }
  ensure() { return {}; }
  get(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    return this.changes.get(`${x},${y},${z}`)?.[0] ?? (y < 0 ? B.BEDROCK : y === 0 ? B.STONE : B.AIR);
  }
  getState(x, y, z) { return this.changes.get(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`)?.[1] || 0; }
  set(x, y, z, id, state = 0) { this.changes.set(`${x},${y},${z}`, [id, state]); }
  surface() { return 1; }
  getLight() { return [15, 0]; }
}
const controls = (...codes) => ({ keys: new Set(codes), sprintLatch: false });
const tick = (player, world, n, input = controls()) => { for (let i = 0; i < n; i++) player.tick(world, input, 'normal'); };
const grid = size => Array(size * size).fill(null);

test('seeded noise is deterministic, continuous and finite at negative coordinates', () => {
  const a = new Noise(seedNumber('验收种子')), b = new Noise(seedNumber('验收种子'));
  for (const [x, y, z] of [[0, 0, 0], [-17.3, 3.8, 44.9], [981.2, -124, 31.1]]) {
    assert.equal(a.at(x, y, z), b.at(x, y, z));
    assert.ok(Number.isFinite(a.at(x, y, z)));
    assert.ok(Math.abs(a.at(x, y, z) - a.at(x + 1e-5, y, z)) < .001);
  }
  assert.equal(mod(-1, 16), 15); assert.equal(mod(-16, 16), 0);
  assert.equal(hash(-50, 12, 37, 891), hash(-50, 12, 37, 891));
  assert.notEqual(seedNumber('a'), seedNumber('b'));
});

test('block registry and all recipe outputs refer to valid items', () => {
  for (const b of blocks) if (b) {
    assert.equal(items[b.id].block, b.id);
    for (let f = 0; f < 6; f++) assert.equal(typeof textureFor(b.id, f), 'string');
  }
  for (const recipe of recipes) assert.ok(items[recipe.output.id], recipe.name);
  assert.equal(items[I.DIAMOND_PICKAXE].durability, 1561);
  assert.equal(items[I.IRON_SWORD].stack, 1);
});

test('inventory merges stacks, returns overflow, and removes atomically', () => {
  const inv = new Inventory(2);
  assert.equal(inv.add(makeStack(B.DIRT, 60)), null);
  assert.equal(inv.add(makeStack(B.DIRT, 12)), null);
  assert.deepEqual(inv.slots.map(s => s.count), [64, 8]);
  assert.equal(inv.add(makeStack(B.DIRT, 70)).count, 14);
  const before = inv.toJSON();
  assert.equal(inv.remove(B.DIRT, 129), false); assert.deepEqual(inv.toJSON(), before);
  assert.equal(inv.remove(B.DIRT, 70), true); assert.equal(inv.count(B.DIRT), 58);
  assert.equal(inv.slots[0], null);
});

test('tool durability is independent between slots and breaks at zero', () => {
  const inv = new Inventory(2); inv.add({ ...makeStack(I.WOOD_PICKAXE), count: 2 });
  assert.deepEqual(inv.slots.map(s => s.count), [1, 1]);
  inv.damage(0, 58); assert.equal(inv.slots[0].durability, 1);
  assert.equal(inv.slots[1].durability, 59);
  assert.equal(inv.damage(0), true); assert.equal(inv.slots[0], null);
});

test('personal crafting: shapeless logs, shifted sticks, and no unconsumed extra ingredients', () => {
  const g = grid(2); g[3] = makeStack(B.OAK_LOG, 3);
  let match = findRecipe(g, 2); assert.equal(match.recipe.output.id, B.PLANKS);
  assert.deepEqual(takeRecipe(g, match), makeStack(B.PLANKS, 4)); assert.equal(g[3].count, 2);
  g.fill(null); g[1] = makeStack(B.PLANKS); g[3] = makeStack(B.BIRCH_PLANKS);
  match = findRecipe(g, 2); assert.equal(match.recipe.output.id, I.STICK);
  takeRecipe(g, match); assert.ok(g.every(s => s === null));
  g[0] = makeStack(B.OAK_LOG); g[2] = makeStack(B.STONE);
  assert.equal(findRecipe(g, 2), null);
});

test('workbench recipes require correct pattern and accept mirrored axe recipes', () => {
  const g = grid(3);
  for (const i of [0, 1, 2]) g[i] = makeStack(B.COBBLE);
  g[4] = makeStack(I.STICK); g[7] = makeStack(I.STICK);
  let match = findRecipe(g, 3); assert.equal(match.recipe.output.id, I.STONE_PICKAXE);
  assert.equal(takeRecipe(g, match).durability, 131); assert.ok(g.every(s => s === null));
  g[1] = makeStack(I.IRON); g[2] = makeStack(I.IRON); g[4] = makeStack(I.STICK); g[5] = makeStack(I.IRON); g[7] = makeStack(I.STICK);
  match = findRecipe(g, 3); assert.equal(match.recipe.output.id, I.IRON_AXE);
  assert.equal(findRecipe(grid(2), 2), null);
});

test('recipe availability accounts for each alternative ingredient exactly once', () => {
  const table = recipes.find(r => r.output.id === B.CRAFTING);
  const inv = new Inventory(3); inv.add(makeStack(B.PLANKS, 2)); inv.add(makeStack(B.BIRCH_PLANKS));
  assert.equal(canCraft(table, inv), false);
  inv.add(makeStack(B.SPRUCE_PLANKS)); assert.equal(canCraft(table, inv), true);
  assert.equal(inv.count(B.PLANKS), 2);
});

test('terrain is regenerated byte-for-byte independently of chunk request order', () => {
  const a = new Terrain('Over the hills'), b = new Terrain('Over the hills');
  const first = a.generate(-1, 0); a.generate(0, 0);
  b.generate(0, 0); const second = b.generate(-1, 0);
  assert.deepEqual(first.data, second.data); assert.deepEqual(first.state, second.state);
  assert.equal(first.data.length, 16 * 16 * HEIGHT);
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) assert.equal(first.data[index(x, 0, z)], B.BEDROCK);
  assert.deepEqual(a.column(-1, 3), b.column(-1, 3));
});

test('world edits survive serialization at positive and negative chunk boundaries', () => {
  const w = new World('roundtrip');
  for (const [x, z] of [[-17, -16], [-1, 0], [0, 0], [15, 15], [16, -1]]) {
    assert.equal(w.set(x, 120, z, B.DIAMOND_BLOCK, 3, false), true);
    assert.equal(w.get(x, 120, z), B.DIAMOND_BLOCK); assert.equal(w.getState(x, 120, z), 3);
  }
  const restored = new World(w.seed, JSON.parse(JSON.stringify(w.toJSON())));
  for (const [x, z] of [[-17, -16], [-1, 0], [0, 0], [15, 15], [16, -1]]) {
    assert.equal(restored.get(x, 120, z), B.DIAMOND_BLOCK); assert.equal(restored.getState(x, 120, z), 3);
  }
  assert.equal(w.set(0, HEIGHT, 0, B.STONE), false);
  assert.equal(w.get(0, -1, 0), B.BEDROCK); assert.equal(w.get(0, HEIGHT, 0), B.AIR);
});

test('slabs, stairs and log axes share their placement states with collision and textures', () => {
  assert.deepEqual(boxFor(B.OAK_SLAB, 0), [0, 0, 0, 1, .5, 1]);
  assert.deepEqual(boxFor(B.OAK_SLAB, 4), [0, .5, 0, 1, 1, 1]);
  assert.deepEqual(boxFor(B.OAK_SLAB, 8), [0, 0, 0, 1, 1, 1]);
  assert.deepEqual(collisionShapes(B.OAK_STAIRS, 4)[0], [0, .5, 0, 1, 1, 1]);
  assert.equal(textureFor(B.OAK_LOG, 0, 4), 'oak_end');
  assert.equal(textureFor(B.OAK_LOG, 2, 4), 'oak_log');
  assert.equal(textureFor(B.OAK_LOG, 4, 8), 'oak_end');
});

test('ray intersections handle parallel axes, distance and surface normals', () => {
  const box = [0, 1, 0, 1, 2, 1];
  assert.deepEqual(intersectBox([.5, 1.5, 3], [0, 0, -1], box), { distance: 2, normal: [0, 0, 1] });
  assert.equal(intersectBox([2, 1.5, 3], [0, 0, -1], box), null);
  assert.equal(intersectBox([.5, 3, .5], [0, -1, 0], box).distance, 1);
});

test('DDA targeting hits placed blocks across negative coordinates', () => {
  const w = new World('targeting'); w.set(-1, 124, 0, B.STONE, 0, false);
  const hit = w.raycast({ x: -3.5, y: 124.5, z: .5 }, { x: 1, y: 0, z: 0 }, 5);
  assert.equal(hit.id, B.STONE); assert.equal(hit.x, -1); assert.equal(hit.distance, 2.5);
  assert.deepEqual(hit.normal, [-1, 0, 0]);
});

test('walking, sprinting and diagonal normalization reproduce fixed-tick speeds', () => {
  const w = new FlatWorld();
  const p = new Player({ x: .5, y: 1, z: .5 }); p.yaw = 0; tick(p, w, 3); tick(p, w, 80, controls('KeyW'));
  assert.ok(Math.abs(p.walkSpeed - 4.317) < .06, `walk speed ${p.walkSpeed}`);
  const sprint = new Player({ x: .5, y: 1, z: .5 }); sprint.yaw = 0; tick(sprint, w, 3); tick(sprint, w, 80, controls('KeyW', 'ControlLeft'));
  assert.ok(Math.abs(sprint.walkSpeed - 5.612) < .08, `sprint speed ${sprint.walkSpeed}`);
  const diagonal = new Player({ x: .5, y: 1, z: .5 }); diagonal.yaw = 0; tick(diagonal, w, 3); tick(diagonal, w, 80, controls('KeyW', 'KeyD'));
  assert.ok(Math.abs(diagonal.walkSpeed - p.walkSpeed) < .01);
});

test('a jump reaches approximately 1.25 blocks and returns to the floor', () => {
  const w = new FlatWorld(), p = new Player({ x: .5, y: 1, z: .5 }); tick(p, w, 3);
  tick(p, w, 1, controls('Space')); let peak = p.pos.y;
  for (let i = 0; i < 40; i++) { tick(p, w, 1); peak = Math.max(peak, p.pos.y); }
  assert.ok(peak - 1 > 1.24 && peak - 1 < 1.27, `jump peak ${peak - 1}`);
  assert.ok(Math.abs(p.pos.y - 1) < 1e-6); assert.equal(p.onGround, true); assert.equal(p.health, 20);
});

test('swept movement cannot tunnel through a floor or a wall at high speed', () => {
  const w = new FlatWorld(), body = { pos: { x: .5, y: 80, z: .5 }, vel: { x: 0, y: -150, z: 0 }, width: .6, height: 1.8, onGround: false };
  moveBody(w, body, 0, -150, 0, 0); assert.equal(body.pos.y, 1); assert.equal(body.onGround, true);
  for (let y = 1; y < 5; y++) w.set(3, y, 0, B.STONE);
  moveBody(w, body, 20, -.08, 0, 0); assert.ok(Math.abs(body.pos.x - 2.7) < 1e-6); assert.equal(collides(w, body), false);
});

test('step assist climbs half slabs but not full blocks without a jump', () => {
  const w = new FlatWorld(); w.set(1, 1, 0, B.OAK_SLAB);
  const body = { pos: { x: .5, y: 1, z: .5 }, vel: { x: .8, y: -.08, z: 0 }, width: .6, height: 1.8, onGround: true };
  moveBody(w, body, .8, -.08, 0, .6);
  assert.ok(Math.abs(body.pos.y - 1.5) < 1e-6); assert.ok(body.pos.x > 1);
  w.set(2, 1, 0, B.STONE); w.set(2, 2, 0, B.STONE);
  moveBody(w, body, 2, -.08, 0, .6); assert.ok(body.pos.x <= 1.7 + 1e-6);
});

test('sneaking prevents leaving a one-block ledge', () => {
  const w = new FlatWorld();
  for (let z = -2; z <= 2; z++) for (let x = 1; x <= 6; x++) w.set(x, 0, z, B.AIR);
  const p = new Player({ x: .5, y: 1, z: .5 }); p.yaw = -Math.PI / 2; tick(p, w, 3);
  tick(p, w, 100, controls('KeyW', 'ShiftLeft'));
  assert.ok(p.pos.x <= 1.31, `sneaking x ${p.pos.x}`); assert.ok(p.pos.y >= 1 - 1e-6);
});

test('fall damage, armor mitigation and food restoration obey survival state', () => {
  const w = new FlatWorld(), p = new Player({ x: .5, y: 8, z: .5 }); tick(p, w, 80);
  assert.ok(p.health < 20 && p.health > 0); assert.equal(p.onGround, true);
  p.hurtTime = 0; p.health = 20; p.armor[1] = makeStack(365);
  assert.equal(p.damage(5, 'attack'), true); assert.ok(p.health > 15 && p.health < 20);
  p.hunger = 10; p.saturation = 0; assert.equal(p.eat(I.BREAD), true); assert.equal(p.hunger, 15); assert.equal(p.saturation, 6);
  const c = new Player({ x: 0, y: 1, z: 0 }, {}, 'creative'); assert.equal(c.damage(100, 'attack'), false); assert.equal(c.health, 20);
});

test('torch light propagates locally and decreases with distance', () => {
  const w = new World('lighting');
  w.set(8, 122, 8, B.TORCH, 0, false); const chunk = w.ensure(0, 0); w.light(chunk);
  assert.equal(w.getLight(8, 122, 8)[1], 14);
  assert.equal(w.getLight(9, 122, 8)[1], 13);
  assert.equal(w.getLight(10, 122, 8)[1], 12);
  w.set(8, 122, 8, B.AIR, 0, false); w.light(chunk); assert.equal(w.getLight(8, 122, 8)[1], 0);
});

test('furnaces consume actual fuel, take ten seconds, and preserve their inventory in saves', () => {
  const w = new World('furnace'); w.set(8, 120, 8, B.FURNACE, 0, false);
  const f = w.container(8, 120, 8, 'furnace');
  f.slots[0] = makeStack(B.IRON_ORE, 2); f.slots[1] = makeStack(I.COAL);
  for (let i = 0; i < 199; i++) w.tick(); assert.equal(f.slots[2], null);
  for (let i = 0; i < 3; i++) w.tick();
  assert.equal(f.slots[2].id, I.IRON); assert.equal(f.slots[2].count, 1); assert.equal(f.slots[0].count, 1); assert.equal(f.slots[1], null);
  assert.ok(f.burn > 60); assert.equal(w.get(8, 120, 8), B.FURNACE_ON);
  const restored = new World(w.seed, JSON.parse(JSON.stringify(w.toJSON())));
  assert.equal(restored.container(8, 120, 8, 'furnace').slots[2].id, I.IRON);
});

test('player and world save formats retain bed spawn and reject corrupt coordinates', () => {
  const p = new Player({ x: 1, y: 70, z: 2 }, { bedSpawn: { x: 3, y: 70, z: 4 } });
  assert.deepEqual(new Player(p.spawnPoint, JSON.parse(JSON.stringify(p.toJSON()))).bedSpawn, { x: 3, y: 70, z: 4 });
  const w = new World('save');
  const valid = { format: 1, name: '验收', player: p.toJSON(), worlds: { overworld: w.toJSON() } };
  assert.equal(validateSave(valid), valid);
  const bad = structuredClone(valid); bad.player.pos.x = NaN; assert.throws(() => validateSave(bad));
});
