import { PlayDriver } from './browser-driver.mjs';
import { B, I } from '../src/core/blocks.js';
import assert from 'node:assert/strict';

const d=new PlayDriver();let failure;
async function sample(duration,action){
  await d.page.evaluate(()=>{window.stressFrames=[];let last;const frame=now=>{if(last!==undefined)window.stressFrames.push(now-last);last=now;window.stressRAF=requestAnimationFrame(frame);};window.stressRAF=requestAnimationFrame(frame);});
  const before=await d.snapshot();if(action)await action(true);
  await d.page.waitForTimeout(duration);if(action)await action(false);
  const intervals=await d.page.evaluate(()=>{cancelAnimationFrame(window.stressRAF);return window.stressFrames;});
  const sorted=[...intervals].sort((a,b)=>a-b),after=await d.snapshot();
  return {durationMs:duration,frames:intervals.length,averageMs:intervals.reduce((a,b)=>a+b,0)/intervals.length,p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:Math.max(...intervals),distance:Math.hypot(after.player.pos.x-before.player.pos.x,after.player.pos.z-before.player.pos.z),before,after};
}
async function options(){await d.page.keyboard.press('Escape');await d.wait(s=>s.screen==='pause');await d.page.locator('[data-action="options"]').click();await d.wait(s=>s.screen==='options');}
async function leaveOptions(){await d.page.locator('[data-action="back"]').click();await d.wait(s=>s.screen==='pause');await d.enter();}
async function fullyStreamed(){await d.page.waitForTimeout(300);await d.wait(s=>s.meshing.pending===0&&s.meshing.queued===0,120000,'the entire streaming queue finishes, not just a gap between workers');await d.page.waitForTimeout(300);}
async function freshWorld(){
  if((await d.snapshot()).screen==='playing')await d.page.keyboard.press('Escape');
  await d.wait(s=>s.screen==='pause');await d.page.locator('[data-action="save-exit"]').click();await d.wait(s=>s.screen==='title');await d.create();
}
async function reload(){
  await d.page.keyboard.press('Escape');await d.wait(s=>s.screen==='pause');const before=await d.snapshot();
  await d.page.locator('[data-action="save"]').click();await d.page.getByText('世界已保存',{exact:true}).waitFor();
  await d.page.reload();await d.wait(s=>s.screen==='title',180000);await d.page.locator('[data-action="worlds"]').click();await d.page.locator(`[data-world="${before.worldId}"]`).click();await d.page.locator('[data-action="play-selected"]').click();await d.wait(s=>s.screen==='ready',180000);
  const after=await d.snapshot();assert.deepEqual(after.player.inventory,before.player.inventory);assert.deepEqual(after.player.pos,before.player.pos);await d.enter();return{before,after};
}
try{
  await d.open('stress');await d.create();
  await d.stage('Actual chain explosions exercise terrain updates, drops and the fixed particle pool',async()=>{
    await d.catalogue(B.TNT,0);const base=await d.placeOnGround(B.TNT),positions=[base];
    await d.flyTo({x:base.x+1.5,y:base.y+1.7,z:base.z+2.5},60000,{horizontal:.55,vertical:.8});
    for(let i=1;i<6;i++){
      const pos={x:base.x+i%3,y:base.y+Math.floor(i/3),z:base.z};
      if(await d.block(pos))await d.mine(pos);await d.placeAt(B.TNT,pos);positions.push(pos);
    }
    await d.catalogue(I.FLINT_STEEL,1);await d.aim({x:base.x+.5,y:base.y+.5,z:base.z+.999});
    const before=await d.snapshot();await d.click();await d.wait(s=>s.transient.tnt.length>0,6000,'TNT is actually primed');
    await d.wait(s=>s.particles.spawned>before.particles.spawned+100,20000,'real explosion particle emission');await d.screenshot('01-explosion');
    await d.wait(s=>s.transient.tnt.length===0&&s.particles.active===0&&s.meshing.pending===0,90000,'chain reaction and dirty meshes settle');
    for(const pos of positions)assert.notEqual(await d.block(pos),B.TNT);
    const state=await d.snapshot();assert.equal(state.particles.allocated,768);assert.ok(state.particles.peak<=state.quality.particleLimit);assert.equal(state.meshing.failures,0);
    await d.screenshot('02-real-crater');return{positions,particles:state.particles,render:state.render,performance:state.performance};
  });
  await d.stage('Excavate below the surface, seal the shaft, light a cave and physically enter water',async()=>{
    await freshWorld();await d.select(7);
    await d.look(0,-Math.PI/2+.005);
    await d.page.mouse.down({button:'left'});
    try{await d.wait(s=>s.player.pos.y<42,45000,'real excavation and gravity descend underground');}
    finally{await d.page.mouse.up({button:'left'});}
    await d.wait(s=>s.player.onGround,10000,'stand on excavated floor');const p=(await d.snapshot()).player.pos;
    const ceiling={x:Math.floor(p.x),y:Math.floor(p.y)+3,z:Math.floor(p.z)};
    await d.catalogue(B.STONE,0);await d.placeAt(B.STONE,ceiling);
    await d.catalogue(B.TORCH,1);
    const torch={x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)};await d.placeAt(B.TORCH,torch);
    await d.look(.4,.05);await d.page.waitForTimeout(1500);await d.screenshot('03-sealed-lit-underground');
    await d.mine(torch);await d.catalogue(I.WATER_BUCKET,2);await d.look(0,-Math.PI/2+.005);await d.click();
    await d.wait(s=>s.player.inWater,12000,'the player is physically inside the placed water');await d.screenshot('04-underground-water');
    await d.catalogue(I.BUCKET,3);await d.look(0,-Math.PI/2+.005);await d.click();await d.wait(s=>!s.player.inWater,20000,'source removed and player dries');
    const saved=await reload();assert.equal(await d.block(ceiling),B.STONE);return{depth:saved.after.player.pos.y,savedPosition:saved.after.player.pos};
  });
  await d.stage('Change every public quality preset and audit the actual framebuffer and frame delivery',async()=>{
    await freshWorld();const results=[];
    for(let i=0;i<3;i++){
      await options();await d.page.locator('[data-action="quality-preset"]').click();await leaveOptions();
      await fullyStreamed();
      const measured=await sample(4000),buffer=await d.page.locator('#game-canvas').evaluate(c=>({width:c.width,height:c.height}));
      assert.equal(buffer.width,Math.floor(1280*measured.after.quality.pixelScale));assert.equal(buffer.height,Math.floor(720*measured.after.quality.pixelScale));
      assert.equal(measured.after.meshing.failures,0);results.push({...measured,buffer});await d.screenshot(`05-quality-${measured.after.quality.preset}`);
    }
    assert.deepEqual(new Set(results.map(r=>r.after.quality.preset)),new Set(['fast','balanced','high']));return results;
  });
  await d.stage('Fly over one kilometer through genuine chunk streaming and verify a refreshed remote save',async()=>{
    const p=(await d.snapshot()).player.pos;await d.flyTo({x:p.x,y:140,z:p.z},120000,{horizontal:.55,vertical:.8});await d.look(0,-.25);
    const result=await sample(65000,async down=>{if(down){await d.page.keyboard.down('ControlLeft');await d.page.keyboard.down('w');}else{await d.page.keyboard.up('w');await d.page.keyboard.up('ControlLeft');}});
    assert.ok(result.distance>850,`Long flight only covered ${result.distance}m`);assert.equal(result.after.meshing.failures,0);
    assert.ok(result.after.resources.loadedChunks<=(result.after.quality.renderDistance*2+9)**2);assert.ok(result.after.resources.terrainColumns<=65536);
    await fullyStreamed();await d.screenshot('06-long-distance');
    const saved=await reload();return{...result,restoredPosition:saved.after.player.pos};
  });
  await d.stage('Stationary long-run audit checks autosaves, bounded GPU resources and paused consistency',async()=>{
    await fullyStreamed();const initial=await d.snapshot(),measurements=[];
    const cdp=await d.page.context().newCDPSession(d.page);await cdp.send('HeapProfiler.collectGarbage');const heapBefore=await cdp.send('Runtime.getHeapUsage');
    for(let i=0;i<3;i++){const result=await sample(25000);measurements.push(result);assert.equal(result.after.meshing.failures,0);assert.equal(result.after.particles.allocated,768);assert.ok(result.after.resources.audioVoices<=64);}
    await cdp.send('HeapProfiler.collectGarbage');const heapAfter=await cdp.send('Runtime.getHeapUsage');await cdp.detach();
    d.report.soakEvidence={initial,final:await d.snapshot(),heapBefore,heapAfter,measurements};
    const final=await d.snapshot();assert.ok(final.performance.saves.count>initial.performance.saves.count,'Real autosaves continue during the soak');
    assert.ok(final.performance.saves.snapshotMs<100,'Active autosave must not force a synchronous screenshot readback');
    assert.ok(final.render.geometries<=initial.render.geometries+40,'A stationary world must not accumulate unbounded GPU geometries');
    assert.ok(heapAfter.usedSize<heapBefore.usedSize+32*1024*1024,'Post-GC live heap remains bounded at a fixed location');
    await d.page.keyboard.press('Escape');await d.wait(s=>s.screen==='pause');const paused=await d.snapshot();await d.page.waitForTimeout(1000);assert.equal((await d.snapshot()).time,paused.time);
    await d.screenshot('07-soak-final');return{heapBefore,heapAfter,measurements,scope:'Forced GC is used only at memory audit boundaries, never during measured frame windows'};
  });
}catch(error){failure=error;process.exitCode=1;}
finally{await d.finish(failure);}
