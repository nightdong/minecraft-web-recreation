import * as THREE from 'three';
import { B, I, blocks, items, isSolid, PISTON_DIRECTIONS } from '../core/blocks.js';
import { World, HEIGHT, SEA, blockKey, chunkKey, DIRECTIONS } from '../core/world.js';
import { Player, bodyBox, collisionShapes, intersects, collides } from '../core/physics.js';
import { canBurnAt, supported } from '../core/environment.js';
import { Inventory, makeStack } from '../core/inventory.js';
import { clamp, hash, seedNumber } from '../core/noise.js';
import { TextureAtlas } from '../render/textures.js';
import { VoxelRenderer } from '../render/renderer.js';
import { GameAudio } from './audio.js';
import { SaveStore, loadSettings, validateSave } from './storage.js';
import { EntitySystem } from './entities.js';
import { GameUI, ADVANCEMENTS } from '../ui/ui.js';
import { portalContact } from '../core/portal-contact.js';
import { activateEndPortal, nearestStronghold, END_SPAWN } from '../core/adventure.js';
import { FrameMetrics } from './frame-metrics.js';

const INVENTORY_SCREENS = ['inventory', 'craft', 'chest', 'furnace'];
const FACING = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const LOGS = [B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG];
const PLANKS = [B.PLANKS, B.BIRCH_PLANKS, B.SPRUCE_PLANKS];
const DIST = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

