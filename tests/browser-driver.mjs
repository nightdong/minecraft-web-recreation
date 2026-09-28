import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { B, items } from '../src/core/blocks.js';
import { pulseKey } from './keyboard-pulse.mjs';
import { blockAimPoints } from './block-aim.mjs';

/** Drives only public menus and real keyboard/mouse input. Reads use the same
 * immutable diagnostics available to the player; there are no state setters. */
export class PlayDriver {
  async open(name = 'systems') {
    this.name = name; this.out = path.resolve('tests/artifacts'); fs.mkdirSync(this.out, { recursive: true });
    this.report = { started: new Date().toISOString(), status: 'running', input: 'Playwright keyboard and mouse only; read-only game diagnostics', stages: [], errors: [], screenshots: [] };
    this.persist();
    this.browser = await chromium.launch({ headless: process.env.HEADED !== '1', args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    this.page = await this.browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await this.page.addInitScript(() => {
      window.actualKeyEvents = [];
      window.actualMouseEvents = [];
      for (const type of ['mousedown', 'mouseup']) document.addEventListener(type, event => {
        window.actualMouseEvents.push({ type, button: event.button, timeStamp: event.timeStamp, handledAt: performance.now(), trusted: event.isTrusted, shift: event.shiftKey, target: event.target.id || event.target.className });
        if (window.actualMouseEvents.length > 128) window.actualMouseEvents.shift();
      });
      document.addEventListener('keydown', event => {
        if (event.code === 'Space') {
          window.actualKeyEvents.push({ code: event.code, timeStamp: event.timeStamp, handledAt: performance.now(), trusted: event.isTrusted, repeat: event.repeat });
          if (window.actualKeyEvents.length > 64) window.actualKeyEvents.shift();
        }
      });
    });
    this.page.setDefaultTimeout(30000); this.mx = 640; this.my = 360;
    this.page.on('pageerror', error => this.report.errors.push(error.stack || error.message));
    this.page.on('console', message => { if (message.type() === 'error') this.report.errors.push(message.text()); });
    await this.page.goto(process.env.GAME_URL || 'http://localhost:5173', { waitUntil: 'domcontentloaded' });
    await this.page.waitForFunction(() => !!window.voxelDiagnostics, null, { timeout: 30000 });
    await this.wait(s => s.screen === 'title', 180000, 'title screen'); return this;
  }
  snapshot() { return this.page.evaluate(() => window.voxelDiagnostics.snapshot()); }
  block(pos) { return this.page.evaluate(p => window.voxelDiagnostics.block(p.x, p.y, p.z), pos); }
  state(pos) { return this.page.evaluate(p => window.voxelDiagnostics.blockState(p.x, p.y, p.z), pos); }
  async wait(predicate, timeout = 15000, label = 'game state') {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const state = await this.snapshot();
      if (state.screen === 'error') throw new Error(await this.page.locator('.error-detail').innerText());
      if (await predicate(state)) return state;
      await this.page.waitForTimeout(80);
    }
    throw new Error(`Timeout: ${label}; ${JSON.stringify(await this.snapshot())}`);
  }
  async stage(name, work) {
    const start = Date.now(); this.report.currentStage = name; this.persist(); console.log(`START ${name}`);
    try { const result = await work(); this.report.stages.push({ name, status: 'passed', elapsedMs: Date.now() - start, result }); console.log(`PASS ${name}`); return result; }
    catch (error) { this.report.stages.push({ name, status: 'failed', error: error.stack, elapsedMs: Date.now() - start }); throw error; }
    finally { delete this.report.currentStage; this.persist(); }
  }
  persist() { fs.writeFileSync(path.join(this.out, `${this.name}-report.json`), JSON.stringify(this.report, null, 2)); }
  async screenshot(name) {
    const file = `${this.name}-${name}.png`; await this.page.screenshot({ path: path.join(this.out, file) }); this.report.screenshots.push(file);
  }
  async create(mode = 'creative') {
    await this.page.locator('[data-action="create"]').click();
    await this.page.locator('#world-name').fill(`系统实玩验收 ${this.name}`); await this.page.locator('#world-seed').fill('Over the hills');
    const button = this.page.locator('[data-action="create-mode"]');
    if (!(await button.innerText()).includes(mode === 'creative' ? '创造' : '生存')) await button.click();
    await this.page.locator('[data-action="start-new"]').click();
    await this.wait(s => s.screen === 'ready', 180000, 'create world'); await this.enter();
    await this.wait(s => s.player.onGround, 10000, 'land');
  }
  async enter() {
    const s = await this.snapshot();
    if (s.screen !== 'playing') await this.page.locator('[data-action="resume"]').click();
    await this.wait(s => s.screen === 'playing' && s.locked, 10000, 'pointer lock');
  }
  async closeInventory() {
    await this.page.keyboard.press('Escape'); await this.page.waitForTimeout(250);
    if ((await this.snapshot()).screen === 'ready') await this.enter();
    await this.wait(s => s.screen === 'playing' && s.locked, 10000, 'close inventory');
  }
  async catalogue(id, slot = 0) {
    await this.page.keyboard.press('e'); await this.wait(s => s.screen === 'inventory');
    await this.page.locator('#creative-search').fill(items[id].name);
    await this.page.locator(`[data-kind="catalog"][data-index="${id}"]`).click({ button: 'right' });
    await this.page.locator(`[data-kind="inv"][data-index="${slot}"]`).click();
    if ((await this.snapshot()).crafting.cursor) await this.page.locator('[data-trash]').click();
    await this.closeInventory(); await this.select(slot);
    assert.equal((await this.snapshot()).player.inventory[slot].id, id);
  }
  async select(slot) { await this.page.keyboard.press(String(slot + 1)); await this.page.waitForTimeout(100); }
  async flyTo(destination, timeout = 45000, tolerance = { horizontal: .55, vertical: .3 }) {
    if (!(await this.snapshot()).player.flying) {
      // Each protocol call already waits for browser acknowledgement. An extra
      // 100ms sleep made the nominal double tap exceed 300ms under software GL.
      // Retry the real gesture, not the player state, and retain actual timings.
      for (let attempt = 0; attempt < 3; attempt++) {
        await this.page.waitForTimeout(400);
        await this.page.keyboard.press('Space'); await this.page.keyboard.press('Space');
        await this.page.waitForTimeout(120);
        const state = await this.snapshot(), events = await this.page.evaluate(() => window.actualKeyEvents.slice(-2));
        this.report.flightGestures ||= []; this.report.flightGestures.push({ attempt, events, recognized: state.player.flying });
        if (state.player.flying) break;
      }
      await this.wait(s => s.player.flying, 5000, 'creative double-jump flight');
    }
    const end = Date.now() + timeout;
    await this.page.waitForTimeout(400);
    const route = []; this.report.navigation ||= []; this.report.navigation.push({ destination, route });
    while (Date.now() < end) {
      const state = await this.snapshot(), p = state.player.pos, dx = destination.x - p.x, dy = destination.y - p.y, dz = destination.z - p.z;
      route.push({ pos: p, velocity: state.player.velocity, flying: state.player.flying });
      assert.ok(state.player.flying, 'Flight input must not accidentally double-tap itself off');
      if (Math.hypot(dx, dz) < tolerance.horizontal && Math.abs(dy) < tolerance.vertical) {
        if (Math.hypot(state.player.velocity.x, state.player.velocity.z) < .006 && Math.abs(state.player.velocity.y) < .006) return;
        await this.page.waitForTimeout(400); continue;
      }
      // Set altitude first. Each pulse is followed by enough release time to
      // avoid interpreting a second ascent press as the flight-toggle gesture.
      // Do not descend onto the object we just built before moving sideways.
      // Landing legitimately turns flight off in the game.
      if (dy >= tolerance.vertical || dy <= -tolerance.vertical && Math.hypot(dx, dz) < .8) {
        const key = dy > 0 ? 'Space' : 'ShiftLeft';
        await pulseKey(this.page.keyboard, key, Math.min(250, Math.max(16, Math.abs(dy) * 75)));
        await this.page.waitForTimeout(420); continue;
      }
      await this.look(Math.atan2(-dx, -dz), -.1);
      await pulseKey(this.page.keyboard, 'w', Math.min(140, Math.max(25, Math.hypot(dx, dz) * 60)));
      await this.page.waitForTimeout(1100);
    }
    throw new Error(`Actual creative flight did not reach ${JSON.stringify(destination)}: ${JSON.stringify((await this.snapshot()).player.pos)}`);
  }
  async look(yaw, pitch) {
    for (let i = 0; i < 6; i++) {
      const s = await this.snapshot(); assert.equal(s.screen, 'playing'); assert.ok(s.locked);
      const dyaw = Math.atan2(Math.sin(yaw - s.player.yaw), Math.cos(yaw - s.player.yaw)), dpitch = pitch - s.player.pitch;
      if (Math.abs(dyaw) < .004 && Math.abs(dpitch) < .004) return;
      const factor = .002617994;
      this.mx -= dyaw / factor; this.my -= dpitch / factor;
      await this.page.mouse.move(this.mx, this.my, { steps: Math.max(1, Math.ceil(Math.max(Math.abs(dyaw), Math.abs(dpitch)) / .3)) });
      await this.page.waitForTimeout(80);
    }
    const p = (await this.snapshot()).player;
    assert.ok(Math.abs(Math.atan2(Math.sin(yaw - p.yaw), Math.cos(yaw - p.yaw))) < .025 && Math.abs(pitch - p.pitch) < .025, 'Mouse look failed');
  }
  async aim(pos) {
    const p = (await this.snapshot()).player, dx = pos.x - p.pos.x, dz = pos.z - p.pos.z, dy = pos.y - p.pos.y - p.eyeHeight;
    await this.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    await this.page.waitForTimeout(100);
  }
  async click(button = 'right') {
    const before = await this.snapshot();
    // Queue the genuine down/up events consecutively without moving the cursor.
    // mouse.click(x,y) would issue a new movement after pointer-lock/menu changes,
    // turning the camera before clicking. Waiting between two protocol round
    // trips can conversely turn a short click into a long repeat-use gesture.
    const press = this.page.mouse.down({ button });
    const release = this.page.mouse.up({ button });
    await Promise.all([press, release]);
    await this.wait(state => state.screen !== before.screen || state.dimension !== before.dimension || state.time !== before.time, 8000, 'a simulation tick consumes the real click');
  }
  async ground() {
    const p = (await this.snapshot()).player;
    for (let i = 0; i < 12; i++) {
      await this.look(p.yaw + i * Math.PI / 6, -.73);
      let s = await this.snapshot(), t = s.target;
      if (t && [B.TALL_GRASS, B.POPPY, B.DANDELION].includes(t.id)) { await this.click('left'); s = await this.snapshot(); t = s.target; }
      if (t && [B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.PLANKS, B.NETHERRACK].includes(t.id) && t.normal[1] === 1 && Math.hypot(t.x + .5 - s.player.pos.x, t.z + .5 - s.player.pos.z) > 1.15) return t;
    }
    throw new Error('No visible, unobstructed ground within ordinary reach');
  }
  async placeOnGround(id) {
    const hit = await this.ground(), destination = { x: hit.x, y: hit.y + 1, z: hit.z };
    await this.click(); await this.wait(async () => await this.block(destination) === id, 8000, `place ${id}`); return destination;
  }
  async mine(pos) {
    const state = await this.snapshot(), id = await this.block(pos), blockState = await this.state(pos);
    const eye = { ...state.player.pos, y: state.player.pos.y + state.player.eyeHeight }; let hit;
    for (const point of blockAimPoints(pos, id, blockState, eye)) {
      await this.aim(point); hit = (await this.snapshot()).target;
      if (!hit || hit.x !== pos.x || hit.y !== pos.y || hit.z !== pos.z) continue;
      await this.click('left'); await this.wait(async () => await this.block(pos) !== id, 6000, 'creative break'); return;
    }
    assert.fail(`No visible mining surface for the requested real block: ${JSON.stringify({ pos, hit, eye })}`);
  }
  async placeAt(id, destination) {
    if (await this.block(destination) === id) return destination;
    const normals = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]];
    for (const n of normals) {
      const support = { x: destination.x - n[0], y: destination.y - n[1], z: destination.z - n[2] };
      if (!await this.block(support)) continue;
      await this.aim({ x: support.x + .5 + n[0] * .499, y: support.y + .5 + n[1] * .499, z: support.z + .5 + n[2] * .499 });
      const hit = (await this.snapshot()).target;
      if (!hit || hit.x !== support.x || hit.y !== support.y || hit.z !== support.z || hit.normal.some((v, i) => v !== n[i])) continue;
      await this.click();
      const until = Date.now() + 800;
      while (Date.now() < until) { if (await this.block(destination) === id) return destination; await this.page.waitForTimeout(50); }
    }
    if (await this.block(destination) === id) return destination;
    const final = await this.snapshot();
    throw new Error(`Cannot physically place ${id} at ${JSON.stringify(destination)}, existing=${await this.block(destination)}, from ${JSON.stringify(final.player.pos)}, target=${JSON.stringify(final.target)}`);
  }
  async finish(error) {
    try { this.report.actualMouseEvents = await this.page.evaluate(() => window.actualMouseEvents); this.report.leverTrace = await this.page.evaluate(() => window.leverTrace || []); } catch { /* retain earlier diagnostics when a browser has already closed */ }
    if (!error && this.report.errors.length) error = new Error(`Browser reported errors: ${this.report.errors.join('\n')}`);
    if (error) { this.report.status = 'failed'; this.report.failure = error.stack; console.error(error); try { this.report.finalState = await this.snapshot(); await this.screenshot('failure'); } catch {} }
    else this.report.status = 'passed';
    if (error) process.exitCode = 1;
    this.report.finished = new Date().toISOString();
    const filename = `${this.name}-report.json`; fs.writeFileSync(path.join(this.out, filename), JSON.stringify(this.report, null, 2));
    const archive = path.join(this.out, `${this.name}-runs`, this.report.started.replace(/[:.]/g, '-')); fs.mkdirSync(archive, { recursive: true });
    for (const file of [filename, ...this.report.screenshots]) fs.copyFileSync(path.join(this.out, file), path.join(archive, file));
    await this.browser?.close(); console.log(`${this.name}: ${this.report.status} (${this.report.stages.filter(s => s.status === 'passed').length}/${this.report.stages.length})`);
  }
}
