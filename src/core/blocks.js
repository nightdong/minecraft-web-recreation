export const B = Object.freeze({
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, COBBLE: 4, BEDROCK: 5, SAND: 6,
  GRAVEL: 7, WATER: 8, OAK_LOG: 9, OAK_LEAVES: 10, PLANKS: 11,
  BIRCH_LOG: 12, BIRCH_LEAVES: 13, BIRCH_PLANKS: 14, SPRUCE_LOG: 15,
  SPRUCE_LEAVES: 16, SPRUCE_PLANKS: 17, COAL_ORE: 18, IRON_ORE: 19,
  GOLD_ORE: 20, DIAMOND_ORE: 21, REDSTONE_ORE: 22, LAPIS_ORE: 23,
  CRAFTING: 24, FURNACE: 25, FURNACE_ON: 26, CHEST: 27, GLASS: 28,
  TORCH: 29, TALL_GRASS: 30, POPPY: 31, DANDELION: 32, SNOW: 33,
  SNOW_BLOCK: 34, ICE: 35, CACTUS: 36, SUGAR_CANE: 37, FARMLAND: 38,
  WHEAT0: 39, WHEAT1: 40, WHEAT2: 41, WHEAT3: 42, WHEAT4: 43,
  WHEAT5: 44, WHEAT6: 45, WHEAT7: 46, SAPLING: 47, MUSHROOM: 48,
  BRICKS: 49, STONE_BRICKS: 50, WOOL: 51, RED_WOOL: 52, OBSIDIAN: 53,
  LAVA: 54, DOOR: 55, DOOR_TOP: 56, BED: 57, BED_HEAD: 58, BOOKSHELF: 59,
  TNT: 60, GLOWSTONE: 61, OAK_SLAB: 62, STONE_SLAB: 63, OAK_STAIRS: 64,
  FENCE: 65, LADDER: 66, CLAY: 67, MOSSY_COBBLE: 68, PUMPKIN: 69,
  COAL_BLOCK: 70, IRON_BLOCK: 71, GOLD_BLOCK: 72, DIAMOND_BLOCK: 73,
  SANDSTONE: 74, REDSTONE_BLOCK: 75, NETHERRACK: 76, SOUL_SAND: 77, PORTAL: 78, FIRE: 79,
  WIRE: 80, LEVER: 81, STONE_BUTTON: 82, STONE_PLATE: 83, REDSTONE_TORCH: 84,
  REDSTONE_TORCH_OFF: 85, REPEATER: 86, REDSTONE_LAMP: 87, REDSTONE_LAMP_ON: 88,
  PISTON: 89, PISTON_HEAD: 90,
  NETHER_BRICKS: 91, NETHER_FENCE: 92, SPAWNER: 93, END_STONE: 94, END_PORTAL_FRAME: 95,
  END_PORTAL: 96, DRAGON_EGG: 97, IRON_BARS: 98, STONE_STAIRS: 99, NETHER_STAIRS: 100
});
export const blocks = [];
function block(id, name, texture, opts = {}) {
  blocks[id] = { id, name, texture, solid: true, opaque: true, hardness: 1,
    sound: 'stone', stack: 64, shape: 'cube', ...opts };
}
block(B.AIR, '空气', 'stone', { solid: false, opaque: false, hidden: true, hardness: 0 });
block(B.GRASS, '草方块', ['grass_side', 'grass_top', 'dirt'], { hardness: .6, tool: 'shovel', drop: B.DIRT, sound: 'grass' });
block(B.DIRT, '泥土', 'dirt', { hardness: .5, tool: 'shovel', sound: 'gravel' });
block(B.STONE, '石头', 'stone', { hardness: 1.5, tool: 'pickaxe', tier: 1, drop: B.COBBLE });
block(B.COBBLE, '圆石', 'cobblestone', { hardness: 2, tool: 'pickaxe', tier: 1 });
block(B.BEDROCK, '基岩', 'bedrock', { hardness: Infinity, hidden: true });
block(B.SAND, '沙子', 'sand', { hardness: .5, tool: 'shovel', falling: true, sound: 'sand' });
block(B.GRAVEL, '砂砾', 'gravel', { hardness: .6, tool: 'shovel', falling: true, sound: 'gravel' });
block(B.WATER, '水', 'water', { solid: false, opaque: false, liquid: true, hidden: true, hardness: Infinity });
for (const [log, leaf, plank, prefix, name] of [
  [B.OAK_LOG, B.OAK_LEAVES, B.PLANKS, 'oak', '橡'],
  [B.BIRCH_LOG, B.BIRCH_LEAVES, B.BIRCH_PLANKS, 'birch', '白桦'],
  [B.SPRUCE_LOG, B.SPRUCE_LEAVES, B.SPRUCE_PLANKS, 'spruce', '云杉']
]) {
  block(log, `${name}木原木`, [`${prefix}_log`, `${prefix}_end`, `${prefix}_end`], { hardness: 2, tool: 'axe', sound: 'wood', fuel: 15 });
  block(leaf, `${name}树叶`, `${prefix}_leaves`, { hardness: .2, opaque: false, leaves: true, sound: 'grass', noDrop: true });
  block(plank, `${name}木板`, `${prefix}_planks`, { hardness: 2, tool: 'axe', sound: 'wood', fuel: 15 });
}
for (const [id, name, texture, tier, drop] of [
  [B.COAL_ORE, '煤矿石', 'coal_ore', 1, 256], [B.IRON_ORE, '铁矿石', 'iron_ore', 2, B.IRON_ORE],
  [B.GOLD_ORE, '金矿石', 'gold_ore', 3, B.GOLD_ORE], [B.DIAMOND_ORE, '钻石矿石', 'diamond_ore', 3, 259],
  [B.REDSTONE_ORE, '红石矿石', 'redstone_ore', 3, 260], [B.LAPIS_ORE, '青金石矿石', 'lapis_ore', 2, 261]
]) block(id, name, texture, { hardness: 3, tool: 'pickaxe', tier, drop, xp: drop !== id ? 2 : 0 });
block(B.CRAFTING, '工作台', ['crafting_side', 'crafting_top', 'oak_planks'], { hardness: 2.5, tool: 'axe', sound: 'wood', station: 'craft', fuel: 15 });
block(B.FURNACE, '熔炉', ['furnace_side', 'furnace_top', 'furnace_top', 'furnace_front'], { hardness: 3.5, tool: 'pickaxe', tier: 1, station: 'furnace' });
block(B.FURNACE_ON, '熔炉', ['furnace_side', 'furnace_top', 'furnace_top', 'furnace_lit'], { hardness: 3.5, tool: 'pickaxe', tier: 1, station: 'furnace', light: 13, drop: B.FURNACE, hidden: true });
block(B.CHEST, '箱子', ['chest_side', 'chest_top', 'chest_top', 'chest_front'], { hardness: 2.5, tool: 'axe', sound: 'wood', station: 'chest', fuel: 15, opaque: false });
block(B.GLASS, '玻璃', 'glass', { hardness: .3, opaque: false, glass: true, noDrop: true, sound: 'glass' });
block(B.TORCH, '火把', 'torch', { hardness: 0, opaque: false, solid: false, shape: 'torch', light: 14, sound: 'wood' });
block(B.TALL_GRASS, '草', 'tall_grass', { hardness: 0, opaque: false, solid: false, shape: 'cross', noDrop: true, sound: 'grass' });
block(B.POPPY, '虞美人', 'poppy', { hardness: 0, opaque: false, solid: false, shape: 'cross', sound: 'grass' });
block(B.DANDELION, '蒲公英', 'dandelion', { hardness: 0, opaque: false, solid: false, shape: 'cross', sound: 'grass' });
block(B.SNOW, '雪', 'snow', { hardness: .1, opaque: false, shape: 'snow', tool: 'shovel', tier: 1, sound: 'snow', noDrop: true });
block(B.SNOW_BLOCK, '雪块', 'snow', { hardness: .2, tool: 'shovel', sound: 'snow' });
block(B.ICE, '冰', 'ice', { hardness: .5, opaque: false, glass: true, noDrop: true, slippery: true, sound: 'glass' });
block(B.CACTUS, '仙人掌', ['cactus_side', 'cactus_top', 'cactus_top'], { hardness: .4, sound: 'grass', hurts: true });
block(B.SUGAR_CANE, '甘蔗', 'sugar_cane', { hardness: 0, opaque: false, solid: false, shape: 'cross', sound: 'grass' });
block(B.FARMLAND, '耕地', ['dirt', 'farmland', 'dirt'], { hardness: .6, shape: 'farmland', opaque: false, tool: 'shovel', drop: B.DIRT, sound: 'gravel' });
for (let i = 0; i < 8; i++) block(B.WHEAT0 + i, '小麦', `wheat${i}`, { hardness: 0, opaque: false, solid: false, shape: 'crop', sound: 'grass', hidden: true, noDrop: true });
block(B.SAPLING, '橡树树苗', 'sapling', { hardness: 0, opaque: false, solid: false, shape: 'cross', sound: 'grass', fuel: 5 });
block(B.MUSHROOM, '红蘑菇', 'mushroom', { hardness: 0, opaque: false, solid: false, shape: 'cross', sound: 'grass' });
block(B.BRICKS, '红砖块', 'bricks', { hardness: 2, tool: 'pickaxe', tier: 1 });
block(B.STONE_BRICKS, '石砖', 'stone_bricks', { hardness: 1.5, tool: 'pickaxe', tier: 1 });
block(B.WOOL, '白色羊毛', 'wool', { hardness: .8, sound: 'cloth' });
block(B.RED_WOOL, '红色羊毛', 'red_wool', { hardness: .8, sound: 'cloth' });
block(B.OBSIDIAN, '黑曜石', 'obsidian', { hardness: 50, tool: 'pickaxe', tier: 4 });
block(B.LAVA, '熔岩', 'lava', { solid: false, opaque: false, liquid: true, hidden: true, light: 15, hardness: Infinity });
block(B.DOOR, '橡木门', 'door_bottom', { hardness: 3, tool: 'axe', shape: 'door', opaque: false, sound: 'wood', station: 'door', fuel: 10 });
block(B.DOOR_TOP, '橡木门', 'door_top', { hardness: 3, tool: 'axe', shape: 'door', opaque: false, sound: 'wood', station: 'door', drop: B.DOOR, hidden: true });
block(B.BED, '红色床', ['bed_side', 'bed_top', 'oak_planks'], { hardness: .2, shape: 'bed', opaque: false, station: 'bed', sound: 'cloth', stack: 1 });
block(B.BED_HEAD, '红色床', ['bed_side', 'bed_head', 'oak_planks'], { hardness: .2, shape: 'bed', opaque: false, station: 'bed', sound: 'cloth', drop: B.BED, hidden: true });
block(B.BOOKSHELF, '书架', ['bookshelf', 'oak_planks', 'oak_planks'], { hardness: 1.5, tool: 'axe', sound: 'wood', fuel: 15 });
block(B.TNT, 'TNT', ['tnt_side', 'tnt_top', 'tnt_bottom'], { hardness: 0, sound: 'grass' });
block(B.GLOWSTONE, '荧石', 'glowstone', { hardness: .3, light: 15, sound: 'glass' });
block(B.OAK_SLAB, '橡木台阶', 'oak_planks', { hardness: 2, shape: 'slab', opaque: false, tool: 'axe', sound: 'wood', fuel: 7.5 });
block(B.STONE_SLAB, '石台阶', ['stone_slab', 'stone', 'stone'], { hardness: 2, shape: 'slab', opaque: false, tool: 'pickaxe', tier: 1 });
block(B.OAK_STAIRS, '橡木楼梯', 'oak_planks', { hardness: 2, shape: 'stairs', opaque: false, tool: 'axe', sound: 'wood', fuel: 15 });
block(B.FENCE, '橡木栅栏', 'oak_planks', { hardness: 2, shape: 'fence', opaque: false, tool: 'axe', sound: 'wood', fuel: 15 });
block(B.LADDER, '梯子', 'ladder', { hardness: .4, shape: 'ladder', opaque: false, solid: false, tool: 'axe', sound: 'wood', fuel: 15 });
block(B.CLAY, '黏土块', 'clay', { hardness: .6, tool: 'shovel', sound: 'gravel' });
block(B.MOSSY_COBBLE, '苔石', 'mossy_cobblestone', { hardness: 2, tool: 'pickaxe', tier: 1 });
block(B.PUMPKIN, '南瓜', ['pumpkin_side', 'pumpkin_top', 'pumpkin_top', 'pumpkin_face'], { hardness: 1, tool: 'axe', sound: 'wood' });
for (const [id, name, tex] of [[B.COAL_BLOCK, '煤炭块', 'coal_block'], [B.IRON_BLOCK, '铁块', 'iron_block'], [B.GOLD_BLOCK, '金块', 'gold_block'], [B.DIAMOND_BLOCK, '钻石块', 'diamond_block'], [B.REDSTONE_BLOCK, '红石块', 'redstone_block']])
  block(id, name, tex, { hardness: 5, tool: 'pickaxe', tier: 2, fuel: id === B.COAL_BLOCK ? 800 : undefined });
