import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { B, I } from '../src/core/blocks.js';
import { recipes } from '../src/core/inventory.js';
import { pulseKey } from './keyboard-pulse.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'artifacts'); fs.mkdirSync(OUT, { recursive: true });
const report = { started: new Date().toISOString(), stages: [], errors: [], warnings: [], screenshots: [], inputMethod: 'Real Playwright mouse/keyboard events; read-only diagnostics; no game-state injection.' };
const baseURL = process.env.GAME_URL || 'http://127.0.0.1:5173';
let browser, page, mouseX = 640, mouseY = 360;
const log = message => { console.log(message); fs.appendFileSync(path.join(OUT, 'browser-run.log'), `${new Date().toISOString()} ${message}\n`); };
const snapshot = () => page.evaluate(() => window.voxelDiagnostics.snapshot());
const wait = async (fn, timeout = 30000, label = 'condition') => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const state = await snapshot();
    if (state.screen === 'error') throw new Error(`Game error: ${await page.locator('.error-detail').innerText()}`);
    if (await fn(state)) return state;
    await page.waitForTimeout(90);
  }
  throw new Error(`Timed out: ${label}; state=${JSON.stringify(await snapshot())}`);
};
const stage = async (name, fn) => {
  const begin = Date.now(); log(`START ${name}`);
  try { const result = await fn(); report.stages.push({ name, status: 'passed', elapsedMs: Date.now() - begin, result }); log(`PASS ${name}`); return result; }
  catch (error) { report.stages.push({ name, status: 'failed', elapsedMs: Date.now() - begin, error: error.stack }); log(`FAIL ${name}: ${error.message}`); throw error; }
};
async function screenshot(name) {
  const target = path.join(OUT, `${name}.png`); await page.screenshot({ path: target }); report.screenshots.push(path.relative(ROOT, target));
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 80 });
}
async function enter() {
  await page.locator('[data-action="resume"]').click();
  await page.waitForTimeout(350);
  const state = await snapshot();
  if (state.screen === 'ready') {
    const compatible = page.locator('[data-action="compatible"]');
    if (await compatible.count()) { await compatible.click(); report.warnings.push('Headless browser used the explicitly available compatibility controls.'); }
  }
  await wait(s => s.screen === 'playing', 15000, 'enter gameplay');
}
async function pause() {
  for (let n = 0; n < 4; n++) {
    const s = await snapshot(); if (s.screen === 'pause') return;
    if (s.screen === 'ready') { await enter(); continue; }
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  }
  assert.equal((await snapshot()).screen, 'pause');
}
async function look(yaw, pitch) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const s = await snapshot(), p = s.player;
    assert.equal(s.screen, 'playing', `Camera movement is only valid during gameplay, not ${s.screen}`);
    const dyaw = Math.atan2(Math.sin(yaw - p.yaw), Math.cos(yaw - p.yaw)), dpitch = pitch - p.pitch;
    if (Math.abs(dyaw) < .008 && Math.abs(dpitch) < .008) return;
    const sensitivity = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('voxel-settings') || '{}').sensitivity ?? .5; } catch { return .5; } });
    const factor = (sensitivity * .6 + .2) ** 3 * 8 * .002617994;
    const dx = -dyaw / factor, dy = -dpitch / factor;
    if (!s.locked) await page.mouse.down({ button: 'middle' });
    mouseX += dx; mouseY += dy; await page.mouse.move(mouseX, mouseY, { steps: Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 80)) });
    if (!s.locked) await page.mouse.up({ button: 'middle' });
    await page.waitForTimeout(100);
  }
  const p = (await snapshot()).player;
  assert.ok(Math.abs(Math.atan2(Math.sin(yaw - p.yaw), Math.cos(yaw - p.yaw))) < .06 && Math.abs(pitch - p.pitch) < .06, 'Mouse controls must change the actual camera orientation.');
}
async function aim(point) {
  const p = (await snapshot()).player, dx = point.x - p.pos.x, dz = point.z - p.pos.z, dy = point.y - p.pos.y - p.eyeHeight;
  await look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
}
async function walkTo(point, tolerance = .7, timeout = 18000) {
  const end = Date.now() + timeout; let blocked = 0, previousDistance = Infinity;
  while (Date.now() < end) {
    const p = (await snapshot()).player, distance = Math.hypot(point.x - p.pos.x, point.z - p.pos.z);
    if (distance < tolerance) return;
    await look(Math.atan2(p.pos.x - point.x, p.pos.z - point.z), -.06);
    await page.keyboard.down('w');
    if (blocked >= 2 || point.y > p.pos.y + .5) await page.keyboard.down('Space');
    await page.waitForTimeout(Math.min(230, Math.max(60, (distance - tolerance) / 4.3 * 1000)));
    await page.keyboard.up('w'); await page.keyboard.up('Space'); await page.waitForTimeout(70);
    const after = (await snapshot()).player.pos, next = Math.hypot(point.x - after.x, point.z - after.z);
    blocked = next > previousDistance - .03 ? blocked + 1 : 0; previousDistance = next;
  }
  throw new Error(`Physical walking did not reach ${JSON.stringify(point)} from ${JSON.stringify((await snapshot()).player.pos)}`);
}
async function inventory() {
  if ((await snapshot()).screen === 'playing') await page.keyboard.press('e');
  await wait(s => ['inventory', 'craft', 'furnace', 'chest'].includes(s.screen), 5000, 'inventory opens');
}
async function closeInventory() {
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  if ((await snapshot()).screen === 'ready') await enter();
  await wait(s => s.screen === 'playing', 8000, 'inventory closes');
}
const slot = (kind, i) => page.locator(`[data-slot][data-kind="${kind}"][data-index="${i}"]`);
const count = (state, id) => state.player.inventory.reduce((sum, stack) => sum + (stack?.id === id ? stack.count : 0), 0);
const findInventorySlot = async id => (await snapshot()).player.inventory.findIndex(s => s?.id === id);
async function selectItem(id) {
  let index = await findInventorySlot(id); assert.ok(index >= 0, `Item ${id} must already have been obtained through gameplay.`);
  if (index >= 9) {
    await inventory(); await slot('inv', index).hover(); await page.keyboard.press('1'); await closeInventory(); index = 0;
  }
  await page.keyboard.press(String(index + 1)); await page.waitForTimeout(120);
  assert.equal((await snapshot()).player.inventory[index].id, id);
}
async function groundTarget() {
  const p = (await snapshot()).player;
  for (let n = 0; n < 8; n++) {
    await look(p.yaw + n * Math.PI / 4, -.65);
    const s = await snapshot(), t = s.target;
    if (t && [B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.SAND, B.GRAVEL, B.PLANKS, B.STONE_BRICKS, B.SANDSTONE, B.SNOW_BLOCK].includes(t.id) && t.normal[1] === 1 && Math.hypot(t.x + .5 - s.player.pos.x, t.z + .5 - s.player.pos.z) > 1.1 && t.id !== B.CRAFTING && t.id !== B.FURNACE_ON && t.id !== B.FURNACE) return t;
  }
  throw new Error('No safe visible ground target found using the actual camera.');
}
async function placeHeldBlock(expectedId) {
  const hit = await groundTarget(), pos = { x: hit.x + hit.normal[0], y: hit.y + hit.normal[1], z: hit.z + hit.normal[2] };
  await page.mouse.down({ button: 'right' }); await page.waitForTimeout(100); await page.mouse.up({ button: 'right' });
  await wait(async () => [expectedId, expectedId === B.FURNACE ? B.FURNACE_ON : expectedId].includes(await page.evaluate(p => window.voxelDiagnostics.block(p.x, p.y, p.z), pos)), 7000, 'block placement');
  return pos;
}
async function newWorld(mode) {
  if ((await snapshot()).screen !== 'title') {
    await pause(); await page.locator('[data-action="save-exit"]').click(); await wait(s => s.screen === 'title');
  }
  await page.locator('[data-action="create"]').click();
  await page.locator('#world-name').fill(`端到端验收 · ${mode === 'creative' ? '创造' : '生存'}`);
  await page.locator('#world-seed').fill('Over the hills');
  const modeButton = page.locator('[data-action="create-mode"]');
  if ((await modeButton.innerText()).includes(mode === 'creative' ? '生存' : '创造')) await modeButton.click();
  await page.locator('[data-action="start-new"]').click();
  await wait(s => s.screen === 'ready', 180000, 'world generation'); await enter();
}
async function creativeItem(id, search, hotbar) {
  await inventory(); await page.locator('#creative-search').fill(search); await slot('catalog', id).click({ button: 'right' });
  await slot('inv', hotbar).click();
  if ((await snapshot()).crafting.cursor) await page.locator('[data-trash]').click();
  await closeInventory(); assert.equal((await snapshot()).player.inventory[hotbar].id, id);
}

