import { PlayDriver } from './browser-driver.mjs';
import { B, I, blocks } from '../src/core/blocks.js';
import assert from 'node:assert/strict';

const d = new PlayDriver(); let failure, spawnSites;
const mobs = () => d.page.evaluate(() => window.voxelDiagnostics.mobs());
async function flySafe(destination) {
  const player=(await d.snapshot()).player.pos;
  const cruise=await d.page.evaluate(({player,destination,solid})=>{
    const steps=Math.ceil(Math.hypot(destination.x-player.x,destination.z-player.z)*2);let top=Math.max(player.y,destination.y);
    for(let i=0;i<=steps;i++){
      const t=steps?i/steps:0,x=Math.floor(player.x+(destination.x-player.x)*t),z=Math.floor(player.z+(destination.z-player.z)*t);
      for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)for(let y=110;y>=Math.floor(top)-1;y--)if(solid.includes(window.voxelDiagnostics.block(x+dx,y,z+dz))){top=Math.max(top,y+2.2);break;}
    }
    return top;
  },{player,destination,solid:blocks.filter(b=>b?.solid).map(b=>b.id)});
  const tolerance={horizontal:.55,vertical:.8};
  if(cruise>player.y+.8)await d.flyTo({x:player.x,y:cruise,z:player.z},60000,tolerance);
  await d.flyTo({...destination,y:cruise},60000,tolerance);
  await d.flyTo(destination,60000,tolerance);
}
async function createAtNight(mode, start = '午夜') {
  await d.page.locator('[data-action="create"]').click();
  await d.page.locator('#world-name').fill(`夜间实玩 ${mode}`);
  await d.page.locator('#world-seed').fill('Over the hills');
  if (!(await d.page.locator('[data-action="create-mode"]').innerText()).includes(mode === 'creative' ? '创造' : '生存')) await d.page.locator('[data-action="create-mode"]').click();
  while (!(await d.page.locator('[data-action="create-time"]').innerText()).includes(start)) await d.page.locator('[data-action="create-time"]').click();
  await d.page.locator('[data-action="start-new"]').click();
  await d.wait(s => s.screen === 'ready', 180000, 'night world creation'); await d.enter();
}
async function reloadPaused() {
  await d.page.keyboard.press('Escape'); await d.wait(s => s.screen === 'pause');
  const state = await d.snapshot(), creatures = await mobs();
  await d.page.locator('[data-action="save"]').click(); await d.page.getByText('世界已保存', { exact: true }).waitFor();
  await d.page.reload(); await d.wait(s => s.screen === 'title', 180000);
  await d.page.locator('[data-action="worlds"]').click(); await d.page.locator(`[data-world="${state.worldId}"]`).click();
  await d.page.locator('[data-action="play-selected"]').click(); await d.wait(s => s.screen === 'ready', 180000);
  const restored = await mobs();
  const persisted = list => list.filter(m => m.health > 0).map(({ routeLength, pursuing, ...m }) => m);
  assert.deepEqual(persisted(restored), persisted(creatures), 'Actual saved creature positions, health, fuse, fire and persistent flags survive refresh');
  assert.deepEqual((await d.snapshot()).player.inventory, state.player.inventory);
  await d.enter(); return { before: creatures.length, restored: restored.length };
}
async function frameSample(milliseconds) {
  await d.page.evaluate(() => {
    window.monsterFrames = []; let previous;
    const tick = now => { if (previous !== undefined) window.monsterFrames.push(now - previous); previous = now; window.monsterRAF = requestAnimationFrame(tick); };
    window.monsterRAF = requestAnimationFrame(tick);
  });
  await d.page.waitForTimeout(milliseconds);
  const frames = await d.page.evaluate(() => { cancelAnimationFrame(window.monsterRAF); return window.monsterFrames; });
  const sorted = [...frames].sort((a,b) => a-b), state = await d.snapshot();
  return { frames: frames.length, averageMs: frames.reduce((a,b) => a+b,0)/frames.length, p95Ms: sorted[Math.floor(sorted.length*.95)], maxMs: Math.max(...frames), render: state.render, ai: state.ai, batching: state.creatureRendering, mobs: (await mobs()).length };
}
try {
  await d.open('hostiles');
  await d.stage('Cold-start a real night world and observe natural hostile spawns', async () => {
    await createAtNight('creative');
    await d.wait(async () => (await mobs()).filter(m => ['zombie','skeleton','creeper','spider'].includes(m.type)).length >= 6, 90000, 'natural night population');
    const population = await mobs(); await d.screenshot('01-natural-night');
    return { population, state: await d.snapshot() };
  });
  await d.stage('Use public creature eggs to create original animated models, then audit a living crowd', async () => {
    const origin = (await d.snapshot()).player.pos;
    const sites = await d.page.evaluate(({ origin, B, solid }) => {
      const sites = [];
      for (let z = Math.floor(origin.z)-15; z <= origin.z+15; z+=3) for (let x=Math.floor(origin.x)-15; x<=origin.x+15; x+=3) {
        for (let y=90;y>=55;y--) {
          const id=window.voxelDiagnostics.block(x,y,z); if (!id) continue;
          let clear=true;
          // The spider is wider than a block: inspect its full 3x3 footprint,
          // not just the empty center of a slope beside a higher grass block.
          for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)for(let dy=1;dy<=4;dy++)if(solid.includes(window.voxelDiagnostics.block(x+dx,y+dy,z+dz)))clear=false;
          if ([B.GRASS,B.DIRT,B.STONE].includes(id) && clear) sites.push({x,y,z});
          break;
        }
      }
      return sites.sort((a,b)=>Math.hypot(a.x-origin.x,a.z-origin.z)-Math.hypot(b.x-origin.x,b.z-origin.z)).slice(0,12);
    }, { origin, B, solid: blocks.filter(b=>b?.solid).map(b=>b.id) });
    assert.ok(sites.length>=8,'There must be genuine unobstructed ground for the creature eggs');
    spawnSites=sites;
    const types=['zombie','skeleton','creeper','spider'], eggs=[I.ZOMBIE_EGG,I.SKELETON_EGG,I.CREEPER_EGG,I.SPIDER_EGG];
    for (let i=0;i<eggs.length;i++) await d.catalogue(eggs[i],i);
    for (let i=0;i<sites.length;i++) {
      const p=sites[i], type=types[i%4]; await flySafe({x:p.x+.5,y:p.y+3,z:p.z+1.4});
      await d.select(i%4); await d.aim({x:p.x+.5,y:p.y+.999,z:p.z+.5});
      const before=(await mobs()).filter(m=>m.type===type&&m.persistent).length;
      await d.click(); await d.wait(async()=> (await mobs()).filter(m=>m.type===type&&m.persistent).length>before,6000,'egg produces the actual creature');
      if(i<4){await d.aim({x:p.x+.5,y:p.y+(type==='spider'?1.4:2.3),z:p.z+.5});await d.screenshot(`02-original-${type}`);}
    }
    for (const type of types) assert.ok((await mobs()).some(m=>m.type===type&&m.persistent));
    await flySafe({x:origin.x,y:origin.y+5,z:origin.z+9}); await d.aim({x:origin.x,y:origin.y+1,z:origin.z});
    const sample=await frameSample(10000); assert.ok(sample.batching.instances>30); assert.ok(sample.batching.draws<sample.batching.instances);
    await d.screenshot('02-original-creature-crowd'); return sample;
  });
  await d.stage('Save and refresh the actual crowd without resetting health or population', reloadPaused);
  await d.stage('Fight a persistent creature with a normal sword and observe real drops or XP', async () => {
    await d.catalogue(I.DIAMOND_SWORD,4);
    // Place a fresh legal egg at visible ground. Do not chase an arbitrary old
    // wandering creature across half the map using its stale saved coordinates.
    const existing=await mobs(),ground=spawnSites.find(site=>existing.every(m=>Math.hypot(m.pos.x-site.x-.5,m.pos.z-site.z-.5)>1.5));
    assert.ok(ground,'One previously verified ground patch remains available for a real combat egg');
    await flySafe({x:ground.x+.5,y:ground.y+2,z:ground.z+.5});await d.select(2);
    await d.aim({x:ground.x+.5,y:ground.y+.999,z:ground.z+.5});
    const count=(await mobs()).filter(m=>m.type==='creeper'&&m.persistent).length;
    await d.click();await d.wait(async()=> (await mobs()).filter(m=>m.type==='creeper'&&m.persistent).length>count,6000,'fresh combat egg');
    const target={type:'creeper',pos:{x:ground.x+.5,y:ground.y+1,z:ground.z+.5}};
    await d.select(4);const before=(await d.snapshot()).stats.kills;d.report.combatTrace=[];
    // A moving target needs continuous real mouse tracking, not a minute-long
    // flight towards the position it occupied before it began walking away.
    await d.page.mouse.down({button:'left'});
    try {
      for(let attempt=0;attempt<120 && (await d.snapshot()).stats.kills===before;attempt++) {
        const candidates=(await mobs()).filter(m=>m.type===target.type&&m.persistent&&m.health>0);
        candidates.sort((a,b)=>Math.hypot(a.pos.x-target.pos.x,a.pos.z-target.pos.z)-Math.hypot(b.pos.x-target.pos.x,b.pos.z-target.pos.z));
        const mob=candidates[0];if(!mob)break;target.pos={...mob.pos};
        const p=(await d.snapshot()).player.pos,range=Math.hypot(p.x-mob.pos.x,p.z-mob.pos.z);
        d.report.combatTrace.push({health:mob.health,pos:mob.pos,player:p});
        await d.aim({...mob.pos,y:mob.pos.y+1.2});
        if(range>2.8)await d.page.keyboard.down('w');else await d.page.keyboard.up('w');
        await d.page.waitForTimeout(180);
      }
    } finally { await d.page.keyboard.up('w');await d.page.mouse.up({button:'left'}); }
    assert.ok((await d.snapshot()).stats.kills>before,'Normal player attacks must really kill a creature');
    assert.ok((await d.snapshot()).earned.includes('monster'));
    await d.screenshot('03-combat-and-drops');
  });
  await d.stage('Observe actual daylight ignition and damage without giving the player remote combat credit',async()=>{
    await d.page.keyboard.press('Escape');await d.wait(s=>s.screen==='pause');await d.page.locator('[data-action="save-exit"]').click();await d.wait(s=>s.screen==='title');
    await createAtNight('creative','白天');await d.catalogue(I.ZOMBIE_EGG,0);
    const site=await d.page.evaluate(({sites,solid})=>sites.find(p=>{for(let y=p.y+1;y<128;y++)if(solid.includes(window.voxelDiagnostics.block(p.x,y,p.z)))return false;return true;}),{sites:spawnSites,solid:blocks.filter(b=>b?.solid).map(b=>b.id)});
    assert.ok(site,'Daylight specimen needs a genuinely open-sky ground patch');
    await flySafe({x:site.x+.5,y:site.y+2,z:site.z+.5});await d.aim({x:site.x+.5,y:site.y+.999,z:site.z+.5});await d.click();
    await d.wait(async()=>(await mobs()).some(m=>m.type==='zombie'&&m.persistent&&m.fire>0&&m.health<20),10000,'real sunlight burns the new creature');
    const state=await d.snapshot(),creature=(await mobs()).find(m=>m.type==='zombie'&&m.persistent);
    assert.ok(!state.earned.includes('monster'));assert.equal(state.player.level,0);await d.aim({...creature.pos,y:creature.pos.y+1.2});await d.screenshot('04-sunlight-behavior');return{creature,playerLevel:state.player.level};
  });
  await d.stage('Start empty-inventory survival at night and verify actual pursuit, damage and respawn', async () => {
    await d.page.keyboard.press('Escape'); await d.wait(s=>s.screen==='pause'); await d.page.locator('[data-action="save-exit"]').click();await d.wait(s=>s.screen==='title');
    await createAtNight('survival');
    assert.ok((await d.snapshot()).player.inventory.every(item=>item===null));
    await d.wait(async()=> (await mobs()).some(m=>m.pursuing),120000,'a naturally spawned hostile acquires the player');
    const pursuing=await mobs(); await d.screenshot('04-survival-pursuit');
    await d.wait(s=>s.player.health<20,120000,'enemy combat changes real player health');
    const damaged=await d.snapshot(); await d.screenshot('05-survival-damage');
    await d.wait(s=>s.screen==='death',180000,'survival death after sustained attacks');
    await d.page.locator('[data-action="respawn"]').click(); await d.wait(s=>s.screen==='ready',180000,'respawn');
    assert.equal((await d.snapshot()).player.health,20);await d.enter();await d.screenshot('06-respawn');
    return { pursuing, damagedHealth: damaged.player.health, stats: (await d.snapshot()).stats };
  });
} catch(error) { failure=error; process.exitCode=1; }
finally { await d.finish(failure); }
