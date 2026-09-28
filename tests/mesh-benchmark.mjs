import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { World } from '../src/core/world.js';
import { meshChunk } from '../src/render/mesher.js';
import { blocks } from '../src/core/blocks.js';

const names = [...new Set(blocks.filter(Boolean).flatMap(block => Array.isArray(block.texture) ? block.texture : [block.texture]))];
const atlas = { uv(name) { let i = names.indexOf(name); if (i < 0) i = 0; return [(i % 16) / 16, Math.floor(i / 16) / 16, (i % 16 + .5) / 16, (Math.floor(i / 16) + .5) / 16]; } };
const world = new World('Over the hills'), jobs = [];
for (let z = -2; z <= 2; z++) for (let x = -2; x <= 2; x++) jobs.push({ x, z });
for (let z = -3; z <= 3; z++) for (let x = -3; x <= 3; x++) world.ensure(x, z);
const digest = createHash('sha256');
for (const job of jobs) digest.update(Buffer.from(world.ensure(job.x, job.z).data.buffer));
const rows = [], started = performance.now();
for (const job of jobs) {
  const begin = performance.now(), geometries = meshChunk(world, world.ensure(job.x, job.z), atlas, true);
  const row = { chunk: `${job.x},${job.z}`, triangles: 0, vertices: 0, bytes: 0, elapsedMs: 0 };
  for (const geometry of Object.values(geometries)) if (geometry) {
    row.triangles += geometry.index.count / 3; row.vertices += geometry.attributes.position.count;
    row.bytes += geometry.index.array.byteLength;
    for (const attr of Object.values(geometry.attributes)) row.bytes += attr.array.byteLength;
    geometry.dispose();
  }
  row.elapsedMs = performance.now() - begin; rows.push(row);
}
const report = { created: new Date().toISOString(), seed: world.seed, smoothLighting: true, worldDataSHA256: digest.digest('hex'), chunks: rows,
  totals: { triangles: rows.reduce((n, row) => n + row.triangles, 0), vertices: rows.reduce((n, row) => n + row.vertices, 0), bytes: rows.reduce((n, row) => n + row.bytes, 0), elapsedMs: performance.now() - started } };
const file = path.resolve(process.argv[2] || 'tests/artifacts/mesh-benchmark.json');
if (path.relative(process.cwd(), file).startsWith('..')) throw new Error('Report must stay inside the current workspace');
fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ file, worldDataSHA256: report.worldDataSHA256, totals: report.totals }, null, 2));
