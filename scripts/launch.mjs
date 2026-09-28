import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function probeGame(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    const html = await response.text();
    return response.ok && /Minecraft.*Web Recreation/.test(html) && html.includes('game-canvas') ? 'game' : 'occupied';
  } catch { return 'offline'; }
}

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => console.error(`请手动在浏览器中打开 ${url}`)); child.unref();
}

async function installDependencies() {
  const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npm';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm install --no-audit --no-fund'] : ['install', '--no-audit', '--no-fund'];
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`依赖安装失败，退出码 ${code}`)));
  });
}

export async function main(args = process.argv.slice(2)) {
  const portFlag = args.indexOf('--port'), port = portFlag < 0 ? 5173 : Number(args[portFlag + 1]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('端口必须是 1024–65535 之间的整数。');
  const verify = args.includes('--verify-start'), noOpen = verify || args.includes('--no-open') || process.env.VOXEL_NO_OPEN === '1';
  const url = `http://localhost:${port}`, state = await probeGame(url);
  if (state === 'game') {
    console.log(`游戏服务已经运行：${url}`); if (!noOpen) openBrowser(url); return;
  }
  if (state === 'occupied') throw new Error(`${port} 端口已有其他 HTTP 服务；不会终止或替换它。`);
  const vite = path.join(ROOT, 'node_modules/vite/bin/vite.js');
  if (!fs.existsSync(vite)) { console.log('正在安装当前工作区的依赖…'); await installDependencies(); }
  const server = spawn(process.execPath, [vite, '--host', '0.0.0.0', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'inherit' });
  let ended = false, exitCode = null, startupError;
  const exited = new Promise(resolve => {
    server.once('error', error => { startupError = error; ended = true; resolve(); });
    server.once('exit', code => { exitCode = code; ended = true; resolve(); });
  });
  const stop = () => { if (!ended) server.kill(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    let ready = false;
    for (let n = 0; n < 80 && !ended; n++) {
      if (await probeGame(url) === 'game') { ready = true; break; }
      await delay(150);
    }
    if (!ready) throw startupError || new Error(`游戏服务器未能启动，退出码 ${exitCode ?? '未知'}。`);
    console.log(`游戏服务已就绪：${url}`);
    if (verify) { stop(); await exited; console.log('冷启动检查完成，测试服务器已停止。'); return; }
    if (!noOpen) openBrowser(url);
    console.log('按 Ctrl+C 或关闭此终端可停止服务器。'); await exited;
    if (exitCode !== null && exitCode !== 0) throw new Error(`服务器退出码 ${exitCode}`);
  } finally {
    stop(); await exited; process.off('SIGINT', stop); process.off('SIGTERM', stop);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
