import { B, I, items, tiers, armorSets } from './blocks.js';
export const cloneStack = stack => stack ? { ...stack } : null;
export function makeStack(id, count = 1) {
  const item = items[id]; if (!item || id === B.AIR) return null;
  return { id, count, ...(item.durability ? { durability: item.durability } : {}) };
}
export const compatible = (a, b) => a && b && a.id === b.id && a.durability === b.durability;
export class Inventory {
  constructor(size = 36, saved) {
    this.slots = Array.from({ length: size }, (_, i) => cloneStack(saved?.[i])); this.revision = 0;
  }
  add(stack) {
    if (!stack || !items[stack.id]) return null;
    const left = cloneStack(stack), max = items[left.id].stack || 64;
    for (const slot of this.slots) {
      if (!compatible(slot, left) || slot.count >= max) continue;
      const n = Math.min(max - slot.count, left.count); slot.count += n; left.count -= n;
      if (!left.count) { this.revision++; return null; }
    }
    for (let i = 0; i < this.slots.length; i++) if (!this.slots[i]) {
      const n = Math.min(max, left.count); this.slots[i] = { ...left, count: n }; left.count -= n;
      if (!left.count) { this.revision++; return null; }
    }
    this.revision++; return left;
  }
  count(id) { return this.slots.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0); }
  remove(id, count = 1) {
    if (this.count(id) < count) return false;
    for (let i = 0; i < this.slots.length && count; i++) {
      const s = this.slots[i]; if (s?.id !== id) continue;
      const n = Math.min(s.count, count); s.count -= n; count -= n; if (!s.count) this.slots[i] = null;
    }
    this.revision++; return true;
  }
  consume(index, amount = 1) {
    const s = this.slots[index]; if (!s || s.count < amount) return false;
    s.count -= amount; if (!s.count) this.slots[index] = null; this.revision++; return true;
  }
  damage(index, amount = 1) {
    const s = this.slots[index]; if (!s || !items[s.id]?.durability) return false;
    s.durability = (s.durability ?? items[s.id].durability) - amount;
    if (s.durability <= 0) this.slots[index] = null;
    this.revision++; return !this.slots[index];
  }
  toJSON() { return this.slots.map(cloneStack); }
}
export const recipes = [];
const wood = [B.PLANKS, B.BIRCH_PLANKS, B.SPRUCE_PLANKS], coal = [I.COAL, I.CHARCOAL];
function recipe(name, shape, keys, output, count = 1) {
  recipes.push({ name, shape, keys, output: makeStack(output, count), width: shape[0].length, height: shape.length });
}
function shapeless(name, ingredients, output, count = 1) {
  recipes.push({ name, ingredients, output: makeStack(output, count), width: 1, height: 1, shapeless: true });
}
shapeless('橡木板', [B.OAK_LOG], B.PLANKS, 4);
shapeless('白桦木板', [B.BIRCH_LOG], B.BIRCH_PLANKS, 4);
shapeless('云杉木板', [B.SPRUCE_LOG], B.SPRUCE_PLANKS, 4);
recipe('木棍', ['P', 'P'], { P: wood }, I.STICK, 4);
recipe('工作台', ['PP', 'PP'], { P: wood }, B.CRAFTING);
recipe('火把', ['C', 'S'], { C: coal, S: I.STICK }, B.TORCH, 4);
recipe('熔炉', ['CCC', 'C C', 'CCC'], { C: B.COBBLE }, B.FURNACE);
recipe('箱子', ['PPP', 'P P', 'PPP'], { P: wood }, B.CHEST);
for (let t = 0; t < tiers.length; t++) {
  const tier = tiers[t], m = t === 0 ? wood : tier.material;
  for (const [k, pattern] of [[0, ['MMM', ' S ', ' S ']], [1, ['MM', 'MS', ' S']], [2, ['M', 'S', 'S']], [3, ['M', 'M', 'S']], [4, ['MM', ' S', ' S']]]) {
    const id = 320 + t * 5 + k; recipe(items[id].name, pattern, { M: m, S: I.STICK }, id);
  }
}
recipe('面包', ['WWW'], { W: I.WHEAT }, I.BREAD);
recipe('红色床', ['WWW', 'PPP'], { W: [B.WOOL, B.RED_WOOL], P: wood }, B.BED);
recipe('橡木门', ['PP', 'PP', 'PP'], { P: wood }, B.DOOR, 3);
recipe('橡木台阶', ['PPP'], { P: wood }, B.OAK_SLAB, 6);
recipe('石台阶', ['SSS'], { S: B.STONE }, B.STONE_SLAB, 6);
recipe('橡木楼梯', ['P  ', 'PP ', 'PPP'], { P: wood }, B.OAK_STAIRS, 4);
recipe('橡木栅栏', ['PSP', 'PSP'], { P: wood, S: I.STICK }, B.FENCE, 3);
recipe('梯子', ['S S', 'SSS', 'S S'], { S: I.STICK }, B.LADDER, 3);
recipe('铁桶', ['I I', ' I '], { I: I.IRON }, I.BUCKET);
recipe('剪刀', [' I', 'I '], { I: I.IRON }, I.SHEARS);
shapeless('打火石', [I.IRON, I.FLINT], I.FLINT_STEEL);
recipe('弓', [' ST', 'S T', ' ST'], { S: I.STICK, T: I.STRING }, I.BOW);
recipe('箭', ['F', 'S', 'E'], { F: I.FLINT, S: I.STICK, E: I.FEATHER }, I.ARROW, 4);
recipe('纸', ['CCC'], { C: B.SUGAR_CANE }, I.PAPER, 3);
shapeless('书', [I.PAPER, I.PAPER, I.PAPER, I.LEATHER], I.BOOK);
recipe('书架', ['PPP', 'BBB', 'PPP'], { P: wood, B: I.BOOK }, B.BOOKSHELF);
recipe('红砖块', ['BB', 'BB'], { B: I.BRICK }, B.BRICKS);
recipe('石砖', ['SS', 'SS'], { S: B.STONE }, B.STONE_BRICKS, 4);
recipe('砂岩', ['SS', 'SS'], { S: B.SAND }, B.SANDSTONE);
recipe('羊毛', ['SS', 'SS'], { S: I.STRING }, B.WOOL);
recipe('TNT', ['GSG', 'SGS', 'GSG'], { G: I.GUNPOWDER, S: B.SAND }, B.TNT);
shapeless('骨粉', [I.BONE], I.BONE_MEAL, 3);
shapeless('红色染料', [B.POPPY], I.RED_DYE);
shapeless('红色羊毛', [B.WOOL, I.RED_DYE], B.RED_WOOL);
for (const [mat, output] of [[I.COAL, B.COAL_BLOCK], [I.IRON, B.IRON_BLOCK], [I.GOLD, B.GOLD_BLOCK], [I.DIAMOND, B.DIAMOND_BLOCK], [I.REDSTONE, B.REDSTONE_BLOCK]]) {
  recipe(items[output].name, ['MMM', 'MMM', 'MMM'], { M: mat }, output); shapeless(items[mat].name, [output], mat, 9);
}
for (let s = 0; s < armorSets.length; s++) for (const [p, pattern] of [[0, ['MMM', 'M M']], [1, ['M M', 'MMM', 'MMM']], [2, ['MMM', 'M M', 'M M']], [3, ['M M', 'M M']]]) {
  const id = 360 + s * 4 + p; recipe(items[id].name, pattern, { M: armorSets[s][2] }, id);
}
recipe('指南针', [' I ', 'IRI', ' I '], { I: I.IRON, R: I.REDSTONE }, I.COMPASS);
recipe('时钟', [' G ', 'GRG', ' G '], { G: I.GOLD, R: I.REDSTONE }, I.CLOCK);
recipe('拉杆', ['S', 'C'], { S: I.STICK, C: B.COBBLE }, B.LEVER);
shapeless('石按钮', [B.STONE], B.STONE_BUTTON);
recipe('石质压力板', ['SS'], { S: B.STONE }, B.STONE_PLATE);
recipe('红石火把', ['R', 'S'], { R: I.REDSTONE, S: I.STICK }, B.REDSTONE_TORCH);
recipe('红石中继器', ['TRT', 'SSS'], { T: B.REDSTONE_TORCH, R: I.REDSTONE, S: B.STONE }, B.REPEATER);
recipe('红石灯', [' R ', 'RGR', ' R '], { R: I.REDSTONE, G: B.GLOWSTONE }, B.REDSTONE_LAMP);
recipe('活塞', ['PPP', 'CIC', 'CRC'], { P: wood, C: B.COBBLE, I: I.IRON, R: I.REDSTONE }, B.PISTON);
shapeless('烈焰粉', [I.BLAZE_ROD], I.BLAZE_POWDER, 2);
shapeless('末影之眼', [I.ENDER_PEARL, I.BLAZE_POWDER], I.EYE_OF_ENDER);
recipe('下界砖块', ['NN', 'NN'], { N: I.NETHER_BRICK }, B.NETHER_BRICKS);
recipe('下界砖栅栏', ['BNB', 'BNB'], { B: B.NETHER_BRICKS, N: I.NETHER_BRICK }, B.NETHER_FENCE, 6);
recipe('铁栏杆', ['III', 'III'], { I: I.IRON }, B.IRON_BARS, 16);
recipe('石砖楼梯', ['S  ', 'SS ', 'SSS'], { S: B.STONE_BRICKS }, B.STONE_STAIRS, 4);
recipe('下界砖楼梯', ['N  ', 'NN ', 'NNN'], { N: B.NETHER_BRICKS }, B.NETHER_STAIRS, 4);
const matches = (id, ingredient) => Array.isArray(ingredient) ? ingredient.includes(id) : id === ingredient;
export function findRecipe(grid, size) {
  for (const r of recipes) {
    if (r.shapeless) {
      const occupied = grid.map((s, i) => s ? i : -1).filter(i => i >= 0);
      if (occupied.length !== r.ingredients.length) continue;
      const remaining = occupied.slice(); let ok = true;
      for (const ing of r.ingredients) {
        const k = remaining.findIndex(i => matches(grid[i].id, ing));
        if (k < 0) { ok = false; break; } remaining.splice(k, 1);
      }
      if (ok) return { recipe: r, used: occupied }; continue;
    }
    if (r.width > size || r.height > size) continue;
    for (let oy = 0; oy <= size - r.height; oy++) for (let ox = 0; ox <= size - r.width; ox++) for (const mirror of [false, true]) {
      let ok = true; const used = [];
      for (let y = 0; y < size && ok; y++) for (let x = 0; x < size; x++) {
        let ing;
        if (x >= ox && x < ox + r.width && y >= oy && y < oy + r.height) {
          const rx = mirror ? r.width - 1 - (x - ox) : x - ox; ing = r.keys[r.shape[y - oy][rx]];
        }
        const slot = grid[y * size + x];
        if (ing ? !slot || !matches(slot.id, ing) : !!slot) { ok = false; break; }
        if (ing) used.push(y * size + x);
      }
      if (ok) return { recipe: r, used };
    }
  }
  return null;
}
export function takeRecipe(grid, match) {
  if (!match || match.used.some(i => !grid[i]?.count)) return null;
  for (const i of match.used) if (--grid[i].count === 0) grid[i] = null;
  return cloneStack(match.recipe.output);
}
export function recipeIngredients(recipe) {
  if (recipe.shapeless) return recipe.ingredients;
  return recipe.shape.join('').split('').filter(c => c !== ' ').map(c => recipe.keys[c]);
}
export function canCraft(recipe, inventory) {
  const available = new Map();
  for (const s of inventory.slots) if (s) available.set(s.id, (available.get(s.id) || 0) + s.count);
  for (const ing of recipeIngredients(recipe)) {
    const id = (Array.isArray(ing) ? ing : [ing]).find(n => available.get(n) > 0);
    if (id === undefined) return false; available.set(id, available.get(id) - 1);
  }
  return true;
}
