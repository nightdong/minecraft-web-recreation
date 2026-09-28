import { B, I } from '../core/blocks.js';
import { hash, clamp } from '../core/noise.js';
import { saveSettings, validateSave, qualityPresets } from '../game/storage.js';
import { HUD } from './hud.js';
import { InventoryScreen } from './inventory.js';

export const escapeHTML = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const ADVANCEMENTS = {
  redstone: ['红石工程', '操作拉杆、按钮或中继器来控制电路', I.REDSTONE],
  wood: ['获取木材', '破坏原木并拾取木材', B.OAK_LOG], table: ['工作时间到！', '合成你的第一张工作台', B.CRAFTING],
  pickaxe: ['采矿时间到！', '合成一把木镐', I.WOOD_PICKAXE], stone: ['石器时代', '采集圆石', B.COBBLE],
  furnace: ['热腾腾的', '合成一个熔炉', B.FURNACE], smelt: ['来硬的', '从熔炉中取出产物', I.IRON],
  diamond: ['钻石！', '采集钻石', I.DIAMOND], hunt: ['自给自足', '狩猎并获得食物', I.STEAK],
  monster: ['怪物猎人', '击败一只敌对生物', I.IRON_SWORD], farmer: ['开垦新土', '种下小麦种子', I.SEEDS],
  breed: ['成双成对', '繁殖两只动物', I.WHEAT], sleep: ['甜蜜的梦', '在夜晚睡上一觉', B.BED],
  nether: ['我们需要再深入些', '建造并穿越下界传送门', B.OBSIDIAN],
  blaze: ['与火共舞', '获得一根烈焰棒', I.BLAZE_ROD], pearl: ['末影之物', '获得一颗末影珍珠', I.ENDER_PEARL],
  eye: ['隔墙有眼', '为传送门装入最后一颗末影之眼', I.EYE_OF_ENDER],
  the_end: ['末地？', '进入末地', B.END_STONE], free_end: ['解放末地', '击败末影龙', B.DRAGON_EGG]
};
const CONTROL_ROWS = [
  ['前进 / 后退 / 左右移动', 'W / S / A / D'], ['观察四周', '鼠标'], ['跳跃 / 游泳上浮', '空格'], ['疾跑', 'Ctrl + W / 双击 W'],
  ['潜行 / 飞行下降', 'Shift'], ['破坏方块 / 攻击', '长按鼠标左键'], ['放置 / 使用 / 互动', '鼠标右键'], ['选取方块', '鼠标中键'],
  ['打开 / 关闭背包', 'E'], ['选择快捷栏', '1–9 / 滚轮'], ['丢弃一个 / 整组物品', 'Q / Ctrl + Q'], ['交换副手', 'F'],
  ['暂停 / 释放鼠标', 'Esc'], ['查看进度', 'L'], ['显示调试信息', 'F3'], ['隐藏界面', 'F1'], ['截图', 'F2'], ['切换视角', 'F5'],
  ['创造模式：切换飞行', '快速双击空格'], ['快速移动物品', 'Shift + 点击'], ['拆分 / 放置一个物品', '右键 / 右键拖动'], ['快捷栏交换物品', '悬停物品 + 1–9']
];

