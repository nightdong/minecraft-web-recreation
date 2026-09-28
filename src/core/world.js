import { B, I, blocks, items, isOpaque, isSolid, boxFor, selectionShapes, SMELTING } from './blocks.js';
import { Noise, seedNumber, hash, clamp, lerp, mod } from './noise.js';
import { makeStack } from './inventory.js';
import { supported, removeBlock, tickEnvironment } from './environment.js';
import { RedstoneSystem } from './redstone.js';
import { FluidSystem, fluidHeight } from './fluids.js';
import { reconcileChest, chestPositions, chestView, chestBlocked } from './chests.js';
import { generateEnd, decorateStrongholds, decorateFortresses, END_SPAWN } from './adventure.js';
import { EndFight } from './end-fight.js';

export const CHUNK = 16, HEIGHT = 128, SEA = 62;
export const index = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;
export const chunkKey = (x, z) => `${x},${z}`;
export const blockKey = (x, y, z) => `${x},${y},${z}`;
export const DIRECTIONS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const BIOMES = ['平原', '森林', '白桦林', '针叶林', '沙漠', '山地', '积雪山峰', '河流', '海洋', '下界荒地', '末地'];

/** Pure seeded generation. Cross-border trees are evaluated from global cell coordinates. */
export class Terrain {
  constructor(seed, dimension = 'overworld', generationVersion = 1) {
    this.seed = seedNumber(seed); this.noise = new Noise(this.seed);
    this.cave = new Noise(this.seed ^ 0x7f34ea); this.dimension = dimension;
    this.generationVersion = generationVersion;
    this.columns = new Map();
  }
  column(x, z) {
    const key = `${x},${z}`, existing = this.columns.get(key); if (existing) return existing;
    const n = this.noise;
    const continental = n.fbm(x / 340 + 19.3, z / 340 - 7.2, 4);
    const hills = n.fbm(x / 85, z / 85, 4);
    const mountain = Math.max(0, n.fbm(x / 180 + 6.7, z / 180 + 9.3, 3) - .02);
    const moisture = n.fbm(x / 190 - 17.3, z / 190 + 30.7, 3);
    const temperature = n.fbm(x / 250 + 61.5, z / 250 - 41.2, 3);
    const river = Math.abs(n.at(x / 190 + 1.73, z / 190 + 4.28));
    let height = SEA + 9 + continental * 43 + hills * 14 + mountain * 91;
    const riverMix = clamp((river - .027) / .075, 0, 1);
    if (height < SEA + 22) height = lerp(SEA - 4 + hills * 3, height, riverMix);
    height = clamp(Math.floor(height), 16, HEIGHT - 16);
    let biome = moisture > .16 ? (temperature > .05 ? 2 : 1) : 0;
    if (moisture > -.06 && moisture <= .16 && temperature < -.15) biome = 3;
    if (temperature > .18 && moisture < .06) biome = 4;
    if (height > SEA + 22) biome = 5;
    if (height > SEA + 36 || (temperature < -.29 && height > SEA + 6)) biome = 6;
    if (height < SEA - 1) biome = riverMix < .55 ? 7 : 8;
    const out = { height, biome, moisture, temperature, river };
    if(this.columns.size>=65536){let count=0;for(const oldest of this.columns.keys()){this.columns.delete(oldest);if(++count>=256)break;}}
    this.columns.set(key, out); return out;
  }
  generate(cx, cz) {
    if (this.dimension === 'end') return generateEnd(this, cx, cz);
    const data = new Uint16Array(CHUNK * CHUNK * HEIGHT), state = new Uint8Array(data.length);
    const heights = new Uint8Array(256), biomes = new Uint8Array(256);
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const put = (x, y, z, id, replace = true, st = 0) => {
      const lx = x - ox, lz = z - oz;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 0 || y >= HEIGHT) return;
      const i = index(lx, y, lz);
      if (replace || !data[i] || blocks[data[i]]?.leaves || data[i] === B.TALL_GRASS || data[i] === B.SNOW) { data[i] = id; state[i] = st; }
    };
    // Coarse continuous density grid: trilinear interpolation preserves chunk seams.
    const ny = HEIGHT / 4 + 1, a = new Float32Array(5 * 5 * ny), b = new Float32Array(a.length);
    const gi = (x, y, z) => x + z * 5 + y * 25;
    for (let y = 0; y < ny; y++) for (let z = 0; z < 5; z++) for (let x = 0; x < 5; x++) {
      const wx = ox + x * 4, wz = oz + z * 4, wy = y * 4, i = gi(x, y, z);
      a[i] = this.cave.at(wx * .036, wy * .052, wz * .036);
      b[i] = this.cave.at(wx * .044 + 83.7, wy * .041 - 41.8, wz * .044 + 16.5);
    }
    const density = (grid, x, y, z) => {
      const ix = x >> 2, iy = y >> 2, iz = z >> 2, fx = (x & 3) / 4, fy = (y & 3) / 4, fz = (z & 3) / 4;
      return lerp(lerp(lerp(grid[gi(ix, iy, iz)], grid[gi(ix + 1, iy, iz)], fx), lerp(grid[gi(ix, iy, iz + 1)], grid[gi(ix + 1, iy, iz + 1)], fx), fz),
        lerp(lerp(grid[gi(ix, iy + 1, iz)], grid[gi(ix + 1, iy + 1, iz)], fx), lerp(grid[gi(ix, iy + 1, iz + 1)], grid[gi(ix + 1, iy + 1, iz + 1)], fx), fz), fy);
    };
    if (this.dimension === 'nether') {
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const wx = ox + x, wz = oz + z; heights[x + z * 16] = 120; biomes[x + z * 16] = 9;
        const floor = 30 + this.noise.fbm(wx / 64, wz / 64, 3) * 15;
        for (let y = 0; y < HEIGHT; y++) {
          const d = density(a, x, y, z);
          let id = y < floor || y > 113 || Math.abs(d) > .32 ? B.NETHERRACK : y < 31 ? B.LAVA : B.AIR;
          if (y < 2 || y > 125) id = B.BEDROCK;
          if (id === B.NETHERRACK && y < 37 && hash(wx, y, wz, this.seed) > .94) id = B.SOUL_SAND;
          if (y > 75 && id === B.NETHERRACK && density(b, x, y, z) > .42) id = B.GLOWSTONE;
          data[index(x, y, z)] = id;
        }
      }
      if (this.generationVersion >= 2) decorateFortresses(this, cx, cz, data, state);
      return { cx, cz, data, state, heights, biomes, maxHeight: HEIGHT - 1 };
    }
    let maxHeight = 0;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const wx = ox + x, wz = oz + z, col = this.column(wx, wz), h = col.height;
      heights[x + z * 16] = h; biomes[x + z * 16] = col.biome; maxHeight = Math.max(maxHeight, h + 12, SEA + 1);
      const beach = h <= SEA + 1, desert = col.biome === 4;
      for (let y = 0; y <= Math.max(h, SEA); y++) {
        let id = B.STONE;
        if (y > h) id = col.biome === 6 && y === SEA ? B.ICE : B.WATER;
        else if (y === 0 || y < 4 && hash(wx, y, wz, this.seed + 8) < (4 - y) / 4) id = B.BEDROCK;
        else {
          const ca = density(a, x, y, z), cb = density(b, x, y, z);
          const tunnel = Math.abs(ca) < .065 && Math.abs(cb) < .27;
          const room = ca > .52 && y < h - 9;
          const entrance = h > SEA + 7 && Math.abs(ca) < .038 && Math.abs(cb) < .16;
          if (y > 4 && (room || tunnel && (y < h - 4 || entrance))) id = y < 10 ? B.LAVA : B.AIR;
          else if (y === h) {
            id = desert || beach ? B.SAND : col.biome === 6 ? B.SNOW_BLOCK : col.biome === 5 && h > SEA + 27 ? B.STONE : B.GRASS;
            if (beach && h < SEA - 2 && hash(Math.floor(wx / 5), 0, Math.floor(wz / 5), this.seed + 7) < .08) id = B.CLAY;
          } else if (y > h - 4) id = desert || beach ? B.SAND : B.DIRT;
          else if (desert && y > h - 7) id = B.SANDSTONE;
          else {
            const vein = hash(Math.floor(wx / 3), Math.floor(y / 3), Math.floor(wz / 3), this.seed + 71);
            if (hash(wx, y, wz, this.seed + 72) > .18) {
              if (vein < .037) id = B.COAL_ORE;
              else if (vein < .065 && y < 61) id = B.IRON_ORE;
              else if (vein < .075 && y < 30) id = B.GOLD_ORE;
              else if (vein < .080 && y < 17) id = B.DIAMOND_ORE;
              else if (vein < .095 && y < 18) id = B.REDSTONE_ORE;
              else if (vein < .105 && y < 33) id = B.LAPIS_ORE;
            }
            if (id === B.STONE && hash(Math.floor(wx / 6), Math.floor(y / 4), Math.floor(wz / 6), this.seed + 3) > .979) id = B.GRAVEL;
          }
        }
        data[index(x, y, z)] = id;
      }
    }
    // Trees are derived from cells outside the chunk too, never truncated at its border.
    for (let gz = Math.floor((oz - 4) / 5); gz <= Math.floor((oz + 19) / 5); gz++) for (let gx = Math.floor((ox - 4) / 5); gx <= Math.floor((ox + 19) / 5); gx++) {
      const tx = gx * 5 + 1 + Math.floor(hash(gx, 11, gz, this.seed) * 3), tz = gz * 5 + 1 + Math.floor(hash(gx, 12, gz, this.seed) * 3);
      const c = this.column(tx, tz), density = [ .10, .67, .68, .64, 0, .035, .06, 0, 0 ][c.biome];
      if (c.height <= SEA + 1 || hash(gx, 14, gz, this.seed) > density) continue;
      const birch = c.biome === 2 || c.biome === 1 && hash(gx, 15, gz, this.seed) < .20;
      const spruce = c.biome === 3 || c.biome === 6;
      const tall = (spruce ? 7 : birch ? 5 : 4) + Math.floor(hash(gx, 16, gz, this.seed) * 3);
      const base = c.height + 1, log = spruce ? B.SPRUCE_LOG : birch ? B.BIRCH_LOG : B.OAK_LOG;
      const leaf = spruce ? B.SPRUCE_LEAVES : birch ? B.BIRCH_LEAVES : B.OAK_LEAVES;
      if (spruce) {
        for (let y = 2; y <= tall + 1; y++) {
          const radius = y === tall + 1 ? 0 : y > tall - 2 ? 1 : y % 2 ? 2 : 1;
          for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) if (!(Math.abs(dx) === radius && Math.abs(dz) === radius && radius > 0)) put(tx + dx, base + y, tz + dz, leaf, false);
        }
      } else for (let y = tall - 3; y <= tall; y++) {
        const radius = y >= tall - 1 ? 1 : 2;
        for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
          if (Math.abs(dx) === radius && Math.abs(dz) === radius && (y === tall || hash(tx + dx, y, tz + dz, this.seed) < .45)) continue;
          put(tx + dx, base + y, tz + dz, leaf, false);
        }
      }
      for (let y = 0; y < tall; y++) put(tx, base + y, tz, log, false);
      put(tx, base - 1, tz, B.DIRT);
    }
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const wx = ox + x, wz = oz + z, h = heights[x + z * 16], biome = biomes[x + z * 16];
      if (h >= HEIGHT - 5 || data[index(x, h + 1, z)]) continue;
      const r = hash(wx, 81, wz, this.seed);
      if (data[index(x, h, z)] === B.GRASS) {
        if (r < .18) data[index(x, h + 1, z)] = B.TALL_GRASS;
        else if (r < .186) data[index(x, h + 1, z)] = B.POPPY;
        else if (r < .192) data[index(x, h + 1, z)] = B.DANDELION;
        else if (r < .1927) data[index(x, h + 1, z)] = B.PUMPKIN;
      } else if (biome === 4 && r < .013 && h > SEA + 1) {
        const length = 2 + Math.floor(hash(wx, 88, wz, this.seed) * 2);
        for (let y = 1; y <= length; y++) data[index(x, h + y, z)] = B.CACTUS;
      } else if (biome === 6 && data[index(x, h, z)] === B.SNOW_BLOCK) data[index(x, h + 1, z)] = B.SNOW;
      if (h === SEA && r < .13 && [B.SAND, B.GRASS].includes(data[index(x, h, z)])) {
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => this.column(wx + dx, wz + dz).height < SEA)) {
          for (let y = 1; y <= 2 + Math.floor(r * 8); y++) data[index(x, h + y, z)] = B.SUGAR_CANE;
        }
      }
    }
    // Small rare abandoned cabins, built with the same blocks as the player can use.
    for (let gz = Math.floor((oz - 8) / 160); gz <= Math.floor((oz + 23) / 160); gz++) for (let gx = Math.floor((ox - 8) / 160); gx <= Math.floor((ox + 23) / 160); gx++) {
      const tx = gx * 160 + 28 + Math.floor(hash(gx, 401, gz, this.seed) * 90), tz = gz * 160 + 28 + Math.floor(hash(gx, 402, gz, this.seed) * 90);
      const c = this.column(tx, tz);
      if (hash(gx, 403, gz, this.seed) > .32 || ![0, 1, 2].includes(c.biome) || c.height < SEA + 3) continue;
      const y = c.height;
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        for (let dy = -3; dy <= 0; dy++) put(tx + dx, y + dy, tz + dz, B.COBBLE);
        for (let dy = 1; dy <= 4; dy++) {
          const edge = Math.abs(dx) === 3 || Math.abs(dz) === 3;
          const corner = Math.abs(dx) === 3 && Math.abs(dz) === 3;
          let id = dy === 4 ? B.PLANKS : edge ? corner ? B.OAK_LOG : B.PLANKS : B.AIR;
          if (dy === 2 && (dx === 0 && Math.abs(dz) === 3 || dz === 0 && Math.abs(dx) === 3)) id = B.GLASS;
          if (dx === 0 && dz === -3 && dy <= 2) id = dy === 1 ? B.DOOR : B.DOOR_TOP;
          put(tx + dx, y + dy, tz + dz, id);
        }
      }
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) put(tx + dx, y + 5, tz + dz, B.OAK_SLAB);
      put(tx - 2, y + 1, tz + 2, B.CHEST); put(tx + 2, y + 1, tz + 2, B.CRAFTING);
      put(tx + 2, y + 1, tz + 1, B.FURNACE); put(tx, y + 1, tz + 2, B.TORCH);
      maxHeight = Math.max(maxHeight, y + 6);
    }
    if (this.generationVersion >= 2) decorateStrongholds(this, cx, cz, data, state);
    return { cx, cz, data, state, heights, biomes, maxHeight: Math.min(HEIGHT - 1, maxHeight) };
  }
}

