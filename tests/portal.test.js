import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { World, Terrain } from '../src/core/world.js';
import { B } from '../src/core/blocks.js';
import { Game } from '../src/game/game.js';
import { portalContact } from '../src/core/portal-contact.js';

function frame(width = 2, height = 3, axis = 'x', corners = false) {
  const world = new World('portal-frame-regression');
  const p = (u, v) => axis === 'x' ? [u, 95 + v, 0] : [0, 95 + v, u];
  for (let v = -1; v <= height; v++) for (let u = -1; u <= width; u++) {
    const edge = u === -1 || u === width || v === -1 || v === height;
    const corner = (u === -1 || u === width) && (v === -1 || v === height);
    world.set(...p(u, v), edge && (!corner || corners) ? B.OBSIDIAN : B.AIR, 0, false);
  }
  return { world, p, game: { world, replaceable: Game.prototype.replaceable } };
}

test('minimum Nether portals work in both axes without requiring corner blocks', () => {
  for (const axis of ['x', 'z']) {
    const { world, game, p } = frame(2, 3, axis);
    assert.equal(Game.prototype.tryPortal.call(game, ...p(0, 0)), true);
    for (let v = 0; v < 3; v++) for (let u = 0; u < 2; u++) assert.equal(world.get(...p(u, v)), B.PORTAL);
  }
});

test('large portals support a full 21 by 21 interior and reject overlarge frames', () => {
  const valid = frame(21, 21); assert.equal(Game.prototype.tryPortal.call(valid.game, ...valid.p(10, 0)), true);
  assert.equal(valid.world.get(...valid.p(20, 20)), B.PORTAL);
  const tooLarge = frame(22, 21); assert.equal(Game.prototype.tryPortal.call(tooLarge.game, ...tooLarge.p(10, 0)), false);
});

test('portal ignition cannot replace water, plants or solid obstructions inside the frame', () => {
  for (const id of [B.WATER, B.LAVA, B.TALL_GRASS, B.STONE, B.CHEST]) {
    const { world, game, p } = frame(); world.set(...p(1, 1), id, 0, false);
    assert.equal(Game.prototype.tryPortal.call(game, ...p(0, 0)), false, `Interior ${id} must prevent ignition`);
    assert.equal(world.get(...p(1, 1)), id);
  }
});

test('removing a frame clears a large connected portal completely', () => {
  const { world, p } = frame(21, 21);
  for (let v = 0; v < 21; v++) for (let u = 0; u < 21; u++) world.set(...p(u, v), B.PORTAL, 0, false);
  Game.prototype.removePortal.call({ world }, ...p(0, 0));
  for (let v = 0; v < 21; v++) for (let u = 0; u < 21; u++) assert.equal(world.get(...p(u, v)), B.AIR);
});

test('Nether floor noise is evaluated per column, not repeated for all 128 vertical cells', () => {
  const terrain = new Terrain('nether-generation-regression', 'nether'), original = terrain.noise.fbm.bind(terrain.noise); let calls = 0;
  terrain.noise.fbm = (...args) => { calls++; return original(...args); };
  const chunk = terrain.generate(0, 0);
  assert.equal(createHash('sha256').update(Buffer.from(chunk.data.buffer)).digest('hex'), '8b370b30e5ddae6b5825b7cee2862d3223f2c037713e3d0ca64018807195979a', 'Optimizing generation may not silently change an existing saved world');
  assert.equal(calls, 256);
});

test('creative flight through a portal between fixed ticks is not silently missed', () => {
  const world = { get: (x, y, z) => z === 0 && x === 0 && y === 70 ? B.PORTAL : B.AIR };
  const player = { creative: true, pos: { x: .5, y: 70, z: -1.2 }, previous: { x: .5, y: 70, z: 2.1 }, width: .6, height: 1.8 };
  assert.equal(portalContact(world, player)?.id, B.PORTAL);
  assert.equal(portalContact(world, { ...player, creative: false }), null, 'Survival travel still requires standing in the portal');
  let entered = 0;
  Game.prototype.portalTick.call({ world, player, screen: 'playing', portalCooldown: 0, portalTime: 0, traveling: false,
    travelDimension: async () => { entered++; }, ui: { error() {} } });
  assert.equal(entered, 1);
});
