import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { unitFiles, browserSuites } from './test-suite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests/artifacts'); fs.mkdirSync(OUT, { recursive: true });
const report = { started: new Date().toISOString(), node: process.version, stages: [], status: 'running', sourceFiles: {} };
let preview, previewLog;
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name); return entry.isDirectory() ? files(file) : [file];
  });
}
const sources = [...files(path.join(ROOT, 'src')), ...files(path.join(ROOT, 'scripts')), ...['package.json', 'package-lock.json', 'index.html', '启动游戏.cmd', '验收游戏.cmd'].map(file => path.join(ROOT, file))];
for (const file of fs.readdirSync(path.join(ROOT, 'tests')).filter(file => /\.m?js$/.test(file))) sources.push(path.join(ROOT, 'tests', file));
for (const name of ['vite.config.js', 'vite.config.mjs']) if (fs.existsSync(path.join(ROOT, name))) sources.push(path.join(ROOT, name));
report.unitFiles = unitFiles;
report.browserSuites = browserSuites;
for (const file of sources) report.sourceFiles[path.relative(ROOT, file).replaceAll('\\', '/')] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const persist = () => fs.writeFileSync(path.join(OUT, 'final-verification.json'), JSON.stringify(report, null, 2));
async function startProductionPreview() {
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
  const url = `http://127.0.0.1:${port}`;
  previewLog = fs.createWriteStream(path.join(OUT, 'production-preview.log'));
  preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let failure; preview.once('error', error => { failure = error; });
  preview.stdout.on('data', chunk => previewLog.write(chunk)); preview.stderr.on('data', chunk => previewLog.write(chunk));
  for (let attempt = 0; attempt < 80; attempt++) {
    if (failure) throw failure;
    if (preview.exitCode !== null) throw new Error('Production preview exited before startup');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      const html = await response.text();
      if (response.ok && html.includes('/assets/') && !html.includes('/src/main.js')) {
        process.env.GAME_URL = url; report.testTarget = { url, kind: 'built-dist', htmlVerified: true }; persist(); return;
      }
    } catch { /* the server is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Could not start the production build preview');
}
async function run(name, args, logName, timeoutMs = 600000) {
  const start = Date.now(), stream = fs.createWriteStream(path.join(OUT, logName)), record = { name, command: ['node', ...args].join(' '), status: 'running', log: logName };
  report.stages.push(record); persist(); console.log(`\n=== ${name} ===`);
  let timer, timedOut = false;
  const result = await new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => { process.stdout.write(chunk); stream.write(chunk); });
    child.stderr.on('data', chunk => { process.stderr.write(chunk); stream.write(chunk); });
    child.once('error', error => resolve({ code: null, error: error.message }));
    child.once('close', (code, signal) => resolve({ code, signal }));
    timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
  });
  clearTimeout(timer); await new Promise(resolve => stream.end(resolve));
  Object.assign(record, { exitCode: result.code, signal: result.signal, error: result.error, elapsedMs: Date.now() - start, status: !timedOut && result.code === 0 ? 'passed' : 'failed', timedOut }); persist();
  if (record.status !== 'passed') throw new Error(`${name} failed; see ${logName}`);
}
try {
  // Exact source syntax is checked independently of bundler tree shaking.
  for (const source of sources.filter(file => /\.m?js$/.test(file))) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--check', source], { cwd: ROOT, stdio: 'inherit' });
      child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Syntax error in ${source}`)));
    });
  }
  report.stages.push({ name: 'source-syntax', status: 'passed', files: sources.filter(f => /\.m?js$/.test(f)).length, exitCode: 0 }); persist();
  await run('core-and-regression-tests', ['tests/run-unit-tests.mjs'], 'core-tests.log');
  const testLog = fs.readFileSync(path.join(OUT, 'core-tests.log'), 'utf8');
  report.unitTests = Number(testLog.match(/(?:ℹ|#) tests (\d+)/)?.[1]);
  if (!Number.isInteger(report.unitTests) || report.unitTests < 1) throw new Error('The test runner did not report a valid executed test count');
  await run('production-build', ['node_modules/vite/bin/vite.js', 'build'], 'build.log');
  report.builtFiles = Object.fromEntries(files(path.join(ROOT, 'dist')).map(file => [path.relative(ROOT, file).replaceAll('\\', '/'), createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
  await startProductionPreview();
  for (const suite of browserSuites) {
    await run(suite.stage, [suite.file], suite.log, suite.timeoutMs);
    const data = JSON.parse(fs.readFileSync(path.join(OUT, suite.report), 'utf8'));
    if (data.status !== 'passed' || !Number.isFinite(Date.parse(data.started)) || Date.parse(data.started) < Date.parse(report.started) || !Number.isFinite(Date.parse(data.finished))) throw new Error(`${suite.stage} did not produce a fresh completed passing report`);
    report[suite.key] = data; persist();
  }
  for (const file of sources) if (createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== report.sourceFiles[path.relative(ROOT, file).replaceAll('\\', '/')]) throw new Error(`Source changed during verification: ${file}`);
  const builtNow = Object.fromEntries(files(path.join(ROOT, 'dist')).map(file => [path.relative(ROOT, file).replaceAll('\\', '/'), createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
  if (JSON.stringify(builtNow) !== JSON.stringify(report.builtFiles)) throw new Error('Production artifacts changed while browser suites were running');
  report.hashesVerified = { source: true, production: true, checkedAt: new Date().toISOString() };
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = error.stack; process.exitCode = 1; }
finally {
  if (preview && preview.exitCode === null) {
    await new Promise(resolve => { const timer = setTimeout(resolve, 3000); preview.once('exit', () => { clearTimeout(timer); resolve(); }); preview.kill(); });
  }
  if (previewLog) await new Promise(resolve => previewLog.end(resolve));
  // A failed browser stage still has valuable screenshots and diagnostics.
  // Never substitute an older successful report for this run's failed output.
  for (const { key: property, report: file } of browserSuites) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(OUT, file), 'utf8'));
      if (Date.parse(data.started) >= Date.parse(report.started)) report[property] = data;
    } catch { /* This stage may not have produced a report. */ }
  }
  report.finished = new Date().toISOString(); persist();
  const archive = path.join(OUT, 'verification-runs', report.started.replace(/[:.]/g, '-')); fs.mkdirSync(archive, { recursive: true });
  for (const name of ['final-verification.json', 'core-tests.log', 'build.log', 'production-preview.log', ...browserSuites.flatMap(suite => [suite.log, suite.report])]) if (fs.existsSync(path.join(OUT, name))) fs.copyFileSync(path.join(OUT, name), path.join(archive, name));
  console.log(`\nVerification ${report.status.toUpperCase()}: tests/artifacts/final-verification.json`);
  await import('./render-report.mjs');
  const screenshots = browserSuites.flatMap(suite => report[suite.key]?.screenshots || []).map(file => path.basename(file.replaceAll('\\', '/')));
  screenshots.push(...(report.interface?.viewportChecks || []).map(view => `interface-${view.width}x${view.height}.png`));
  for (const file of new Set(['verification.html', ...screenshots])) if (fs.existsSync(path.join(OUT, file))) fs.copyFileSync(path.join(OUT, file), path.join(archive, file));
}
