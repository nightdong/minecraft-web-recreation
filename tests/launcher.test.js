import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { probeGame, main } from '../scripts/launch.mjs';

test('launcher recognizes an existing game but does not replace another HTTP service', async () => {
  let body = '<title>Minecraft · Web Recreation</title><canvas id="game-canvas"></canvas>';
  const server = http.createServer((request, response) => response.end(body));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, url = `http://127.0.0.1:${port}`;
  try {
    assert.equal(await probeGame(url), 'game');
    await main(['--port', String(port), '--no-open']);
    body = '<title>Owned test fixture, not a game</title>';
    assert.equal(await probeGame(url), 'occupied');
    await assert.rejects(() => main(['--port', String(port), '--no-open']), /HTTP/);
    assert.equal((await fetch(url)).status, 200, 'An occupied server must be left running');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('a real cold-start check starts Vite, verifies the game response, and stops its own server', { timeout: 45000 }, async () => {
  const reservation = net.createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  let output = '';
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/launch.mjs', '--port', String(port), '--verify-start'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
    child.once('error', reject); child.once('exit', resolve);
  });
  assert.equal(code, 0, output); assert.match(output, /已就绪/); assert.match(output, /测试服务器已停止/);
  assert.equal(await probeGame(`http://127.0.0.1:${port}`), 'offline');
});

test('Windows entry points are ASCII CRLF wrappers and forward actual exit codes', () => {
  for (const file of ['启动游戏.cmd', '验收游戏.cmd']) {
    const data = fs.readFileSync(file); assert.ok([...data].every(byte => byte < 128), `${file}: no console-codepage-dependent commands`);
    const text = data.toString('ascii'); assert.ok(text.includes('\r\n')); assert.equal(/(?<!\r)\n/.test(text), false);
    assert.ok(text.includes('exit /b'));
  }
});
