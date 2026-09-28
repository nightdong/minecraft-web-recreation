import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const unitFiles = fs.readdirSync(path.join(root, 'tests')).filter(file => file.endsWith('.test.js')).sort().map(file => `tests/${file}`);
export const browserSuites = [
  { key: 'storage', stage: 'indexeddb-migration-and-atomicity', file: 'tests/browser-storage.mjs', report: 'storage-report.json', log: 'storage-console.log' },
  { key: 'browser', stage: 'survival-and-inventory', file: 'tests/browser-smoke.mjs', report: 'browser-report.json', log: 'browser-console.log' },
  { key: 'hostiles', stage: 'hostile-crowd-combat-and-persistence', file: 'tests/browser-hostiles.mjs', report: 'hostiles-report.json', log: 'hostiles-console.log', timeoutMs: 1200000 },
  { key: 'stress', stage: 'quality-explosions-caves-streaming-soak', file: 'tests/browser-stress.mjs', report: 'stress-report.json', log: 'stress-console.log', timeoutMs: 1200000 },
  { key: 'performanceAudit', stage: 'repeatable-frame-delivery-audit', file: 'tests/browser-performance-audit.mjs', report: 'performance-current-report.json', log: 'performance-console.log' },
  { key: 'environment', stage: 'fire-and-farming', file: 'tests/browser-environment.mjs', report: 'environment-report.json', log: 'environment-console.log' },
  { key: 'redstone', stage: 'redstone-and-pistons', file: 'tests/browser-redstone.mjs', report: 'redstone-report.json', log: 'redstone-console.log' },
  { key: 'fluids', stage: 'buckets-and-flow', file: 'tests/browser-fluids.mjs', report: 'fluids-report.json', log: 'fluids-console.log' },
  { key: 'chests', stage: 'double-chests-and-lids', file: 'tests/browser-chests.mjs', report: 'chests-report.json', log: 'chests-console.log' },
  { key: 'portals', stage: 'nether-portals-and-return', file: 'tests/browser-portals.mjs', report: 'portals-report.json', log: 'portals-console.log' },
  { key: 'adventure', stage: 'end-battle-save-and-return', file: 'tests/browser-adventure.mjs', report: 'adventure-report.json', log: 'adventure-console.log', timeoutMs: 1800000 },
  { key: 'streaming', stage: 'streaming-frame-delivery', file: 'tests/browser-streaming-performance.mjs', report: 'streaming-current-report.json', log: 'streaming-console.log' },
  { key: 'interface', stage: 'responsive-interface', file: 'tests/interface-check.mjs', report: 'interface-report.json', log: 'interface-console.log' }
];