try {
  fs.writeFileSync(path.join(OUT, 'browser-run.log'), '');
  try { const response = await fetch(baseURL); assert.ok(response.ok); }
  catch {
    const logFile = fs.openSync(path.join(OUT, 'vite.log'), 'a');
    const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--host', '0.0.0.0', '--port', '5173', '--strictPort'], { cwd: ROOT, detached: true, stdio: ['ignore', logFile, logFile], windowsHide: true });
    child.unref(); fs.closeSync(logFile); await new Promise(resolve => setTimeout(resolve, 1500));
  }
  browser = await chromium.launch({ headless: process.env.HEADED !== '1', args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, acceptDownloads: true });
  page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => { report.errors.push(error.stack || error.message); log(`PAGEERROR ${error.message}`); });
  page.on('console', message => { if (message.type() === 'error') { report.errors.push(message.text()); log(`CONSOLEERROR ${message.text()}`); } });
  await stage('Boot, WebGL rendering and title menu', async () => {
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.voxelDiagnostics, { timeout: 30000 });
    await wait(s => s.screen === 'title', 180000, 'title panorama'); await page.waitForTimeout(3000); await screenshot('01-title');
    const pixels = await page.evaluate(async () => {
      const source = document.querySelector('#game-canvas'), canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 54;
      const ctx = canvas.getContext('2d'); ctx.drawImage(source, 0, 0, 96, 54); const bytes = ctx.getImageData(0, 0, 96, 54).data;
      const bins = new Set(); let sum = 0, min = 765, max = 0;
      for (let i = 0; i < bytes.length; i += 4) { const l = bytes[i] + bytes[i + 1] + bytes[i + 2]; min = Math.min(min, l); max = Math.max(max, l); sum += l; bins.add(`${bytes[i] >> 3},${bytes[i + 1] >> 3},${bytes[i + 2] >> 3}`); }
      return { colors: bins.size, mean: sum / (bytes.length / 4), min, max };
    });
    assert.ok(pixels.colors > 50 && pixels.max - pixels.min > 100, `The actual WebGL frame must contain a nonblank world: ${JSON.stringify(pixels)}`);
    assert.equal(report.errors.length, 0); return pixels;
  });
  await stage('Empty survival inventory, real mouse look, physical walking and jumping', async () => {
    await newWorld('survival'); let s = await snapshot(); assert.equal(s.player.mode, 'survival'); assert.ok(s.player.inventory.every(item => item === null));
    await wait(s => s.player.onGround, 8000, 'player lands at spawn');
    const start = (await snapshot()).player.pos;
    // Observe before sending the input: waiting for a software-rendering
    // keyup acknowledgement can miss the entire jump before the first read.
    await page.evaluate(() => {
      const trace = window.observedJump = { samples: [], stop: false };
      const record = () => {
        if (trace.stop) return;
        const state = window.voxelDiagnostics.snapshot();
        trace.samples.push({ tick: state.time, y: state.player.pos.y, velocityY: state.player.velocity.y, grounded: state.player.onGround });
        if (trace.samples.length < 240) requestAnimationFrame(record);
      };
      record();
    });
    await pulseKey(page.keyboard, 'Space', 70); await page.waitForTimeout(1800);
    const jump = await page.evaluate(() => { window.observedJump.stop = true; return window.observedJump.samples; });
    report.jumpTrace = jump;
    const peak = Math.max(start.y, ...jump.map(sample => sample.y));
    assert.ok(peak > start.y + .8, `Visible gameplay jump height ${peak - start.y}`);
    await look(s.player.yaw + .3, -.1); await screenshot('02-survival-spawn'); return { spawn: start, observedJump: peak - start.y };
  });
  let plankId = B.PLANKS;
  await stage('Survival: harvest and pick up three naturally generated logs', async () => {
    const tree = await page.evaluate(() => {
      const p = window.voxelDiagnostics.snapshot().player.pos, candidates = [];
      for (let z = Math.floor(p.z) - 22; z <= p.z + 22; z++) for (let x = Math.floor(p.x) - 22; x <= p.x + 22; x++) {
        for (let y = Math.floor(p.y) - 5; y <= p.y + 5; y++) {
          const id = window.voxelDiagnostics.block(x, y, z);
          if (![9, 12, 15].includes(id) || [9, 12, 15].includes(window.voxelDiagnostics.block(x, y - 1, z))) continue;
          if (![9, 12, 15].includes(window.voxelDiagnostics.block(x, y + 2, z))) continue;
          candidates.push({ x, y, z, id, d: Math.hypot(x + .5 - p.x, z + .5 - p.z) + Math.abs(y - p.y) * 3 });
        }
      }
      return candidates.sort((a, b) => a.d - b.d)[0];
    });
    assert.ok(tree, 'The real generated world should provide an accessible tree near spawn.');
    plankId = ({ 9: B.PLANKS, 12: B.BIRCH_PLANKS, 15: B.SPRUCE_PLANKS })[tree.id];
    await walkTo({ x: tree.x + .5, y: tree.y, z: tree.z + .5 }, 2.7, 45000);
    for (let n = 0; n < 3; n++) {
      await aim({ x: tree.x + .5, y: tree.y + n + .5, z: tree.z + .5 });
      // Vegetation is a real target. Clear it through normal input instead of
      // assuming the ray can pass through it or changing the generated world.
      for (let obstruction = 0; obstruction < 8; obstruction++) {
        const visible = (await snapshot()).target;
        if (!visible || visible.id === tree.id) break;
        if (![B.TALL_GRASS, B.POPPY, B.DANDELION, B.OAK_LEAVES, B.BIRCH_LEAVES, B.SPRUCE_LEAVES].includes(visible.id)) break;
        log(`Clear visible vegetation ${visible.id} at ${visible.x},${visible.y},${visible.z}`);
        await page.mouse.down({ button: 'left' });
        try {
          await wait(async () => await page.evaluate(t => window.voxelDiagnostics.block(t.x, t.y, t.z), visible) !== visible.id, 10000, 'vegetation cleared with mouse');
        } finally { await page.mouse.up({ button: 'left' }); }
        await page.waitForTimeout(300);
        await aim({ x: tree.x + .5, y: tree.y + n + .5, z: tree.z + .5 });
      }
      const target = (await snapshot()).target;
      assert.equal(target?.id, tree.id, `Expected an actual visible log before mining, got ${JSON.stringify(target)}`);
      await page.mouse.down({ button: 'left' });
      await wait(async () => !(await page.evaluate(p => [9, 12, 15].includes(window.voxelDiagnostics.block(p.x, p.y, p.z)), { x: tree.x, y: tree.y + n, z: tree.z })), 15000, 'log broken by held mouse input');
      await page.mouse.up({ button: 'left' }); await page.waitForTimeout(300);
    }
    await walkTo({ x: tree.x + .5, y: tree.y, z: tree.z + .5 }, .25, 25000);
    // Drops have real randomized horizontal velocity. Walk to the remaining
    // items instead of assuming every item lands at the trunk's center.
    for (let attempt = 0; attempt < 5; attempt++) {
      const state = await snapshot(); if (count(state, tree.id) >= 3) break;
      const remaining = state.looseItems.filter(drop => drop.stack.id === tree.id).sort((a, b) => Math.hypot(a.pos.x - state.player.pos.x, a.pos.z - state.player.pos.z) - Math.hypot(b.pos.x - state.player.pos.x, b.pos.z - state.player.pos.z))[0];
      if (!remaining) { await page.waitForTimeout(300); continue; }
      log(`Walk to real dropped log ${JSON.stringify(remaining.pos)}`);
      await walkTo(remaining.pos, .35, 15000); await page.waitForTimeout(400);
    }
    await wait(s => count(s, tree.id) >= 3, 10000, 'three dropped logs collected'); await screenshot('03-survival-wood');
    return { tree, inventory: (await snapshot()).player.inventory, stats: (await snapshot()).stats };
  });
  await stage('Survival crafting: logs → planks → crafting table → sticks', async () => {
    await inventory(); const logId = ({ [B.PLANKS]: B.OAK_LOG, [B.BIRCH_PLANKS]: B.BIRCH_LOG, [B.SPRUCE_PLANKS]: B.SPRUCE_LOG })[plankId];
    await slot('inv', await findInventorySlot(logId)).click(); await slot('craft', 0).click(); await slot('result', 0).click({ modifiers: ['Shift'] });
    assert.ok(count(await snapshot(), plankId) >= 12);
    let index = await findInventorySlot(plankId); await slot('inv', index).click();
    for (const i of [0, 1, 2, 3]) await slot('craft', i).click({ button: 'right' });
    await slot('inv', index).click(); await slot('result', 0).click({ modifiers: ['Shift'] });
    assert.equal(count(await snapshot(), B.CRAFTING), 1);
    index = await findInventorySlot(plankId); await slot('inv', index).click();
    for (const i of [0, 2]) await slot('craft', i).click({ button: 'right' });
    await slot('inv', index).click(); await slot('result', 0).click({ modifiers: ['Shift'] });
    assert.equal(count(await snapshot(), I.STICK), 4); assert.ok(count(await snapshot(), plankId) >= 6);
    await screenshot('04-survival-inventory'); await closeInventory();
  });
  await stage('Place and use the crafted workbench, then craft a wooden pickaxe', async () => {
    await selectItem(B.CRAFTING); const placed = await placeHeldBlock(B.CRAFTING);
    // Holding use can legitimately open the newly placed station on its next
    // use tick. Never try to turn the camera while that inventory is open.
    if ((await snapshot()).screen !== 'craft') {
      await aim({ x: placed.x + .5, y: placed.y + .5, z: placed.z + .5 });
      await page.mouse.down({ button: 'right' }); await page.waitForTimeout(100); await page.mouse.up({ button: 'right' });
    }
    await wait(s => s.screen === 'craft', 10000, 'workbench interaction');
    await page.locator('[data-recipe-toggle]').click();
    const recipeIndex = recipes.findIndex(r => r.output.id === I.WOOD_PICKAXE); await page.locator(`[data-recipe="${recipeIndex}"]`).click();
    assert.equal((await snapshot()).crafting.grid.filter(Boolean).length, 5); await screenshot('05-workbench-recipe');
    await slot('result', 0).click({ modifiers: ['Shift'] }); assert.equal(count(await snapshot(), I.WOOD_PICKAXE), 1);
    assert.equal((await snapshot()).player.inventory.find(s => s?.id === I.WOOD_PICKAXE).durability, 59);
    await closeInventory(); await selectItem(I.WOOD_PICKAXE); await screenshot('06-crafted-pickaxe');
    return { workbench: placed, earned: (await snapshot()).earned, stats: (await snapshot()).stats };
  });
  await stage('Survival save and reload preserve legitimately acquired inventory and edits', async () => {
    await pause(); await page.locator('[data-action="save"]').click();
    await page.getByText('世界已保存', { exact: true }).waitFor(); const before = await snapshot();
    await page.reload(); await wait(s => s.screen === 'title', 180000, 'reload title');
    await page.locator('[data-action="worlds"]').click(); await page.locator(`[data-world="${before.worldId}"]`).click();
    await page.locator('[data-action="play-selected"]').click(); await wait(s => s.screen === 'ready', 180000, 'saved world loads'); await enter();
    const after = await snapshot(); assert.equal(after.worldId, before.worldId); assert.deepEqual(after.player.inventory, before.player.inventory);
    assert.equal(after.stats.crafted, before.stats.crafted); assert.ok(after.earned.includes('pickaxe')); await screenshot('07-restored-survival');
  });
  await stage('Creative catalog, hotbar exchange, block placement and instant breaking', async () => {
    await newWorld('creative'); await creativeItem(B.DIAMOND_BLOCK, '钻石', 8); await page.keyboard.press('9');
    const placed = await placeHeldBlock(B.DIAMOND_BLOCK); await aim({ x: placed.x + .5, y: placed.y + .5, z: placed.z + .5 });
    await screenshot('08-creative-building'); await page.mouse.down({ button: 'left' }); await page.waitForTimeout(90); await page.mouse.up({ button: 'left' });
    await wait(async () => await page.evaluate(p => window.voxelDiagnostics.block(p.x, p.y, p.z), placed) === 0, 8000, 'creative instant break');
    assert.equal((await snapshot()).player.inventory[8].count, 64);
  });
  await stage('Furnace UI smelts real input and fuel over simulated time', async () => {
    await creativeItem(B.FURNACE, '熔炉', 8); await creativeItem(B.IRON_ORE, '铁矿石', 7); await creativeItem(I.COAL, '煤炭', 6);
    await page.keyboard.press('9'); const placed = await placeHeldBlock(B.FURNACE);
    if ((await snapshot()).screen !== 'furnace') {
      await aim({ x: placed.x + .5, y: placed.y + .5, z: placed.z + .5 });
      await page.mouse.down({ button: 'right' }); await page.waitForTimeout(90); await page.mouse.up({ button: 'right' });
    }
    await wait(s => s.screen === 'furnace');
    await slot('inv', 7).click(); await slot('container', 0).click(); await slot('inv', 6).click(); await slot('container', 1).click();
    await page.waitForFunction(() => document.querySelector('[data-kind="container"][data-index="2"]')?.getAttribute('data-item') === '257', null, { timeout: 45000 });
    await screenshot('09-furnace-smelting'); await slot('container', 2).click({ modifiers: ['Shift'] }); assert.ok(count(await snapshot(), I.IRON) >= 1);
    await closeInventory(); await pause(); await page.locator('[data-action="save"]').click(); await page.getByText('世界已保存', { exact: true }).waitFor();
  });
  await stage('Pause freezes simulation and hotbar cycling does not leak GPU geometry', async () => {
    const paused = await snapshot(); await page.waitForTimeout(700);
    assert.equal((await snapshot()).time, paused.time);
    assert.equal((await snapshot()).textureAnimation.frame, paused.textureAnimation.frame, 'Pause also freezes fluid and fire animation');
    await enter(); await creativeItem(B.TORCH, '火把', 6);
    await page.keyboard.press('7'); await wait(s => s.meshing.pending === 0 && s.chunks >= 121, 60000, 'finish queued chunk uploads before measuring resource ownership');
    await page.waitForTimeout(300);
    const before = (await snapshot()).render;
    for (let i = 0; i < 24; i++) { await page.keyboard.press(i % 2 ? '7' : '1'); await page.waitForTimeout(100); }
    await page.waitForTimeout(500); const after = (await snapshot()).render;
    assert.ok(after.geometries <= before.geometries + 2, `Geometry leak: ${JSON.stringify({ before, after })}`);
    assert.ok(after.calls > 5 && after.triangles > 1000, 'Diagnostics must count the world, not just the hand pass');
    await page.keyboard.press('F3'); await screenshot('10-debug-frame'); await page.keyboard.press('F3');
    return { before, after };
  });
  await stage('Primed TNT survives saving and reloading, then completes its explosion', async () => {
    await creativeItem(B.TNT, 'TNT', 8); await creativeItem(I.FLINT_STEEL, '打火石', 7);
    await page.keyboard.press('9'); const placed = await placeHeldBlock(B.TNT);
    await page.keyboard.press('8'); await aim({ x: placed.x + .5, y: placed.y + .5, z: placed.z + .5 });
    await page.mouse.down({ button: 'right' }); await page.waitForTimeout(80); await page.mouse.up({ button: 'right' });
    await wait(s => s.transient.tnt.length === 1, 5000, 'TNT ignites through ordinary right-click');
    await pause(); const before = await snapshot();
    assert.ok(before.transient.tnt[0].fuse > 0 && before.transient.tnt[0].fuse < 80);
    await page.locator('[data-action="save"]').click(); await page.getByText('世界已保存', { exact: true }).waitFor();
    await page.reload(); await wait(s => s.screen === 'title', 180000);
    await page.locator('[data-action="worlds"]').click(); await page.locator(`[data-world="${before.worldId}"]`).click();
    await page.locator('[data-action="play-selected"]').click(); await wait(s => s.screen === 'ready', 180000);
    const restored = await snapshot(); assert.deepEqual(restored.transient.tnt, before.transient.tnt);
    await enter(); await wait(s => s.transient.tnt.length === 0, 12000, 'restored fuse completes');
    await page.waitForTimeout(700); await screenshot('11-restored-tnt-explosion');
    assert.equal(await page.evaluate(p => window.voxelDiagnostics.block(p.x, p.y - 1, p.z), placed), B.AIR, 'The restored TNT must actually alter the world');
    return { savedFuse: before.transient.tnt[0].fuse, restoredFuse: restored.transient.tnt[0].fuse };
  });
  await stage('Menu export and import round-trip an actual world save', async () => {
    await pause(); const worldId = (await snapshot()).worldId;
    await page.locator('[data-action="save-exit"]').click(); await wait(s => s.screen === 'title');
    await page.locator('[data-action="worlds"]').click(); await page.locator(`[data-world="${worldId}"]`).click();
    const downloadEvent = page.waitForEvent('download'); await page.locator('[data-action="export-world"]').click();
    const downloaded = await downloadEvent, file = path.join(OUT, 'exported-world.voxel.json'); await downloaded.saveAs(file);
    const data = JSON.parse(fs.readFileSync(file, 'utf8')); assert.equal(data.id, worldId); assert.equal(data.format, 1);
    const initialCount = await page.locator('[data-world]').count();
    const chooserEvent = page.waitForEvent('filechooser'); await page.locator('[data-action="import-world"]').click();
    await (await chooserEvent).setFiles(file);
    await page.waitForFunction(expected => document.querySelectorAll('[data-world]').length === expected, initialCount + 1);
    const imported = page.locator('[data-world]').filter({ hasText: '（导入）' }); await imported.click();
    await screenshot('12-world-import'); await page.locator('[data-action="play-selected"]').click();
    await wait(s => s.screen === 'ready', 180000); const state = await snapshot();
    assert.notEqual(state.worldId, worldId); assert.deepEqual(state.player.inventory, data.player.inventory);
    await enter(); return { importedName: state.worldName, inventoryPreserved: true };
  });
  await stage('No uncaught JavaScript or WebGL shader errors', async () => { assert.deepEqual(report.errors, []); return { screenshots: report.screenshots.length }; });
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = error.stack;
  if (page) {
    try { report.finalState = await snapshot(); await screenshot('failure'); fs.writeFileSync(path.join(OUT, 'failure.html'), await page.content()); } catch { /* browser may have already failed */ }
  }
  process.exitCode = 1;
} finally {
  report.finished = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'browser-report.json'), JSON.stringify(report, null, 2));
  log(`RESULT ${report.status || 'failed'} — ${report.stages.filter(s => s.status === 'passed').length}/${report.stages.length} stages passed`);
  // Keep every real run, including failures, rather than overwriting evidence.
  const archive = path.join(OUT, 'runs', report.started.replace(/[:.]/g, '-'));
  fs.mkdirSync(archive, { recursive: true });
  for (const file of fs.readdirSync(OUT, { withFileTypes: true })) if (file.isFile()) fs.copyFileSync(path.join(OUT, file.name), path.join(archive, file.name));
  await browser?.close();
}