export class Game {
  constructor(canvas, root) {
    this.settings = loadSettings(); this.atlas = new TextureAtlas(); this.graphics = new VoxelRenderer(canvas, this.atlas, this.settings);
    this.audio = new GameAudio(this.settings); this.store = new SaveStore(); this.input = { keys: new Set(), left: false, right: false, attackPressed: false, sprintLatch: false, compatible: false };
    this.canvas = canvas; this.screen = 'loading'; this.activeWorld = false; this.locked = false; this.hideHUD = false; this.debug = false;
    this.elapsed = 0; this.playTime = 0; this.fps = 60; this.frameCount = 0; this.accumulator = 0; this.interpolation = 1;
    this.swing = 0; this.attackCooldown = 0; this.maxAttackCooldown = .625; this.mining = 0; this.miningKey = ''; this.miningCooldown = 0; this.digSound = 0;
    this.placeCooldown = 0; this.eating = 0; this.bowCharge = 0; this.portalTime = 0; this.portalCooldown = 0; this.autoSaveTime = 0;
    this.earned = new Set(); this.stats = { broken: 0, placed: 0, crafted: 0, distance: 0, deaths: 0, kills: 0 };
    this.worldSnapshots = {}; this.entitySnapshots = {}; this.difficulty = 'normal'; this.saving = false;
    this.metrics = new FrameMetrics();
    this.ui = new GameUI(this, root); this.bindEvents(); this.lastFrame = performance.now();
    this.frame = this.frame.bind(this); requestAnimationFrame(this.frame);
  }
  get paused() { return !this.activeWorld || !['playing', ...INVENTORY_SCREENS, 'death'].includes(this.screen) || this.screen === 'playing' && !this.locked && !this.input.compatible; }
  async init() {
    this.ui.show('loading', '正在准备全景世界');
    await this.store.open(); this.world = new World('Over the hills');
    const spawn = this.world.spawn(); this.player = new Player(spawn, {}, 'creative');
    await this.graphics.warm(this.world, spawn, p => this.ui.progress(p));
    this.entities = new EntitySystem(this); this.entities.naturalSpawns();
    document.querySelector('#boot-status')?.remove(); this.ui.show('title');
  }
  bindEvents() {
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked && this.screen === 'playing' && !this.input.compatible) this.pause();
    });
    document.addEventListener('pointerlockerror', () => { if (this.screen === 'playing') { this.pointerError = true; this.ui.show('ready'); } });
    document.addEventListener('mousemove', event => {
      if (this.screen !== 'playing' || !(this.locked || this.input.compatible && event.buttons & 4)) return;
      const factor = Math.pow(this.settings.sensitivity * .6 + .2, 3) * 8 * .002617994;
      this.player.yaw -= event.movementX * factor;
      this.player.pitch = clamp(this.player.pitch - event.movementY * factor * (this.settings.invertMouse ? -1 : 1), -Math.PI / 2 + .001, Math.PI / 2 - .001);
    });
    this.canvas.addEventListener('mousedown', event => {
      if (this.screen !== 'playing') return;
      if (!this.locked && !this.input.compatible) { this.resume(); return; }
      event.preventDefault(); this.audio.unlock();
      if (event.button === 0) { this.input.left = true; this.input.attackPressed = true; }
      if (event.button === 2) {
        this.input.right = true; this.input.usePressed = true;
        this.input.useSneaking = event.shiftKey || this.input.keys.has('ShiftLeft') || this.input.keys.has('ShiftRight');
        this.placeCooldown = 0;
      }
      if (event.button === 1 && !this.input.compatible) this.pickBlock();
    });
    document.addEventListener('mouseup', event => {
      if (event.button === 0) this.input.left = false;
      if (event.button === 2) { this.releaseUse(); this.input.right = false; this.eating = 0; if (this.player) this.player.usingItem = false; }
    });
    document.addEventListener('wheel', event => {
      if (this.screen !== 'playing') return; event.preventDefault();
      this.player.selected = (this.player.selected + Math.sign(event.deltaY) + 9) % 9; this.cancelUse(); this.mining = 0;
    }, { passive: false });
    document.addEventListener('keydown', event => this.keyDown(event));
    document.addEventListener('keyup', event => this.input.keys.delete(event.code));
    window.addEventListener('blur', () => { if (this.screen === 'playing') this.pause(); this.input.keys.clear(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.activeWorld) { if (this.screen === 'playing') this.pause(); this.saveEmergency(); }
      this.lastFrame = performance.now(); this.accumulator = 0;
    });
    window.addEventListener('beforeunload', () => this.saveEmergency());
    window.addEventListener('pagehide', () => this.saveEmergency());
  }
  keyDown(event) {
    const code = event.code, typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    if (typing && code !== 'Escape') return;
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'F2', 'F3', 'F5'].includes(code) && this.activeWorld) event.preventDefault();
    if (code === 'Escape' && !event.repeat) {
      event.preventDefault();
      if (INVENTORY_SCREENS.includes(this.screen)) { this.ui.inventory.close(); this.resume(); }
      else if (this.screen === 'playing' || this.screen === 'ready') this.pause();
      else if (this.screen === 'pause') this.resume();
      else if (['options', 'controls', 'advancements'].includes(this.screen)) this.ui.show(this.ui.backScreen || 'title');
      else if (this.screen === 'worlds' || this.screen === 'create') this.ui.show('title');
      else if (this.screen === 'credits') this.ui.show('ready');
      return;
    }
    if (INVENTORY_SCREENS.includes(this.screen)) {
      if (code === 'KeyE' && !event.repeat) { this.ui.inventory.close(); this.resume(); }
      else this.ui.inventory.key(code); return;
    }
    if (this.screen !== 'playing') return;
    this.input.keys.add(code);
    if (event.repeat) return;
    if (code === 'Space') this.input.jumpPressed = true;
    if (code === 'KeyW') {
      const now = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
      if (this.lastW !== undefined && now - this.lastW >= 0 && now - this.lastW < 280) this.input.sprintLatch = true;
      this.lastW = now;
    }
    if (code === 'Space' && this.player.creative) {
      const now = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
      if (this.lastSpace !== undefined && now - this.lastSpace >= 0 && now - this.lastSpace < 300) { this.player.flying = !this.player.flying; this.player.vel.y = 0; this.lastSpace = undefined; }
      else this.lastSpace = now;
    }
    if (code === 'KeyE') { this.openInventory(); return; }
    if (code === 'KeyL') { this.ui.backScreen = 'pause'; this.ui.show('advancements'); return; }
    if (code === 'F1') this.hideHUD = !this.hideHUD;
    if (code === 'F2') this.screenshot();
    if (code === 'F3') this.debug = !this.debug;
    if (code === 'F5') this.player.perspective = (this.player.perspective + 1) % 3;
    if (/^Digit[1-9]$/.test(code)) { this.player.selected = Number(code.slice(5)) - 1; this.cancelUse(); this.mining = 0; }
    if (code === 'KeyQ') {
      const stack = this.player.inventory.slots[this.player.selected];
      if (stack) { const count = event.ctrlKey ? stack.count : 1; this.dropStack({ ...stack, count }); this.player.inventory.consume(this.player.selected, count); }
    }
    if (code === 'KeyF') {
      const slot = this.player.inventory.slots[this.player.selected]; this.player.inventory.slots[this.player.selected] = this.player.offhand; this.player.offhand = slot;
      this.player.inventory.revision++; this.cancelUse();
    }
  }
  resume() {
    if (!this.activeWorld || this.player.health <= 0) { if (this.player?.health <= 0) this.ui.show('death'); return; }
    this.ui.show('playing'); this.audio.unlock(); this.accumulator = 0; this.lastFrame = performance.now();
    if (this.input.compatible) {
      this.ui.hud.message('兼容控制：方向键转向；按住鼠标中键也可观察。'); return;
    }
    try {
      const request = this.canvas.requestPointerLock();
      if (request?.catch) request.catch(() => { if (!this.locked) { this.pointerError = true; this.ui.show('ready'); } });
    } catch { this.pointerError = true; this.ui.show('ready'); }
  }
  pause() {
    if (!this.activeWorld || this.screen === 'death') return;
    this.cancelUse(); this.mining = 0; this.ui.show('pause');
  }
  openInventory(type = 'inventory', context) { this.cancelUse(); this.mining = 0; this.ui.show(type, context); }
  cancelUse() { this.eating = 0; this.bowCharge = 0; this.input.right = false; this.input.usePressed = false; if (this.player) this.player.usingItem = false; }
  async newWorld({ name, seed, mode, difficulty, startTime = 1000 }) {
    this.ui.show('loading', '正在生成世界'); await nextFrame();
    this.entities?.dispose(); this.entities = null;
    this.worldName = name; this.worldId = crypto.randomUUID(); this.difficulty = difficulty; this.worldSnapshots = {}; this.entitySnapshots = {};
    this.world = new World(seed); this.world.time = [1000,12000,18000].includes(startTime) ? startTime : 1000;
    const spawn = this.world.spawn(); this.initialSpawn = { ...spawn };
    this.player = new Player(spawn, {}, mode); this.earned = new Set(); this.stats = { broken: 0, placed: 0, crafted: 0, distance: 0, deaths: 0, kills: 0 }; this.playTime = 0;
    if (mode === 'creative') [B.GRASS, B.STONE, B.PLANKS, B.OAK_LOG, B.GLASS, B.CRAFTING, B.TORCH, I.DIAMOND_PICKAXE, B.BRICKS].forEach((id, i) => { this.player.inventory.slots[i] = makeStack(id, items[id].stack); });
    this.activeWorld = true; this.resetInteraction();
    await this.graphics.warm(this.world, spawn, p => this.ui.progress(p, p < .45 ? '构建地形、矿脉与植被…' : '计算光照与可见方块…'));
    this.faceNearbyTree(); this.entities = new EntitySystem(this); this.entities.naturalSpawns();
    this.ui.hud.tipTime = 16; this.ui.show('ready'); await this.save();
  }
  faceNearbyTree() {
    const p = this.player.pos; let nearest = null;
    for (let z = -18; z <= 18; z++) for (let x = -18; x <= 18; x++) {
      const distance = x * x + z * z; if (distance < 9 || nearest && distance >= nearest.distance) continue;
      for (let y = Math.floor(p.y) - 3; y <= p.y + 4; y++) {
        if (LOGS.includes(this.world.get(Math.floor(p.x) + x, y, Math.floor(p.z) + z, false))) { nearest = { x, z, distance }; break; }
      }
    }
    if (nearest) { this.player.yaw = Math.atan2(-nearest.x, -nearest.z); this.player.pitch = -.06; }
  }
  async loadWorld(id) {
    this.ui.show('loading', '正在加载世界');
    let data = await this.store.load(id); if (!data) throw new Error('找不到这个世界的存档。');
    try { const emergency = JSON.parse(localStorage.getItem('voxel-emergency') || 'null'); if (emergency?.id === id && emergency.updated > data.updated) data = validateSave(emergency); } catch { /* ignore an incomplete emergency backup */ }
    validateSave(data); this.entities?.dispose(); this.entities = null;
    this.worldId = data.id; this.worldName = data.name; this.difficulty = data.difficulty || 'normal';
    this.lastThumbnail = data.thumbnail ? { id: data.id, value: data.thumbnail } : null;
    this.worldSnapshots = data.worlds; this.entitySnapshots = data.entities || {}; this.earned = new Set(data.earned || []); this.stats = data.stats || this.stats;
    this.playTime = data.playTime || 0; this.initialSpawn = data.initialSpawn || data.player.spawnPoint;
    const dimension = data.dimension || 'overworld'; this.world = new World(data.seed, { ...data.worlds[dimension], dimension });
    this.player = new Player(data.player.spawnPoint || this.world.spawn(), data.player, data.mode); this.activeWorld = true; this.resetInteraction();
    await this.graphics.warm(this.world, this.player.pos, p => this.ui.progress(p, '恢复区块、玩家与容器…'));
    this.entities = new EntitySystem(this, this.entitySnapshots[dimension]);
    this.ui.show(this.player.health <= 0 ? 'death' : 'ready');
  }
  resetInteraction() {
    this.cancelUse(); this.target = null; this.mining = 0; this.miningKey = ''; this.portalTime = 0; this.portalCooldown = 3;
    this.accumulator = 0; this.autoSaveTime = 0; this.input.left = false; this.input.attackPressed = false;
  }
  snapshot(thumbnail = false) {
    this.worldSnapshots[this.world.dimension] = this.world.toJSON();
    if (this.entities) this.entitySnapshots[this.world.dimension] = this.entities.toJSON();
    const data = { format: 1, id: this.worldId, name: this.worldName, seed: this.world.seed, mode: this.player.mode,
      difficulty: this.difficulty, dimension: this.world.dimension, player: this.player.toJSON(), worlds: this.worldSnapshots,
      entities: this.entitySnapshots, earned: [...this.earned], stats: this.stats, initialSpawn: this.initialSpawn, playTime: this.playTime, updated: Date.now() };
    if (thumbnail && !['playing','inventory','craft','chest','furnace'].includes(this.screen)) {
      // Capturing WebGL pixels synchronizes the GPU. Refresh this cosmetic
      // preview only while simulation is paused, not in the 30-second autosave.
      try { const c = document.createElement('canvas'); c.width = 128; c.height = 72; c.getContext('2d').drawImage(this.canvas, 0, 0, 128, 72); this.lastThumbnail = { id: this.worldId, value: c.toDataURL('image/jpeg', .65) }; } catch { /* optional preview */ }
    }
    if (this.lastThumbnail?.id === this.worldId) data.thumbnail = this.lastThumbnail.value;
    // IndexedDB opens asynchronously. Detach every nested object now so the
    // write represents one instant, even while the live world keeps ticking.
    return structuredClone(data);
  }
  async save() {
    if (!this.activeWorld || !this.worldId || this.screen === 'error' || this.screen === 'loading') return;
    if (this.savePromise) { await this.savePromise; return this.save(); }
    this.saving = true;
    // Cursor and crafting grids are transient; make a serialized inventory copy without mutating live UI state.
    const snapshotStart=performance.now(), data=this.snapshot(true);
    if(this.metrics){const m=this.metrics.saves;m.snapshotMs=performance.now()-snapshotStart;m.maxSnapshotMs=Math.max(m.maxSnapshotMs,m.snapshotMs);}
    if (this.ui.inventory.opened) {
      const inventory = new Inventory(36, data.player.inventory), extras = [...this.ui.inventory.grid, this.ui.inventory.cursor];
      for (const stack of extras) if (stack) {
        const left = inventory.add(stack);
        if (left) data.entities[this.world.dimension].drops.push({ stack: left, pos: { ...this.player.pos }, vel: { x: 0, y: .1, z: 0 }, delay: 10, age: 0 });
      }
      data.player.inventory = inventory.toJSON();
    }
    const transactionStart=performance.now();
    this.savePromise = this.store.save(data).then(() => {
      if(this.metrics){const m=this.metrics.saves;m.count++;m.transactionMs=performance.now()-transactionStart;m.maxTransactionMs=Math.max(m.maxTransactionMs,m.transactionMs);}
      try {
        const emergency = JSON.parse(localStorage.getItem('voxel-emergency') || 'null');
        if (emergency?.id === data.id && emergency.updated <= data.updated) localStorage.removeItem('voxel-emergency');
      } catch { /* no storage permission */ }
    });
    try { await this.savePromise; } finally { this.saving = false; this.savePromise = null; }
  }
  saveEmergency() {
    if (!this.activeWorld || !this.worldId || ['loading', 'error'].includes(this.screen)) return;
    try {
      const data = this.snapshot(false), inv = new Inventory(36, data.player.inventory);
      if (this.ui.inventory.opened) {
        for (const stack of [...this.ui.inventory.grid, this.ui.inventory.cursor]) if (stack) {
          const left = inv.add(stack); if (left) data.entities[this.world.dimension].drops.push({ stack: left, pos: { ...this.player.pos }, vel: { x: 0, y: 0, z: 0 }, age: 0, delay: 10 });
        }
        data.player.inventory = inv.toJSON();
      }
      const text = JSON.stringify(data); if (text.length < 3500000) localStorage.setItem('voxel-emergency', text);
    } catch { /* IndexedDB autosaves remain the primary save. */ }
  }
  async saveAndExit() {
    this.ui.inventory.close(); await this.save(); this.activeWorld = false; this.cancelUse(); this.ui.show('title'); this.player.perspective = 0;
  }
  screenshot() {
    // Capture actual world pixels and the currently visible in-game HUD.
    const capture = document.createElement('canvas'); capture.width = this.canvas.width; capture.height = this.canvas.height;
    const ctx = capture.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(this.canvas, 0, 0);
    if (!this.hideHUD && this.ui.hud.canvas.style.display !== 'none') ctx.drawImage(this.ui.hud.canvas, 0, 0, capture.width, capture.height);
    capture.toBlob(blob => {
      if (!blob) return; const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = `Minecraft-${new Date().toISOString().replace(/[:.]/g, '-')}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      this.ui.hud.message('截图已保存。');
    }, 'image/png');
  }
  updateTarget() {
    if (!this.player || !this.world || !this.activeWorld) return;
    const held = this.player.inventory.slots[this.player.selected]?.id;
    this.target = this.world.raycast(this.player.eye, this.player.direction, this.player.creative ? 5 : 4.5, held === I.BUCKET);
    const key = this.target ? `${this.target.x},${this.target.y},${this.target.z}:${this.target.id}` : '';
    if (key !== this.miningKey) { this.mining = 0; this.miningKey = key; }
  }
  startSwing() { if (!this.swing || this.swing > .65) this.swing = .001; }
  interactTick() {
    const p = this.player;
    this.updateTarget(); this.attackCooldown = Math.max(0, this.attackCooldown - .05); this.placeCooldown = Math.max(0, this.placeCooldown - .05); this.miningCooldown = Math.max(0, this.miningCooldown - .05);
    if (this.swing) { this.swing += .05 / .3; if (this.swing >= 1) this.swing = 0; }
    if (this.screen !== 'playing' || p.health <= 0) { this.mining = 0; return; }
    if (this.input.left || this.input.attackPressed) {
      const entity = this.entities.hitTest(p.eye, p.direction, p.creative ? 5 : 3);
      if (entity && (!this.target || entity.distance < this.target.distance)) {
        this.mining = 0;
        if (this.input.attackPressed || !this.attackCooldown) {
          const item = items[p.inventory.slots[p.selected]?.id], progress = 1 - this.attackCooldown / this.maxAttackCooldown;
          const damage = (item?.damage || 1) * (.2 + .8 * progress * progress) * (!p.onGround && p.vel.y < 0 && !p.inWater && !p.flying ? 1.5 : 1);
          if (this.entities.hit(entity.mob, damage, p.direction)) {
            p.exhaust(.1); if (!p.creative && item?.durability) p.inventory.damage(p.selected, item.tool === 'sword' ? 1 : 2);
            if (entity.mob.health <= 0) this.stats.kills++;
          }
          this.maxAttackCooldown = item?.tool === 'axe' ? 1 : item?.tool === 'sword' ? .625 : .35;
          this.attackCooldown = this.maxAttackCooldown; this.startSwing(); this.audio.play('swing');
        }
      } else if (this.target && !blocks[this.target.id]?.liquid) {
        this.startSwing();
        if (!this.miningCooldown) {
          const definition = blocks[this.target.id], item = items[p.inventory.slots[p.selected]?.id];
          let speed = definition.tool && definition.tool === item?.tool && Number.isFinite(item?.speed) ? item.speed : 1;
          if (definition.leaves && item?.tool === 'shears') speed = 15;
          if (this.target.id === B.WOOL && item?.tool === 'shears') speed = 5;
          const harvest = !definition.tier || item?.tool === definition.tool && item?.tier >= definition.tier;
          let seconds = definition.hardness * (harvest ? 1.5 : 5) / speed;
          if (p.underwater) seconds *= 5; if (!p.onGround && !p.flying) seconds *= 5;
          if (p.creative) seconds = 0;
          if (Number.isFinite(seconds)) {
            this.mining += seconds > 0 ? .05 / seconds : 1;
            if ((this.digSound -= .05) <= 0) { this.digSound = .25; this.audio.play('dig', definition.sound); this.graphics.burst(this.target.x, this.target.y, this.target.z, this.target.id, 2, .4); }
            if (this.mining >= 1) {
              this.breakBlock(this.target); this.mining = 0; this.miningCooldown = .25; this.updateTarget();
            }
          }
        }
      } else if (this.input.attackPressed) { this.startSwing(); this.audio.play('swing'); }
    } else { this.mining = 0; this.digSound = 0; }
    this.input.attackPressed = false;
    if (this.input.right || this.input.usePressed) this.useTick();
    else { this.eating = 0; p.usingItem = false; }
    this.input.usePressed = false;
  }
  harvestDrops(id, item, state) {
    const b = blocks[id], drops = [];
    if (b.tier && !(item?.tool === b.tool && item?.tier >= b.tier)) return drops;
    if (b.leaves) {
      if (item?.tool === 'shears') return [makeStack(id)];
      if (Math.random() < .05) drops.push(makeStack(B.SAPLING));
      if (id === B.OAK_LEAVES && Math.random() < .005) drops.push(makeStack(I.APPLE));
      if (Math.random() < .02) drops.push(makeStack(I.STICK)); return drops;
    }
    if (id === B.TALL_GRASS) return Math.random() < .125 ? [makeStack(I.SEEDS)] : [];
    if (id >= B.WHEAT0 && id <= B.WHEAT7) return id === B.WHEAT7 ? [makeStack(I.WHEAT), makeStack(I.SEEDS, 1 + Math.floor(Math.random() * 3))] : [makeStack(I.SEEDS)];
    if (id === B.CLAY) return [makeStack(I.CLAY_BALL, 4)];
    if (id === B.GRAVEL && Math.random() < .1) return [makeStack(I.FLINT)];
    if (b.noDrop) return [];
    const count = id === B.LAPIS_ORE ? 4 + Math.floor(Math.random() * 6) : id === B.REDSTONE_ORE ? 4 + Math.floor(Math.random() * 2) : b.shape === 'slab' && state & 8 ? 2 : 1;
    return [makeStack(b.drop ?? id, count)];
  }
  breakBlock(hit, explosion = false, allowDrops = true) {
    const { x, y, z } = hit, id = this.world.get(x, y, z, false), b = blocks[id];
    if (!id || id === B.BEDROCK && !this.player.creative || b.liquid) return false;
    const state = this.world.getState(x, y, z), item = explosion ? { tool: b.tool, tier: 10 } : items[this.player.inventory.slots[this.player.selected]?.id];
    if (id === B.PISTON_HEAD) {
      const d = PISTON_DIRECTIONS[state & 7], base = { x: x - d[0], y: y - d[1], z: z - d[2] };
      if (this.world.get(base.x, base.y, base.z, false) === B.PISTON) return this.breakBlock(base, explosion, allowDrops);
    }
    if (id === B.PISTON && state & 8) {
      const d = PISTON_DIRECTIONS[state & 7];
      if (this.world.get(x + d[0], y + d[1], z + d[2], false) === B.PISTON_HEAD) this.world.set(x + d[0], y + d[1], z + d[2], B.AIR);
    }
    const key = blockKey(x, y, z), container = id === B.CHEST ? this.world.container(x, y, z, 'chest') : this.world.containers.get(key);
    if (container) {
      for (const stack of container.slots) if (stack) this.entities.drop(stack, { x: x + .5, y: y + .25, z: z + .5 }); this.world.containers.delete(key);
    }
    if (b.station === 'door') {
      const otherY = id === B.DOOR ? y + 1 : y - 1;
      if ([B.DOOR, B.DOOR_TOP].includes(this.world.get(x, otherY, z, false))) this.world.set(x, otherY, z, B.AIR);
    }
    if (b.station === 'bed') {
      const [dx, dz] = FACING[state & 3], sign = id === B.BED ? 1 : -1;
      const other = this.world.get(x + dx * sign, y, z + dz * sign, false);
      if ([B.BED, B.BED_HEAD].includes(other)) this.world.set(x + dx * sign, y, z + dz * sign, B.AIR);
    }
    if (id === B.OBSIDIAN) for (const [dx, dy, dz] of DIRECTIONS) if (this.world.get(x + dx, y + dy, z + dz, false) === B.PORTAL) this.removePortal(x + dx, y + dy, z + dz);
    this.world.set(x, y, z, B.AIR);
    if (allowDrops && (explosion || !this.player.creative)) {
      for (const stack of this.harvestDrops(id, item, state)) this.entities.drop(stack, { x: x + .5, y: y + .2, z: z + .5 });
      if (b.xp && (!b.tier || item?.tool === b.tool && item?.tier >= b.tier)) this.entities.xp(b.xp, { x: x + .5, y: y + .5, z: z + .5 });
    }
    if (!explosion) {
      this.audio.play('break', b.sound); this.graphics.burst(x, y, z, id);
      if (!this.player.creative && b.hardness > 0 && item?.durability) {
        const broke = this.player.inventory.damage(this.player.selected, item.tool === 'sword' ? 2 : 1); if (broke) this.audio.play('break', 'wood');
      }
      this.player.exhaust(.005); this.stats.broken++;
    }
    return true;
  }
  hand(offhand = false) { return offhand ? this.player.offhand : this.player.inventory.slots[this.player.selected]; }
  setHand(stack, offhand = false) { if (offhand) this.player.offhand = stack; else this.player.inventory.slots[this.player.selected] = stack; this.player.inventory.revision++; }
  consumeHand(offhand = false, count = 1) {
    if (this.player.creative) return;
    const stack = this.hand(offhand); if (!stack) return; stack.count -= count; if (stack.count <= 0) this.setHand(null, offhand); this.player.inventory.revision++;
  }
  damageHand(offhand = false) {
    if (this.player.creative) return;
    const stack = this.hand(offhand); if (!items[stack?.id]?.durability) return;
    if (--stack.durability <= 0) this.setHand(null, offhand); this.player.inventory.revision++;
  }
  exchangeBucket(newId, offhand = false) {
    if (this.player.creative) return;
    const stack = this.hand(offhand); if (stack.count === 1) this.setHand(makeStack(newId), offhand);
    else { this.consumeHand(offhand); const left = this.player.inventory.add(makeStack(newId)); if (left) this.dropStack(left); }
  }
  useTick() {
    const p = this.player, hit = this.target, stack = this.hand(), item = items[stack?.id];
    const bypassInteraction = p.sneaking || this.input.keys?.has('ShiftLeft') || this.input.keys?.has('ShiftRight') || this.input.usePressed && this.input.useSneaking;
    const entity = this.entities.hitTest(p.eye, p.direction, p.creative ? 5 : 4.5);
    if (!this.placeCooldown && entity && (!hit || entity.distance < hit.distance) && this.entities.interact(entity.mob)) { this.placeCooldown = .3; return; }
    if (!this.placeCooldown && hit && !bypassInteraction && this.world.redstone.interact(hit.x, hit.y, hit.z)) {
      this.placeCooldown = .3; this.startSwing();
      if (hit.id === B.REPEATER) this.ui.hud.message(`中继器延迟：${((this.world.getState(hit.x, hit.y, hit.z) >> 2) & 3) + 1} 档`);
      this.advancement('redstone'); return;
    }
    if (!this.placeCooldown && hit && !bypassInteraction && blocks[hit.id]?.station) {
      const station = blocks[hit.id].station;
      if (station === 'craft' || station === 'furnace' || station === 'chest') {
        if (station === 'chest' && this.world.chestBlocked(hit.x, hit.y, hit.z)) { this.placeCooldown = .3; return; }
        const container = station === 'chest' ? this.world.chestView(hit.x, hit.y, hit.z) : station === 'furnace' ? this.world.container(hit.x, hit.y, hit.z, station) : null;
        this.openInventory(station, { x: hit.x, y: hit.y, z: hit.z, container }); if (station === 'chest') this.audio.play('chest'); return;
      }
      if (station === 'door') {
        const y = hit.id === B.DOOR_TOP ? hit.y - 1 : hit.y, state = this.world.getState(hit.x, y, hit.z) ^ 4;
        this.world.set(hit.x, y, hit.z, B.DOOR, state); this.world.set(hit.x, y + 1, hit.z, B.DOOR_TOP, state);
        this.audio.play('door'); this.placeCooldown = .3; return;
      }
      if (station === 'bed') { this.sleep(hit); this.placeCooldown = .5; return; }
    }
    if (item?.food && p.hunger < 20 && this.input.right) {
      p.usingItem = true; this.eating += .05;
      if (Math.floor(this.eating * 5) !== Math.floor((this.eating - .05) * 5)) this.audio.play('eat');
      if (this.eating >= 1.6) { if (p.eat(item.id)) this.consumeHand(); this.eating = 0; this.audio.play('burp'); }
      return;
    }
    if (item?.id === I.BOW) {
      if (!this.input.right) return;
      if (p.creative || p.inventory.count(I.ARROW) > 0) { this.bowCharge += .05; p.usingItem = true; }
      else if (!this.placeCooldown) { this.ui.hud.message('需要箭才能拉弓。'); this.placeCooldown = 1; }
      return;
    }
    if (this.placeCooldown) return;
    if (this.useItem(item, hit, false)) { this.placeCooldown = .25; return; }
    if (p.offhand && this.useItem(items[p.offhand.id], hit, true)) { this.placeCooldown = .25; return; }
  }
  useItem(item, hit, offhand = false) {
    if (!item) return false;
    const p = this.player;
    if (item.spawnMob) {
      if (!hit || this.entities.mobs.length >= 128 || this.difficulty === 'peaceful') { this.ui.hud.message(this.difficulty === 'peaceful' ? '和平难度不会生成敌对生物。' : '需要可见的地面与足够的生物空间。'); return true; }
      const pos = { x: hit.x + .5 + hit.normal[0], y: hit.y + (hit.normal[1] > 0 ? 1 : 0), z: hit.z + .5 + hit.normal[2] };
      const width = item.spawnMob === 'spider' ? 1.3 : .6, height = item.spawnMob === 'spider' ? .9 : 1.95;
      if (collides(this.world, { pos, width, height }) || this.entities.mobs.some(m => m.health > 0 && DIST(m.pos, pos) < .7)) return true;
      this.entities.spawnMob(item.spawnMob, pos, { persistent: true }); this.consumeHand(offhand); this.startSwing(); return true;
    }
    if (item.id === I.EGG) { this.entities.shoot(p.eye, p.direction, 1, 'player', 'egg'); this.consumeHand(offhand); this.startSwing(); return true; }
    if (item.id === I.ENDER_PEARL) {
      if (p.pearlCooldown > 0) return true;
      this.entities.shoot(p.eye, p.direction, 1, 'player', 'ender_pearl'); p.pearlCooldown = 20;
      this.consumeHand(offhand); this.startSwing(); return true;
    }
    if (item.id === I.EYE_OF_ENDER) {
      if (hit?.id === B.END_PORTAL_FRAME && !(this.world.getState(hit.x, hit.y, hit.z) & 4)) {
        this.world.set(hit.x, hit.y, hit.z, B.END_PORTAL_FRAME, this.world.getState(hit.x, hit.y, hit.z) | 4);
        this.consumeHand(offhand); this.startSwing(); this.audio.play('end_eye');
        if (activateEndPortal(this.world, hit)) { this.advancement('eye'); this.audio.play('portal_activate'); }
        return true;
      }
      if (this.world.dimension === 'overworld' && !(p.eyeCooldown > 0)) {
        const fortress = nearestStronghold(this.world.seed, p.pos), dx = fortress.x + 24 - p.pos.x, dz = fortress.z - p.pos.z, distance = Math.hypot(dx, dz);
        const projectile = this.entities.shoot(p.eye, p.direction, 1, 'player', 'eye_of_ender');
        projectile.target = distance > 12 ? { x: p.pos.x + dx / distance * 12, y: p.pos.y + 8, z: p.pos.z + dz / distance * 12 } : { x: fortress.x + 24.5, y: fortress.y + 3, z: fortress.z + .5 };
        this.consumeHand(offhand); p.eyeCooldown = 20; this.startSwing(); this.audio.play('end_eye'); return true;
      }
      return true;
    }
    if (item.armor !== undefined) {
      const old = p.armor[item.armor]; p.armor[item.armor] = this.hand(offhand); this.setHand(old, offhand); this.audio.play('place', 'cloth'); return true;
    }
    if (!hit) return false;
    if (item.id === I.REDSTONE) return this.placeBlock(B.WIRE, hit, offhand);
    if (item.tool === 'hoe' && [B.GRASS, B.DIRT].includes(hit.id) && !isSolid(this.world.get(hit.x, hit.y + 1, hit.z, false))) {
      this.world.set(hit.x, hit.y, hit.z, B.FARMLAND); this.damageHand(offhand); this.audio.play('place', 'gravel'); this.startSwing(); return true;
    }
    if (item.id === I.SEEDS && hit.id === B.FARMLAND && !this.world.get(hit.x, hit.y + 1, hit.z, false)) {
      this.world.set(hit.x, hit.y + 1, hit.z, B.WHEAT0); this.consumeHand(offhand); this.advancement('farmer'); this.audio.play('place', 'grass'); this.startSwing(); return true;
    }
    if (item.id === I.BONE_MEAL) {
      let used = false;
      if (hit.id === B.SAPLING) used = this.world.growTree(hit.x, hit.y, hit.z);
      if (hit.id >= B.WHEAT0 && hit.id < B.WHEAT7) used = this.world.set(hit.x, hit.y, hit.z, Math.min(B.WHEAT7, hit.id + 2 + Math.floor(Math.random() * 4)));
      if (hit.id === B.GRASS) {
        for (let n = 0; n < 18; n++) {
          const x = hit.x + Math.floor((Math.random() - .5) * 7), z = hit.z + Math.floor((Math.random() - .5) * 7), y = this.world.surface(x, z);
          if (this.world.get(x, y - 1, z, false) === B.GRASS && !this.world.get(x, y, z, false)) used = this.world.set(x, y, z, Math.random() < .1 ? B.DANDELION : B.TALL_GRASS) || used;
        }
      }
      if (used) { this.consumeHand(offhand); this.audio.play('place', 'grass'); return true; }
    }
    if (item.id === I.BUCKET && [B.WATER, B.LAVA].includes(hit.id) && this.world.getState(hit.x, hit.y, hit.z) === 0) {
      this.world.set(hit.x, hit.y, hit.z, B.AIR); this.exchangeBucket(hit.id === B.WATER ? I.WATER_BUCKET : I.LAVA_BUCKET, offhand); this.audio.play('splash'); return true;
    }
    const target = this.placementTarget(hit), { x, y, z } = target;
    if (item.id === I.WATER_BUCKET || item.id === I.LAVA_BUCKET) {
      if (!this.replaceable(this.world.get(x, y, z, false))) return false;
      if (item.id === I.WATER_BUCKET && this.world.dimension === 'nether') { this.audio.play('fuse'); this.graphics.burst(x, y, z, B.STONE, 10, .4); }
      else this.world.set(x, y, z, item.id === I.WATER_BUCKET ? B.WATER : B.LAVA, 0);
      this.exchangeBucket(I.BUCKET, offhand); this.audio.play('splash'); this.startSwing(); return true;
    }
    if (item.id === I.FLINT_STEEL) {
      if (hit.id === B.TNT) { this.entities.primeTNT(hit.x, hit.y, hit.z); this.damageHand(offhand); return true; }
      if (this.tryPortal(x, y, z)) { this.damageHand(offhand); this.audio.play('fuse'); return true; }
      if (this.replaceable(this.world.get(x, y, z, false)) && !blocks[this.world.get(x, y, z, false)]?.liquid && canBurnAt(this.world, x, y, z)) {
        this.world.set(x, y, z, B.FIRE); this.damageHand(offhand); this.audio.play('fuse'); this.startSwing(); return true;
      }
      return false;
    }
    if (item.block !== undefined) return this.placeBlock(item.block, hit, offhand);
    return false;
  }
  releaseUse() {
    if (this.bowCharge > .1 && this.activeWorld && this.screen === 'playing') {
      const p = this.player, stack = this.hand();
      if (stack?.id === I.BOW && (p.creative || p.inventory.remove(I.ARROW))) {
        const f = Math.min(1, this.bowCharge), charge = Math.min(1, (f * f + f * 2) / 3), direction = p.direction;
        this.entities.shoot({ x: p.eye.x + direction.x * .3, y: p.eye.y + direction.y * .3, z: p.eye.z + direction.z * .3 }, direction, charge);
        this.damageHand(); this.startSwing();
      }
    }
    this.bowCharge = 0;
  }
  replaceable(id) { return id === B.AIR || id === B.FIRE || blocks[id]?.liquid || ['cross', 'crop'].includes(blocks[id]?.shape); }
  placementTarget(hit) {
    return this.replaceable(hit.id) && !blocks[hit.id]?.liquid ? { x: hit.x, y: hit.y, z: hit.z } : { x: hit.x + hit.normal[0], y: hit.y + hit.normal[1], z: hit.z + hit.normal[2] };
  }
  overlapsEntity(x, y, z, id, state) {
    for (const shape of collisionShapes(id, state)) {
      const bounds = [x + shape[0], y + shape[1], z + shape[2], x + shape[3], y + shape[4], z + shape[5]];
      if (intersects(bounds, bodyBox(this.player))) return true;
      if (this.entities.mobs.some(m => m.health > 0 && intersects(bounds, bodyBox(m)))) return true;
    }
    return false;
  }
  placeBlock(id, hit, offhand = false) {
    const p = this.player, b = blocks[id], pos = this.placementTarget(hit); let { x, y, z } = pos;
    if (y < 1 || y >= HEIGHT) { this.ui.hud.message(`建筑高度范围：1–${HEIGHT - 1}`); return false; }
    let state = Math.round(-p.yaw / (Math.PI / 2)) & 3;
    if (id === B.PISTON) state = p.pitch < -.85 ? 4 : p.pitch > .85 ? 5 : (state + 2) & 3;
    if (['lever', 'button'].includes(b.shape)) state = hit.normal[1] > 0 ? 0 : hit.normal[1] < 0 ? 5 : hit.normal[0] > 0 ? 1 : hit.normal[0] < 0 ? 2 : hit.normal[2] > 0 ? 3 : 4;
    if (b.shape === 'wire' || b.shape === 'plate') state = 0;
    if (b.station === 'furnace' || b.station === 'chest') state = (state + 2) & 3;
    if (LOGS.includes(id)) state = hit.normal[0] ? 4 : hit.normal[2] ? 8 : 0;
    if (id === B.SPAWNER) state = this.world.dimension === 'nether' ? 1 : 0;
    if (b.leaves) state = 16;
    if (b.shape === 'cube' && !b.station && !LOGS.includes(id) && !b.leaves && id !== B.SPAWNER) state = 0;
    if (b.shape === 'slab') {
      const oldState = this.world.getState(hit.x, hit.y, hit.z);
      if (hit.id === id && !(oldState & 8) && (hit.normal[1] > 0 && !(oldState & 4) || hit.normal[1] < 0 && oldState & 4)) { x = hit.x; y = hit.y; z = hit.z; state = 8; }
      else state = hit.normal[1] < 0 || hit.normal[1] === 0 && hit.point.y % 1 > .5 ? 4 : 0;
    }
    if (b.shape === 'stairs' && (hit.normal[1] < 0 || hit.normal[1] === 0 && hit.point.y % 1 > .5)) state |= 4;
    const old = this.world.get(x, y, z, false);
    if (!(b.shape === 'slab' && state === 8 && old === id) && !this.replaceable(old)) return false;
    if (b.shape === 'torch') {
      if (hit.normal[1] < 0) return false;
      state = hit.normal[0] > 0 ? 1 : hit.normal[0] < 0 ? 2 : hit.normal[2] > 0 ? 3 : hit.normal[2] < 0 ? 4 : 0;
    }
    if (b.shape === 'ladder') {
      if (hit.normal[1]) return false; state = hit.normal[0] > 0 ? 1 : hit.normal[0] < 0 ? 3 : hit.normal[2] > 0 ? 2 : 0;
    }
    if (['cross', 'crop'].includes(b.shape)) {
      const below = this.world.get(x, y - 1, z, false);
      if (id === B.SUGAR_CANE) {
        if (![B.GRASS, B.DIRT, B.SAND, B.SUGAR_CANE].includes(below)) return false;
        if (below !== B.SUGAR_CANE && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => this.world.get(x + dx, y - 1, z + dz, false) === B.WATER)) return false;
      } else if (![B.GRASS, B.DIRT, B.FARMLAND].includes(below)) return false;
      state = 0;
    }
    if (id === B.CACTUS) {
      if (![B.SAND, B.CACTUS].includes(this.world.get(x, y - 1, z, false))) return false;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => isSolid(this.world.get(x + dx, y, z + dz, false)))) return false;
    }
    if (!['bed', 'door'].includes(b.station) && !supported(this.world, x, y, z, id, state)) return false;
    if (b.solid && this.overlapsEntity(x, y, z, id, state)) return false;
    if (id === B.DOOR) {
      if (y >= HEIGHT - 1 || !isSolid(this.world.get(x, y - 1, z, false)) || !this.replaceable(this.world.get(x, y + 1, z, false)) || this.overlapsEntity(x, y + 1, z, B.DOOR_TOP, state)) return false;
      this.world.set(x, y + 1, z, B.DOOR_TOP, state);
    }
    if (id === B.BED) {
      const [dx, dz] = FACING[state & 3];
      if (!isSolid(this.world.get(x, y - 1, z, false)) || !isSolid(this.world.get(x + dx, y - 1, z + dz, false)) || !this.replaceable(this.world.get(x + dx, y, z + dz, false)) || this.overlapsEntity(x + dx, y, z + dz, B.BED_HEAD, state)) return false;
      this.world.set(x + dx, y, z + dz, B.BED_HEAD, state);
    }
    this.world.set(x, y, z, id, state); this.consumeHand(offhand); this.stats.placed++; this.audio.play('place', b.sound); this.startSwing();
    return true;
  }
  pickBlock() {
    this.updateTarget(); if (!this.target) return;
    const p = this.player; let id = this.target.id;
    if ([B.DOOR_TOP, B.BED_HEAD, B.FURNACE_ON].includes(id)) id = blocks[id].drop;
    if ([B.WIRE, B.REDSTONE_TORCH_OFF, B.REDSTONE_LAMP_ON].includes(id)) id = blocks[id].drop;
    if (id === B.PISTON_HEAD) id = B.PISTON;
    const index = p.inventory.slots.findIndex(s => s?.id === id);
    if (index >= 0 && index < 9) p.selected = index;
    else if (index >= 9) { const old = p.inventory.slots[p.selected]; p.inventory.slots[p.selected] = p.inventory.slots[index]; p.inventory.slots[index] = old; }
    else if (p.creative && items[id] && !items[id].hidden) p.inventory.slots[p.selected] = makeStack(id, items[id].stack);
    p.inventory.revision++;
  }
  dropStack(stack, throwForward = true) {
    if (!stack) return;
    const p = this.player, d = p.direction;
    this.entities.drop(stack, { x: p.pos.x + (throwForward ? d.x * .4 : 0), y: p.pos.y + (throwForward ? 1.35 : .4), z: p.pos.z + (throwForward ? d.z * .4 : 0) },
      throwForward ? { x: d.x * .3, y: d.y * .3 + .1, z: d.z * .3 } : undefined, 40);
  }
  onPickup(stack) {
    if (LOGS.includes(stack.id)) this.advancement('wood');
    if (stack.id === B.COBBLE) this.advancement('stone');
    if (stack.id === I.DIAMOND) this.advancement('diamond');
    if (stack.id === I.BLAZE_ROD) this.advancement('blaze');
    if (stack.id === I.ENDER_PEARL) this.advancement('pearl');
  }
  onCraft(stack) {
    this.stats.crafted += stack.count;
    if (stack.id === B.CRAFTING) this.advancement('table');
    if (stack.id === I.WOOD_PICKAXE) this.advancement('pickaxe');
    if (stack.id === B.FURNACE) this.advancement('furnace');
  }
  advancement(id) {
    if (this.earned.has(id) || !ADVANCEMENTS[id]) return;
    this.earned.add(id); const [title, description, icon] = ADVANCEMENTS[id]; this.ui.toast('已达成进度！', title, icon); this.audio.play('xp');
  }
  sleep(hit) {
    if (this.world.dimension !== 'overworld') { this.breakBlock(hit, true, false); this.entities.explode(hit.x + .5, hit.y + .5, hit.z + .5, 5); return; }
    const p = this.player;
    let spawn = null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const candidate = { x: hit.x + dx + .5, y: hit.y, z: hit.z + dz + .5 };
      if (!collides(this.world, p, candidate) && isSolid(this.world.get(candidate.x, candidate.y - .1, candidate.z, false))) { spawn = candidate; break; }
    }
    if (spawn) { p.spawnPoint = spawn; p.bedSpawn = { x: hit.x, y: hit.y, z: hit.z }; }
    if (this.world.time < 12500 || this.world.time > 23500) { this.ui.hud.message('重生点已设置。只能在晚上睡觉。'); return; }
    if (this.entities.mobs.some(m => !['pig', 'cow', 'sheep', 'chicken'].includes(m.type) && m.health > 0 && Math.hypot(m.pos.x - hit.x, m.pos.z - hit.z) < 8 && Math.abs(m.pos.y - hit.y) < 5)) {
      this.ui.hud.message('你现在不能休息，周围有怪物在游荡。'); return;
    }
    this.world.time = 1000; this.world.weather = 0; this.world.weatherTimer = 600; this.advancement('sleep'); this.ui.hud.message('一觉醒来，天已亮了。');
  }
  processEvents() {
    for (const event of this.world.events.splice(0)) {
      if (event.type === 'fall') this.entities.fall(event.id, event.x, event.y, event.z);
      if (event.type === 'drop') this.entities.drop(event.stack || makeStack(event.id), { x: event.x + .5, y: event.y + .2, z: event.z + .5 });
      if (event.type === 'prime') this.entities.primeTNT(event.x, event.y, event.z);
      if (event.type === 'circuit-click') this.audio.play('click', 'stone', .6);
      if (event.type === 'piston') this.audio.play('door', 'stone', .8);
      if (event.type === 'fizz') this.audio.play('fuse', 'stone', .4);
      if (event.type === 'leaves' && LOGS.includes(event.old)) {
        for (let dy = -4; dy <= 4; dy++) for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
          const x = event.x + dx, y = event.y + dy, z = event.z + dz, id = this.world.get(x, y, z, false);
          if (blocks[id]?.leaves && !(this.world.getState(x, y, z) & 16)) this.world.leafQueue.push({ x, y, z, wait: 60 + Math.floor(Math.random() * 140) });
        }
      }
    }
    for (const leaf of this.world.leafQueue) leaf.wait--;
    let removed = 0;
    this.world.leafQueue = this.world.leafQueue.filter(leaf => {
      if (leaf.wait > 0 || removed > 4) return true; removed++;
      const id = this.world.get(leaf.x, leaf.y, leaf.z, false); if (!blocks[id]?.leaves || this.world.getState(leaf.x, leaf.y, leaf.z) & 16) return false;
      let connected = false;
      for (let dy = -4; dy <= 4 && !connected; dy++) for (let dz = -4; dz <= 4 && !connected; dz++) for (let dx = -4; dx <= 4; dx++) {
        if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 6) continue;
        if (LOGS.includes(this.world.get(leaf.x + dx, leaf.y + dy, leaf.z + dz, false))) { connected = true; break; }
      }
      if (!connected) {
        this.world.set(leaf.x, leaf.y, leaf.z, B.AIR);
        for (const stack of this.harvestDrops(id, null, 0)) this.entities.drop(stack, { x: leaf.x + .5, y: leaf.y, z: leaf.z + .5 });
      }
      return false;
    });
    for (const event of this.player.events.splice(0)) {
      if (event.type === 'step') this.audio.play('step', blocks[event.block]?.sound || 'stone');
      if (event.type === 'splash') this.audio.play('splash');
      if (event.type === 'hurt') this.audio.play('hurt');
      if (event.type === 'level') this.audio.play('level');
      if (event.type === 'death') this.die(event.cause);
    }
  }
  die(cause) {
    this.ui.inventory.close(); this.stats.deaths++; this.cancelUse();
    const p = this.player;
    for (const stack of [...p.inventory.slots, ...p.armor, p.offhand]) if (stack) this.entities.drop(stack, { x: p.pos.x, y: p.pos.y + .7, z: p.pos.z }, undefined, 20);
    p.inventory.slots.fill(null); p.armor.fill(null); p.offhand = null; p.inventory.revision++;
    this.entities.xp(Math.min(100, p.level * 7 + p.xp), { ...p.pos, y: p.pos.y + .5 }); p.level = 0; p.xp = 0;
    this.ui.show('death', cause); this.save().catch(error => this.ui.toast('保存失败', error.message, B.CHEST));
  }
  async respawn() {
    const old = this.player; this.ui.show('loading', '正在重生');
    if (this.world.dimension !== 'overworld') {
      this.worldSnapshots[this.world.dimension] = this.world.toJSON(); this.entitySnapshots[this.world.dimension] = this.entities.toJSON();
      this.entities.dispose(); this.entities = null; this.world = new World(this.world.seed, { ...this.worldSnapshots.overworld, dimension: 'overworld' });
    }
    let spawn = old.spawnPoint || this.initialSpawn || this.world.spawn();
    if (old.bedSpawn && ![B.BED, B.BED_HEAD].includes(this.world.get(old.bedSpawn.x, old.bedSpawn.y, old.bedSpawn.z))) spawn = this.initialSpawn || this.world.spawn();
    this.player = new Player(spawn, { spawnPoint: old.spawnPoint, mode: old.mode, score: old.score, bedSpawn: old.bedSpawn }, old.mode);
    await this.graphics.warm(this.world, spawn, p => this.ui.progress(p));
    if (collides(this.world, this.player)) { this.player.pos = this.world.spawn(); this.player.previous = { ...this.player.pos }; }
    if (!this.entities) this.entities = new EntitySystem(this, this.entitySnapshots.overworld);
    this.resetInteraction(); this.ui.show('ready'); await this.save();
  }
  tryPortal(x, y, z) {
    if (this.world.dimension === 'end') return false;
    const empty = id => id === B.AIR || id === B.FIRE || id === B.PORTAL;
    for (const [ax, az, state] of [[1, 0, 0], [0, 1, 1]]) {
      let base = y;
      for (let n = 0; n < 21 && base > 1 && empty(this.world.get(x, base - 1, z, false)); n++) base--;
      if (this.world.get(x, base - 1, z, false) !== B.OBSIDIAN) continue;
      let left = 0, right = 0;
      while (left < 22 && empty(this.world.get(x - ax * left, base, z - az * left, false))) left++;
      while (right < 22 && empty(this.world.get(x + ax * right, base, z + az * right, false))) right++;
      const width = left + right - 1; if (width < 2 || width > 21 || this.world.get(x - ax * left, base, z - az * left, false) !== B.OBSIDIAN || this.world.get(x + ax * right, base, z + az * right, false) !== B.OBSIDIAN) continue;
      for (let h = 3; h <= 21 && base + h < HEIGHT; h++) {
        let valid = true;
        for (let u = -left; u <= right && valid; u++) for (let v = -1; v <= h; v++) {
          const edge = u === -left || u === right || v === -1 || v === h, corner = (u === -left || u === right) && (v === -1 || v === h);
          const id = this.world.get(x + ax * u, base + v, z + az * u, false);
          if (corner) continue;
          if (edge ? id !== B.OBSIDIAN : !empty(id)) { valid = false; break; }
        }
        if (valid) {
          for (let u = -left + 1; u < right; u++) for (let v = 0; v < h; v++) this.world.set(x + ax * u, base + v, z + az * u, B.PORTAL, state);
          return true;
        }
      }
    }
    return false;
  }
  removePortal(x, y, z) {
    const queue = [[x, y, z]], visited = new Set();
    for (let read = 0; read < queue.length; read++) {
      const [x, y, z] = queue[read], key = blockKey(x, y, z); if (visited.has(key)) continue; visited.add(key);
      if (this.world.get(x, y, z, false) !== B.PORTAL) continue; this.world.set(x, y, z, B.AIR);
      for (const [dx, dy, dz] of DIRECTIONS) if (this.world.get(x + dx, y + dy, z + dz, false) === B.PORTAL) queue.push([x + dx, y + dy, z + dz]);
    }
  }
  portalTick() {
    if (this.portalCooldown > 0) { this.portalCooldown -= .05; return; }
    const p = this.player;
    const contact = portalContact(this.world, p);
    if (contact?.id === B.END_PORTAL && this.screen === 'playing' && !this.traveling) {
      if (this.world.dimension !== 'end' || this.world.endFight?.state.defeated) this.travelEnd().catch(error => this.ui.error(error));
      return;
    }
    if (contact?.id === B.PORTAL && this.screen === 'playing') {
      this.portalTime += .05;
      if (this.portalTime >= (p.creative ? .05 : 4) && !this.traveling) this.travelDimension().catch(error => this.ui.error(error));
    } else this.portalTime = Math.max(0, this.portalTime - .2);
  }
  async travelEnd() {
    this.traveling = true; this.keepPointerLock = this.locked;
    const returning = this.world.dimension === 'end', from = this.world.dimension, seed = this.world.seed, generationVersion = this.world.generationVersion;
    const p = this.player;
    this.ui.show('loading', returning ? '正在返回主世界' : '正在进入末地');
    this.worldSnapshots[from] = this.world.toJSON(); this.entitySnapshots[from] = this.entities.toJSON(); this.entities.dispose(); this.entities = null;
    const dimension = returning ? 'overworld' : 'end';
    this.world = new World(seed, { ...this.worldSnapshots[dimension], dimension, generationVersion: this.worldSnapshots[dimension]?.generationVersion || generationVersion });
    let destination;
    if (returning) {
      destination = { ...(p.spawnPoint || this.initialSpawn || this.world.spawn()) };
      this.world.ensure(Math.floor(destination.x / 16), Math.floor(destination.z / 16));
      if (collides(this.world, p, destination)) destination = this.world.spawn();
    } else {
      destination = { ...END_SPAWN };
      for (let z = -2; z <= 2; z++) for (let x = 98; x <= 102; x++) {
        this.world.set(x, 48, z, B.OBSIDIAN, 0, false); for (let y = 49; y <= 52; y++) this.world.set(x, y, z, B.AIR, 0, false);
      }
      p.yaw = Math.PI / 2; p.pitch = 0;
    }
    p.pos = destination; p.previous = { ...destination }; p.vel = { x: 0, y: 0, z: 0 }; p.fallDistance = 0; p.burnTime = 0;
    await this.graphics.warm(this.world, destination, value => this.ui.progress(value));
    this.entities = new EntitySystem(this, this.entitySnapshots[dimension]); this.resetInteraction(); this.portalCooldown = 5;
    this.traveling = false; this.keepPointerLock = false;
    if (!returning) this.advancement('the_end');
    this.ui.show(returning ? 'credits' : this.locked || this.input.compatible ? 'playing' : 'ready'); await this.save();
  }
  async travelDimension() {
    this.traveling = true; this.keepPointerLock = this.locked; this.ui.show('loading', '正在进入另一个维度');
    const from = this.world.dimension, dimension = from === 'overworld' ? 'nether' : 'overworld', p = this.player;
    const desired = { x: p.pos.x * (from === 'overworld' ? 1 / 8 : 8), z: p.pos.z * (from === 'overworld' ? 1 / 8 : 8) };
    this.worldSnapshots[from] = this.world.toJSON(); this.entitySnapshots[from] = this.entities.toJSON();
    const generationVersion = this.world.generationVersion;
    this.entities.dispose(); this.entities = null; this.world = new World(this.world.seed, { generationVersion, ...this.worldSnapshots[dimension], dimension });
    let nearest = null;
    for (const [key, edits] of this.world.edits) {
      const [cx, cz] = key.split(',').map(Number);
      for (const [i, value] of edits) if (value[0] === B.PORTAL) {
        const x = cx * 16 + (i & 15), z = cz * 16 + ((i >> 4) & 15), y = i >> 8, d = Math.hypot(x - desired.x, z - desired.z);
        if (d < 96 && (!nearest || d < nearest.d || d === nearest.d && y < nearest.y)) nearest = { x, y, z, d };
      }
    }
    let destination;
    if (nearest) destination = { x: nearest.x + .5, y: nearest.y + .05, z: nearest.z + .5 };
    else {
      const x = Math.floor(desired.x), z = Math.floor(desired.z); let y;
      if (dimension === 'overworld') y = Math.max(SEA + 2, this.world.surface(x, z));
      else {
        this.world.ensure(Math.floor(x / 16), Math.floor(z / 16)); y = 55;
        for (let yy = 90; yy >= 33; yy--) if (isSolid(this.world.get(x, yy - 1, z)) && !this.world.get(x, yy, z) && !this.world.get(x, yy + 1, z) && !this.world.get(x, yy + 2, z)) { y = yy; break; }
      }
      y = clamp(Math.floor(y), 5, HEIGHT - 7);
      for (let dx = -1; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        this.world.set(x + dx, y - 1, z + dz, B.OBSIDIAN, 0, false);
        for (let dy = 0; dy <= 4; dy++) this.world.set(x + dx, y + dy, z + dz, B.AIR, 0, false);
      }
      for (let dx = -1; dx <= 2; dx++) for (let dy = -1; dy <= 3; dy++) this.world.set(x + dx, y + dy, z, dx === -1 || dx === 2 || dy === -1 || dy === 3 ? B.OBSIDIAN : B.PORTAL, 0, false);
      destination = { x: x + .5, y: y + .05, z: z + .5 };
    }
    p.pos = destination; p.previous = { ...destination }; p.vel = { x: 0, y: 0, z: 0 }; p.fallDistance = 0;
    await this.graphics.warm(this.world, destination, value => this.ui.progress(value));
    this.entities = new EntitySystem(this, this.entitySnapshots[dimension]); this.resetInteraction(); this.portalCooldown = 5;
    this.traveling = false; this.keepPointerLock = false; this.advancement('nether');
    this.ui.show(this.locked || this.input.compatible ? 'playing' : 'ready'); await this.save();
  }
  tick() {
    const old = { ...this.player.pos }; this.player.tick(this.world, this.input, this.difficulty);
    this.stats.distance += Math.hypot(this.player.pos.x - old.x, this.player.pos.z - old.z);
    this.interactTick(); this.world.tick(.05, [this.player, ...this.entities.mobs, ...this.entities.drops]); this.entities.tick(); this.processEvents(); this.portalTick();
    this.playTime += .05; this.autoSaveTime += .05;
    if (this.autoSaveTime >= 30) { this.autoSaveTime = 0; this.save().catch(error => this.ui.toast('自动保存失败', error.message, B.CHEST)); }
    const context = this.ui.inventory.context;
    if (this.ui.inventory.opened && this.ui.inventory.type === 'chest' && context) {
      const current = this.world.chestPositions(context.x, context.y, context.z), original = context.container.positions;
      if (current.length !== original.length || current.some((p, i) => p.x !== original[i].x || p.z !== original[i].z)) { this.ui.inventory.close(); this.resume(); return; }
    }
    if (this.ui.inventory.opened && context && (DIST(this.player.pos, context) > 8 || !blocks[this.world.get(context.x, context.y, context.z, false)]?.station)) { this.ui.inventory.close(); this.resume(); }
  }
  frame(now) {
    const frameStart=performance.now();let simulationEnd=frameStart,streamingMs=0,renderMs=0;
    const dt = Math.min(.25, Math.max(0, (now - this.lastFrame) / 1000)); this.lastFrame = now;
    this.elapsed += dt; this.fps += ((dt > 0 ? 1 / dt : 60) - this.fps) * .045; this.frameCount++;
    try {
      if (!this.paused && this.entities && !this.traveling) {
        this.accumulator += dt; let steps = 0;
        while (this.accumulator >= .05 && steps < 5 && !this.paused && !this.traveling) { this.tick(); this.accumulator -= .05; steps++; }
        this.interpolation = this.accumulator / .05;
      } else { this.accumulator = 0; this.interpolation = 1; }
      simulationEnd=performance.now();
      if (this.world && this.player) {
        const streamStart=performance.now();
        if (this.screen !== 'loading' && this.screen !== 'error') this.graphics.stream(this.world, this.player.pos, this.activeWorld ? 6 : 4);
        streamingMs=performance.now()-streamStart;const renderStart=performance.now();
        this.entities?.render(this.interpolation, this.paused ? 0 : dt);
        if (this.screen === 'playing') this.updateTarget();
        this.graphics.selection(this.screen === 'playing' && !this.hideHUD ? this.target : null, this.mining);
        this.graphics.render(this, dt); this.audio.tick(this.paused ? 0 : dt);
        renderMs=performance.now()-renderStart;
      }
      this.ui.tick(dt);
    } catch (error) {
      if (!this.failed) { this.failed = true; this.ui.error(error); }
    }
    this.metrics.record(simulationEnd-frameStart,streamingMs,renderMs,performance.now()-frameStart);
    requestAnimationFrame(this.frame);
  }
  diagnostics() {
    if(!this.world || !this.player)return {screen:this.screen,locked:this.locked,fps:this.fps,activeWorld:this.activeWorld,dimension:null,player:null};
    return {
      screen: this.screen, locked: this.locked, fps: this.fps, activeWorld: this.activeWorld, seed: this.world?.seed,
      dimension: this.world?.dimension, time: this.world?.time, worldName: this.worldName, worldId: this.worldId,
      boss: this.entities?.endBattle?.diagnostics() || null,
      flyingItems: this.entities?.projectiles.filter(p => ['ender_pearl', 'eye_of_ender'].includes(p.kind)).map(p => ({ kind: p.kind, pos: { ...p.pos }, target: p.target ? { ...p.target } : null, age: p.age })) || [],
      chunks: this.graphics.chunkMeshes.size, entities: this.entities?.mobs.length || 0, drops: this.entities?.drops.length || 0,
      chests: this.graphics.chestDiagnostics(),
      meshing: this.graphics.streamingDiagnostics(this.world),
      creatureRendering: this.entities ? { ...this.entities.batches.stats } : null,
      ai: this.entities ? { ...this.entities.navigation.stats, pending: this.entities.navigation.jobs.length } : null,
      performance: this.metrics.summary(), storage: { ...this.store.stats },
      particles: { active: this.graphics.particles.length, ...this.graphics.particlePool.stats },
      quality: { preset: this.settings.quality, pixelScale: this.settings.pixelScale, renderDistance: this.settings.renderDistance, particleLimit: this.settings.particleLimit, water: this.settings.richWater },
      resources: { loadedChunks: this.world.chunks.size, terrainColumns: this.world.terrain.columns.size, audioVoices: this.audio.voices.size, audioLimit: this.audio.maxVoices },
      textureAnimation: { frame: this.atlas.lastFrame, uploadVersion: this.atlas.texture.version, atlasWidth: this.atlas.canvas.width, atlasHeight: this.atlas.canvas.height },
      lighting: { ...this.world.lightingStats },
      looseItems: this.entities?.drops.filter(drop => !drop.dead && drop.stack).map(drop => ({ stack: { ...drop.stack }, pos: { ...drop.pos } })) || [],
      render: { calls: this.graphics.renderer.info.render.calls, triangles: this.graphics.renderer.info.render.triangles, geometries: this.graphics.renderer.info.memory.geometries, textures: this.graphics.renderer.info.memory.textures },
      transient: { tnt: this.entities?.tnt.map(t => ({ pos: { ...t.pos }, fuse: t.fuse })) || [], falling: this.entities?.falling.length || 0, projectiles: this.entities?.projectiles.length || 0, orbs: this.entities?.orbs.length || 0 },
      player: this.player ? { ...this.player.toJSON(), velocity: { ...this.player.vel }, onGround: this.player.onGround, inWater: this.player.inWater, eyeHeight: this.player.eyeHeight } : null,
      target: this.target ? { ...this.target, name: blocks[this.target.id]?.name } : null, mining: this.mining, earned: [...this.earned], stats: { ...this.stats },
      crafting: this.ui.inventory.opened ? { size: this.ui.inventory.size, grid: this.ui.inventory.grid.map(s => s ? { ...s } : null), cursor: this.ui.inventory.cursor ? { ...this.ui.inventory.cursor } : null } : null
    };
  }
}
