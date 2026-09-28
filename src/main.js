import './ui/style.css';
import './ui/layout.css';
import { Game } from './game/game.js';

const canvas = document.querySelector('#game-canvas'), root = document.querySelector('#ui-root');
let game;
try {
  game = new Game(canvas, root);
  // Read-only diagnostics for profiling and reproducible tests. No inventory, teleport, or world-edit commands.
  Object.defineProperty(window, 'voxelDiagnostics', { configurable: false, writable: false, value: Object.freeze({
    snapshot: () => JSON.parse(JSON.stringify(game.diagnostics())),
    block: (x, y, z) => game.world?.get(Math.floor(x), Math.floor(y), Math.floor(z), false) ?? 0,
    blockState: (x, y, z) => game.world?.getState(Math.floor(x), Math.floor(y), Math.floor(z)) ?? 0,
    mobs: () => game.entities?.mobs.map(m => ({ type: m.type, pos: { ...m.pos }, health: m.health, fire: m.fire, fuse: m.fuse, bowDraw: m.bowDraw || 0, pursuing: !!m.visibleTarget, persistent: !!m.persistent, routeLength: m.route?.length || 0, age: m.age })) || []
  }) });
  game.init().catch(error => game.ui.error(error));
} catch (error) {
  console.error(error);
  const boot = document.querySelector('#boot-status');
  if (boot) { boot.textContent = `无法启动 WebGL 游戏：${error.message}。请使用支持 WebGL 2 的浏览器，并启用硬件加速。`; boot.style.maxWidth = '80vw'; }
}