export class World {
  constructor(seed = 'Over the hills', saved = {}) {
    this.seed = seed; this.dimension = saved.dimension || 'overworld';
    this.generationVersion = saved.generationVersion ?? (Object.hasOwn(saved, 'edits') ? 1 : 2);
    this.terrain = new Terrain(seed, this.dimension, this.generationVersion);
    this.endFight = this.dimension === 'end' ? new EndFight(seed, saved.endFight) : null;
    this.chunks = new Map(); this.edits = new Map(); this.dirty = new Set(); this.blockLightingDirty = true;
    this.lightDirtyChunks = new Set(); this.lightPass = 0;
    this.lightingStats = { passes: 0, lastChunks: 0, lastCells: 0 };
    this.containers = new Map(saved.containers || []); this.growing = new Map(saved.growing || []);
    this.time = saved.time ?? 1000; this.totalTicks = saved.totalTicks || 0; this.weather = saved.weather || 0;
    this.weatherTimer = saved.weatherTimer || 900; this.events = []; this.updateQueue = []; this.updateSet = new Set();
    this.leafQueue = saved.leafQueue || [];
    this.redstone = new RedstoneSystem(this, saved.redstone);
    this.fluids = new FluidSystem(this, saved.fluids);
    for (const [key, changes] of saved.edits || []) this.edits.set(key, new Map(changes));
    for (const [x, y, z] of saved.pendingUpdates || []) this.schedule(x, y, z);
  }
  ensure(cx, cz) {
    const key = chunkKey(cx, cz); let chunk = this.chunks.get(key); if (chunk) return chunk;
    chunk = this.terrain.generate(cx, cz); chunk.key = key;
    chunk.sky = new Uint8Array(chunk.data.length); chunk.glow = new Uint8Array(chunk.data.length); chunk.lightDirty = true;
    chunk.previousGlow = new Uint8Array(chunk.data.length); chunk.emitters = new Map(); chunk.tops = new Uint8Array(256); chunk.precipitation = new Float32Array(256); chunk.environment = new Set(); chunk.chests = new Set(); chunk.spawners = new Set();
    for (const [i, value] of this.edits.get(key) || []) { chunk.data[i] = value[0]; chunk.state[i] = value[1] || 0; }
    this.chunks.set(key, chunk); this.dirty.add(key);
    for (const [i, value] of this.edits.get(key) || []) if (blocks[value[0]]?.falling) this.schedule(cx * 16 + (i & 15), i >> 8, cz * 16 + ((i >> 4) & 15));
    this.fluids.registerChunk(chunk);
    this.redstone.registerChunk(chunk);
    for (let i = 0; i < chunk.data.length; i++) {
      if (chunk.data[i] === B.CHEST) chunk.chests.add(i);
      if (chunk.data[i] === B.SPAWNER) chunk.spawners.add(i);
      if (blocks[chunk.data[i]]?.light) chunk.emitters.set(i, blocks[chunk.data[i]].light);
      if (chunk.data[i] === B.FIRE || chunk.data[i] === B.FARMLAND) chunk.environment.add(i);
    }
    this.markBlockLight(cx, cz);
    this.recalcHeights(chunk); return chunk;
  }
  recalcHeights(chunk) {
    let max = SEA;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      let top = 0;
      for (let y = HEIGHT - 1; y >= 0; y--) if (chunk.data[index(x, y, z)]) { top = y; break; }
      chunk.tops[x + z * 16] = top;
      max = Math.max(top, max);
      let precipitation = 0;
      for (let y = top; y >= 0; y--) {
        const i = index(x, y, z), id = chunk.data[i];
        if (!precipitation && (blocks[id]?.solid || blocks[id]?.liquid)) precipitation = y + (boxFor(id, chunk.state[i])?.[4] || 1);
        if (isOpaque(id)) { chunk.heights[x + z * 16] = y; break; }
      }
      chunk.precipitation[x + z * 16] = precipitation;
    }
    chunk.maxHeight = Math.min(HEIGHT - 1, max + 1);
  }
  updateColumn(chunk, x, z) {
    const column = x + z * 16; let top = 0, opaque = 0, foundTop = false, precipitation = 0;
    for (let y = HEIGHT - 1; y >= 0; y--) {
      const id = chunk.data[index(x, y, z)];
      if (!foundTop && id) { top = y; foundTop = true; }
      if (!precipitation && (blocks[id]?.solid || blocks[id]?.liquid)) precipitation = y + (boxFor(id, chunk.state[index(x, y, z)])?.[4] || 1);
      if (isOpaque(id)) { opaque = y; break; }
    }
    chunk.tops[column] = top; chunk.heights[column] = opaque; chunk.precipitation[column] = precipitation;
    let max = SEA; for (const height of chunk.tops) max = Math.max(max, height);
    chunk.maxHeight = Math.min(HEIGHT - 1, max + 1);
  }
  unload(key) {
    const chunk = this.chunks.get(key); if (chunk) this.redstone.unload(chunk);
    if (chunk) this.fluids.unload(chunk);
    if (!this.chunks.delete(key)) return;
    this.dirty.delete(key); this.lightDirtyChunks.delete(key);
    if (chunk) this.markBlockLight(chunk.cx, chunk.cz);
  }
  get(x, y, z, generate = true) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0) return this.dimension === 'end' ? B.AIR : B.BEDROCK; if (y >= HEIGHT) return B.AIR;
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    const chunk = generate ? this.ensure(cx, cz) : this.chunks.get(chunkKey(cx, cz));
    return chunk ? chunk.data[index(mod(x, 16), y, mod(z, 16))] : B.AIR;
  }
  getState(x, y, z) { x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0 || y >= HEIGHT) return 0;
    const chunk = this.chunks.get(chunkKey(Math.floor(x / 16), Math.floor(z / 16)));
    return chunk?.state[index(mod(x, 16), Math.floor(y), mod(z, 16))] || 0;
  }
  set(x, y, z, id, state = 0, updates = true) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0 || y >= HEIGHT || !blocks[id] || !Number.isFinite(x + y + z)) return false;
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16), chunk = this.ensure(cx, cz), i = index(mod(x, 16), y, mod(z, 16));
    const old = chunk.data[i], oldState = chunk.state[i]; if (old === id && oldState === state) return false;
    chunk.data[i] = id; chunk.state[i] = state;
    if (id === B.CHEST) chunk.chests.add(i); else chunk.chests.delete(i);
    if (id === B.SPAWNER) chunk.spawners.add(i); else chunk.spawners.delete(i);
    if (old !== id) this.fluids.pending.delete(blockKey(x, y, z));
    this.redstone.changed(x, y, z, old, id, chunk, i);
    if (!this.edits.has(chunk.key)) this.edits.set(chunk.key, new Map()); this.edits.get(chunk.key).set(i, [id, state]);
    const key = blockKey(x, y, z); chunk.emitters.delete(i);
    if (blocks[id].light) chunk.emitters.set(i, blocks[id].light);
    if (id === B.FIRE || id === B.FARMLAND) chunk.environment.add(i); else chunk.environment.delete(i);
    if (old !== id && (!blocks[id].station || blocks[old].station !== blocks[id].station)) this.containers.delete(key);
    if ([B.SAPLING, B.SUGAR_CANE].includes(id) || id >= B.WHEAT0 && id < B.WHEAT7) { if (!this.growing.has(key)) this.growing.set(key, 0); }
    else this.growing.delete(key);
    this.updateColumn(chunk, mod(x, 16), mod(z, 16));
    const before = blocks[old], after = blocks[id];
    const lightChanged = !!before.opaque !== !!after.opaque || !!before.leaves !== !!after.leaves || !!before.liquid !== !!after.liquid || (before.light || 0) !== (after.light || 0);
    if (lightChanged) this.markBlockLight(cx, cz);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!lightChanged && (dx && mod(x, 16) !== (dx < 0 ? 0 : 15) || dz && mod(z, 16) !== (dz < 0 ? 0 : 15))) continue;
      const neighbor = this.chunks.get(chunkKey(cx + dx, cz + dz));
      if (neighbor) { if (lightChanged) neighbor.lightDirty = true; this.dirty.add(neighbor.key); }
    }
    if (updates) {
      this.schedule(x, y, z); for (const [dx, dy, dz] of DIRECTIONS) this.schedule(x + dx, y + dy, z + dz);
      if (blocks[old]?.leaves || [B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG].includes(old)) this.events.push({ type: 'leaves', x, y, z, old });
    }
    if (old !== id && (old === B.CHEST || id === B.CHEST)) reconcileChest(this, x, y, z, old, oldState, id);
    return true;
  }
  schedule(x, y, z) {
    if (y < 0 || y >= HEIGHT) return;
    if (blocks[this.get(x, y, z, false)]?.liquid) { this.fluids.schedule(x, y, z); return; }
    const key = blockKey(x, y, z); if (this.updateSet.has(key)) return;
    this.updateSet.add(key); this.updateQueue.push([x, y, z, key]);
  }
  surface(x, z) {
    x = Math.floor(x); z = Math.floor(z); const chunk = this.ensure(Math.floor(x / 16), Math.floor(z / 16));
    for (let y = HEIGHT - 2; y >= 0; y--) {
      const id = chunk.data[index(mod(x, 16), y, mod(z, 16))];
      if (isSolid(id) && !blocks[id]?.leaves && ![B.OAK_LOG, B.SPRUCE_LOG, B.BIRCH_LOG, B.SNOW].includes(id)) return y + (boxFor(id, this.getState(x, y, z))?.[4] || 1);
    }
    return this.dimension === 'end' ? 0 : SEA + 1;
  }
  spawn() {
    if (this.dimension === 'end') return { ...END_SPAWN };
    for (let radius = 0; radius < 100; radius += 4) for (let a = 0; a < (radius ? 16 : 1); a++) {
      const x = Math.round(8 + Math.cos(a * Math.PI / 8) * radius), z = Math.round(8 + Math.sin(a * Math.PI / 8) * radius);
      const c = this.terrain.column(x, z);
      if (c.height < SEA + 2 || c.height > SEA + 23 || c.biome === 4) continue;
      const y = this.surface(x, z);
      if (this.get(x, y, z) === B.AIR || !isSolid(this.get(x, y, z))) {
        if (!isSolid(this.get(x, y + 1, z)) && !isSolid(this.get(x + 1, y, z))) return { x: x + .5, y: y + .02, z: z + .5 };
      }
    }
    return { x: 8.5, y: this.surface(8, 8) + 1, z: 8.5 };
  }
  light(chunk) {
    this.updateBlockLight();
    if (!chunk.lightDirty) return;
    const { data, sky } = chunk; sky.fill(0);
    const sq = [], max = chunk.maxHeight;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      let s = this.dimension === 'nether' ? 0 : 15;
      for (let y = HEIGHT - 1; y >= 0; y--) {
        const i = index(x, y, z), id = data[i], block = blocks[id];
        if (block?.opaque) s = 0;
        else if (block?.leaves || block?.liquid) s = Math.max(0, s - (block.liquid ? 2 : 1));
        sky[i] = s;
        if (s > 1 && y <= max + 1) sq.push(i);
      }
    }
    // Boundary sky seeds connect cliffs and cave mouths across chunk boundaries.
    if (this.dimension !== 'nether') for (let side = 0; side < 4; side++) for (let k = 0; k < 16; k++) {
      const x = side < 2 ? side === 0 ? 0 : 15 : k, z = side >= 2 ? side === 2 ? 0 : 15 : k;
      const wx = chunk.cx * 16 + x + (side === 0 ? -1 : side === 1 ? 1 : 0), wz = chunk.cz * 16 + z + (side === 2 ? -1 : side === 3 ? 1 : 0);
      const neighbor = this.chunks.get(chunkKey(Math.floor(wx / 16), Math.floor(wz / 16)));
      const h = neighbor ? neighbor.heights[mod(wx, 16) + mod(wz, 16) * 16] : this.terrain.column(wx, wz).height;
      for (let y = h + 1; y <= max; y++) {
        const i = index(x, y, z); if (!isOpaque(data[i]) && sky[i] < 14) { sky[i] = 14; sq.push(i); }
      }
    }
    const flood = (arr, queue) => {
      for (let read = 0; read < queue.length; read++) {
        const i = queue[read], x = i & 15, z = (i >> 4) & 15, y = i >> 8, level = arr[i] - 1;
        if (level <= 0) continue;
        const visit = j => {
          if (arr[j] >= level || isOpaque(data[j])) return;
          const value = level - (blocks[data[j]]?.liquid ? 1 : 0); if (value <= arr[j]) return;
          arr[j] = value; queue.push(j);
        };
        if (x > 0) visit(i - 1); if (x < 15) visit(i + 1); if (z > 0) visit(i - 16); if (z < 15) visit(i + 16);
        if (y > 0) visit(i - 256); if (y < HEIGHT - 1) visit(i + 256);
      }
    };
    flood(sky, sq); chunk.lightDirty = false;
  }
  markBlockLight(cx, cz) {
    // Every source has level <=15, so a changed cell cannot influence a chunk
    // beyond this one-chunk guard ring. No arbitrary distance approximation.
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const key = chunkKey(cx + dx, cz + dz); if (this.chunks.has(key)) this.lightDirtyChunks.add(key);
    }
    this.blockLightingDirty = true;
  }
  /** Recompute the affected region using exact unchanged boundary values.
   * Boundaries sample the actual adjacent cell through its actual occluder;
   * they are never estimated from source distance. Full/local equivalence is
   * regression-tested across source removal, walls and chunk unload/reload.
   */
  updateBlockLight() {
    if (!this.blockLightingDirty) return;
    this.blockLightingDirty = false;
    const chunks = [...this.lightDirtyChunks].map(key => this.chunks.get(key)).filter(Boolean), queue = [], pass = ++this.lightPass;
    this.lightDirtyChunks.clear();
    this.lightingStats.passes++; this.lightingStats.lastChunks = chunks.length;
    for (let c = 0; c < chunks.length; c++) {
      const chunk = chunks[c]; chunk.lightIndex = c; chunk.lightPass = pass;
      [chunk.glow, chunk.previousGlow] = [chunk.previousGlow, chunk.glow]; chunk.glow.fill(0);
      for (const [i, strength] of chunk.emitters) { chunk.glow[i] = strength; queue.push(c * 32768 + i); }
    }
    const neighbors = chunks.map(c => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => this.chunks.get(chunkKey(c.cx + dx, c.cz + dz))));
    const visit = (chunk, i, level) => {
      if (!chunk || chunk.lightPass !== pass || isOpaque(chunk.data[i])) return;
      const value = level - (blocks[chunk.data[i]]?.liquid ? 1 : 0);
      if (value <= chunk.glow[i]) return;
      chunk.glow[i] = value; queue.push(chunk.lightIndex * 32768 + i);
    };
    for (let c = 0; c < chunks.length; c++) for (let side = 0; side < 4; side++) {
      const outside = neighbors[c][side]; if (!outside || outside.lightPass === pass) continue;
      const inside = chunks[c];
      for (let y = 0; y < HEIGHT; y++) for (let t = 0; t < 16; t++) {
        const i = side < 2 ? index(side === 0 ? 15 : 0, y, t) : index(t, y, side === 2 ? 15 : 0);
        const j = side < 2 ? index(side === 0 ? 0 : 15, y, t) : index(t, y, side === 2 ? 0 : 15);
        const level = outside.glow[j] - 1; if (level > 0) visit(inside, i, level);
      }
    }
    for (let read = 0; read < queue.length; read++) {
      const code = queue[read], c = Math.floor(code / 32768), i = code % 32768, chunk = chunks[c], level = chunk.glow[i] - 1;
      if (level <= 0) continue;
      const x = i & 15, z = (i >> 4) & 15, y = i >> 8, n = neighbors[c];
      if (x < 15) visit(chunk, i + 1, level); else visit(n[0], i - 15, level);
      if (x > 0) visit(chunk, i - 1, level); else visit(n[1], i + 15, level);
      if (z < 15) visit(chunk, i + 16, level); else visit(n[2], i - 240, level);
      if (z > 0) visit(chunk, i - 16, level); else visit(n[3], i + 240, level);
      if (y < HEIGHT - 1) visit(chunk, i + 256, level);
      if (y > 0) visit(chunk, i - 256, level);
    }
    this.lightingStats.lastCells = queue.length;
    for (const chunk of chunks) for (let i = 0; i < chunk.glow.length; i++) {
      if (chunk.glow[i] !== chunk.previousGlow[i]) { this.dirty.add(chunk.key); break; }
    }
  }
  getLight(x, y, z) {
    if (y >= HEIGHT) return [15, 0]; if (y < 0) return [0, 0];
    const c = this.chunks.get(chunkKey(Math.floor(x / 16), Math.floor(z / 16)));
    if (!c) return [this.dimension === 'nether' ? 0 : 15, 0];
    const i = index(mod(x, 16), y, mod(z, 16)); return [c.sky[i], c.glow[i]];
  }
  container(x, y, z, type) {
    const key = blockKey(x, y, z); let container = this.containers.get(key);
    if (!container) {
      container = { type, slots: Array(type === 'chest' ? 27 : 3).fill(null), burn: 0, burnMax: 0, progress: 0 };
      // Loot is only generated for untouched, naturally generated chests.
      const ck = chunkKey(Math.floor(x / 16), Math.floor(z / 16)), i = index(mod(x, 16), y, mod(z, 16));
      if (type === 'chest' && this.get(x, y, z, false) === B.CHEST && !this.edits.get(ck)?.has(i)) {
        container.slots[2] = makeStack(I.BREAD, 2); container.slots[8] = makeStack(I.IRON, 2);
        container.slots[14] = makeStack(I.COAL, 4); container.slots[19] = makeStack(I.STRING, 3);
      }
      this.containers.set(key, container);
    }
    return container;
  }
  chestPositions(x, y, z) { return chestPositions(this, x, y, z); }
  chestView(x, y, z) { return chestView(this, x, y, z); }
  chestBlocked(x, y, z) { return chestBlocked(this, x, y, z); }
  growTree(x, y, z) {
    if (![B.DIRT, B.GRASS].includes(this.get(x, y - 1, z))) return false;
    for (let dy = 1; dy <= 6; dy++) if (isSolid(this.get(x, y + dy, z))) return false;
    this.set(x, y, z, B.AIR, 0, false);
    const height = 5;
    for (let dy = height - 3; dy <= height; dy++) {
      const r = dy >= height - 1 ? 1 : 2;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && dy === height) continue;
        if (!isSolid(this.get(x + dx, y + dy, z + dz))) this.set(x + dx, y + dy, z + dz, B.OAK_LEAVES, 0, false);
      }
    }
    for (let dy = 0; dy < height; dy++) this.set(x, y + dy, z, B.OAK_LOG, 0, false);
    return true;
  }
  tick(dt = .05, bodies = []) {
    this.time = (this.time + dt * 20) % 24000; this.totalTicks++;
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) { this.weather = this.weather ? 0 : Math.random() < .55 ? 1 : 0; this.weatherTimer = 360 + Math.random() * 600; }
    for (const [key, f] of this.containers) if (f.type === 'furnace') {
      const [fx, fy, fz] = key.split(',').map(Number);
      if (!this.chunks.has(chunkKey(Math.floor(fx / 16), Math.floor(fz / 16)))) continue;
      const input = f.slots[0]?.id || 0;
      if (f.recipeInput !== undefined && f.recipeInput !== input) f.progress = 0;
      f.recipeInput = input;
      const output = SMELTING[f.slots[0]?.id];
      const possible = output && (!f.slots[2] || f.slots[2].id === output && f.slots[2].count < 64);
      const wasBurning = f.burn > 0; f.burn = Math.max(0, f.burn - dt);
      if (!f.burn && possible && items[f.slots[1]?.id]?.fuel) {
        const fuel = f.slots[1]; f.burn = f.burnMax = items[fuel.id].fuel;
        if (fuel.id === I.LAVA_BUCKET) f.slots[1] = makeStack(I.BUCKET);
        else if (--fuel.count === 0) f.slots[1] = null;
      }
      if (f.burn > 0 && possible) {
        f.progress += dt;
        if (f.progress >= 10) {
          f.progress -= 10; if (--f.slots[0].count === 0) f.slots[0] = null;
          if (f.slots[2]) f.slots[2].count++; else f.slots[2] = makeStack(output);
        }
      } else f.progress = Math.max(0, f.progress - dt * 2);
      if ((f.burn > 0) !== wasBurning) {
        const [x, y, z] = key.split(',').map(Number); const id = this.get(x, y, z, false);
        if ([B.FURNACE, B.FURNACE_ON].includes(id)) this.set(x, y, z, f.burn > 0 ? B.FURNACE_ON : B.FURNACE, this.getState(x, y, z), false);
      }
    }
    if (this.totalTicks % 20 === 0) for (const [key, age] of this.growing) {
      const [x, y, z] = key.split(',').map(Number); if (!this.chunks.has(chunkKey(Math.floor(x / 16), Math.floor(z / 16)))) continue;
      const id = this.get(x, y, z, false); let threshold = id === B.SAPLING ? 160 : id === B.SUGAR_CANE ? 100 : 50;
      if (id >= B.WHEAT0 && id < B.WHEAT7) {
        let water = false;
        for (let dx = -4; dx <= 4 && !water; dx++) for (let dz = -4; dz <= 4; dz++) if (this.get(x + dx, y - 1, z + dz, false) === B.WATER) { water = true; break; }
        if (!water) threshold *= 3;
      }
      if (age + 1 < threshold) { this.growing.set(key, age + 1); continue; }
      if (id === B.SAPLING) { if (!this.growTree(x, y, z)) this.growing.set(key, 0); }
      else if (id >= B.WHEAT0 && id < B.WHEAT7) { this.set(x, y, z, id + 1); if (id + 1 < B.WHEAT7) this.growing.set(key, 0); }
      else if (id === B.SUGAR_CANE) {
        if (!this.get(x, y + 1, z) && this.get(x, y - 2, z) !== B.SUGAR_CANE) this.set(x, y + 1, z, B.SUGAR_CANE);
        this.growing.set(key, 0);
      } else this.growing.delete(key);
    }
    tickEnvironment(this);
    this.redstone.tick(bodies);
    const updates = Math.min(128, this.updateQueue.length);
    for (let n = 0; n < updates; n++) {
      const [x, y, z, key] = this.updateQueue.shift(); this.updateSet.delete(key);
      const id = this.get(x, y, z, false), def = blocks[id];
      if (id && !supported(this, x, y, z, id, this.getState(x, y, z))) { removeBlock(this, x, y, z); continue; }
      if (def?.falling && y > 0 && !isSolid(this.get(x, y - 1, z))) {
        this.set(x, y, z, B.AIR); this.events.push({ type: 'fall', id, x, y, z }); continue;
      }
      if (blocks[id]?.liquid) this.fluids.schedule(x, y, z);
    }
    this.fluids.tick();
  }
  toJSON() {
    return { seed: this.seed, dimension: this.dimension, generationVersion: this.generationVersion, endFight: this.endFight?.toJSON(), time: this.time, totalTicks: this.totalTicks, weather: this.weather, weatherTimer: this.weatherTimer,
      edits: [...this.edits].map(([key, edits]) => [key, [...edits]]), containers: [...this.containers], growing: [...this.growing],
      pendingUpdates: this.updateQueue.map(([x, y, z]) => [x, y, z]), leafQueue: this.leafQueue.map(leaf => ({ ...leaf })), redstone: this.redstone.toJSON(), fluids: this.fluids.toJSON() };
  }
  raycast(origin, direction, reach = 4.5, liquids = false) {
    const o = [origin.x, origin.y, origin.z], d = [direction.x, direction.y, direction.z], cell = o.map(Math.floor);
    const step = d.map(v => v > 0 ? 1 : -1), delta = d.map(v => v ? Math.abs(1 / v) : Infinity);
    const next = d.map((v, i) => v ? ((cell[i] + (v > 0 ? 1 : 0)) - o[i]) / v : Infinity);
    let traveled = 0;
    while (traveled <= reach) {
      const [x, y, z] = cell, id = this.get(x, y, z, false);
      if (id && id !== B.PORTAL && id !== B.END_PORTAL && (!blocks[id]?.liquid || liquids && this.getState(x, y, z) === 0)) {
        const state = this.getState(x, y, z); let hit = null;
        const shapes = blocks[id]?.liquid ? [[0, 0, 0, 1, fluidHeight(this, x, y, z, id), 1]] : selectionShapes(id, state);
        for (const box of shapes) {
          const candidate = intersectBox(o, d, [box[0] + x, box[1] + y, box[2] + z, box[3] + x, box[4] + y, box[5] + z]);
          if (candidate && (!hit || candidate.distance < hit.distance)) hit = candidate;
        }
        if (hit && hit.distance <= reach && hit.distance >= traveled - .001) return { x, y, z, id, state, ...hit, point: { x: o[0] + d[0] * hit.distance, y: o[1] + d[1] * hit.distance, z: o[2] + d[2] * hit.distance } };
      }
      let axis = next[0] < next[1] ? 0 : 1; if (next[2] < next[axis]) axis = 2;
      traveled = next[axis]; cell[axis] += step[axis]; next[axis] += delta[axis];
    }
    return null;
  }
}
export function intersectBox(origin, direction, box) {
  let near = -Infinity, far = Infinity, normal = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    const d = direction[axis], o = origin[axis];
    if (Math.abs(d) < 1e-10) { if (o < box[axis] || o > box[axis + 3]) return null; continue; }
    const a = (box[axis] - o) / d, b = (box[axis + 3] - o) / d;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    if (lo > near) { near = lo; normal = [0, 0, 0]; normal[axis] = d > 0 ? -1 : 1; }
    far = Math.min(far, hi); if (near > far || far < 0) return null;
  }
  return { distance: Math.max(0, near), normal };
}
