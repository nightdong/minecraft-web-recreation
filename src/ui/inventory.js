import { B, I, items, blocks, SMELTING } from '../core/blocks.js';
import { Inventory, makeStack, cloneStack, compatible, recipes, findRecipe, takeRecipe, canCraft, recipeIngredients } from '../core/inventory.js';
import { clamp } from '../core/noise.js';

const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TABS = [['building', '建筑方块', B.BRICKS], ['nature', '自然', B.SAPLING], ['tools', '工具', I.IRON_PICKAXE], ['redstone', '红石', I.REDSTONE], ['combat', '战斗', I.IRON_SWORD], ['food', '食物', I.APPLE], ['all', '搜索物品', I.COMPASS], ['survival', '生存物品栏', B.CHEST]];

export class InventoryScreen {
  constructor(ui) {
    this.ui = ui; this.game = ui.game; this.root = ui.menu; this.cursor = null; this.grid = []; this.size = 2;
    this.bookOpen = false; this.onlyCraftable = false; this.recipeSearch = ''; this.creativeSearch = ''; this.tab = 'building'; this.opened = false;
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2 }; this.dragVisited = new Set(); this.lastRevision = -1;
    this.cursorElement = document.createElement('div'); this.cursorElement.className = 'cursor-stack'; this.cursorElement.hidden = true; ui.root.append(this.cursorElement);
    this.tooltip = document.createElement('div'); this.tooltip.className = 'item-tooltip'; this.tooltip.hidden = true; ui.root.append(this.tooltip);
    this.root.addEventListener('mousedown', event => this.mouseDown(event));
    this.root.addEventListener('mousemove', event => this.mouseMove(event));
    this.root.addEventListener('mouseover', event => {
      if (!this.opened || !this.dragging || !this.cursor) return;
      const slot = event.target.closest('[data-slot]'); if (!slot) return;
      const key = `${slot.dataset.kind}:${slot.dataset.index}`;
      if (!this.dragVisited.has(key)) { this.dragVisited.add(key); this.slotClick(slot.dataset.kind, Number(slot.dataset.index), 2, false); }
    });
    this.root.addEventListener('click', event => {
      if (!this.opened) return;
      const toggle = event.target.closest('[data-recipe-toggle]'); if (toggle) { this.bookOpen = !this.bookOpen; this.render(); }
      const filter = event.target.closest('[data-recipe-filter]'); if (filter) { this.onlyCraftable = !this.onlyCraftable; this.render(); }
      const recipe = event.target.closest('[data-recipe]'); if (recipe) this.fillRecipe(recipes[Number(recipe.dataset.recipe)]);
      const tab = event.target.closest('[data-tab]'); if (tab) { this.tab = tab.dataset.tab; this.creativeSearch = ''; this.render(); }
      const trash = event.target.closest('[data-trash]'); if (trash) { if (event.shiftKey) this.game.player.inventory.slots.fill(null); this.cursor = null; this.game.player.inventory.revision++; this.render(); }
    });
    this.root.addEventListener('input', event => {
      if (event.target.id === 'recipe-search') { this.recipeSearch = event.target.value; this.refreshRecipes(); }
      if (event.target.id === 'creative-search') { this.creativeSearch = event.target.value; this.refreshCatalog(); }
    });
    document.addEventListener('mouseup', () => { this.dragging = false; this.dragVisited.clear(); });
    document.addEventListener('mousemove', event => {
      if (!this.opened) return; this.mouse.x = event.clientX; this.mouse.y = event.clientY;
      this.cursorElement.style.left = `${event.clientX}px`; this.cursorElement.style.top = `${event.clientY}px`;
    });
  }
  open(type, context) {
    this.type = type; this.context = context; this.container = context?.container || null;
    this.size = type === 'craft' ? 3 : 2; this.grid = Array(this.size ** 2).fill(null); this.cursor = null;
    this.opened = true; this.recipeSearch = ''; this.lastContainerSignature = ''; this.render();
  }
  close() {
    if (!this.opened) return;
    this.returnGrid(); this.returnStack(this.cursor); this.cursor = null; this.opened = false;
    if (this.type === 'chest') this.game.audio.play('chest', 'wood', .6);
    this.cursorElement.hidden = true; this.tooltip.hidden = true; this.dragging = false;
    this.game.player.inventory.revision++;
  }
  returnStack(stack) {
    if (!stack) return;
    const leftover = this.game.player.inventory.add(stack); if (leftover) this.game.dropStack(leftover, false);
  }
  returnGrid() { for (let i = 0; i < this.grid.length; i++) { this.returnStack(this.grid[i]); this.grid[i] = null; } }
  stackHTML(stack) {
    if (!stack || !items[stack.id]) return '';
    const item = items[stack.id], health = item.durability ? clamp(stack.durability / item.durability, 0, 1) : 1;
    return `<img src="${this.game.atlas.iconURL(stack.id)}" alt="" draggable="false">${stack.count > 1 ? `<span class="stack-count">${stack.count}</span>` : ''}${health < 1 ? `<span class="durability" style="--durability-color:hsl(${health * 120},100%,45%);--durability-width:${health * 100}%"><i></i></span>` : ''}`;
  }
  slot(kind, i, stack, extra = '') {
    return `<button class="slot ${extra}" data-slot data-kind="${kind}" data-index="${i}" data-item="${stack?.id || 0}" aria-label="${esc(items[stack?.id]?.name || (kind === 'result' ? '合成结果' : '空物品栏'))}" tabindex="-1">${this.stackHTML(stack)}</button>`;
  }
  playerSlots() {
    const slots = this.game.player.inventory.slots;
    return `<div class="inventory-label">物品栏</div><div class="slots-grid">${Array.from({ length: 27 }, (_, n) => this.slot('inv', n + 9, slots[n + 9])).join('')}</div><div class="slots-grid hotbar-grid">${Array.from({ length: 9 }, (_, n) => this.slot('inv', n, slots[n])).join('')}</div>`;
  }
  craftTop() {
    this.match = findRecipe(this.grid, this.size);
    const player = this.game.player, personal = this.type === 'inventory';
    return `<div class="${personal ? 'inventory-top' : 'workbench-top'}">
      ${personal ? `<div class="armor-column">${player.armor.map((stack, i) => this.slot('armor', i, stack)).join('')}</div><div class="avatar-box"><canvas id="inventory-avatar" width="50" height="70"></canvas></div><div class="offhand-slot">${this.slot('offhand', 0, player.offhand)}</div>` : ''}
      <div class="crafting-label">合成</div><div class="crafting-area"><div class="craft-grid" style="--grid-size:${this.size}">${this.grid.map((stack, i) => this.slot('craft', i, stack)).join('')}</div></div>
      <span class="craft-arrow">➜</span><div class="result-slot">${this.slot('result', 0, this.match?.recipe.output)}</div>
      <button class="recipe-toggle" data-recipe-toggle aria-label="配方书"><img src="${this.game.atlas.iconURL(I.BOOK)}" alt=""></button>
      </div>`;
  }
  furnaceTop() {
    const f = this.container;
    return `<div class="furnace-top"><div class="inventory-label" style="text-align:center">熔炉</div>
      <div class="furnace-input">${this.slot('container', 0, f.slots[0])}</div><div class="furnace-fuel">${this.slot('container', 1, f.slots[1])}</div><div class="furnace-output">${this.slot('container', 2, f.slots[2])}</div>
      <div class="furnace-flame">♨<span class="lit">♨</span></div><div class="furnace-progress">➜<span class="lit">➜</span></div></div>`;
  }
  recipeBook() {
    return `<aside class="recipe-book"><header>配方书<button class="recipe-filter" data-recipe-filter>${this.onlyCraftable ? '可合成' : '全部'}</button></header>
      <input id="recipe-search" class="mc-input" placeholder="搜索…" value="${esc(this.recipeSearch)}" autocomplete="off" aria-label="搜索配方">
      <div class="recipe-list"></div><div class="recipe-note">选择配方填入材料，再取出右侧产物。</div></aside>`;
  }
  creativePanel() {
    const player = this.game.player;
    return `<div class="inventory-panel creative-panel"><div class="creative-tabs">${TABS.map(([id, name, icon]) => `<button class="creative-tab ${this.tab === id ? 'active' : ''}" data-tab="${id}" title="${name}" aria-label="${name}"><img src="${this.game.atlas.iconURL(icon)}" alt=""></button>`).join('')}</div>
      <div class="inventory-label">${TABS.find(t => t[0] === this.tab)?.[1]}</div><input class="mc-input creative-search" id="creative-search" placeholder="搜索物品…" value="${esc(this.creativeSearch)}" aria-label="搜索物品">
      <div class="slots-grid creative-items"></div><div class="slots-grid hotbar-grid">${Array.from({ length: 9 }, (_, n) => this.slot('inv', n, player.inventory.slots[n])).join('')}</div><div class="creative-delete" data-trash title="销毁手持物品；Shift 清空背包">×</div></div>`;
  }
  render() {
    if (!this.opened) return;
    const creative = this.game.player.creative && this.type === 'inventory' && this.tab !== 'survival';
    const showBook = this.bookOpen && ['inventory', 'craft'].includes(this.type) && !creative;
    let panel;
    if (creative) panel = this.creativePanel();
    else {
      const top = this.type === 'furnace' ? this.furnaceTop() : this.type === 'chest' ? `<div class="chest-top"><div class="inventory-label">${this.container.slots.length === 54 ? '大型箱子' : '箱子'}</div><div class="slots-grid">${this.container.slots.map((stack, i) => this.slot('container', i, stack)).join('')}</div></div>` : this.craftTop();
      panel = `<div class="inventory-panel">${this.game.player.creative && this.type === 'inventory' ? `<div class="creative-tabs">${TABS.map(([id, name, icon]) => `<button class="creative-tab ${this.tab === id ? 'active' : ''}" data-tab="${id}" title="${name}"><img src="${this.game.atlas.iconURL(icon)}" alt=""></button>`).join('')}</div>` : ''}${top}${this.playerSlots()}</div>`;
    }
    const oldScroll = this.root.querySelector('.creative-items')?.scrollTop || 0, recipeScroll = this.root.querySelector('.recipe-list')?.scrollTop || 0;
    this.root.innerHTML = `<div class="menu-screen inventory-screen"><div class="inventory-layout">${showBook ? this.recipeBook() : ''}${panel}<div class="inventory-help">E / Esc 关闭　·　右键拆分　·　Shift 快速移动　·　数字键交换</div></div></div>`;
    if (creative) { this.refreshCatalog(); this.root.querySelector('.creative-items').scrollTop = oldScroll; }
    if (showBook) { this.refreshRecipes(); this.root.querySelector('.recipe-list').scrollTop = recipeScroll; }
    this.drawAvatar(); this.updateCursor(); this.tooltip.hidden = true; this.hovered = null;
    this.lastRevision = this.game.player.inventory.revision; this.updateFurnace();
  }
  refreshCatalog() {
    const container = this.root.querySelector('.creative-items'); if (!container) return;
    const list = Object.values(items).filter(item => {
      if (!item.id || item.hidden || this.creativeSearch && !(`${item.name} ${item.icon || item.texture}`).toLowerCase().includes(this.creativeSearch.toLowerCase())) return false;
      if (this.creativeSearch || this.tab === 'all') return true;
      if (this.tab === 'building') return item.block !== undefined && blocks[item.id].solid && !blocks[item.id].leaves && ![B.GRASS, B.DIRT, B.SAND, B.GRAVEL, B.CACTUS, B.SNOW_BLOCK, B.ICE].includes(item.id);
      if (this.tab === 'nature') return item.block !== undefined && !item.station || [I.SEEDS, I.WHEAT, I.BONE_MEAL, I.EGG].includes(item.id);
      if (this.tab === 'tools') return item.tool && item.tool !== 'sword' || [I.BUCKET, I.WATER_BUCKET, I.LAVA_BUCKET, I.FLINT_STEEL, I.COMPASS, I.CLOCK].includes(item.id);
      if (this.tab === 'combat') return item.tool === 'sword' || item.armor !== undefined || [I.BOW, I.ARROW, B.TNT].includes(item.id);
      if (this.tab === 'food') return !!item.food;
      if (this.tab === 'redstone') return !!item.circuit || [I.REDSTONE, I.FLINT_STEEL, B.PISTON].includes(item.id);
      return false;
    });
    container.innerHTML = list.map(item => this.slot('catalog', item.id, makeStack(item.id))).join('');
  }
  refreshRecipes() {
    const container = this.root.querySelector('.recipe-list'); if (!container) return;
    const inventory = new Inventory(36, this.game.player.inventory.slots);
    for (const stack of this.grid) if (stack) inventory.add(stack);
    const list = recipes.map((r, i) => ({ r, i, available: canCraft(r, inventory) })).filter(({ r, available }) =>
      (r.shapeless ? r.ingredients.length <= this.size ** 2 : r.width <= this.size && r.height <= this.size) && (!this.onlyCraftable || available) && (!this.recipeSearch || r.name.includes(this.recipeSearch)));
    list.sort((a, b) => Number(b.available) - Number(a.available));
    container.innerHTML = list.map(({ r, i, available }) => `<button class="recipe-entry ${available ? '' : 'unavailable'}" data-recipe="${i}" title="${esc(r.name)}" aria-label="配方：${esc(r.name)}"><img src="${this.game.atlas.iconURL(r.output.id)}" alt="">${r.output.count > 1 ? `<span class="stack-count">${r.output.count}</span>` : ''}</button>`).join('');
  }
  fillRecipe(recipe) {
    if (!recipe) return;
    this.returnGrid();
    if (!canCraft(recipe, this.game.player.inventory)) {
      this.render(); const note = this.root.querySelector('.recipe-note');
      if (note) { note.style.color = '#a02020'; note.textContent = `缺少材料：${[...new Set(recipeIngredients(recipe).map(ing => items[Array.isArray(ing) ? ing[0] : ing]?.name))].join('、')}`; }
      return;
    }
    const place = (ingredient, index) => {
      const id = (Array.isArray(ingredient) ? ingredient : [ingredient]).find(id => this.game.player.inventory.count(id) > 0);
      if (id === undefined) return; this.game.player.inventory.remove(id, 1); this.grid[index] = makeStack(id);
    };
    if (recipe.shapeless) recipe.ingredients.forEach((ing, i) => place(ing, i));
    else recipe.shape.forEach((row, y) => [...row].forEach((symbol, x) => { if (recipe.keys[symbol]) place(recipe.keys[symbol], y * this.size + x); }));
    this.game.audio.play('click'); this.render();
  }
  getSlot(kind, index) {
    if (kind === 'inv') return this.game.player.inventory.slots[index];
    if (kind === 'craft') return this.grid[index];
    if (kind === 'armor') return this.game.player.armor[index];
    if (kind === 'offhand') return this.game.player.offhand;
    if (kind === 'container') return this.container?.slots[index];
    if (kind === 'result') return findRecipe(this.grid, this.size)?.recipe.output;
    if (kind === 'catalog') return makeStack(index);
    return null;
  }
  setSlot(kind, index, stack) {
    if (kind === 'inv') this.game.player.inventory.slots[index] = stack;
    if (kind === 'craft') this.grid[index] = stack;
    if (kind === 'armor') this.game.player.armor[index] = stack;
    if (kind === 'offhand') this.game.player.offhand = stack;
    if (kind === 'container') this.container.slots[index] = stack;
    this.game.player.inventory.revision++;
  }
  accepts(kind, index, stack) {
    if (!stack) return true;
    if (kind === 'result' || kind === 'catalog') return false;
    if (kind === 'armor') return items[stack.id]?.armor === index;
    if (kind === 'container' && this.type === 'furnace') return index === 2 ? false : index === 1 ? !!items[stack.id]?.fuel || stack.id === I.BUCKET : true;
    return true;
  }
  canFit(stack) {
    let left = stack.count;
    for (const slot of this.game.player.inventory.slots) { if (!slot) left -= items[stack.id].stack; else if (compatible(slot, stack)) left -= items[stack.id].stack - slot.count; }
    return left <= 0;
  }
  takeOutput(shift = false) {
    for (let n = 0; n < (shift ? 256 : 1); n++) {
      const match = findRecipe(this.grid, this.size); if (!match) break; const out = match.recipe.output;
      if (shift) { if (!this.canFit(out)) break; }
      else if (this.cursor && (!compatible(this.cursor, out) || this.cursor.count + out.count > items[out.id].stack)) break;
      const made = takeRecipe(this.grid, match);
      if (shift) this.game.player.inventory.add(made);
      else if (this.cursor) this.cursor.count += made.count; else this.cursor = made;
      this.game.onCraft(made); this.game.player.inventory.revision++;
    }
    this.render();
  }
  transferTo(stack, destinations) {
    let remaining = cloneStack(stack);
    for (const pass of [0, 1]) for (const [kind, index] of destinations) {
      if (!this.accepts(kind, index, remaining)) continue;
      const slot = this.getSlot(kind, index), max = kind === 'armor' ? 1 : items[remaining.id].stack;
      if (pass === 0 && compatible(slot, remaining) && slot.count < max) {
        const n = Math.min(max - slot.count, remaining.count); slot.count += n; remaining.count -= n;
      } else if (pass === 1 && !slot) {
        const n = Math.min(max, remaining.count); this.setSlot(kind, index, { ...remaining, count: n }); remaining.count -= n;
      }
      if (!remaining.count) return null;
    }
    return remaining;
  }
  shiftSlot(kind, index) {
    const stack = this.getSlot(kind, index); if (!stack) return;
    let targets = [];
    if (kind === 'inv') {
      if (this.container) {
        if (this.type === 'chest') targets = this.container.slots.map((_, i) => ['container', i]);
        else if (SMELTING[stack.id]) targets = [['container', 0]];
        else if (items[stack.id]?.fuel) targets = [['container', 1]];
      } else if (items[stack.id]?.armor !== undefined && !this.game.player.armor[items[stack.id].armor]) targets = [['armor', items[stack.id].armor]];
      if (!targets.length) targets = Array.from({ length: index < 9 ? 27 : 9 }, (_, i) => ['inv', index < 9 ? i + 9 : i]);
    } else targets = Array.from({ length: 36 }, (_, i) => ['inv', i]);
    const before = stack.count, remaining = this.transferTo(stack, targets); this.setSlot(kind, index, remaining);
    if (kind === 'container' && this.type === 'furnace' && index === 2 && before !== (remaining?.count || 0)) { this.game.player.addXP(Math.max(1, before - (remaining?.count || 0))); this.game.advancement('smelt'); }
  }
  slotClick(kind, index, button, shift) {
    if (kind === 'catalog') {
      const out = makeStack(index, shift ? items[index].stack : 1);
      if (shift) this.game.player.inventory.add(out);
      else if (this.cursor?.id === index && button === 0) this.cursor.count = Math.min(items[index].stack, this.cursor.count + 1);
      else this.cursor = makeStack(index, button === 2 ? items[index].stack : 1);
      this.render(); return;
    }
    if (kind === 'result') { this.takeOutput(shift); return; }
    if (shift) { this.shiftSlot(kind, index); this.render(); return; }
    let slot = this.getSlot(kind, index);
    if (kind === 'container' && this.type === 'furnace' && index === 2 && this.cursor) {
      if (compatible(slot, this.cursor)) {
        const count = Math.min(slot.count, items[this.cursor.id].stack - this.cursor.count);
        if (count > 0) {
          this.cursor.count += count; slot.count -= count;
          if (!slot.count) this.setSlot(kind, index, null);
          this.game.player.addXP(count); this.game.advancement('smelt');
        }
      }
      this.game.player.inventory.revision++; this.render(); return;
    }
    if (!this.cursor) {
      if (!slot) return;
      const count = button === 2 ? Math.ceil(slot.count / 2) : slot.count;
      this.cursor = { ...slot, count }; slot.count -= count;
      if (!slot.count) this.setSlot(kind, index, null);
      if (kind === 'container' && this.type === 'furnace' && index === 2) { this.game.player.addXP(Math.max(1, count)); this.game.advancement('smelt'); }
    } else if (this.accepts(kind, index, this.cursor)) {
      const max = kind === 'armor' ? 1 : items[this.cursor.id].stack;
      if (!slot) {
        const count = Math.min(button === 2 ? 1 : this.cursor.count, max);
        this.setSlot(kind, index, { ...this.cursor, count }); this.cursor.count -= count;
      } else if (compatible(slot, this.cursor)) {
        const count = Math.min(button === 2 ? 1 : this.cursor.count, max - slot.count); slot.count += count; this.cursor.count -= count;
      } else if (button === 0) { this.setSlot(kind, index, this.cursor); this.cursor = slot; }
      if (!this.cursor?.count) this.cursor = null;
    }
    this.game.player.inventory.revision++; this.render();
  }
  mouseDown(event) {
    if (!this.opened || ![0, 2].includes(event.button)) return;
    const slot = event.target.closest('[data-slot]');
    if (slot) {
      event.preventDefault();
      const { kind, index } = slot.dataset, wasHolding = !!this.cursor;
      this.slotClick(kind, Number(index), event.button, event.shiftKey);
      if (event.button === 2 && wasHolding) { this.dragging = true; this.dragVisited.add(`${kind}:${index}`); }
    } else if (this.cursor && event.target.classList.contains('inventory-screen')) {
      const count = event.button === 2 ? 1 : this.cursor.count; this.game.dropStack({ ...this.cursor, count }); this.cursor.count -= count;
      if (!this.cursor.count) this.cursor = null; this.updateCursor();
    }
  }
  mouseMove(event) {
    if (!this.opened) return;
    const slot = event.target.closest('[data-slot]'), recipe = event.target.closest('[data-recipe]'); this.hovered = slot ? { kind: slot.dataset.kind, index: Number(slot.dataset.index) } : null;
    let stack = slot ? this.getSlot(slot.dataset.kind, Number(slot.dataset.index)) : recipe ? recipes[Number(recipe.dataset.recipe)]?.output : null;
    if (!stack || this.cursor) { this.tooltip.hidden = true; return; }
    const item = items[stack.id], details = [];
    if (item.damage) details.push(`${item.damage} 攻击伤害`);
    if (item.defense) details.push(`护甲值：${item.defense}`);
    if (item.durability) details.push(`耐久度：${Math.ceil(stack.durability ?? item.durability)} / ${item.durability}`);
    if (item.food) details.push(`恢复 ${item.food} 点饥饿值`);
    if (recipe) details.push('点击填入配方材料');
    this.tooltip.innerHTML = `${esc(item.name)}${details.length ? `<small>${details.map(esc).join('<br>')}</small>` : ''}`;
    this.tooltip.hidden = false;
    const rect = this.tooltip.getBoundingClientRect();
    this.tooltip.style.left = `${Math.min(innerWidth - rect.width - 4, event.clientX + 14)}px`; this.tooltip.style.top = `${clamp(event.clientY - 25, 4, innerHeight - rect.height - 4)}px`;
  }
  key(code) {
    if (!this.opened) return;
    if (/^Digit[1-9]$/.test(code) && this.hovered) {
      const index = Number(code.slice(5)) - 1, { kind, index: target } = this.hovered;
      if (kind === 'catalog') { this.game.player.inventory.slots[index] = makeStack(target, items[target].stack); }
      else if (!['result'].includes(kind)) {
        const current = this.game.player.inventory.slots[index], slot = this.getSlot(kind, target);
        if (!this.accepts(kind, target, current)) return;
        this.setSlot(kind, target, current); this.game.player.inventory.slots[index] = slot;
      }
      this.game.player.inventory.revision++; this.render();
    }
    if (code === 'KeyQ' && this.hovered) {
      const { kind, index } = this.hovered, stack = this.getSlot(kind, index);
      if (!stack || ['result', 'catalog'].includes(kind)) return;
      this.game.dropStack({ ...stack, count: 1 }); if (--stack.count === 0) this.setSlot(kind, index, null);
      this.game.player.inventory.revision++; this.render();
    }
  }
  updateCursor() {
    this.cursorElement.hidden = !this.cursor; this.cursorElement.innerHTML = this.stackHTML(this.cursor);
    this.cursorElement.style.left = `${this.mouse.x}px`; this.cursorElement.style.top = `${this.mouse.y}px`;
  }
  drawAvatar() {
    const canvas = this.root.querySelector('#inventory-avatar'); if (!canvas) return;
    const c = canvas.getContext('2d'); c.imageSmoothingEnabled = false; c.clearRect(0, 0, 50, 70);
    c.fillStyle = '#0c0c0c'; c.fillRect(0, 0, 50, 70);
    const atlas = this.game.atlas.tileCanvases;
    c.drawImage(atlas.get('trousers'), 17, 37, 8, 25); c.drawImage(atlas.get('trousers'), 25, 37, 8, 25);
    c.drawImage(atlas.get('shirt'), 17, 17, 16, 23);
    c.drawImage(atlas.get('skin'), 9, 19, 8, 24); c.drawImage(atlas.get('skin'), 33, 19, 8, 24);
    c.drawImage(atlas.get('shirt'), 9, 18, 8, 8); c.drawImage(atlas.get('shirt'), 33, 18, 8, 8);
    c.drawImage(atlas.get('steve_face'), 16, 2, 18, 18);
    c.fillStyle = '#414141'; c.fillRect(17, 61, 8, 3); c.fillRect(25, 61, 8, 3);
    const p = this.game.player;
    for (let i = 0; i < 4; i++) if (p.armor[i]) {
      const id = p.armor[i].id, color = id >= 368 ? '#55d9cd' : id >= 364 ? '#c2c6c6' : '#9e683f'; c.fillStyle = color;
      if (i === 0) { c.fillRect(15, 1, 20, 5); c.fillRect(15, 6, 3, 12); c.fillRect(32, 6, 3, 12); }
      if (i === 1) { c.fillRect(17, 20, 16, 18); c.fillRect(9, 18, 8, 9); c.fillRect(33, 18, 8, 9); }
      if (i === 2) { c.fillRect(17, 40, 7, 16); c.fillRect(26, 40, 7, 16); }
      if (i === 3) { c.fillRect(17, 55, 8, 9); c.fillRect(25, 55, 8, 9); }
    }
    const stack = p.inventory.slots[p.selected]; if (stack) c.drawImage(this.game.atlas.icon(stack.id), 32, 33, 14, 14);
  }
  updateFurnace() {
    if (this.type !== 'furnace' || !this.container) return;
    const f = this.container;
    this.root.querySelector('.furnace-flame')?.style.setProperty('--burn-crop', `${100 - (f.burnMax ? f.burn / f.burnMax * 100 : 0)}%`);
    this.root.querySelector('.furnace-progress')?.style.setProperty('--cook-crop', `${100 - f.progress * 10}%`);
  }
  tick() {
    if (!this.opened) return;
    const signature = this.container ? JSON.stringify(this.container.slots) : '';
    if (signature !== this.lastContainerSignature || this.lastRevision !== this.game.player.inventory.revision) {
      this.lastContainerSignature = signature;
      // Do not rebuild a search field while the player is typing.
      if (!this.root.contains(document.activeElement) || document.activeElement.tagName !== 'INPUT') this.render();
    }
    this.updateFurnace();
  }
}
