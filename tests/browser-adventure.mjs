import { PlayDriver } from './browser-driver.mjs';
import { B, I } from '../src/core/blocks.js';
import { endFrames } from '../src/core/adventure.js';
import assert from 'node:assert/strict';
import { creditViewports, inspectCredits } from './credits-layout.mjs';

// A real creative-mode integration journey, not a claim of a fresh survival
// speedrun. Every change uses public menus and trusted keyboard/mouse events.
const d = new PlayDriver(); let failure, center, inventory, checkpoint;
const delay = ms => d.page.waitForTimeout(ms);
async function pause() { await d.page.keyboard.press('Escape'); await d.wait(s => s.screen === 'pause'); }
async function reloadSaved() {
  const id = (await d.snapshot()).worldId;
  await d.page.locator('[data-action="save"]').click(); await d.page.getByText('世界已保存', { exact: true }).waitFor();
  await d.page.reload(); await d.wait(s => s.screen === 'title', 180000, 'reload title');
  await d.page.locator('[data-action="worlds"]').click(); await d.page.locator(`[data-world="${id}"]`).click();
  await d.page.locator('[data-action="play-selected"]').click();
  return d.wait(s => s.screen === 'ready', 180000, 'saved world restored and paused');
}
async function fly(destination, timeout = 120000) {
  // Use the existing exact pilot for takeoff and short corrections; long legs
  // use continuous ordinary flight rather than thousands of tiny UI pulses.
  let s = await d.snapshot();
  const tolerance = { horizontal: .55, vertical: .8 };
  // Cruise above the departure pillar before descending at the destination.
  // Vertical flight has .375-block/tick impulses; sub-tick corrections based
  // on wall time oscillate under software GL. All placement/ray assertions
  // still use the actual resulting position and exact target blocks.
  const cruiseY = Math.max(destination.y, s.player.pos.y);
  if (!s.player.flying || cruiseY - s.player.pos.y > tolerance.vertical) {
    await d.flyTo({ x: s.player.pos.x, y: cruiseY, z: s.player.pos.z }, timeout, tolerance);
  }
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    s = await d.snapshot(); const dx = destination.x - s.player.pos.x, dz = destination.z - s.player.pos.z, dist = Math.hypot(dx, dz);
    if (dist < 3) break;
    await d.look(Math.atan2(-dx, -dz), 0);
    await d.page.keyboard.down('w');
    try { await delay(Math.min(2000, Math.max(80, (dist - 2.5) * 70))); }
    finally { await d.page.keyboard.up('w'); }
    await delay(450);
  }
  return d.flyTo(destination, timeout, tolerance);
}
async function shootAt(pos) {
  await d.select(3); await d.aim(pos);
  await d.page.mouse.down({ button: 'right' });
  try { const before = (await d.snapshot()).time; await d.wait(s => (s.time - before + 24000) % 24000 >= 23, 10000, 'fully charge a real bow'); }
  finally { await d.page.mouse.up({ button: 'right' }); }
}
async function hurtDragon(threshold, timeout = 180000) {
  // Wait near the head's landing radius, then attack only when it is in reach.
  // The boss naturally turns towards the player, so no state/aim setter is needed.
  await fly({ x: .5, y: 68.5, z: 10.5 }); await d.select(2);
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const s = await d.snapshot(); if (s.boss.health <= threshold) return s.boss;
    const head = s.boss.parts.find(p => p.name === 'head').pos;
    const eye = { ...s.player.pos, y: s.player.pos.y + s.player.eyeHeight };
    if (Math.hypot(head.x - eye.x, head.y - eye.y, head.z - eye.z) < 6.1) {
      await d.aim(head); await d.click('left'); await delay(680);
    } else await delay(250);
  }
  throw new Error(`Dragon not damaged to ${threshold}: ${JSON.stringify((await d.snapshot()).boss)}`);
}

