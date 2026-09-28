import { B, I, blocks, isSolid, isOpaque, boxFor } from './blocks.js';
import { hash, seedNumber } from './noise.js';
import { makeStack } from './inventory.js';
import { precipitationAt, precipitationHeight } from './weather.js';

const DIRECTIONS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const HORIZONTAL = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const FACING = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const key = (x, y, z) => `${x},${y},${z}`;

export function supportsTop(id, state = 0) {
  const block = blocks[id];
  return !!block?.solid && (block.opaque || block.glass || block.shape === 'slab' && !!(state & 12));
}

export function attachmentOffset(id, state = 0) {
  const shape = blocks[id]?.shape;
  if (shape === 'torch') return [[0, -1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]][state & 7] || [0, -1, 0];
  if (shape === 'ladder') return [[0, 0, 1], [-1, 0, 0], [0, 0, -1], [1, 0, 0]][state & 3];
  if (shape === 'lever' || shape === 'button') return [[0, -1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1], [0, 1, 0]][state & 7] || [0, -1, 0];
  return null;
}

export function supported(world, x, y, z, id, state = 0) {
  const get = (dx, dy, dz) => world.get(x + dx, y + dy, z + dz, false), definition = blocks[id];
  const attachment = attachmentOffset(id, state);
  if (attachment) {
    const [dx, dy, dz] = attachment, support = get(dx, dy, dz);
    return dy === -1 ? supportsTop(support, world.getState(x + dx, y + dy, z + dz)) : isOpaque(support);
  }
  const below = get(0, -1, 0);
  if (definition?.shape === 'wire' || definition?.shape === 'repeater' || definition?.shape === 'plate') return supportsTop(below, world.getState(x, y - 1, z));
  if (definition?.shape === 'crop') return below === B.FARMLAND;
  if (id === B.CACTUS) return [B.CACTUS, B.SAND].includes(below) && HORIZONTAL.every(([dx, dz]) => !isSolid(get(dx, 0, dz)) && get(dx, 0, dz) !== B.LAVA);
  if (id === B.SUGAR_CANE) return below === B.SUGAR_CANE || [B.GRASS, B.DIRT, B.SAND].includes(below) && HORIZONTAL.some(([dx, dz]) => get(dx, -1, dz) === B.WATER);
  if (id === B.MUSHROOM) return supportsTop(below, world.getState(x, y - 1, z));
  if (definition?.shape === 'cross') return [B.GRASS, B.DIRT, B.FARMLAND].includes(below);
  if (definition?.station === 'door') return id === B.DOOR_TOP ? below === B.DOOR : supportsTop(below, world.getState(x, y - 1, z));
  if (definition?.station === 'bed') {
    const [dx, dz] = FACING[state & 3], head = id === B.BED_HEAD, sign = head ? -1 : 1;
    return supportsTop(below, world.getState(x, y - 1, z)) && get(dx * sign, 0, dz * sign) === (head ? B.BED : B.BED_HEAD);
  }
  return true;
}

/** Physical destruction used by fluid, fire and support updates. It emits real
 * item events and clears paired halves atomically, never duplicating a bed/door.
 */
export function removeBlock(world, x, y, z, drop = true) {
  const id = world.get(x, y, z, false), definition = blocks[id]; if (!id || !definition) return;
  const state = world.getState(x, y, z), container = world.containers.get(key(x, y, z));
  if (drop && container) for (const stack of container.slots) if (stack) world.events.push({ type: 'drop', stack: { ...stack }, x, y, z });
  let item = definition.drop ?? id;
  if (definition.station === 'door') {
    const dy = id === B.DOOR_TOP ? -1 : 1;
    if ([B.DOOR, B.DOOR_TOP].includes(world.get(x, y + dy, z, false))) world.set(x, y + dy, z, B.AIR);
    item = B.DOOR;
  }
  if (definition.station === 'bed') {
    const [dx, dz] = FACING[state & 3], sign = id === B.BED_HEAD ? -1 : 1;
    if ([B.BED, B.BED_HEAD].includes(world.get(x + dx * sign, y, z + dz * sign, false))) world.set(x + dx * sign, y, z + dz * sign, B.AIR);
    item = B.BED;
  }
  world.set(x, y, z, B.AIR);
  if (drop && definition.shape === 'crop') {
    world.events.push({ type: 'drop', id: I.SEEDS, x, y, z });
    if (id === B.WHEAT7) world.events.push({ type: 'drop', id: I.WHEAT, x, y, z });
  } else if (drop && !definition.noDrop && !definition.liquid) world.events.push({ type: 'drop', id: item, x, y, z });
}

