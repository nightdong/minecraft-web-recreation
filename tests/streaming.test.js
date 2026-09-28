import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EntitySystem } from '../src/game/entities.js';
import { Player } from '../src/core/physics.js';
import { B } from '../src/core/blocks.js';
import { makeStack } from '../src/core/inventory.js';

function fixture() {
  const system = Object.create(EntitySystem.prototype);
  const world = { chunks: new Map(), weather: 0, dimension: 'overworld', get: () => B.AIR, getState: () => 0, raycast: () => null };
  const player = new Player({ x: .5, y: 70, z: .5 });
  const body = () => ({ pos: { x: 20.5, y: 70, z: .5 }, previous: { x: 20.5, y: 70, z: .5 }, vel: { x: .1, y: -.2, z: 0 }, width: .25, height: .25, age: 4, mesh: new THREE.Group() });
  Object.assign(system, { game: { world, player, audio: { play() {} } }, scene: new THREE.Scene(), spawned: new Set(), ticks: 11,
    mobs: [{ ...body(), type: 'pig', health: 10 }], drops: [{ ...body(), stack: makeStack(B.DIRT), delay: 0 }],
    falling: [{ ...body(), id: B.SAND }], tnt: [{ ...body(), fuse: 70 }],
    projectiles: [{ ...body(), kind: 'arrow', owner: 'player', damage: 3, stuck: false }], orbs: [{ ...body(), amount: 3 }],
    tickMob(mob) { mob.age++; }, explode() { throw new Error('Unloaded TNT must not explode'); }
  });
  return system;
}

test('unloaded entities pause rather than falling through missing terrain or losing fuse time', () => {
  const system = fixture(), before = JSON.stringify(system.toJSON());
  for (let i = 0; i < 10; i++) system.tick();
  const after = system.toJSON(); after.ticks -= 10;
  assert.equal(JSON.stringify(after), before, 'No item, mob, arrow, falling block, TNT or XP may advance outside loaded terrain');
});

test('fast projectiles wait for their entire next movement segment to be loaded', () => {
  const system = fixture(); system.game.world.chunks.set('0,0', {});
  const arrow = system.projectiles[0]; arrow.pos.x = 15.9; arrow.vel.x = 1.2;
  const before = JSON.stringify({ pos: arrow.pos, vel: arrow.vel, age: arrow.age });
  system.tick();
  assert.equal(JSON.stringify({ pos: arrow.pos, vel: arrow.vel, age: arrow.age }), before);
});
