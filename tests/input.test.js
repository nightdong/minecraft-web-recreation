import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/game.js';
import { Player } from '../src/core/physics.js';
import { B } from '../src/core/blocks.js';
import { makeStack } from '../src/core/inventory.js';

test('queued double-jump input is recognized using event times, not a stalled handler clock', () => {
  const savedDocument = globalThis.document;
  globalThis.document = { activeElement: null };
  let handledAt = 7000; const clock = mock.method(performance, 'now', () => handledAt);
  try {
    const game = { screen: 'playing', activeWorld: true, input: { keys: new Set() }, player: new Player({ x: 0, y: 70, z: 0 }, {}, 'creative') };
    const key = timeStamp => ({ code: 'Space', timeStamp, repeat: false, preventDefault() {} });
    Game.prototype.keyDown.call(game, key(100)); game.input.keys.delete('Space');
    handledAt = 7900; Game.prototype.keyDown.call(game, key(220));
    assert.equal(game.player.flying, true, 'Two real events 120ms apart remain a double tap even if the main thread stalled');
    assert.equal(game.player.vel.y, 0);
  } finally { clock.mock.restore(); globalThis.document = savedDocument; }
});

test('holding sneak while flying bypasses a chest so a block can be placed against it', () => {
  let placements = 0;
  const game = {
    player: { flying: true, sneaking: false, health: 20, eye: {}, direction: {} },
    input: { keys: new Set(['ShiftLeft']), right: true }, placeCooldown: 0,
    target: { id: B.CHEST, x: 0, y: 70, z: 0 }, hand: () => makeStack(B.STONE),
    entities: { hitTest: () => null }, world: { redstone: { interact: () => false }, chestBlocked: () => false, chestView: () => ({}) },
    openInventory() { throw new Error('Sneak-use must bypass the chest'); },
    useItem() { placements++; return true; }
  };
  Game.prototype.useTick.call(game); assert.equal(placements, 1);
  game.placeCooldown = 0; game.input.keys.clear(); game.input.usePressed = true; game.input.useSneaking = true;
  Game.prototype.useTick.call(game); assert.equal(placements, 2, 'A queued short Shift-click must retain the modifier after keyup');
});
