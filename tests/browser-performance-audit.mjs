import { PlayDriver } from './browser-driver.mjs';
import assert from 'node:assert/strict';

const label = process.argv[2] || 'current', d = new PlayDriver(); let failure;
async function measure(name, duration, action) {
  const before = await d.snapshot();
  await d.page.evaluate(() => {
    window.auditFrames = []; window.auditLongTasks = []; let last;
    window.auditObserver = new PerformanceObserver(list => { for (const entry of list.getEntries()) window.auditLongTasks.push(entry.duration); });
    try { window.auditObserver.observe({ type: 'longtask', buffered: false }); } catch {}
    const frame = now => { if (last !== undefined) window.auditFrames.push(now - last); last = now; window.auditRAF = requestAnimationFrame(frame); };
    window.auditRAF = requestAnimationFrame(frame);
  });
  if (action) await action(true);
  await d.page.waitForTimeout(duration);
  if (action) await action(false);
  const data = await d.page.evaluate(() => {
    cancelAnimationFrame(window.auditRAF); window.auditObserver.disconnect();
    return { intervals: window.auditFrames, longTasks: window.auditLongTasks, heap: performance.memory?.usedJSHeapSize ?? null };
  });
  const after = await d.snapshot(), values = [...data.intervals].sort((a,b) => a-b), quantile = q => values[Math.min(values.length-1, Math.floor(values.length*q))];
  const result = { name, frames: values.length, averageMs: values.reduce((a,b)=>a+b,0)/values.length, p50Ms: quantile(.5), p95Ms: quantile(.95), p99Ms: quantile(.99), maxMs: quantile(1), over50ms: values.filter(v=>v>50).length, longTasks: data.longTasks, heapBytes: data.heap, distance: Math.hypot(after.player.pos.x-before.player.pos.x,after.player.pos.z-before.player.pos.z), before, after, intervals: data.intervals };
  assert.ok(values.length > 25, 'An audit needs real delivered browser frames');
  console.log(JSON.stringify({ ...result, before: undefined, after: undefined, intervals: undefined }));
  return result;
}
try {
  await d.open(`performance-${label}`); const bootStarted = Date.now(); await d.create();
  d.report.worldLoadMs = Date.now()-bootStarted;
  await d.wait(s=>s.chunks>=121 && s.meshing.pending===0 && s.meshing.queued===0,120000,'initial terrain fully rendered');
  await d.stage('Steady scene with naturally generated animals',()=>measure('steady',6000));
  const p=(await d.snapshot()).player.pos; await d.flyTo({x:p.x,y:p.y+18,z:p.z}); await d.look(0,-.14);
  await d.stage('Long real flight into unloaded terrain',async()=>{
    const result = await measure('streaming',16000,async down=>{ if(down){await d.page.keyboard.down('ControlLeft');await d.page.keyboard.down('w');}else{await d.page.keyboard.up('w');await d.page.keyboard.up('ControlLeft');} });
    assert.ok(result.distance>180); assert.equal(result.after.meshing.failures,0); return result;
  });
  await d.wait(s=>s.meshing.pending===0 && s.meshing.queued===0,120000,'streaming finishes');
  await d.stage('Post-stream stationary memory and frame audit',()=>measure('settled',6000));
  await d.screenshot('final-scene');
} catch(error){failure=error;process.exitCode=1;}
finally{await d.finish(failure);}
