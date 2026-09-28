import { spawn } from 'node:child_process';
import { root, unitFiles } from './test-suite.mjs';

if (!unitFiles.length) throw new Error('No production regression tests were discovered');
console.log(`Running every test file (${unitFiles.length}) in a single sequential process.`);
// No tests are omitted. A shared process avoids the runtime's IPC report
// deserialization failure observed with isolated child test reporters.
const child = spawn(process.execPath, ['--test', '--test-isolation=none', ...process.argv.slice(2), ...unitFiles], { cwd: root, stdio: 'inherit' });
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.once('exit', (code, signal) => { if (signal) console.error(`Test process terminated: ${signal}`); process.exitCode = code ?? 1; });