block(B.SANDSTONE, '砂岩', ['sandstone_side', 'sandstone_top', 'sandstone_bottom'], { hardness: .8, tool: 'pickaxe', tier: 1 });
block(B.NETHERRACK, '下界岩', 'netherrack', { hardness: .4, tool: 'pickaxe', tier: 1 });
block(B.SOUL_SAND, '灵魂沙', 'soul_sand', { hardness: .5, tool: 'shovel', sound: 'sand', slow: true });
block(B.PORTAL, '下界传送门', 'portal', { solid: false, opaque: false, shape: 'portal', hardness: Infinity, light: 11, hidden: true });
block(B.FIRE, '火', 'fire', { solid: false, opaque: false, shape: 'fire', hardness: 0, light: 15, hidden: true, noDrop: true });
block(B.WIRE, '红石粉', 'redstone_dust', { solid: false, opaque: false, shape: 'wire', hardness: 0, hidden: true, drop: 260, circuit: 'wire' });
block(B.LEVER, '拉杆', ['cobblestone', 'lever_handle', 'cobblestone'], { solid: false, opaque: false, shape: 'lever', hardness: .5, circuit: 'lever' });
block(B.STONE_BUTTON, '石按钮', 'stone', { solid: false, opaque: false, shape: 'button', hardness: .5, circuit: 'button' });
block(B.STONE_PLATE, '石质压力板', 'stone', { solid: false, opaque: false, shape: 'plate', hardness: .5, circuit: 'plate', tool: 'pickaxe', tier: 1 });
block(B.REDSTONE_TORCH, '红石火把', 'redstone_torch', { solid: false, opaque: false, shape: 'torch', hardness: 0, light: 7, circuit: 'torch' });
block(B.REDSTONE_TORCH_OFF, '红石火把', 'redstone_torch_off', { solid: false, opaque: false, shape: 'torch', hardness: 0, circuit: 'torch', hidden: true, drop: B.REDSTONE_TORCH });
block(B.REPEATER, '红石中继器', ['stone', 'repeater_top', 'stone'], { solid: false, opaque: false, shape: 'repeater', hardness: 0, circuit: 'repeater' });
block(B.REDSTONE_LAMP, '红石灯', 'redstone_lamp', { hardness: .3, sound: 'glass', circuit: 'lamp' });
block(B.REDSTONE_LAMP_ON, '红石灯', 'redstone_lamp_on', { hardness: .3, sound: 'glass', circuit: 'lamp', hidden: true, drop: B.REDSTONE_LAMP, light: 15 });
block(B.PISTON, '活塞', ['piston_side', 'piston_front', 'piston_bottom'], { hardness: 1.5, tool: 'pickaxe', shape: 'piston', opaque: false, circuit: 'piston' });
block(B.PISTON_HEAD, '活塞头', ['piston_side', 'piston_front', 'piston_bottom'], { hardness: 1.5, shape: 'piston_head', opaque: false, hidden: true, noDrop: true });
block(B.NETHER_BRICKS, '下界砖块', 'nether_bricks', { hardness: 2, tool: 'pickaxe', tier: 1 });
block(B.NETHER_FENCE, '下界砖栅栏', 'nether_bricks', { shape: 'fence', hardness: 2, tool: 'pickaxe', tier: 1, opaque: false });
block(B.SPAWNER, '刷怪笼', 'spawner', { hardness: 5, tool: 'pickaxe', tier: 1, opaque: false, noDrop: true, xp: 20 });
block(B.END_STONE, '末地石', 'end_stone', { hardness: 3, tool: 'pickaxe', tier: 1 });
block(B.END_PORTAL_FRAME, '末地传送门框架', ['end_frame_side', 'end_frame_top', 'end_stone'], { shape: 'end_frame', hardness: Infinity, opaque: false, noDrop: true, station: 'end_frame', light: 1 });
block(B.END_PORTAL, '末地传送门', 'end_portal', { shape: 'end_portal', hardness: Infinity, solid: false, opaque: false, noDrop: true, hidden: true, light: 15 });
block(B.DRAGON_EGG, '龙蛋', 'dragon_egg', { shape: 'egg', hardness: 3, opaque: false, falling: true, light: 1 });
block(B.IRON_BARS, '铁栏杆', 'iron_bars', { shape: 'bars', hardness: 5, tool: 'pickaxe', tier: 1, opaque: false });
block(B.STONE_STAIRS, '石砖楼梯', 'stone_bricks', { shape: 'stairs', hardness: 1.5, tool: 'pickaxe', tier: 1, opaque: false });
block(B.NETHER_STAIRS, '下界砖楼梯', 'nether_bricks', { shape: 'stairs', hardness: 2, tool: 'pickaxe', tier: 1, opaque: false });
for (const id of [B.DOOR, B.DOOR_TOP]) blocks[id].circuit = 'door';
blocks[B.TNT].circuit = 'tnt'; blocks[B.REDSTONE_BLOCK].circuit = 'source';
for (const [ids, fireSpread, flammability] of [
  [[B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG], 5, 5],
  [[B.PLANKS, B.BIRCH_PLANKS, B.SPRUCE_PLANKS, B.CRAFTING, B.CHEST, B.BOOKSHELF, B.OAK_SLAB, B.OAK_STAIRS, B.FENCE, B.DOOR, B.DOOR_TOP], 5, 20],
  [[B.OAK_LEAVES, B.BIRCH_LEAVES, B.SPRUCE_LEAVES], 30, 60],
  [[B.WOOL, B.RED_WOOL, B.BED, B.BED_HEAD], 30, 60],
  [[B.TALL_GRASS, B.POPPY, B.DANDELION, B.SAPLING], 60, 100],
  [[B.TNT], 15, 100]
]) for (const id of ids) Object.assign(blocks[id], { fireSpread, flammability });

