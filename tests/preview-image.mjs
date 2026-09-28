// Produce a small lossily encoded inspection copy of an actual test screenshot.
// The original full-resolution screenshot is retained unchanged.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd(), input = path.resolve(process.argv[2] || 'tests/artifacts/06-crafted-pickaxe.png');
if (path.relative(root, input).startsWith('..')) throw new Error('Only current workspace screenshots may be inspected.');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const data = await page.evaluate(async ({ source, width, crop }) => {
    const image = new Image(); image.src = source; await image.decode();
    const area = crop.length === 4 ? crop : [0, 0, image.width, image.height];
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = Math.round(width * area[3] / area[2]);
    canvas.getContext('2d').drawImage(image, ...area, 0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, sourceCrop: area, image: canvas.toDataURL('image/webp', .4) };
  }, { source: `data:image/png;base64,${fs.readFileSync(input).toString('base64')}`, width: Number(process.argv[3]) || 384, crop: process.argv.slice(4, 8).map(Number) });
  console.log(JSON.stringify(data));
} finally { await browser.close(); }
