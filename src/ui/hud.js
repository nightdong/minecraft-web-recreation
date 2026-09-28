import { B, items } from '../core/blocks.js';
import { BIOMES, chunkKey } from '../core/world.js';
import { clamp } from '../core/noise.js';

const HEART = ['001101100', '011111110', '111111111', '111111111', '011111110', '001111100', '000111000', '000010000', '000000000'];
const FOOD = ['000011100', '000111110', '000111110', '000111100', '001111000', '011100000', '111000000', '110000000', '000000000'];
const ARMOR = ['110000011', '111000111', '011111110', '001111100', '001111100', '001111100', '001111100', '001111100', '000000000'];
const AIR = ['000111000', '001000100', '010000010', '010000010', '010000010', '001000100', '000111000', '000000000', '000000000'];

export class HUD {
  constructor(game, element) {
    this.game = game; this.canvas = document.createElement('canvas'); this.canvas.id = 'hud-canvas';
    element.append(this.canvas); this.ctx = this.canvas.getContext('2d'); this.previousSelected = -1; this.itemNameTime = 0;
    this.lastName = ''; this.tipTime = 0; this.messages = [];
  }
  text(text, x, y, color = '#fff', align = 'left', size = 8, shadow = true) {
    const c = this.ctx; c.font = `${size}px "Courier New", "Microsoft YaHei", monospace`; c.textBaseline = 'top'; c.textAlign = align;
    if (shadow) { c.fillStyle = 'rgba(0,0,0,.8)'; c.fillText(text, Math.round(x) + 1, Math.round(y) + 1); }
    c.fillStyle = color; c.fillText(text, Math.round(x), Math.round(y));
  }
  rect(x, y, w, h, color) { this.ctx.fillStyle = color; this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  sprite(pattern, x, y, fill, amount = 1, back = '#3c2527') {
    const c = this.ctx;
    pattern.forEach((row, yy) => [...row].forEach((bit, xx) => {
      if (bit !== '1') return;
      const border = xx === 0 || xx === 8 || yy === 0 || yy === 8 || pattern[yy - 1]?.[xx] !== '1' || pattern[yy + 1]?.[xx] !== '1' || row[xx - 1] !== '1' || row[xx + 1] !== '1';
      c.fillStyle = border ? '#101010' : xx < 9 * amount ? fill : back;
      c.fillRect(Math.round(x) + xx, Math.round(y) + yy, 1, 1);
    }));
    if (amount > .5 && pattern === HEART) this.rect(x + 2, y + 2, 1, 1, '#ffb8ac');
    if (amount > .5 && pattern === FOOD) this.rect(x + 5, y + 2, 1, 1, '#e9b383');
  }
  item(stack, x, y, size = 16) {
    if (!stack || !items[stack.id]) return;
    const c = this.ctx; c.drawImage(this.game.atlas.icon(stack.id), Math.round(x), Math.round(y), size, size);
    if (stack.count > 1) this.text(String(stack.count), x + size + 1, y + size - 6, '#fff', 'right', 8);
    const max = items[stack.id]?.durability;
    if (max && stack.durability < max) {
      const value = clamp(stack.durability / max, 0, 1); this.rect(x + 1, y + size - 1, size - 2, 2, '#000');
      this.rect(x + 1, y + size - 1, Math.round((size - 2) * value), 1, `hsl(${value * 120},100%,45%)`);
    }
  }
  message(text) { this.messages.push({ text, time: 6 }); if (this.messages.length > 5) this.messages.shift(); }
  draw(dt) {
    const { game } = this, { player, world } = game;
    const scale = game.ui.scale, width = Math.ceil(innerWidth / scale), height = Math.ceil(innerHeight / scale);
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; this.ctx.imageSmoothingEnabled = false; }
    this.ctx.clearRect(0, 0, width, height);
    const visible = player && ['playing', 'inventory', 'craft', 'chest', 'furnace', 'pause', 'death', 'options', 'controls', 'advancements'].includes(game.screen) && game.activeWorld;
    this.canvas.style.display = visible && !game.hideHUD ? 'block' : 'none';
    if (!visible || game.hideHUD) return;
    const c = this.ctx, center = Math.floor(width / 2), hotX = center - 91, hotY = height - 23;
    const boss = game.world?.endFight?.state;
    if (boss && !boss.defeated) {
      this.text('末影龙', center, 4, '#fff', 'center');
      this.rect(center - 91, 15, 182, 6, '#18091f'); this.rect(center - 90, 16, 180, 4, '#512257');
      const hpWidth = Math.floor(clamp(boss.health / 200, 0, 1) * 180);
      this.rect(center - 90, 16, hpWidth, 4, '#b640bd'); this.rect(center - 90, 16, hpWidth, 1, '#e378e9');
    }
    if (game.screen === 'playing' && player.health > 0) {
      const cy = Math.floor(height / 2);
      this.rect(center - 4, cy, 9, 1, '#ffffff'); this.rect(center, cy - 4, 1, 9, '#ffffff');
      if (game.attackCooldown > .05) {
        this.rect(center - 8, cy + 10, 16, 2, '#1d1d1d'); this.rect(center - 8, cy + 10, 16 * clamp(1 - game.attackCooldown / game.maxAttackCooldown, 0, 1), 1, '#cecece');
      }
    }
    this.rect(hotX, hotY, 182, 22, '#171717'); this.rect(hotX + 1, hotY + 1, 180, 20, '#686868');
    this.rect(hotX + 2, hotY + 2, 178, 18, 'rgba(34,34,34,.75)');
    for (let i = 0; i < 9; i++) {
      const x = hotX + i * 20 + 1;
      this.rect(x + 1, hotY + 1, 18, 1, '#999999'); this.rect(x, hotY + 2, 1, 18, '#3b3b3b'); this.rect(x + 19, hotY + 1, 1, 20, '#141414');
    }
    const selectedX = hotX + player.selected * 20 - 1;
    this.rect(selectedX, hotY - 1, 24, 24, '#151515'); this.rect(selectedX + 1, hotY, 22, 22, '#eeeeee');
    this.rect(selectedX + 2, hotY + 1, 20, 20, '#9e9e9e'); this.rect(selectedX + 3, hotY + 2, 18, 18, '#555555');
    for (let i = 0; i < 9; i++) this.item(player.inventory.slots[i], hotX + 3 + i * 20, hotY + 3);
    if (player.offhand) {
      this.rect(hotX - 27, hotY + 1, 22, 21, '#171717'); this.rect(hotX - 26, hotY + 2, 20, 19, '#6e6e6e');
      this.rect(hotX - 25, hotY + 3, 18, 17, '#353535'); this.item(player.offhand, hotX - 24, hotY + 4);
    }
    if (!player.creative) {
      const healthY = hotY - 17;
      for (let i = 0; i < 10; i++) {
        const hp = clamp((player.health - i * 2) / 2, 0, 1), food = clamp((player.hunger - i * 2) / 2, 0, 1);
        const shake = player.health <= 4 && Math.floor(game.elapsed * 5 + i) % 5 === 0 ? 1 : 0;
        this.sprite(HEART, hotX + i * 8, healthY + shake, player.hurtTime > .35 ? '#ffffff' : '#db2020', hp);
        this.sprite(FOOD, hotX + 173 - i * 8, healthY + (player.hunger <= 4 && Math.floor(game.elapsed * 4 + i) % 6 === 0 ? 1 : 0), '#ac6940', food, '#3b2c25');
        if (player.defense) this.sprite(ARMOR, hotX + i * 8, healthY - 10, '#d6d6d6', clamp((player.defense - i * 2) / 2, 0, 1), '#434343');
        if (player.underwater || player.air < 300) {
          const amount = player.air / 30 > i;
          if (amount) this.sprite(AIR, hotX + 173 - i * 8, healthY - 10, '#84bded', 1, '#639ccd');
        }
      }
      this.rect(hotX, hotY - 7, 182, 5, '#171e12'); this.rect(hotX + 1, hotY - 6, 180, 3, '#25371b');
      const cost = player.level < 16 ? 7 + player.level * 2 : player.level < 31 ? 37 + (player.level - 15) * 5 : 112 + (player.level - 30) * 9;
      this.rect(hotX + 1, hotY - 6, Math.floor(player.xp / cost * 180), 3, '#77ad26');
      this.rect(hotX + 1, hotY - 6, Math.floor(player.xp / cost * 180), 1, '#a4d844');
      if (player.level) this.text(String(player.level), center, hotY - 17, '#7fe34b', 'center', 9);
    }
    const stack = player.inventory.slots[player.selected], name = items[stack?.id]?.name || '';
    if (this.previousSelected !== player.selected || name !== this.lastName) { this.itemNameTime = 2.5; this.previousSelected = player.selected; this.lastName = name; }
    if (this.itemNameTime > 0 && name) {
      this.itemNameTime -= dt; c.globalAlpha = Math.min(1, this.itemNameTime * 2); this.text(name, center, hotY - (player.creative ? 17 : 30), '#fff', 'center'); c.globalAlpha = 1;
    }
    if (player.burnTime > 0) {
      c.globalAlpha = .7;
      const fire = game.atlas.tileCanvases.get('fire'), size = Math.max(50, Math.floor(height * .38));
      if (fire) for (let x = -size / 2; x < width; x += size) c.drawImage(fire, x, height - size, size, size);
      c.globalAlpha = 1;
    }
    if (game.portalTime > 0) this.rect(0, 0, width, height, `rgba(101,30,168,${Math.min(.65, game.portalTime / 6)})`);
    for (const m of this.messages) m.time -= dt; this.messages = this.messages.filter(m => m.time > 0);
    this.messages.forEach((m, i) => {
      c.globalAlpha = Math.min(1, m.time); this.rect(2, height - 63 - (this.messages.length - 1 - i) * 11, Math.min(width - 5, m.text.length * 7 + 6), 10, 'rgba(0,0,0,.35)');
      this.text(m.text, 4, height - 62 - (this.messages.length - 1 - i) * 11); c.globalAlpha = 1;
    });
    if (game.saving) this.text('正在保存世界…', width - 5, height - 12, '#e1e1e1', 'right');
    if (this.tipTime > 0 && !game.debug) {
      this.tipTime -= dt; c.globalAlpha = Math.min(1, this.tipTime); this.text('WASD 移动  ·  空格 跳跃  ·  E 背包', 5, 5, '#fff');
      this.text('长按左键采集  ·  右键放置 / 使用', 5, 17, '#fff'); c.globalAlpha = 1;
    }
    if (game.debug) {
      const p = player.pos, cx = Math.floor(p.x / 16), cz = Math.floor(p.z / 16), chunk = world.chunks.get(chunkKey(cx, cz));
      const biome = chunk?.biomes[(Math.floor(p.x) & 15) + (Math.floor(p.z) & 15) * 16];
      const light = world.getLight(Math.floor(p.x), Math.floor(p.y + player.eyeHeight), Math.floor(p.z));
      const info = game.graphics.renderer.info;
      const lines = [
        'Minecraft Web Recreation 1.0 · independent implementation',
        `${Math.round(game.fps)} fps | ${info.render.calls} draw calls | ${Math.round(info.render.triangles / 1000)}k triangles`,
        `C: ${game.graphics.chunkMeshes.size}/${world.chunks.size} | E: ${game.entities?.mobs.length || 0} | D: ${game.entities?.drops.length || 0}`,
        '', `XYZ: ${p.x.toFixed(3)} / ${p.y.toFixed(3)} / ${p.z.toFixed(3)}`,
        `Block: ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}`,
        `Chunk: ${cx} ${cz} | ${world.dimension}`,
        `Facing: ${['South', 'West', 'North', 'East'][((Math.round(player.yaw / (Math.PI / 2)) + 2) % 4 + 4) % 4]} (${(player.yaw * 180 / Math.PI % 360).toFixed(1)} / ${(player.pitch * 180 / Math.PI).toFixed(1)})`,
        `Biome: ${BIOMES[biome] || '未知'} | Light: ${light[0]} sky, ${light[1]} block`,
        `Day ${Math.floor(world.totalTicks / 24000)} | time ${Math.floor(world.time)} | speed ${player.walkSpeed.toFixed(2)} m/s`,
        `Health: ${player.health.toFixed(1)} | Food: ${player.hunger} | Saturation: ${player.saturation.toFixed(1)}`,
        `GPU geometries: ${info.memory.geometries} | textures: ${info.memory.textures}`
      ];
      if (game.target) lines.push('', `Target: ${items[game.target.id]?.name} [${game.target.x}, ${game.target.y}, ${game.target.z}]`);
      lines.forEach((line, i) => { if (!line) return; this.rect(1, 1 + i * 10, Math.min(width - 2, line.length * 4.9 + 4), 10, 'rgba(70,70,70,.55)'); this.text(line, 2, 2 + i * 10, '#eeeeee', 'left', 8); });
    }
  }
}
