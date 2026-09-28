import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/core/world.js';
import { B, I, items } from '../src/core/blocks.js';
import { Player } from '../src/core/physics.js';
import { impactAdventureProjectile } from '../src/game/adventure-projectiles.js';
import { captureNeighborhood, MeshSnapshot } from '../src/render/mesh-snapshot.js';
import { Game } from '../src/game/game.js';
import { endFrames } from '../src/core/adventure.js';
import { makeStack } from '../src/core/inventory.js';
import { EndBattleView } from '../src/render/end-battle.js';
import { dragonParts } from '../src/core/end-fight.js';
import { EntitySystem } from '../src/game/entities.js';
import { GameAudio } from '../src/game/audio.js';

test('a real blaze fireball impact ignites supported air without calling a missing world method', () => {
  const world = new World('fireball-impact'); world.set(8, 119, 8, B.STONE, 0, false);
  const system = { game: { world, player: new Player({ x: 4, y: 120, z: 4 }), graphics: { burst() {} } } };
  const projectile = { kind: 'blaze_fireball', dead: false };
  impactAdventureProjectile(system, projectile, { x: 8.5, y: 120.01, z: 8.5 });
  assert.equal(world.get(8, 120, 8), B.FIRE); assert.equal(projectile.dead, true);
  world.set(8, 120, 8, B.WATER, 0, false);
  impactAdventureProjectile(system, { kind: 'blaze_fireball' }, { x: 8.5, y: 120.01, z: 8.5 });
  assert.equal(world.get(8, 120, 8), B.WATER, 'A fireball does not replace water with fire');
});

test('End worker snapshots retain the real void boundary rather than inventing bedrock', () => {
  const world = new World('end-worker-boundary', { dimension: 'end', generationVersion: 2 });
  const snapshot = new MeshSnapshot(captureNeighborhood(world, world.ensure(0, 0)));
  assert.equal(snapshot.dimension, 'end');
  assert.equal(snapshot.get(0, -1, 0), world.get(0, -1, 0));
});

function gameFixture(world, player) {
  return Object.assign(Object.create(Game.prototype), { world, player, swing: 0, audio: { play() {} }, graphics: { burst() {} }, advancement() {} });
}

test('survival eye insertion consumes exactly one real eye and activates the completed ring', () => {
  const world = new World('survival-eye-consumption'), player = new Player({ x: 0, y: 120, z: 0 });
  const frames = endFrames({ x: 0, y: 120, z: 0 });
  frames.forEach((p, i) => world.set(p.x, p.y, p.z, B.END_PORTAL_FRAME, p.state | (i < 11 ? 4 : 0), false));
  player.inventory.slots[0] = makeStack(I.EYE_OF_ENDER, 2);
  const game = gameFixture(world, player), frame = { ...frames[11], id: B.END_PORTAL_FRAME };
  assert.equal(game.useItem(items[I.EYE_OF_ENDER], frame), true);
  assert.equal(player.inventory.slots[0].count, 1);
  assert.equal(world.get(0, 120, 0), B.END_PORTAL);
});

test('survival pearls consume inventory, save their cooldown, and teleport through safe collision checks', () => {
  const world = new World('pearl-runtime'), player = new Player({ x: 3, y: 120, z: 3 }), game = gameFixture(world, player);
  let shots = 0; game.entities = { shoot() { shots++; } }; player.inventory.slots[0] = makeStack(I.ENDER_PEARL, 2);
  game.useItem(items[I.ENDER_PEARL], null); game.useItem(items[I.ENDER_PEARL], null);
  assert.equal(shots, 1); assert.equal(player.inventory.slots[0].count, 1); assert.equal(player.pearlCooldown, 20);
  const loaded = new Player(player.spawnPoint, structuredClone(player.toJSON())); assert.equal(loaded.pearlCooldown, 20);
  world.set(8, 119, 8, B.STONE, 0, false);
  const projectile = { kind: 'ender_pearl' }; impactAdventureProjectile({ game }, projectile, { x: 8.5, y: 120, z: 8.5 });
  assert.deepEqual(player.pos, { x: 8.5, y: 120, z: 8.5 }); assert.equal(player.health, 15); assert.equal(projectile.dead, true);
});

