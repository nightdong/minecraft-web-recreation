import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkCreditsFixture } from './credits-layout.mjs';

const OUT = path.resolve('tests/artifacts'); fs.mkdirSync(OUT, { recursive: true });
const report = { started: new Date().toISOString(), viewportChecks: [], errors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(30000);
page.on('pageerror', error => report.errors.push(error.message));
const waitScreen = screen => page.waitForFunction(value => window.voxelDiagnostics?.snapshot().screen === value, screen, { timeout: 180000 });
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173'); await waitScreen('title');
  await page.locator('[data-action="create"]').click();
  await page.locator('#world-name').fill('界面尺寸验收'); await page.locator('#world-seed').fill('Over the hills');
  await page.locator('[data-action="create-mode"]').click(); await page.locator('[data-action="start-new"]').click(); await waitScreen('ready');
  await page.locator('[data-action="resume"]').click(); await waitScreen('playing');
  await page.keyboard.press('e'); await waitScreen('inventory'); await page.locator('[data-tab="survival"]').click();
  await page.locator('[data-recipe-toggle]').click();
  for (const viewport of [{ width: 1280, height: 720 }, { width: 640, height: 480 }, { width: 480, height: 320 }, { width: 400, height: 720 }]) {
    await page.setViewportSize(viewport); await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      const violations = [], box = element => {
        const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
      };
      const panel = document.querySelector('.inventory-panel'), p = box(panel);
      for (const element of panel.querySelectorAll('[data-slot]')) {
        const r = box(element), name = `${element.dataset.kind}:${element.dataset.index}`;
        if (r.x < p.x - .5 || r.right > p.right + .5 || r.y < p.y - .5 || r.bottom > p.bottom + .5) violations.push({ type: 'slot-outside-panel', name, rect: r, panel: p });
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        if (top && top.closest('[data-slot]') !== element) violations.push({ type: 'slot-obscured', name, by: top.className });
      }
      for (const element of document.querySelectorAll('.inventory-panel,.recipe-book,.creative-tabs')) {
        const r = box(element);
        if (r.x < -.5 || r.y < -.5 || r.right > innerWidth + .5 || r.bottom > innerHeight + .5) violations.push({ type: 'outside-viewport', name: element.className, rect: r });
      }
      return { width: innerWidth, height: innerHeight, scale: getComputedStyle(document.documentElement).getPropertyValue('--s'), violations };
    });
    report.viewportChecks.push(result);
    const file = `interface-${viewport.width}x${viewport.height}.png`;
    await page.screenshot({ path: path.join(OUT, file) }); console.log(JSON.stringify(result));
  }
  assert.deepEqual(report.errors, []);
  assert.equal(report.viewportChecks.reduce((n, r) => n + r.violations.length, 0), 0, 'Inventory controls must remain visible, inside their panel, and clickable.');
  report.creditsFixtureChecks = await checkCreditsFixture(browser);
  assert.equal(report.creditsFixtureChecks.reduce((n, check) => n + check.violations.length, 0), 0, 'The actual credits template must not clip its heading, footer, text or buttons.');
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = error.stack; process.exitCode = 1; console.error(error.message); }
finally {
  report.finished = new Date().toISOString(); fs.writeFileSync(path.join(OUT, 'interface-report.json'), JSON.stringify(report, null, 2));
  const archive = path.join(OUT, 'interface-runs', report.started.replace(/[:.]/g, '-')); fs.mkdirSync(archive, { recursive: true });
  for (const name of fs.readdirSync(OUT)) if (/^interface-(report\.json|\d+x\d+\.png)$/.test(name)) fs.copyFileSync(path.join(OUT, name), path.join(archive, name));
  await browser.close();
}
