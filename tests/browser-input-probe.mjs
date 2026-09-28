import { PlayDriver } from './browser-driver.mjs';
import assert from 'node:assert/strict';
const d = new PlayDriver(); let failure;
try {
  await d.open('input-probe'); await d.create();
  await d.page.evaluate(() => {
    window.inputProbe = { events: [], frames: [] }; let last = performance.now();
    document.addEventListener('keydown', event => {
      if (event.code === 'Space') window.inputProbe.events.push({ timestamp: event.timeStamp, handled: performance.now(), trusted: event.isTrusted, repeat: event.repeat, player: window.voxelDiagnostics.snapshot().player });
    });
    const frame = now => { window.inputProbe.frames.push(now - last); last = now; requestAnimationFrame(frame); }; requestAnimationFrame(frame);
  });
  await d.stage('Real double-space gesture under software rendering', async () => {
    await d.page.waitForTimeout(600);
    await d.page.keyboard.press('Space'); await d.page.waitForTimeout(100); await d.page.keyboard.press('Space');
    await d.page.waitForTimeout(600);
    const result = await d.page.evaluate(() => ({ ...window.inputProbe, final: window.voxelDiagnostics.snapshot() }));
    d.report.inputProbe = result; console.log(JSON.stringify(result));
    assert.equal(result.final.player.flying, true);
  });
} catch (error) { failure = error; process.exitCode = 1; }
finally { await d.finish(failure); }
