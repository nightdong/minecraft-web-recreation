import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { GameUI } from '../src/ui/ui.js';

export const creditViewports = [{ width: 1280, height: 720 }, { width: 640, height: 480 }, { width: 480, height: 320 }, { width: 400, height: 720 }];

/** Read layout only. Shared between the isolated production-template fixture
 * and the actual credits reached by winning and physically exiting the End. */
export async function inspectCredits(page) {
  return page.evaluate(() => {
    const violations = [], elements = [...document.querySelectorAll('.menu-screen .menu-title,.menu-screen .menu-caption,.menu-screen .mc-button')];
    if (elements.length < 6) violations.push({ type: 'missing-credits-content', count: elements.length });
    const outside = rect => rect.x < -.5 || rect.y < -.5 || rect.right > innerWidth + .5 || rect.bottom > innerHeight + .5;
    const bounds = rect => ({ x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom });
    for (const element of elements) {
      const rect = element.getBoundingClientRect(), name = element.textContent.trim().slice(0, 45);
      if (!rect.width || !rect.height || outside(rect)) violations.push({ type: 'outside-viewport', name, rect: bounds(rect) });
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(walker.currentNode);
        for (const textRect of range.getClientRects()) if (outside(textRect)) violations.push({ type: 'clipped-text', name, rect: bounds(textRect) });
      }
      if (element.matches('button')) {
        const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        if (top?.closest('button') !== element) violations.push({ type: 'unclickable-button', name });
      }
    }
    return { width: innerWidth, height: innerHeight, scale: getComputedStyle(document.documentElement).getPropertyValue('--s').trim(), violations };
  });
}

/** Component-only fixture: renders the real production method and stylesheet,
 * never changes any game state. Actual return/credits are checked in adventure. */
export async function checkCreditsFixture(browser, outputDirectory) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const fixture = { menu: { innerHTML: '' }, game: { player: { score: 123456 } }, button: GameUI.prototype.button };
  GameUI.prototype.credits.call(fixture);
  const css = fs.readFileSync(path.join(root, 'src/ui/style.css'), 'utf8'), page = await browser.newPage(), checks = [];
  try {
    for (const viewport of creditViewports) {
      await page.setViewportSize(viewport);
      const scale = Math.max(1, Math.min(3, Math.floor(viewport.width / 320), Math.floor(viewport.height / 240)));
      await page.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>${css}\n:root{--s:${scale}}</style><body><div class="menus">${fixture.menu.innerHTML}</div></body></html>`);
      await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(60);
      checks.push(await inspectCredits(page));
      if (outputDirectory) await page.screenshot({ path: path.join(outputDirectory, `credits-fixture-${viewport.width}x${viewport.height}.png`) });
    }
  } finally { await page.close(); }
  return checks;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const started = new Date().toISOString(), out = path.resolve('tests/artifacts/credits-layout-runs', started.replace(/[:.]/g, '-'));
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const checks = await checkCreditsFixture(browser, out), status = checks.some(check => check.violations.length) ? 'failed' : 'passed';
    const report = { started, finished: new Date().toISOString(), scope: 'isolated actual production credits template and CSS, not a gameplay run', status, checks };
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ out, ...report }, null, 2)); if (status === 'failed') process.exitCode = 1;
  } finally { await browser.close(); }
}
