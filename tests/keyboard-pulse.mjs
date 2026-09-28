import { setTimeout as delay } from 'node:timers/promises';

/** Schedule the release against the driver clock, not after Chromium finishes
 * acknowledging keydown. A stalled render thread must not turn 25ms into a
 * multi-second held input. Both events still come from Playwright's keyboard. */
export async function pulseKey(keyboard, key, milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new RangeError('Invalid key pulse duration');
  const down = keyboard.down(key);
  const up = delay(milliseconds).then(() => keyboard.up(key));
  await Promise.all([down, up]);
}
