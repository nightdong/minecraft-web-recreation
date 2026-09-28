import { B, blocks, isSolid, isOpaque } from './blocks.js';
import { removeBlock } from './environment.js';

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const NEIGHBORS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const key = (x, y, z) => `${x},${y},${z}`;
const loaded = (world, x, z) => world.chunks.has(`${Math.floor(x / 16)},${Math.floor(z / 16)}`);

export function fluidHeight(world, x, y, z, id = world.get(x, y, z, false)) {
  if (!blocks[id]?.liquid) return 0;
  if (world.get(x, y + 1, z, false) === id || world.getState(x, y, z) >= 8) return 1;
  return (8 - (world.getState(x, y, z) & 7)) / 9;
}
export function fluidCorner(world, x, y, z, id) {
  let weight = 0, sum = 0;
  for (const dx of [-1, 0]) for (const dz of [-1, 0]) {
    const block = world.get(x + dx, y, z + dz, false);
    if (block === id) {
      const height = fluidHeight(world, x + dx, y, z + dz, id); if (height === 1) return 1;
      const w = height > .8 ? 10 : 1; sum += height * w; weight += w;
    } else if (!isSolid(block)) weight++;
  }
  return weight ? sum / weight : 0;
}
export function fluidSurface(world, x, y, z) {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z), id = world.get(bx, by, bz, false);
  if (!blocks[id]?.liquid) return by;
  const a = fluidCorner(world, bx, by, bz, id), b = fluidCorner(world, bx + 1, by, bz, id);
  const c = fluidCorner(world, bx, by, bz + 1, id), d = fluidCorner(world, bx + 1, by, bz + 1, id);
  const u = x - bx, v = z - bz;
  // Match the rendered triangle diagonal, rather than a different bilinear patch.
  return by + (u + v <= 1 ? a * (1 - u - v) + b * u + c * v : d * (u + v - 1) + b * (1 - v) + c * (1 - u));
}
export function fluidAt(world, x, y, z) {
  const id = world.get(x, y, z, false);
  return blocks[id]?.liquid && y < fluidSurface(world, x, y, z) - .001 ? id : B.AIR;
}
export function flowVector(world, x, y, z) {
  x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
  const id = world.get(x, y, z, false), own = fluidHeight(world, x, y, z, id); if (!own) return [0, 0, 0];
  let vx = 0, vz = 0;
  for (const [dx, dz] of SIDES) {
    const other = world.get(x + dx, y, z + dz, false);
    const delta = other === id ? own - fluidHeight(world, x + dx, y, z + dz, id) : !isSolid(other) && world.get(x + dx, y - 1, z + dz, false) === id ? own + 1 - fluidHeight(world, x + dx, y - 1, z + dz, id) : 0;
    vx += delta * dx; vz += delta * dz;
  }
  const length = Math.hypot(vx, vz); if (length > 0) { vx /= length; vz /= length; }
  return [vx, world.getState(x, y, z) >= 8 ? -.5 : 0, vz];
}

/** Fluids have their own scheduled tick queue. Rendering frequency never changes
 * flow speed; new cells cannot recursively flood an entire lake in one tick. */
