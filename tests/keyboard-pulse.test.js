import test from 'node:test';
import assert from 'node:assert/strict';
import { pulseKey } from './keyboard-pulse.mjs';

test('a navigation key release is sent even while keydown acknowledgement is blocked', { timeout: 1000 }, async () => {
  const events = []; let acknowledge;
  const keyboard = {
    down(key) { events.push(`down:${key}`); return new Promise(resolve => { acknowledge = () => { events.push('down-ack'); resolve(); }; }); },
    async up(key) { events.push(`up:${key}`); acknowledge(); }
  };
  await pulseKey(keyboard, 'ShiftLeft', 5);
  assert.deepEqual(events, ['down:ShiftLeft', 'up:ShiftLeft', 'down-ack']);
});

test('invalid pulse durations cannot leave a movement key held', async () => {
  let called = false;
  const keyboard = { down() { called = true; }, up() { called = true; } };
  await assert.rejects(() => pulseKey(keyboard, 'Space', NaN), RangeError);
  assert.equal(called, false);
});