export class GameUI {
  constructor(game, root) {
    this.game = game; this.root = root; this.toasts = []; this.selectedWorld = null;
    this.createMode = 'survival'; this.createDifficulty = 'normal'; this.backScreen = 'title';
    root.innerHTML = '<div class="vignette"></div><div class="hurt-overlay"></div><div class="menus"></div><div class="toast-stack"></div>';
    this.menu = root.querySelector('.menus'); this.toastRoot = root.querySelector('.toast-stack'); this.hurtOverlay = root.querySelector('.hurt-overlay');
    this.hud = new HUD(game, root); this.inventory = new InventoryScreen(this);
    this.resize(); window.addEventListener('resize', () => this.resize());
    const dirt = game.atlas.tileCanvases.get('dirt'); document.documentElement.style.setProperty('--dirt', `url(${dirt.toDataURL()})`);
    const noise = document.createElement('canvas'); noise.width = noise.height = 16; const ctx = noise.getContext('2d');
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const a = .035 + hash(x, y, 8) * .07; ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(x, y, 1, 1); }
    document.documentElement.style.setProperty('--button-noise', `url(${noise.toDataURL()})`);
    this.menu.addEventListener('click', event => {
      const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
      game.audio.unlock(); game.audio.play('click'); this.action(button.dataset.action, button, event).catch(error => this.error(error));
    });
    this.menu.addEventListener('input', event => this.settingInput(event));
    this.menu.addEventListener('dblclick', event => { const world = event.target.closest('[data-world]'); if (world) game.loadWorld(world.dataset.world).catch(error => this.error(error)); });
  }
  resize() {
    const max = Math.max(1, Math.min(Math.floor(innerWidth / 320), Math.floor(innerHeight / 240)));
    this.scale = clamp(this.game.settings.guiScale || 3, 1, max); document.documentElement.style.setProperty('--s', this.scale);
  }
  button(label, action, cls = 'wide', disabled = false) { return `<button class="mc-button ${cls}" data-action="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`; }
  show(screen, context) {
    if (this.inventory.opened && !['inventory', 'craft', 'chest', 'furnace'].includes(screen)) this.inventory.close();
    this.game.screen = screen; this.game.input.keys.clear(); this.game.input.left = false; this.game.input.right = false; this.game.input.usePressed = false; this.game.input.jumpPressed = false; this.game.input.attackPressed = false;
    if (screen !== 'playing' && document.pointerLockElement && !(screen === 'loading' && this.game.keepPointerLock)) document.exitPointerLock();
    if (['inventory', 'craft', 'chest', 'furnace'].includes(screen)) { this.inventory.open(screen, context); return; }
    if (screen === 'playing') { this.menu.innerHTML = ''; return; }
    if (screen === 'title') this.title();
    else if (screen === 'worlds') this.worlds().catch(error => this.error(error));
    else if (screen === 'create') this.create();
    else if (screen === 'pause') this.pause();
    else if (screen === 'options') this.options();
    else if (screen === 'controls') this.controls();
    else if (screen === 'death') this.death(context);
    else if (screen === 'loading') this.loading(context || '正在生成世界');
    else if (screen === 'ready') this.ready();
    else if (screen === 'advancements') this.advancements();
    else if (screen === 'credits') this.credits();
  }
  title() {
    this.menu.innerHTML = `<div class="menu-screen title-screen"><div class="title-content"><div class="logo-wrap"><canvas class="game-logo" width="300" height="63" aria-label="Minecraft"></canvas><div class="edition">WEB RECREATION</div><div class="splash">世界由你创造！</div></div>
      <div class="title-buttons">${this.button('单人游戏', 'worlds')}${this.button('创建新的世界', 'create')}<div class="spacer"></div><div class="row menu-width">${this.button('选项…', 'options', '')}${this.button('操作说明…', 'controls', '')}</div><div class="title-hint">采集 · 建造 · 探索 · 生存</div></div></div>
      <div class="title-footer"><span>Web Recreation 1.0</span><span>独立实现 · 非 Mojang / Microsoft 官方产品</span></div></div>`;
    this.drawLogo(this.menu.querySelector('.game-logo'));
  }
  drawLogo(canvas) {
    const glyphs = { M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'], I: ['111', '010', '010', '010', '010', '010', '111'],
      N: ['10001', '11001', '11001', '10101', '10011', '10011', '10001'], E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
      C: ['01111', '11000', '10000', '10000', '10000', '11000', '01111'], R: ['11110', '10011', '10001', '11110', '10100', '10010', '10001'],
      A: ['01110', '11011', '10001', '10001', '11111', '10001', '10001'], F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'], T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'] };
    const pixels = []; let cursor = 0;
    for (const letter of 'MINECRAFT') { glyphs[letter].forEach((row, y) => [...row].forEach((v, x) => { if (v === '1') pixels.push([cursor + x, y]); })); cursor += glyphs[letter][0].length + 1; }
    const c = canvas.getContext('2d'), unit = 5, left = (300 - (cursor - 1) * unit) / 2;
    c.imageSmoothingEnabled = false;
    for (let depth = 8; depth >= 0; depth--) {
      c.fillStyle = depth > 2 ? '#181818' : '#050505';
      for (const [x, y] of pixels) c.fillRect(left + x * unit - 1 + depth * .4, y * 6 + 3 + depth - 1, unit + 2, 8);
    }
    for (const [x, y] of pixels) {
      const light = 191 - y * 9 + hash(x, y, 71) * 17;
      c.fillStyle = `rgb(${light},${light},${light})`; c.fillRect(left + x * unit, y * 6 + 3, unit, 6);
      if (!pixels.some(([xx, yy]) => xx === x && yy === y - 1)) { c.fillStyle = '#e6e6e6'; c.fillRect(left + x * unit, y * 6 + 3, unit, 1); }
      if (hash(x, y, 55) > .87) { c.fillStyle = '#696969'; c.fillRect(left + x * unit + 2, y * 6 + 4, 1, 3); c.fillRect(left + x * unit + 3, y * 6 + 6, 1, 2); }
    }
  }
  async worlds() {
    const list = await this.game.store.list(); if (this.game.screen !== 'worlds') return;
    this.worldList = list; if (!list.some(w => w.id === this.selectedWorld)) this.selectedWorld = list[0]?.id || null;
    this.menu.innerHTML = `<div class="menu-screen dirt-screen"><div class="menu-body"><h1 class="menu-title">选择世界</h1><div class="world-list">${list.length ? list.map(world => `<button class="world-entry ${world.id === this.selectedWorld ? 'selected' : ''}" data-action="select-world" data-world="${escapeHTML(world.id)}">${world.thumbnail ? `<img src="${escapeHTML(world.thumbnail)}" alt="世界预览">` : '<div class="world-thumb"></div>'}<div class="world-info"><div class="world-name">${escapeHTML(world.name)}</div><div class="world-meta">${new Date(world.updated).toLocaleString('zh-CN')}<br>${world.mode === 'creative' ? '创造模式' : '生存模式'} · 种子 ${escapeHTML(world.seed)}</div></div></button>`).join('') : '<div class="empty-worlds">还没有世界。<br>创建世界，开始你的旅程。</div>'}</div>
      <div class="row">${this.button('进入选中的世界', 'play-selected', '', !this.selectedWorld)}${this.button('创建新的世界', 'create', '')}</div>
      <div class="row">${this.button('导出', 'export-world', '', !this.selectedWorld)}${this.button('导入', 'import-world', '')}${this.button('删除', 'delete-world', '', !this.selectedWorld)}${this.button('取消', 'title', '')}</div><div class="menu-caption">世界保存在当前浏览器中。清除网站数据前，请先导出备份。</div></div></div>`;
  }
  create() {
    const name = this.menu.querySelector('#world-name')?.value || '新的世界', seed = this.menu.querySelector('#world-seed')?.value || '';
    this.menu.innerHTML = `<div class="menu-screen dirt-screen"><div class="menu-body"><h1 class="menu-title">创建新的世界</h1>
      <div class="form-field"><label for="world-name">世界名称</label><input class="mc-input" id="world-name" maxlength="64" value="${escapeHTML(name)}" autocomplete="off"></div>
      ${this.button(`游戏模式：${this.createMode === 'creative' ? '创造' : '生存'}`, 'create-mode')}
      <div class="menu-caption">${this.createMode === 'creative' ? '无限资源、自由飞行、即时破坏方块。' : '采集资源、制作工具，在危险的夜晚活下来。'}</div>
      <div class="row menu-width">${this.button(`难度：${this.difficultyName(this.createDifficulty)}`, 'create-difficulty', '')}${this.button(`开始：${['白天','黄昏','午夜'][this.createTimeIndex || 0]}`, 'create-time', '')}</div><div class="spacer"></div>
      <div class="form-field"><label for="world-seed">世界生成器的种子</label><input class="mc-input" id="world-seed" maxlength="128" value="${escapeHTML(seed)}" placeholder="留空以使用随机种子" autocomplete="off"></div>
      <div class="menu-caption">地形：默认 · 生物群系与地下洞穴<br>独立生成器；同一文本种子可重现同一地形。</div><div class="spacer"></div>
      <div class="row menu-width">${this.button('创建新的世界', 'start-new', '')}${this.button('取消', 'worlds', '')}</div><div class="notice" id="create-notice"></div></div></div>`;
  }
  difficultyName(key) { return { peaceful: '和平', easy: '简单', normal: '普通', hard: '困难' }[key]; }
  pause() {
    this.menu.innerHTML = `<div class="menu-screen shade"><div class="menu-body"><h1 class="menu-title">游戏菜单</h1>${this.button('回到游戏', 'resume')}<div class="spacer"></div>
      <div class="row menu-width">${this.button('进度', 'advancements', '')}${this.button('操作说明…', 'controls', '')}</div>
      ${this.button('选项…', 'options')}${this.button('保存世界', 'save')}${this.button('保存并退回到标题画面', 'save-exit')}<div class="menu-caption">${escapeHTML(this.game.worldName)} · ${this.game.player.creative ? '创造' : '生存'} · ${this.difficultyName(this.game.difficulty)}</div></div></div>`;
  }
  options() {
    const s = this.game.settings;
    const sliders = [['fov', '视野', 30, 110, 1], ['renderDistance', '渲染距离', 3, 12, 1], ['sensitivity', '鼠标灵敏度', .05, 1.5, .05], ['volume', '主音量', 0, 1, .05], ['brightness', '亮度', 0, 1, .05], ['guiScale', '界面缩放', 1, 4, 1]];
    const toggles = [['bobbing', '视角摇晃'], ['smoothLighting', '平滑光照'], ['clouds', '云'], ['weather', '天气粒子'], ['music', '原创环境音乐'], ['invertMouse', '反转鼠标']];
    this.menu.innerHTML = `<div class="menu-screen ${this.game.activeWorld ? 'shade' : 'dirt-screen'}"><div class="menu-body"><h1 class="menu-title">选项</h1>
      <div class="options-grid">${sliders.map(([key, label, min, max, step]) => `<label class="slider-button"><span data-slider-label="${key}">${label}：${this.settingLabel(key, s[key])}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${s[key]}" data-setting="${key}" aria-label="${label}"></label>`).join('')}
      ${toggles.map(([key, label]) => this.button(`${label}：${s[key] ? '开' : '关'}`, `toggle-${key}`, '')).join('')}
      ${this.button(`画质：${({fast:'流畅',balanced:'均衡',high:'精细'})[s.quality] || '均衡'}`, 'quality-preset', '')}${this.button('切换全屏', 'fullscreen', '')}</div>
      ${this.button('完成', 'back')}<div class="menu-caption">渲染距离越大，内存与显卡开销越高。<br>所有纹理和声音在本地生成；音乐默认关闭。</div></div></div>`;
  }
  settingLabel(key, value) { return ['volume', 'sensitivity', 'brightness'].includes(key) ? `${Math.round(value * 100)}%` : key === 'renderDistance' ? `${value} 区块` : String(value); }
  settingInput(event) {
    const key = event.target.dataset.setting; if (!key) return;
    const value = Number(event.target.value); if (!Number.isFinite(value)) return;
    this.game.settings[key] = value;
    const label = this.menu.querySelector(`[data-slider-label="${key}"]`); if (label) label.textContent = `${event.target.getAttribute('aria-label')}：${this.settingLabel(key, value)}`;
    if (key === 'guiScale') this.resize(); if (key === 'renderDistance') this.game.graphics.center = '';
    if (key === 'volume' && this.game.audio.master) this.game.audio.master.gain.value = value;
    saveSettings(this.game.settings);
  }
  controls() {
    this.menu.innerHTML = `<div class="menu-screen ${this.game.activeWorld ? 'shade' : 'dirt-screen'}"><div class="menu-body"><h1 class="menu-title">操作说明</h1><div class="controls-list">${CONTROL_ROWS.map(([action, key]) => `<div class="control-row"><span>${action}</span><span class="control-key">${key}</span></div>`).join('')}</div>
      <div class="menu-caption">生存开局：砍树 → 木板 → 工作台 → 木镐 → 圆石 → 熔炉。<br>对工作台、熔炉、箱子或床按右键可互动；潜行时右键优先放置。</div>${this.button('完成', 'back')}</div></div>`;
  }
  death(cause) {
    this.lastCause = cause || this.lastCause || 'unknown';
    const messages = { fall: '从高处摔了下来', drown: '溺水了', lava: '试图在熔岩里游泳', fire: '被烧死了', starve: '饿死了', suffocate: '在墙里窒息了', void: '掉出了世界', zombie: '被僵尸击败了', skeleton: '被骷髅击败了', arrow: '被箭射中了', spider: '被蜘蛛击败了', explosion: '被炸飞了', cactus: '被仙人掌刺死了' };
    this.menu.innerHTML = `<div class="menu-screen death-screen"><div class="menu-body"><h1 class="death-title">你死了！</h1><div>${messages[this.lastCause] || '冒险暂时结束了'}</div><div class="death-score">分数：<span>${this.game.player.score}</span></div>${this.button('重生', 'respawn')}${this.button('标题画面', 'save-exit')}</div></div>`;
  }
  loading(label = '正在生成世界') {
    this.menu.innerHTML = `<div class="menu-screen dirt-screen"><div class="menu-body"><div class="loading-label">${escapeHTML(label)}<br><span id="loading-percent">0%</span></div><div class="loading-box"><div class="chunk-map"></div></div><div class="progress-track"><i></i></div><div class="menu-caption" id="loading-detail">准备地形与光照…</div></div></div>`;
  }
  progress(value, detail) {
    const label = this.menu.querySelector('#loading-percent'); if (label) label.textContent = `${Math.floor(value * 100)}%`;
    const fill = this.menu.querySelector('.progress-track i'); if (fill) fill.style.width = `${value * 100}%`;
    const map = this.menu.querySelector('.chunk-map'); if (map) map.style.transform = `scale(${.02 + Math.sqrt(value) * .98})`;
    if (detail) { const e = this.menu.querySelector('#loading-detail'); if (e) e.textContent = detail; }
  }
  ready() {
    this.menu.innerHTML = `<div class="menu-screen lock-screen"><div class="menu-body"><h2>${this.game.pointerError ? '鼠标控制' : '世界已准备就绪'}</h2><p>${this.game.pointerError ? '浏览器尚未允许锁定鼠标。再次点击进入，或使用兼容模式。' : '点击进入游戏，锁定鼠标。<br>按 Esc 暂停并释放鼠标。'}</p>${this.button('进入游戏', 'resume')}${this.game.pointerError ? this.button('兼容模式', 'compatible') : ''}<div class="menu-caption">WASD 移动 · 空格跳跃 · E 背包</div></div></div>`;
  }
  advancements() {
    this.menu.innerHTML = `<div class="menu-screen shade"><div class="menu-body"><h1 class="menu-title">进度</h1><div class="achievement-list">${Object.entries(ADVANCEMENTS).map(([id, [title, description, icon]]) => `<div class="achievement ${this.game.earned.has(id) ? 'earned' : ''}"><img src="${this.game.atlas.iconURL(icon)}" alt=""><span>${title}</span><small>${description}</small></div>`).join('')}</div><div class="spacer"></div>${this.button('完成', 'back')}</div></div>`;
  }
  credits() {
    this.menu.innerHTML = `<div class="menu-screen dirt-screen credits-screen"><div class="menu-body"><h1 class="menu-title">解放末地</h1><div class="menu-caption credits-prose">从第一块木头，到世界尽头。<br>水晶熄灭了，巨龙落下了。<br>而你创造的世界，还在等待新的故事。</div><div class="menu-caption">末影龙已被击败 · 世界与物品已保留<br>分数：${this.game.player.score}</div>${this.button('继续你的世界', 'resume')}${this.button('保存并回到标题画面', 'save-exit')}<div class="menu-caption credits-footer">独立实现与原创结尾文字<br>非 Mojang / Microsoft 官方产品</div></div></div>`;
  }
  confirm(title, message, action) {
    this.pendingAction = action; this.game.screen = 'confirm';
    this.menu.innerHTML = `<div class="menu-screen dirt-screen"><div class="menu-body"><h1 class="menu-title">${escapeHTML(title)}</h1><div class="menu-caption">${escapeHTML(message)}</div><div class="spacer"></div><div class="row menu-width">${this.button('确认', 'confirm', '')}${this.button('取消', 'worlds', '')}</div></div></div>`;
  }
  async action(action, button, event) {
    const game = this.game;
    if (['title', 'worlds', 'create'].includes(action)) { this.show(action); return; }
    if (action === 'options' || action === 'controls' || action === 'advancements') {
      if (!['options', 'controls', 'advancements'].includes(game.screen)) this.backScreen = game.activeWorld ? 'pause' : 'title';
      this.show(action); return;
    }
    if (action === 'back') { this.show(this.backScreen || (game.activeWorld ? 'pause' : 'title')); return; }
    if (action === 'resume') { game.resume(); return; }
    if (action === 'compatible') { game.input.compatible = true; game.resume(); return; }
    if (action === 'save') { button.disabled = true; await game.save(); button.disabled = false; this.toast('世界已保存', '也可以在世界选择界面导出备份。', B.CHEST); return; }
    if (action === 'save-exit') { button.disabled = true; await game.saveAndExit(); return; }
    if (action === 'respawn') { await game.respawn(); return; }
    if (action === 'select-world') {
      this.selectedWorld = button.dataset.world;
      for (const entry of this.menu.querySelectorAll('.world-entry')) entry.classList.toggle('selected', entry.dataset.world === this.selectedWorld);
      return;
    }
    if (action === 'play-selected' && this.selectedWorld) { await game.loadWorld(this.selectedWorld); return; }
    if (action === 'create-mode') { this.createMode = this.createMode === 'survival' ? 'creative' : 'survival'; this.create(); return; }
    if (action === 'create-difficulty') { const values = ['peaceful', 'easy', 'normal', 'hard']; this.createDifficulty = values[(values.indexOf(this.createDifficulty) + 1) % 4]; this.create(); return; }
    if (action === 'create-time') { this.createTimeIndex = ((this.createTimeIndex || 0) + 1) % 3; this.create(); return; }
    if (action === 'start-new') {
      const name = this.menu.querySelector('#world-name').value.trim() || '新的世界', text = this.menu.querySelector('#world-seed').value.trim();
      const seed = text || String(crypto.getRandomValues(new Uint32Array(1))[0]); button.disabled = true;
      await game.newWorld({ name, seed, mode: this.createMode, difficulty: this.createDifficulty, startTime: [1000,12000,18000][this.createTimeIndex || 0] }); return;
    }
    if (action.startsWith('toggle-')) {
      const key = action.slice(7); if (!(key in game.settings)) return;
      game.settings[key] = !game.settings[key]; saveSettings(game.settings);
      if (key === 'smoothLighting') for (const chunk of game.world.chunks.values()) game.world.dirty.add(chunk.key);
      this.options(); return;
    }
    if(action==='quality-preset'){
      const names=Object.keys(qualityPresets),name=names[(names.indexOf(game.settings.quality)+1)%names.length];
      const lighting=game.settings.smoothLighting;Object.assign(game.settings,qualityPresets[name]);
      if(lighting!==game.settings.smoothLighting)for(const key of game.world.chunks.keys())game.world.dirty.add(key);
      saveSettings(game.settings);game.graphics.center='';game.graphics.resize();this.options();return;
    }
    if (action === 'fullscreen') {
      try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
      catch { this.toast('全屏未获许可', '可以使用浏览器的 F11 全屏。', B.GLASS); } return;
    }
    if (action === 'export-world' && this.selectedWorld) {
      const data = await game.store.load(this.selectedWorld); this.download(JSON.stringify(data), `${data.name.replace(/[<>:"/\\|?*]/g, '_')}.voxel.json`, 'application/json'); return;
    }
    if (action === 'import-world') {
      const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,.voxel';
      input.onchange = async () => {
        try {
          const file = input.files[0]; if (!file) return; if (file.size > 100 * 1024 * 1024) throw new Error('存档文件超过 100 MB。');
          const data = validateSave(JSON.parse(await file.text())); data.id = crypto.randomUUID(); data.name += '（导入）';
          await game.store.save(data); this.show('worlds');
        } catch (error) { this.error(error); }
      };
      input.click(); return;
    }
    if (action === 'delete-world' && this.selectedWorld) {
      const world = this.worldList.find(w => w.id === this.selectedWorld), id = world.id;
      this.confirm('确定要删除这个世界吗？', `“${world.name}”将被永久删除。此操作无法撤销。`, async () => { await game.store.delete(id); this.show('worlds'); }); return;
    }
    if (action === 'confirm' && this.pendingAction) { const perform = this.pendingAction; this.pendingAction = null; await perform(); return; }
    if (action === 'reload') location.reload();
  }
  download(content, name, type) {
    const url = URL.createObjectURL(new Blob([content], { type })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  toast(title, text = '', icon = B.CRAFTING) {
    this.toasts.push({ title, text, icon, age: 0 }); if (this.toasts.length > 3) this.toasts.shift(); this.updateToasts();
  }
  updateToasts() {
    this.toastRoot.innerHTML = this.toasts.map(t => `<div class="toast"><img src="${this.game.atlas.iconURL(t.icon)}" alt=""><div><div class="toast-title">${escapeHTML(t.title)}</div><div class="toast-text">${escapeHTML(t.text)}</div></div></div>`).join('');
  }
  error(error) {
    console.error(error); this.game.screen = 'error'; this.game.input.keys.clear(); if (document.pointerLockElement) document.exitPointerLock();
    this.menu.innerHTML = `<div class="menu-screen dirt-screen"><div class="menu-body"><h1 class="menu-title">发生了错误</h1><div class="menu-caption">世界的最近一次成功存档不会被覆盖。</div><pre class="error-detail">${escapeHTML(error?.stack || error?.message || error)}</pre>${this.button('返回标题画面', 'title')}${this.button('重新加载', 'reload')}</div></div>`;
  }
  tick(dt) {
    this.hud.draw(dt); this.inventory.tick();
    this.hurtOverlay.style.opacity = this.game.screen === 'playing' ? Math.min(.5, this.game.player?.hurtTime || 0) : 0;
    for (const toast of this.toasts) toast.age += dt;
    if (this.toasts.some(t => t.age > 5)) { this.toasts = this.toasts.filter(t => t.age <= 5); this.updateToasts(); }
  }
}