try {
  await d.open('adventure'); await d.create();
  d.report.scope = 'Public creative catalogue + physical placement/flight/combat; no injected world, inventory, position, health or victory.';
  await d.stage('Build twelve inward-facing End frames and insert eyes using actual right clicks', async () => {
    center = await d.page.evaluate(({ B }) => {
      const api = window.voxelDiagnostics, p = api.snapshot().player.pos, columns = new Map();
      for (let z = Math.floor(p.z) - 28; z <= p.z + 28; z++) for (let x = Math.floor(p.x) - 28; x <= p.x + 28; x++) {
        for (let y = 115; y >= 55; y--) {
          const id = api.block(x, y, z); if (!id || [B.TALL_GRASS, B.POPPY, B.DANDELION].includes(id)) continue;
          if ([B.GRASS, B.DIRT, B.STONE, B.SAND].includes(id)) columns.set(`${x},${z}`, y);
          break;
        }
      }
      const candidates = [];
      for (const [key, y] of columns) {
        const [x, z] = key.split(',').map(Number); let ok = true;
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (columns.get(`${x + dx},${z + dz}`) !== y) ok = false;
        if (ok) candidates.push({ x, y: y + 1, z, distance: Math.hypot(x - p.x, z - p.z) });
      }
      candidates.sort((a, b) => a.distance - b.distance); return candidates[0];
    }, { B });
    assert.ok(center, 'Locate a genuine flat area in the existing terrain');
    await d.catalogue(B.END_PORTAL_FRAME, 0); await d.catalogue(I.EYE_OF_ENDER, 1);
    await d.catalogue(I.DIAMOND_SWORD, 2); await d.catalogue(I.BOW, 3); await d.select(0);
    const frames = endFrames(center).sort((a,b) => a.state - b.state), vectors = [[0,-1],[1,0],[0,1],[-1,0]];
    for (const frame of frames) {
      const [dx, dz] = vectors[frame.state];
      await fly({ x: frame.x + .5 - dx * 2.2, y: frame.y + 2, z: frame.z + .5 - dz * 2.2 });
      const old = await d.block(frame); if (old) await d.mine(frame);
      await d.placeAt(B.END_PORTAL_FRAME, frame);
      assert.equal(await d.state(frame) & 3, frame.state, 'The physical placement orientation must face the ring interior');
      console.log(`FRAME ${frame.x},${frame.y},${frame.z} facing ${frame.state}`);
    }
    await d.select(1);
    for (const frame of frames) {
      const [dx, dz] = vectors[frame.state];
      await fly({ x: frame.x + .5 - dx * 1.6, y: frame.y + 1.8, z: frame.z + .5 - dz * 1.6 });
      await d.aim({ x: frame.x + .5, y: frame.y + .7, z: frame.z + .5 });
      assert.equal((await d.snapshot()).target?.id, B.END_PORTAL_FRAME);
      await d.click(); await d.wait(async () => !!(await d.state(frame) & 4), 5000, 'eye inserted');
      console.log(`EYE ${frame.x},${frame.y},${frame.z} inserted`);
    }
    for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) assert.equal(await d.block({ x: center.x+x, y: center.y, z: center.z+z }), B.END_PORTAL);
    inventory = (await d.snapshot()).player.inventory;
    await d.aim({ x: center.x+.5, y: center.y+.75, z: center.z+.5 }); await d.screenshot('01-activated-end-portal');
    return { center, frameCount: frames.length, portalBlocks: 9 };
  });
  await d.stage('Enter the actual End portal and render the island, dragon and ten crystals', async () => {
    await fly({ x: center.x+.5, y: center.y+2, z: center.z+.5 });
    await d.page.keyboard.down('ShiftLeft');
    try { await d.wait(s => s.dimension === 'end', 12000, 'physical descent into End portal'); }
    finally { await d.page.keyboard.up('ShiftLeft'); }
    await d.wait(s => s.dimension === 'end' && s.screen !== 'loading', 180000, 'End rendered');
    if ((await d.snapshot()).screen !== 'playing') await d.enter();
    const s = await d.snapshot(); assert.equal(s.boss.health, 200); assert.equal(s.boss.crystals.filter(c => c.alive).length, 10);
    assert.deepEqual(s.player.inventory, inventory); assert.equal(await d.block({x:100,y:48,z:0}), B.OBSIDIAN);
    await fly({ x: 66, y: 82, z: 7 }); await d.aim({x:0,y:80,z:0}); await d.screenshot('02-end-island-and-dragon');
    return { arrival: s.player.pos, crystals: s.boss.crystals, health: s.boss.health };
  });
  await d.stage('Destroy all ten real crystals, opening cages before bow shots', async () => {
    const crystals = (await d.snapshot()).boss.crystals;
    for (const crystal of crystals) {
      const p = crystal.pos;
      await fly({ x: p.x, y: p.y+4.5, z: p.z });
      if (crystal.cage) {
        const roof = { x: Math.floor(p.x), y: Math.round(p.y+1.9), z: Math.floor(p.z) };
        assert.equal(await d.block(roof), B.IRON_BARS); await d.mine(roof);
      }
      await shootAt(p); await d.wait(s => !s.boss.crystals[crystal.index].alive, 8000, 'bow destroys targeted crystal');
      console.log(`CRYSTAL ${crystal.index} destroyed through real input`);
    }
    assert.equal((await d.snapshot()).boss.crystals.filter(c => c.alive).length, 0);
    await d.screenshot('03-crystals-destroyed');
  });
  await d.stage('Damage the dragon with a normal sword then save and reload the unfinished battle', async () => {
    await hurtDragon(160); await d.screenshot('04-melee-dragon'); await pause(); checkpoint = await d.snapshot();
    assert.ok(checkpoint.boss.health > 0 && checkpoint.boss.health < 200);
    await d.screenshot('04-battle-save-checkpoint'); const loaded = await reloadSaved();
    assert.equal(loaded.dimension, 'end'); assert.deepEqual(loaded.boss, checkpoint.boss);
    assert.deepEqual(loaded.player.inventory, checkpoint.player.inventory);
    assert.deepEqual(loaded.player.pos, checkpoint.player.pos);
    await d.enter(); return { before: checkpoint.boss, restored: loaded.boss };
  });
  await d.stage('Defeat the dragon through melee, complete its death, and persist one victory', async () => {
    await hurtDragon(0, 240000); await d.wait(s => s.boss.defeated, 20000, 'real death animation completes');
    const s = await d.snapshot(); assert.ok(s.earned.includes('free_end')); assert.ok(s.transient.orbs > 0);
    assert.equal(await d.block({x:0,y:67,z:0}), B.DRAGON_EGG);
    assert.equal(await d.block({x:1,y:63,z:1}), B.END_PORTAL);
    await d.aim({x:0,y:67,z:0}); await d.screenshot('05-victory-egg-and-exit'); await pause(); const before = await d.snapshot(), loaded = await reloadSaved();
    assert.equal(loaded.boss.defeated, true); assert.equal(loaded.boss.health, 0);
    assert.equal(loaded.transient.orbs, before.transient.orbs, 'Reload does not spawn a second reward batch');
    assert.deepEqual(loaded.player.inventory, before.player.inventory); await d.enter();
    return { victory: s.boss, rewardsBeforeReload: before.transient, rewardsAfterReload: loaded.transient };
  });
  await d.stage('Physically use the exit portal, continue the Overworld and reload the completed world', async () => {
    await fly({x:2,y:69,z:2}); await d.page.keyboard.down('ShiftLeft');
    try { await d.wait(s => s.dimension === 'overworld', 12000, 'physical entry into victory exit'); }
    finally { await d.page.keyboard.up('ShiftLeft'); }
    await d.wait(s => s.screen === 'credits', 180000, 'original ending and return');
    d.report.creditsViewportChecks = [];
    for (const viewport of creditViewports) {
      await d.page.setViewportSize(viewport); await delay(300);
      const check = await inspectCredits(d.page); d.report.creditsViewportChecks.push(check);
      await d.screenshot(`06-credits-${viewport.width}x${viewport.height}`);
      assert.deepEqual(check.violations, [], 'Actual victory title, text, footer and buttons must fit and remain clickable');
    }
    await d.page.setViewportSize({ width: 1280, height: 720 }); await delay(300);
    await d.screenshot('06-returned-credits'); await d.enter();
    const returned = await d.snapshot(); assert.equal(returned.dimension, 'overworld'); assert.ok(returned.earned.includes('free_end'));
    assert.deepEqual(returned.player.inventory, checkpoint.player.inventory);
    await pause(); const saved = await d.snapshot(), loaded = await reloadSaved();
    assert.equal(loaded.dimension, 'overworld'); assert.ok(loaded.earned.includes('free_end'));
    assert.deepEqual(loaded.player.inventory, saved.player.inventory); await d.enter();
    await d.screenshot('07-reloaded-overworld'); return { pos: loaded.player.pos, earned: loaded.earned };
  });
} catch (error) { failure = error; process.exitCode = 1; }
finally { await d.finish(failure); }