export class FluidSystem {
  constructor(world, saved = {}) { this.world = world; this.pending = new Map(saved.pending || []); }
  delay(id) { return id === B.WATER ? 5 : this.world.dimension === 'nether' ? 10 : 30; }
  schedule(x, y, z, id = this.world.get(x, y, z, false)) {
    if (!blocks[id]?.liquid || y < 0 || y >= 128 || !loaded(this.world, x, z)) return;
    const position = key(x, y, z), existing = this.pending.get(position), due = this.world.totalTicks + this.delay(id);
    if (!existing || existing.id !== id || existing.due !== null && existing.due > due) this.pending.set(position, { id, due });
  }
  changed(x, y, z, id) {
    if (blocks[id]?.liquid) this.schedule(x, y, z, id); else this.pending.delete(key(x, y, z));
    for (const [dx, dy, dz] of NEIGHBORS) this.schedule(x + dx, y + dy, z + dz);
  }
  registerChunk(chunk) {
    for (const [position, update] of this.pending) {
      const [x, , z] = position.split(',').map(Number);
      if (Math.floor(x / 16) === chunk.cx && Math.floor(z / 16) === chunk.cz && update.due === null) {
        update.due = this.world.totalTicks + (update.remaining || 0); delete update.remaining;
      }
    }
    for (const [i, value] of this.world.edits.get(chunk.key) || []) if (blocks[value[0]]?.liquid) this.schedule(chunk.cx * 16 + (i & 15), i >> 8, chunk.cz * 16 + ((i >> 4) & 15), value[0]);
    // A source can become idle while its destination chunk is absent. Wake only
    // exposed boundary cells when that destination actually becomes available.
    for (const [dx, dz] of SIDES) {
      if (!this.world.chunks.has(`${chunk.cx + dx},${chunk.cz + dz}`)) continue;
      for (let t = 0; t < 16; t++) for (let y = 1; y < 128; y++) {
        const x = chunk.cx * 16 + (dx ? dx > 0 ? 15 : 0 : t), z = chunk.cz * 16 + (dz ? dz > 0 ? 15 : 0 : t);
        const a = this.world.get(x, y, z, false), b = this.world.get(x + dx, y, z + dz, false);
        if (a === b) continue;
        if (blocks[a]?.liquid && !isSolid(b)) this.schedule(x, y, z, a);
        if (blocks[b]?.liquid && !isSolid(a)) this.schedule(x + dx, y, z + dz, b);
      }
    }
  }
  unload(chunk) {
    for (const [position, update] of this.pending) {
      const [x, , z] = position.split(',').map(Number);
      if (Math.floor(x / 16) === chunk.cx && Math.floor(z / 16) === chunk.cz && update.due !== null) {
        update.remaining = Math.max(0, update.due - this.world.totalTicks); update.due = null;
      }
    }
  }
  canFill(x, y, z, id) {
    if (y < 0 || y >= 128 || !loaded(this.world, x, z)) return false;
    const old = this.world.get(x, y, z, false);
    if (old === B.PORTAL) return false;
    if (blocks[old]?.liquid) return old !== id;
    return !isSolid(old) || blocks[old]?.shape === 'snow';
  }
  fill(x, y, z, id, level) {
    const old = this.world.get(x, y, z, false);
    if (old === id) {
      const existing = this.world.getState(x, y, z);
      if (existing && (level === 8 && existing !== 8 || level < existing && existing !== 8)) this.world.set(x, y, z, id, level);
      return;
    }
    if (!this.canFill(x, y, z, id)) return;
    if (blocks[old]?.liquid) {
      this.world.set(x, y, z, id === B.LAVA ? B.STONE : this.world.getState(x, y, z) === 0 ? B.OBSIDIAN : B.COBBLE);
      this.world.events.push({ type: 'fizz', x, y, z }); return;
    }
    if (old) removeBlock(this.world, x, y, z, id === B.WATER);
    this.world.set(x, y, z, id, level);
  }
  slopeDistance(x, y, z, id, depth, previous, visited) {
    if (this.canFill(x, y - 1, z, id)) return 0;
    if (depth <= 0) return 1000;
    let best = 1000;
    for (let i = 0; i < 4; i++) {
      if (i === previous) continue;
      const [dx, dz] = SIDES[i], nx = x + dx, nz = z + dz, k = key(nx, y, nz);
      if (visited.has(k) || !this.canFill(nx, y, nz, id)) continue;
      visited.add(k); best = Math.min(best, 1 + this.slopeDistance(nx, y, nz, id, depth - 1, i ^ 1, visited)); visited.delete(k);
    }
    return best;
  }
  update(x, y, z, id) {
    const world = this.world; if (world.get(x, y, z, false) !== id) return;
    let level = world.getState(x, y, z), below = world.get(x, y - 1, z, false);
    const loss = id === B.LAVA && world.dimension !== 'nether' ? 2 : 1;
    if (id === B.LAVA && [[0, 1, 0], ...SIDES.map(([dx, dz]) => [dx, 0, dz])].some(([dx, dy, dz]) => world.get(x + dx, y + dy, z + dz, false) === B.WATER)) {
      world.set(x, y, z, level === 0 ? B.OBSIDIAN : B.COBBLE); world.events.push({ type: 'fizz', x, y, z }); return;
    }
    if (id === B.WATER) for (const [dx, dy, dz] of [[0, -1, 0], ...SIDES.map(([dx, dz]) => [dx, 0, dz])]) {
      if (world.get(x + dx, y + dy, z + dz, false) === B.LAVA) {
        world.set(x + dx, y + dy, z + dz, world.getState(x + dx, y + dy, z + dz) === 0 ? B.OBSIDIAN : B.COBBLE);
        world.events.push({ type: 'fizz', x: x + dx, y: y + dy, z: z + dz });
      }
    }
    if (level !== 0) {
      let sources = 0, minimum = 100;
      for (const [dx, dz] of SIDES) if (world.get(x + dx, y, z + dz, false) === id) {
        const other = world.getState(x + dx, y, z + dz); if (other === 0) sources++;
        if (other < 8) minimum = Math.min(minimum, other);
        else if (isSolid(world.get(x + dx, y - 1, z + dz, false))) minimum = Math.min(minimum, 0);
      }
      const next = id === B.WATER && sources >= 2 && (isSolid(below) || below === id && world.getState(x, y - 1, z) === 0) ? 0 : world.get(x, y + 1, z, false) === id ? 8 : minimum + loss;
      if (next > 8 || next === 8 && world.get(x, y + 1, z, false) !== id) { world.set(x, y, z, B.AIR); return; }
      if (next !== level) { world.set(x, y, z, id, next); level = next; }
    }
    below = world.get(x, y - 1, z, false);
    if (this.canFill(x, y - 1, z, id) || below === id && world.getState(x, y - 1, z) !== 0) {
      this.fill(x, y - 1, z, id, 8); return;
    }
    const next = (level >= 8 ? 0 : level) + loss; if (next >= 8) return;
    const possibilities = [];
    for (let i = 0; i < 4; i++) {
      const [dx, dz] = SIDES[i], nx = x + dx, nz = z + dz, old = world.get(nx, y, nz, false);
      if (old === id) { this.fill(nx, y, nz, id, next); continue; }
      if (!this.canFill(nx, y, nz, id)) continue;
      const distance = this.slopeDistance(nx, y, nz, id, loss === 2 ? 2 : 4, i ^ 1, new Set([key(x, y, z), key(nx, y, nz)]));
      possibilities.push({ x: nx, z: nz, distance });
    }
    const nearest = Math.min(...possibilities.map(p => p.distance));
    for (const p of possibilities) if (p.distance === nearest) this.fill(p.x, y, p.z, id, next);
  }
  tick() {
    let budget = 512;
    for (const [position, update] of [...this.pending]) {
      if (update.due === null || update.due > this.world.totalTicks) continue;
      const [x, y, z] = position.split(',').map(Number); if (!loaded(this.world, x, z)) continue;
      this.pending.delete(position); this.update(x, y, z, update.id);
      if (--budget === 0) break;
    }
  }
  toJSON() { return { pending: [...this.pending].map(([position, update]) => [position, { ...update }]) }; }
}