export const I = { COAL: 256, IRON: 257, GOLD: 258, DIAMOND: 259, REDSTONE: 260, LAPIS: 261,
  STICK: 262, APPLE: 263, PORK: 264, COOKED_PORK: 265, BEEF: 266, STEAK: 267,
  CHICKEN: 268, COOKED_CHICKEN: 269, MUTTON: 270, COOKED_MUTTON: 271,
  WHEAT: 272, SEEDS: 273, BREAD: 274, LEATHER: 275, FEATHER: 276, BONE: 277,
  BONE_MEAL: 278, STRING: 279, GUNPOWDER: 280, ROTTEN_FLESH: 281, FLINT: 282,
  BUCKET: 283, WATER_BUCKET: 284, LAVA_BUCKET: 285, FLINT_STEEL: 286,
  SHEARS: 287, BOW: 288, ARROW: 289, PAPER: 290, BOOK: 291, CHARCOAL: 292,
  BRICK: 293, CLAY_BALL: 294, EGG: 295, COMPASS: 296, CLOCK: 297, RED_DYE: 298,
  ENDER_PEARL: 400, BLAZE_ROD: 401, BLAZE_POWDER: 402, EYE_OF_ENDER: 403, NETHER_BRICK: 404,
  ZOMBIE_EGG: 410, SKELETON_EGG: 411, CREEPER_EGG: 412, SPIDER_EGG: 413
};
// A block's tool/tier describe what is required to harvest it, not what the
// block can do when held. Keep those fields exclusively on actual tools.
export const items = Object.fromEntries(blocks.filter(Boolean).map(({ tool, tier, ...b }) => [b.id, { ...b, block: b.id }]));
function item(id, name, icon, opts = {}) { items[id] = { id, ...opts, name, icon, stack: opts.stack || 64 }; }
for (const [id, name, icon, extra] of [
  [I.COAL, '煤炭', 'coal', { fuel: 80 }], [I.CHARCOAL, '木炭', 'charcoal', { fuel: 80 }],
  [I.IRON, '铁锭', 'iron_ingot'], [I.GOLD, '金锭', 'gold_ingot'], [I.DIAMOND, '钻石', 'diamond'],
  [I.REDSTONE, '红石粉', 'redstone'], [I.LAPIS, '青金石', 'lapis'], [I.STICK, '木棍', 'stick', { fuel: 5 }],
  [I.LEATHER, '皮革', 'leather'], [I.FEATHER, '羽毛', 'feather'], [I.BONE, '骨头', 'bone'],
  [I.BONE_MEAL, '骨粉', 'bone_meal'], [I.STRING, '线', 'string'], [I.GUNPOWDER, '火药', 'gunpowder'],
  [I.FLINT, '燧石', 'flint'], [I.WHEAT, '小麦', 'wheat'], [I.SEEDS, '小麦种子', 'seeds'],
  [I.BUCKET, '铁桶', 'bucket', { stack: 16 }], [I.WATER_BUCKET, '水桶', 'water_bucket', { stack: 1 }],
  [I.LAVA_BUCKET, '熔岩桶', 'lava_bucket', { stack: 1, fuel: 1000 }],
  [I.FLINT_STEEL, '打火石', 'flint_steel', { stack: 1, durability: 64 }],
  [I.SHEARS, '剪刀', 'shears', { stack: 1, durability: 238, tool: 'shears', speed: 15 }],
  [I.BOW, '弓', 'bow', { stack: 1, durability: 384 }], [I.ARROW, '箭', 'arrow'],
  [I.PAPER, '纸', 'paper'], [I.BOOK, '书', 'book'], [I.BRICK, '红砖', 'brick'],
  [I.CLAY_BALL, '黏土球', 'clay_ball'], [I.EGG, '鸡蛋', 'egg', { stack: 16 }],
  [I.COMPASS, '指南针', 'compass', { stack: 1 }], [I.CLOCK, '时钟', 'clock', { stack: 1 }],
  [I.RED_DYE, '红色染料', 'red_dye'],
  [I.ENDER_PEARL, '末影珍珠', 'ender_pearl', { stack: 16 }], [I.BLAZE_ROD, '烈焰棒', 'blaze_rod', { fuel: 120 }],
  [I.BLAZE_POWDER, '烈焰粉', 'blaze_powder'], [I.EYE_OF_ENDER, '末影之眼', 'eye_of_ender'], [I.NETHER_BRICK, '下界砖', 'nether_brick']
]) item(id, name, icon, extra || {});
for (const [id, name, type] of [[I.ZOMBIE_EGG, '覆苔游尸生成卵', 'zombie'], [I.SKELETON_EGG, '灰骨弓手生成卵', 'skeleton'], [I.CREEPER_EGG, '苔壳爆灵生成卵', 'creeper'], [I.SPIDER_EGG, '暮色织蛛生成卵', 'spider']]) item(id, name, `${type}_egg`, { spawnMob: type });
for (const [id, name, icon, food, saturation] of [
  [I.APPLE, '苹果', 'apple', 4, 2.4], [I.PORK, '生猪排', 'pork', 3, 1.8],
  [I.COOKED_PORK, '熟猪排', 'cooked_pork', 8, 12.8], [I.BEEF, '生牛肉', 'beef', 3, 1.8],
  [I.STEAK, '牛排', 'steak', 8, 12.8], [I.CHICKEN, '生鸡肉', 'chicken', 2, 1.2],
  [I.COOKED_CHICKEN, '熟鸡肉', 'cooked_chicken', 6, 7.2], [I.MUTTON, '生羊肉', 'mutton', 2, 1.2],
  [I.COOKED_MUTTON, '熟羊肉', 'cooked_mutton', 6, 9.6], [I.BREAD, '面包', 'bread', 5, 6],
  [I.ROTTEN_FLESH, '腐肉', 'rotten_flesh', 4, .8]
]) item(id, name, icon, { food, saturation });
export const tiers = [
  { key: 'wood', name: '木', durability: 59, speed: 2, tier: 1, material: B.PLANKS },
  { key: 'stone', name: '石', durability: 131, speed: 4, tier: 2, material: B.COBBLE },
  { key: 'iron', name: '铁', durability: 250, speed: 6, tier: 3, material: I.IRON },
  { key: 'diamond', name: '钻石', durability: 1561, speed: 8, tier: 4, material: I.DIAMOND },
  { key: 'gold', name: '金', durability: 32, speed: 12, tier: 1, material: I.GOLD }
];
export const toolKinds = [['pickaxe', '镐', 2], ['axe', '斧', 5], ['shovel', '锹', 1], ['sword', '剑', 4], ['hoe', '锄', 0]];
for (let t = 0; t < tiers.length; t++) for (let k = 0; k < toolKinds.length; k++) {
  const id = 320 + t * 5 + k, tier = tiers[t], [kind, name, damage] = toolKinds[k];
  I[`${tier.key.toUpperCase()}_${kind.toUpperCase()}`] = id;
  item(id, `${tier.name}${name}`, `${tier.key}_${kind}`, { ...tier, stack: 1, tool: kind, damage: damage + (t === 4 ? 0 : t) + 1 });
}
export const armorSets = [['leather', '皮革', I.LEATHER, [1, 3, 2, 1], 80], ['iron', '铁', I.IRON, [2, 6, 5, 2], 240], ['diamond', '钻石', I.DIAMOND, [3, 8, 6, 3], 500]];
for (let s = 0; s < armorSets.length; s++) for (let p = 0; p < 4; p++) {
  const [key, name, material, defense, durability] = armorSets[s], kind = ['helmet', 'chestplate', 'leggings', 'boots'][p], id = 360 + s * 4 + p;
  item(id, `${name}${['头盔', '胸甲', '护腿', '靴子'][p]}`, `${key}_${kind}`, { stack: 1, armor: p, defense: defense[p], durability, material });
}
export function textureFor(id, face, state = 0) {
  if (id === B.END_PORTAL_FRAME && face === 2 && state & 4) return 'end_frame_eye';
  if (id === B.FARMLAND && face === 2 && (state & 7)) return 'farmland_wet';
  if (id === B.PISTON || id === B.PISTON_HEAD) {
    const front = [5, 0, 4, 1, 2, 3][state & 7] ?? 2;
    return face === front ? 'piston_front' : face === (front ^ 1) ? 'piston_bottom' : 'piston_side';
  }
  const t = blocks[id]?.texture || 'stone'; if (typeof t === 'string') return t;
  if ([B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG].includes(id)) {
    const axis = state & 4 ? 0 : state & 8 ? 2 : 1;
    return Math.floor(face / 2) === axis ? t[1] : t[0];
  }
  if (face === 2) return t[1]; if (face === 3) return t[2];
  if (t[3] && face === [5, 0, 4, 1][state & 3]) return t[3]; return t[0];
}
export function isSolid(id) { return !!blocks[id]?.solid; }
export function isOpaque(id) { return !!blocks[id]?.opaque; }
export function boxFor(id, state = 0) {
  const shape = blocks[id]?.shape; if (!blocks[id]?.solid) return null;
  if (shape === 'slab') return state & 8 ? [0, 0, 0, 1, 1, 1] : state & 4 ? [0, .5, 0, 1, 1, 1] : [0, 0, 0, 1, .5, 1];
  if (id === B.CHEST) {
    const box = [.0625, 0, .0625, .9375, .875, .9375], axis = state & 1 ? 2 : 0;
    if (state & 4) box[axis + 3] = 1; else if (state & 8) box[axis] = 0;
    return box;
  }
  if (shape === 'snow') return [0, 0, 0, 1, .125, 1];
  if (shape === 'bed') return [0, 0, 0, 1, .5625, 1];
  if (shape === 'farmland') return [0, 0, 0, 1, .9375, 1];
  if (shape === 'end_frame') return [0, 0, 0, 1, .8125, 1];
  if (shape === 'egg') return [.125, 0, .125, .875, 1, .875];
  if (shape === 'fence') return [.25, 0, .25, .75, 1.5, .75];
  if (shape === 'door') {
    const orientation = ((state & 3) + ((state & 4) ? 1 : 0)) & 3;
    return [[0, 0, 0, 1, 1, .1875], [.8125, 0, 0, 1, 1, 1], [0, 0, .8125, 1, 1, 1], [0, 0, 0, .1875, 1, 1]][orientation];
  }
  return [0, 0, 0, 1, 1, 1];
}
/** Immutable shared sub-boxes keep targeting, routing and physical collision
 * in agreement without allocating a fresh hierarchy at every AI node. */