export function exposedToRain(world, x, y, z) {
  return !!world.weather && precipitationAt(world, x, z) === 'rain' && y >= precipitationHeight(world, x, z);
}

export function canBurnAt(world, x, y, z) {
  return supportsTop(world.get(x, y - 1, z, false), world.getState(x, y - 1, z)) || DIRECTIONS.some(([dx, dy, dz]) => blocks[world.get(x + dx, y + dy, z + dz, false)]?.flammability);
}

function fireTick(world, x, y, z) {
  const below = world.get(x, y - 1, z, false), eternal = below === B.NETHERRACK;
  if (!canBurnAt(world, x, y, z) || !eternal && exposedToRain(world, x, y, z)) { world.set(x, y, z, B.AIR); return; }
  const age = world.getState(x, y, z), seed = seedNumber(world.seed) ^ world.totalTicks;
  if (!eternal && age >= 15 && hash(x, y, z, seed) < .4) { world.set(x, y, z, B.AIR); return; }
  if (age < 15) world.set(x, y, z, B.FIRE, age + 1, false);
  for (const [dx, dy, dz] of DIRECTIONS) {
    const bx = x + dx, by = y + dy, bz = z + dz, id = world.get(bx, by, bz, false), fuel = blocks[id]?.flammability || 0;
    if (!fuel || hash(bx, by, bz, seed ^ 1729) >= fuel / (dy ? 250 : 300)) continue;
    if (id === B.TNT) { world.set(bx, by, bz, B.AIR); world.events.push({ type: 'prime', x: bx, y: by, z: bz }); }
    else {
      removeBlock(world, bx, by, bz, false);
      if (!exposedToRain(world, bx, by, bz) && canBurnAt(world, bx, by, bz)) world.set(bx, by, bz, B.FIRE, Math.min(15, age + 1));
    }
  }
  for (let dy = -1; dy <= 3; dy++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    if (!dx && !dy && !dz) continue;
    const bx = x + dx, by = y + dy, bz = z + dz;
    if (by < 1 || by >= 128 || world.get(bx, by, bz, false) !== B.AIR || exposedToRain(world, bx, by, bz)) continue;
    const encouragement = Math.max(0, ...DIRECTIONS.map(([a, b, c]) => blocks[world.get(bx + a, by + b, bz + c, false)]?.fireSpread || 0));
    if (encouragement && hash(bx, by, bz, seed ^ 7919) < encouragement / (dy > 1 ? 500 : 200)) world.set(bx, by, bz, B.FIRE, Math.min(15, Math.floor(age / 2) + 1));
  }
}

function farmlandTick(world, x, y, z) {
  if (isSolid(world.get(x, y + 1, z, false))) { world.set(x, y, z, B.DIRT); return; }
  let wet = exposedToRain(world, x, y + 1, z);
  for (let dx = -4; dx <= 4 && !wet; dx++) for (let dz = -4; dz <= 4 && !wet; dz++) for (let dy = 0; dy <= 1; dy++) {
    if (world.get(x + dx, y + dy, z + dz, false) === B.WATER) { wet = true; break; }
  }
  const state = world.getState(x, y, z), moisture = state & 7;
  if (wet) { if (state !== 7) world.set(x, y, z, B.FARMLAND, 7, false); }
  else if (moisture) world.set(x, y, z, B.FARMLAND, moisture - 1, false);
  else if (blocks[world.get(x, y + 1, z, false)]?.shape !== 'crop') {
    const drought = (state >> 3) + 1;
    if (drought >= 8) world.set(x, y, z, B.DIRT);
    else world.set(x, y, z, B.FARMLAND, drought << 3, false);
  }
}

export function tickEnvironment(world) {
  if (world.totalTicks % 20) return;
  // The set is per loaded chunk, not a world-wide scan of every voxel.
  const jobs = [];
  for (const chunk of world.chunks.values()) for (const i of chunk.environment) jobs.push([chunk.cx * 16 + (i & 15), i >> 8, chunk.cz * 16 + ((i >> 4) & 15)]);
  for (const [x, y, z] of jobs) {
    const id = world.get(x, y, z, false);
    if (id === B.FIRE) fireTick(world, x, y, z);
    else if (id === B.FARMLAND && world.totalTicks % 100 === 0) farmlandTick(world, x, y, z);
  }
}