test('the integrated death event creates one actual exit, egg and XP batch across world reload', () => {
  const world = new World('victory-integration', { dimension: 'end', generationVersion: 2 });
  const player = new Player({ x: 15, y: 80, z: 15 }, {}, 'creative'), game = gameFixture(world, player);
  const experience = [], view = { game, fight: world.endFight, system: { xp: (amount, pos) => experience.push({ amount, pos }) } };
  world.endFight.state.health = 0; world.endFight.state.deathTicks = 199;
  EndBattleView.prototype.tick.call(view);
  assert.equal(world.get(1, 63, 1), B.END_PORTAL); assert.equal(world.get(0, 67, 0), B.DRAGON_EGG);
  assert.equal(experience.length, 20); assert.equal(experience.reduce((total, orb) => total + orb.amount, 0), 12000);
  const loaded = new World(world.seed, structuredClone(world.toJSON())); game.world = loaded; view.fight = loaded.endFight;
  for (let i = 0; i < 10; i++) EndBattleView.prototype.tick.call(view);
  assert.equal(experience.length, 20); assert.equal(loaded.get(1, 63, 1), B.END_PORTAL);
});

test('the real dragon landing adapts to island terrain instead of burying the head inside End stone', () => {
  const world = new World('Over the hills', { dimension: 'end', generationVersion: 2 });
  const player = new Player({ x: .5, y: 68.5, z: 10.5 }, {}, 'creative'), game = gameFixture(world, player);
  const fight = world.endFight, view = { game, fight, system: {} };
  fight.state.phase = 'approach'; fight.state.pos = { x: .5, y: 87, z: .5 };
  for (let i = 0; i < 100 && fight.state.phase !== 'perch'; i++) EndBattleView.prototype.tick.call(view);
  assert.equal(fight.state.phase, 'perch');
  for (const part of dragonParts(fight.state).slice(0, 2)) {
    assert.equal(world.get(part.center.x, part.center.y, part.center.z), B.AIR, `${part.name} must be outside solid terrain`);
  }
  const loaded = new World(world.seed, structuredClone(world.toJSON()));
  assert.equal(loaded.endFight.state.landingY, fight.state.landingY);
});

test('perched dragon breath rests on the actual island floor rather than under the ground', () => {
  const world = new World('Over the hills', { dimension: 'end', generationVersion: 2 });
  const player = new Player({ x: .5, y: 67, z: 10.5 }), game = gameFixture(world, player), fight = world.endFight;
  fight.state.phase = 'perch'; fight.state.phaseTicks = 49; fight.state.pos = {x:.5,y:69.8,z:.5};
  EndBattleView.prototype.tick.call({ game, fight, system: {} });
  assert.equal(fight.state.clouds.length, 1);
  const pos = fight.state.clouds[0].pos; assert.equal(pos.y, world.surface(pos.x, pos.z));
});

test('empty-hand use cannot feed hostile mobs or synthetic dragon hit parts', () => {
  const player = new Player({x:0,y:120,z:0}), system = { game: { player, ui: { toast() { throw new Error('Hostile entities cannot breed'); } } } };
  for (const mob of [{ type: 'zombie', health: 20 }, { boss: true, kind: 'dragon', health: 200 }]) {
    assert.equal(EntitySystem.prototype.interact.call(system, mob), false); assert.equal(mob.love, undefined);
  }
});

test('adventure sound events schedule real synthesized audio instead of falling through silently', () => {
  const calls = [], audio = { ctx: {}, master: { gain: {} }, settings: {volume:.65}, tone: (...args) => calls.push(args), noiseSound: (...args) => calls.push(args) };
  for (const name of ['dragon_hurt', 'dragon_breath', 'dragon_death', 'blaze', 'blaze_charge', 'enderman', 'enderman_angry', 'enderman_teleport', 'end_eye', 'portal_activate']) {
    calls.length = 0; GameAudio.prototype.play.call(audio, name);
    assert.ok(calls.length > 0, `Missing audio handler: ${name}`);
  }
});
