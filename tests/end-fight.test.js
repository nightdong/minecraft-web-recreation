import test from 'node:test';
import assert from 'node:assert/strict';
import { EndFight, dragonParts } from '../src/core/end-fight.js';

const player = () => ({ creative: true, health: 20, pos: { x: 0, y: 63, z: 10 }, damage() { throw new Error('Creative spectators are not attacked'); } });

test('alive crystals heal a nearby dragon and destruction of its healing crystal damages it', () => {
  const fight = new EndFight('dragon-tests'), s = fight.state;
  s.health = 180; s.pos = { ...fight.crystalPosition(0), y: fight.crystalPosition(0).y + 5 }; s.ticks = 9;
  fight.tick(player()); assert.equal(s.health, 181); assert.equal(s.healing, 0);
  assert.equal(fight.destroyCrystal(0), true); assert.equal(s.health, 171); assert.equal(fight.destroyCrystal(0), false);
});

test('dragon multipart damage, hurt cooldown and perched arrow immunity affect actual state', () => {
  const fight = new EndFight('dragon-tests');
  assert.equal(fight.damage(8, 'head', 'arrow'), true); assert.equal(fight.state.health, 192);
  assert.equal(fight.damage(8, 'head', 'arrow'), false);
  fight.state.hurt = 0; assert.equal(fight.damage(8, 'body', 'melee'), true); assert.equal(fight.state.health, 190);
  fight.state.hurt = 0; fight.state.phase = 'perch'; assert.equal(fight.damage(30, 'head', 'arrow'), false);
  assert.equal(fight.damage(8, 'head', 'melee'), true); assert.equal(fight.state.health, 182);
  assert.ok(dragonParts(fight.state).some(part => part.name === 'head' && part.box[4] > part.box[1]));
});

test('dragon death emits victory and experience once, including across a save during death', () => {
  const first = new EndFight('dragon-tests'); first.state.health = 0;
  for (let i = 0; i < 90; i++) first.tick(player());
  const restored = new EndFight('dragon-tests', first.toJSON());
  for (let i = 0; i < 210; i++) restored.tick(player());
  const victories = restored.events.filter(event => event.type === 'dragonDefeated');
  assert.equal(victories.length, 1); assert.equal(victories[0].xp, 12000); assert.equal(restored.state.defeated, true);
  const loadedAgain = new EndFight('dragon-tests', restored.toJSON());
  for (let i = 0; i < 250; i++) loadedAgain.tick(player());
  assert.equal(loadedAgain.events.filter(event => event.type === 'dragonDefeated').length, 0);
});

test('saved flight and breath clouds resume identically, without restoring killed crystals', () => {
  const first = new EndFight('dragon-tests'); first.destroyCrystal(3); first.addCloud({ x: 1, y: 63, z: 2 });
  for (let i = 0; i < 100; i++) first.tick(player());
  const restored = new EndFight('dragon-tests', first.toJSON());
  for (let i = 0; i < 350; i++) { first.tick(player()); restored.tick(player()); }
  assert.deepEqual(restored.toJSON(), first.toJSON()); assert.equal(restored.state.crystals[3], false);
});