const collisionCache = new Map(), EMPTY_SHAPES = Object.freeze([]);
export function collisionShapes(id, state = 0) {
  if (!blocks[id]?.solid) return EMPTY_SHAPES;
  const key = id * 256 + (state & 255);
  let shapes = collisionCache.get(key);
  if (!shapes) {
    shapes = Object.freeze(buildCollisionShapes(id, state).map(box => Object.freeze(box)));
    collisionCache.set(key, shapes);
  }
  return shapes;
}
function buildCollisionShapes(id, state = 0) {
  if (id === B.PISTON_HEAD) return [[0, 0, .75, 1, 1, 1], [.375, .375, 0, .625, .625, .75]].map(box => orientBox(box, state & 7));
  if (id === B.PISTON && state & 8) return [orientBox([0, 0, 0, 1, 1, .75], state & 7)];
  if (blocks[id]?.shape === 'stairs') {
    const boxes = [[0, 0, 0, 1, .5, 1], [[0, .5, .5, 1, 1, 1], [0, .5, 0, .5, 1, 1], [0, .5, 0, 1, 1, .5], [.5, .5, 0, 1, 1, 1]][state & 3]];
    return state & 4 ? boxes.map(b => [b[0], 1 - b[4], b[2], b[3], 1 - b[1], b[5]]) : boxes;
  }
  if (id === B.CACTUS) return [[.0625, 0, .0625, .9375, 1, .9375]];
  if (id === B.END_PORTAL_FRAME && state & 4) return [[0, 0, 0, 1, .8125, 1], [.3125, .8125, .3125, .6875, 1, .6875]];
  if (id === B.IRON_BARS) return [[.4375, 0, 0, .5625, 1, 1], [0, 0, .4375, 1, 1, .5625]];
  const box = boxFor(id, state); return box ? [box] : [];
}
export function selectionShapes(id, state = 0) {
  const solid = collisionShapes(id, state); if (solid.length) return solid;
  const shape = blocks[id]?.shape;
  if (shape === 'wire') return [[0, 0, 0, 1, .0625, 1]];
  if (shape === 'plate') return [[.0625, 0, .0625, .9375, state & 8 ? .03125 : .0625, .9375]];
  if (shape === 'repeater') return [[0, 0, 0, 1, .125, 1]];
  if (shape === 'button') return [mountBox([.3125, 0, .375, .6875, state & 8 ? .0625 : .125, .625], state & 7)];
  if (shape === 'lever') return [mountBox([.25, 0, .25, .75, .65, .75], state & 7)];
  if (shape === 'torch') {
    const dx = state === 1 ? -1 : state === 2 ? 1 : 0, dz = state === 3 ? -1 : state === 4 ? 1 : 0;
    return [[.4 + Math.min(dx * .38, dx * .22), state ? .18 : 0, .4 + Math.min(dz * .38, dz * .22), .6 + Math.max(dx * .38, dx * .22), state ? .88 : .7, .6 + Math.max(dz * .38, dz * .22)]];
  }
  if (shape === 'ladder') return [[ [0, 0, .94, 1, 1, 1], [0, 0, 0, .06, 1, 1], [0, 0, 0, 1, 1, .06], [.94, 0, 0, 1, 1, 1] ][state & 3]];
  if (shape === 'cross' || shape === 'crop') return [[.1, 0, .1, .9, .9, .9]];
  return [[0, 0, 0, 1, 1, 1]];
}
export const PISTON_DIRECTIONS = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
export function orientPoint([x, y, z], direction = 2) {
  return [[1 - x, y, 1 - z], [z, y, 1 - x], [x, y, z], [1 - z, y, x], [x, z, 1 - y], [x, 1 - z, y]][direction] || [x, y, z];
}
export function mountPoint([x, y, z], mount = 0) {
  return [[x, y, z], [y, 1 - x, z], [1 - y, x, z], [x, 1 - z, y], [x, z, 1 - y], [x, 1 - y, 1 - z]][mount] || [x, y, z];
}
const transformedBox = (box, transform) => {
  const a = transform(box.slice(0, 3)), b = transform(box.slice(3));
  return [...a.map((v, i) => Math.min(v, b[i])), ...a.map((v, i) => Math.max(v, b[i]))];
};
export const orientBox = (box, direction) => transformedBox(box, point => orientPoint(point, direction));
export const mountBox = (box, mount) => transformedBox(box, point => mountPoint(point, mount));
export const SMELTING = {
  [B.NETHERRACK]: I.NETHER_BRICK,
  [B.IRON_ORE]: I.IRON, [B.GOLD_ORE]: I.GOLD, [B.SAND]: B.GLASS, [B.COBBLE]: B.STONE,
  [B.OAK_LOG]: I.CHARCOAL, [B.BIRCH_LOG]: I.CHARCOAL, [B.SPRUCE_LOG]: I.CHARCOAL,
  [I.PORK]: I.COOKED_PORK, [I.BEEF]: I.STEAK, [I.CHICKEN]: I.COOKED_CHICKEN,
  [I.MUTTON]: I.COOKED_MUTTON, [I.CLAY_BALL]: I.BRICK
};
