import { blocks, items } from '../core/blocks.js';

export { SaveStore } from './save-store.js';
export const defaultSettings = { fov: 70, renderDistance: 6, sensitivity: .5, volume: .65, music: false,
  bobbing: true, smoothLighting: true, clouds: true, weather: true, brightness: .5, guiScale: 3, invertMouse: false, fullscreen: false,
  quality: 'balanced', pixelScale: 1, particleLimit: 512, richWater: true };
export const qualityPresets = {
  fast: { quality: 'fast', renderDistance: 4, pixelScale: .75, particleLimit: 192, clouds: false, weather: false, smoothLighting: true, richWater: false },
  balanced: { quality: 'balanced', renderDistance: 6, pixelScale: 1, particleLimit: 512, clouds: true, weather: true, smoothLighting: true, richWater: true },
  high: { quality: 'high', renderDistance: 8, pixelScale: 1.25, particleLimit: 768, clouds: true, weather: true, smoothLighting: true, richWater: true }
};
export function sanitizeSettings(value) {
  const settings = { ...defaultSettings }; if (!value || typeof value !== 'object') return settings;
  const ranges = { fov: [30, 110], renderDistance: [3, 12], sensitivity: [.05, 1.5], volume: [0, 1], brightness: [0, 1], guiScale: [1, 4], pixelScale: [.5,1.5], particleLimit: [64,768] };
  for (const [key, [min, max]] of Object.entries(ranges)) if (typeof value[key] === 'number' && Number.isFinite(value[key])) {
    const n = Math.max(min, Math.min(max, value[key])); settings[key] = ['renderDistance', 'guiScale'].includes(key) ? Math.round(n) : n;
  }
  for (const [key, defaultValue] of Object.entries(defaultSettings)) if (typeof defaultValue === 'boolean' && typeof value[key] === 'boolean') settings[key] = value[key];
  if(Object.hasOwn(qualityPresets,value.quality))settings.quality=value.quality;
  return settings;
}
export function loadSettings() { try { return sanitizeSettings(JSON.parse(localStorage.getItem('voxel-settings') || '{}')); } catch { return { ...defaultSettings }; } }
export function saveSettings(settings) { try { localStorage.setItem('voxel-settings', JSON.stringify(settings)); } catch { /* gameplay remains usable with restricted storage */ } }
export function validateSave(data) {
  const fail = text => { throw new Error(`存档数据无效：${text}。`); };
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  const integer = (value, min, max) => Number.isInteger(value) && number(value, min, max);
  const vector = value => object(value) && ['x', 'y', 'z'].every(axis => number(value[axis], -30000000, 30000000));
  const stack = (value, label) => {
    if (value === null) return;
    const item = items[value?.id];
    if (!object(value) || !Number.isInteger(value.id) || !value.id || !item || !integer(value.count, 1, item.stack)) fail(`${label}的物品或数量`);
    if (value.durability !== undefined && (!item.durability || !number(value.durability, 1, item.durability))) fail(`${label}的耐久度`);
  };
  const slots = (value, length, label) => {
    if (!Array.isArray(value) || value.length !== length) fail(`${label}的栏位`);
    value.forEach(item => stack(item, label));
  };
  const pairs = (value, maximum, label) => {
    if (!Array.isArray(value) || value.length > maximum || value.some(entry => !Array.isArray(entry) || entry.length !== 2)) fail(label);
  };
  const key = (value, dimensions) => {
    if (typeof value !== 'string') return false;
    const parts = value.split(',');
    return parts.length === dimensions && parts.every(n => /^-?\d+$/.test(n) && number(Number(n), -30000000, 30000000)) && (dimensions !== 3 || integer(Number(parts[1]), 0, 127));
  };
  if (!object(data) || data.format !== 1 || !object(data.player) || !object(data.worlds) || typeof data.name !== 'string' || data.name.length > 128) fail('世界格式');
  const dimension = data.dimension || 'overworld';
  if (!['overworld', 'nether', 'end'].includes(dimension) || !Object.hasOwn(data.worlds, dimension)) fail('当前维度');
  if (data.seed !== undefined && !(typeof data.seed === 'string' && data.seed.length <= 128 || number(data.seed, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))) fail('世界种子');
  const player = data.player;
  if (!vector(player.pos) || !vector(player.spawnPoint) || player.bedSpawn != null && !vector(player.bedSpawn)) fail('玩家位置');
  if (!['survival', 'creative'].includes(player.mode) || !number(player.yaw, -1e9, 1e9) || !number(player.pitch, -Math.PI / 2, Math.PI / 2)) fail('玩家模式或朝向');
  if (!integer(player.selected, 0, 8) || !number(player.health, 0, 20) || !number(player.hunger, 0, 20) || !number(player.saturation, 0, 20) || !number(player.air, -20, 300)) fail('玩家生存状态');
  for (const field of ['xp', 'level', 'score', 'exhaustion']) if (!number(player[field] ?? 0, 0, 1e9)) fail(`玩家${field}`);
  for (const field of ['pearlCooldown', 'eyeCooldown']) if (player[field] !== undefined && !integer(player[field], 0, 20)) fail('物品使用冷却');
  if (player.velocity !== undefined && (!object(player.velocity) || ['x', 'y', 'z'].some(axis => !number(player.velocity[axis], -16, 16)))) fail('玩家速度');
  for (const field of ['flying', 'sneaking', 'onGround']) if (player[field] !== undefined && typeof player[field] !== 'boolean') fail('玩家移动状态');
  const motionRanges = { eyeHeight: [1.26, 1.63], fallDistance: [0, 30000000], hurtTime: [0, .5], burnTime: [-.1, 15], regenTicks: [0, 80], hazardTicks: [0, Number.MAX_SAFE_INTEGER], jumpCooldown: [0, 10] };
  for (const [field, [min, max]] of Object.entries(motionRanges)) if (player[field] !== undefined && !number(player[field], min, max)) fail(`玩家${field}`);
  slots(player.inventory, 36, '物品栏'); slots(player.armor, 4, '护甲栏'); stack(player.offhand ?? null, '副手');
  player.armor.forEach((value, index) => { if (value && items[value.id].armor !== index) fail('护甲位置'); });
  let totalEdits = 0;
  for (const [name, world] of Object.entries(data.worlds)) {
    if (!['overworld', 'nether', 'end'].includes(name) || !object(world)) fail('世界维度');
    if (world.generationVersion !== undefined && ![1, 2].includes(world.generationVersion)) fail('地形生成版本');
    if (world.endFight !== undefined) {
      const fight = world.endFight;
      if (name !== 'end' || !object(fight) || !number(fight.health, 0, 200) || !vector(fight.pos) || !number(fight.yaw, -1e9, 1e9) || !number(fight.angle, -1e9, 1e9)) fail('末影龙状态');
      if (!Array.isArray(fight.crystals) || fight.crystals.length !== 10 || fight.crystals.some(value => typeof value !== 'boolean')) fail('末地水晶');
      if (fight.landingY !== undefined && !number(fight.landingY, 2, 160)) fail('末影龙降落高度');
      if (fight.healing !== undefined && !integer(fight.healing, -1, 9)) fail('水晶治疗连接');
      if (!['circle', 'approach', 'perch', 'takeoff', 'dying', 'defeated'].includes(fight.phase)) fail('末影龙阶段');
      for (const field of ['ticks', 'phaseTicks', 'deathTicks', 'hurt']) if (!number(fight[field], 0, Number.MAX_SAFE_INTEGER)) fail('末影龙计时');
      for (const field of ['defeated', 'rewarded']) if (typeof fight[field] !== 'boolean') fail('末影龙胜利状态');
      if (!Array.isArray(fight.clouds) || fight.clouds.length > 12 || fight.clouds.some(cloud => !object(cloud) || !vector(cloud.pos) || !integer(cloud.life, 1, 160) || !integer(cloud.age, 0, 160))) fail('龙息范围');
    }
    if (!number(world.time ?? 1000, 0, 24000) || !number(world.totalTicks ?? 0, 0, Number.MAX_SAFE_INTEGER)) fail('世界时间');
    pairs(world.edits, 50000, '世界区块');
    for (const [position, edits] of world.edits) {
      if (!key(position, 2)) fail('区块坐标'); pairs(edits, 32768, '区块修改');
      totalEdits += edits.length; if (totalEdits > 2000000) fail('过多方块修改');
      for (const [index, value] of edits) if (!integer(index, 0, 32767) || !Array.isArray(value) || !integer(value[0], 0, blocks.length - 1) || !blocks[value[0]] || !integer(value[1] ?? 0, 0, 255)) fail('方块编号或朝向');
    }
    pairs(world.containers || [], 50000, '容器');
    for (const [position, container] of world.containers || []) {
      if (!key(position, 3) || !object(container) || !['chest', 'furnace'].includes(container.type)) fail('容器位置或类型');
      slots(container.slots, container.type === 'chest' ? 27 : 3, '容器');
      for (const field of ['burn', 'burnMax', 'progress']) if (!number(container[field] ?? 0, 0, 1e6)) fail('烧炼状态');
    }
    pairs(world.growing || [], 100000, '作物');
    for (const [position, age] of world.growing || []) if (!key(position, 3) || !number(age, 0, 1e9)) fail('作物生长状态');
    if (world.pendingUpdates !== undefined && (!Array.isArray(world.pendingUpdates) || world.pendingUpdates.length > 100000 || world.pendingUpdates.some(p => !Array.isArray(p) || p.length !== 3 || !key(p.join(','), 3)))) fail('待处理方块更新');
    if (world.leafQueue !== undefined && (!Array.isArray(world.leafQueue) || world.leafQueue.length > 100000 || world.leafQueue.some(p => !object(p) || !key(`${p.x},${p.y},${p.z}`, 3) || !number(p.wait, -1e9, 1e9)))) fail('树叶衰减队列');
    if (world.redstone !== undefined) {
      if (!object(world.redstone)) fail('红石状态'); pairs(world.redstone.pending || [], 100000, '红石更新');
      for (const [position, update] of world.redstone.pending || []) if (!key(position, 3) || !object(update) || !['repeater', 'torch', 'button', 'plate', 'lamp'].includes(update.kind) || !integer(update.due, 0, Number.MAX_SAFE_INTEGER) || typeof update.target !== 'boolean') fail('红石延时事件');
    }
    if (world.fluids !== undefined) {
      if (!object(world.fluids)) fail('流体调度'); pairs(world.fluids.pending || [], 100000, '流体更新');
      for (const [position, update] of world.fluids.pending || []) {
        if (!key(position, 3) || !object(update) || ![8, 54].includes(update.id)) fail('流体位置或类型');
        if (update.due === null ? !integer(update.remaining, 0, 30) : !integer(update.due, 0, Number.MAX_SAFE_INTEGER)) fail('流体更新延时');
      }
    }
  }
  const mobTypes = new Set(['pig', 'cow', 'sheep', 'chicken', 'zombie', 'skeleton', 'creeper', 'spider', 'blaze', 'enderman', 'silverfish']);
  for (const [name, entities] of Object.entries(data.entities || {})) {
    if (!['overworld', 'nether', 'end'].includes(name) || !object(entities)) fail('实体维度');
    for (const type of ['mobs', 'drops', 'falling', 'tnt', 'projectiles', 'orbs']) if (entities[type] !== undefined && (!Array.isArray(entities[type]) || entities[type].length > 10000)) fail('实体列表');
    for (const mob of entities.mobs || []) if (!object(mob) || !mobTypes.has(mob.type) || !vector(mob.pos) || !number(mob.health, 0, 100) || !number(mob.yaw, -1e9, 1e9)) fail('生物');
    for (const mob of entities.mobs || []) {
      if (mob.lastSeen !== undefined && !vector(mob.lastSeen)) fail('生物记忆位置');
      if (mob.persistent !== undefined && typeof mob.persistent !== 'boolean') fail('生物持久化标记');
      for (const [field, min, max] of [['provoked',0,1200],['lastSeenTicks',0,80],['bowDraw',0,1],['air',-20,300],['lastPlayerHit',0,1e9],['fallDistance',0,30000000]]) {
        if (mob[field] !== undefined && !number(mob[field],min,max)) fail('生物行为状态');
      }
    }
    for (const drop of entities.drops || []) { if (!object(drop) || !vector(drop.pos) || drop.vel && !vector(drop.vel)) fail('掉落物位置'); stack(drop.stack, '掉落物'); }
    for (const type of ['mobs', 'drops', 'falling', 'tnt', 'projectiles', 'orbs']) for (const entity of entities[type] || []) {
      if (!object(entity) || !vector(entity.pos) || entity.vel && (!object(entity.vel) || ['x', 'y', 'z'].some(axis => !number(entity.vel[axis], -16, 16)))) fail('实体位置或速度');
      for (const field of ['age', 'fuse', 'fire', 'love', 'breedCooldown', 'attackCooldown', 'panic', 'walkTime', 'idleTime', 'targetYaw', 'delay', 'angry', 'stareTicks', 'volley', 'homeY']) if (entity[field] !== undefined && !number(entity[field], -1e9, 1e9)) fail('实体计时');
      if (type === 'falling' && !blocks[entity.id]?.falling) fail('下落方块');
      if (type === 'tnt' && !integer(entity.fuse, 1, 1200)) fail('TNT 引信');
      if (type === 'projectiles' && (!['arrow', 'egg', 'ender_pearl', 'eye_of_ender', 'blaze_fireball', 'dragon_breath'].includes(entity.kind) || !['player', 'mob'].includes(entity.owner) || !number(entity.damage, 0, 100))) fail('投射物');
      if (entity.target !== undefined && !vector(entity.target)) fail('投射物目的地');
      if (type === 'orbs' && !number(entity.amount, 1, 1e6)) fail('经验球');
    }
  }
  return data;
}
