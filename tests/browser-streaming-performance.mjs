import { PlayDriver } from './browser-driver.mjs';
import assert from 'node:assert/strict';

const label = process.argv[2] || 'current', d = new PlayDriver(); let failure;
try {
  await d.open(`streaming-${label}`); await d.create();
  await d.stage('Measure actual frame delivery while flying into newly generated chunks', async () => {
    const start = (await d.snapshot()).player.pos;
    await d.flyTo({ x: start.x, y: start.y + 18, z: start.z }); await d.look(0, -.08);
    await d.wait(state => state.chunks >= 121 && state.meshing.pending === 0, 60000, 'initial render distance finishes before measuring streaming');
    await d.page.waitForTimeout(500);
    const before = await d.snapshot();
    await d.page.evaluate(() => {
      window.measuredFrames = []; let previous;
      const frame = now => { if (previous !== undefined) window.measuredFrames.push(now - previous); previous = now; window.measuredFrameRequest = requestAnimationFrame(frame); };
      window.measuredFrameRequest = requestAnimationFrame(frame);
    });
    await d.page.keyboard.down('ControlLeft'); await d.page.keyboard.down('w'); await d.page.waitForTimeout(6500);
    await d.page.keyboard.up('w'); await d.page.keyboard.up('ControlLeft');
    const frames = await d.page.evaluate(() => { cancelAnimationFrame(window.measuredFrameRequest); return window.measuredFrames; });
    const after = await d.snapshot(), sorted = [...frames].sort((a, b) => a - b);
    const result = { frames: frames.length, averageMs: frames.reduce((a, b) => a + b, 0) / frames.length,
      p50Ms: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.floor(sorted.length * .95)], maxMs: Math.max(...frames),
      over50ms: frames.filter(n => n > 50).length, over100ms: frames.filter(n => n > 100).length,
      distance: Math.hypot(after.player.pos.x - before.player.pos.x, after.player.pos.z - before.player.pos.z),
      chunksBefore: before.chunks, chunksAfter: after.chunks, render: after.render, meshing: after.meshing, lighting: after.lighting, textureAnimation: after.textureAnimation, deltas: frames };
    assert.ok(frames.length > 20); assert.ok(result.distance > 30, 'Benchmark must really traverse and stream new chunks');
    if (label !== 'before-workers') { assert.equal(after.meshing.workers, 2); assert.ok(after.meshing.completed > 50); assert.equal(after.meshing.failures, 0); }
    if (after.textureAnimation) {
      assert.ok(after.textureAnimation.frame > before.textureAnimation.frame + 20);
      assert.equal(after.textureAnimation.uploadVersion, before.textureAnimation.uploadVersion, 'Animation must not repeatedly upload the static atlas');
    }
    await d.screenshot('flight'); console.log(JSON.stringify({ ...result, deltas: undefined })); return result;
  });
} catch (error) { failure = error; process.exitCode = 1; }
finally { await d.finish(failure); }
