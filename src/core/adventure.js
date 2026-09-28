import { B } from './blocks.js';
import { hash, seedNumber } from './noise.js';

const index = (x, y, z) => x + z * 16 + y * 256;
export const END_SPAWN = Object.freeze({ x: 100.5, y: 49, z: .5 });

export function strongholds(seed) {
  seed = seedNumber(seed); const angle = hash(0, 900, 0, seed) * Math.PI * 2, result = [];
  for (let ring = 0; ring < 3; ring++) {
    const count = 3 + ring * 3;
    for (let i = 0; i < count; i++) {
      const a = angle + i / count * Math.PI * 2 + ring * .73, radius = 1100 + ring * 1800 + hash(i, 901 + ring, 0, seed) * 400;
      result.push({ x: Math.round(Math.cos(a) * radius / 16) * 16, y: 28 + Math.floor(hash(i, 910, ring, seed) * 8), z: Math.round(Math.sin(a) * radius / 16) * 16 });
    }
  }
  return result;
}

export function nearestStronghold(seed, position) {
  return strongholds(seed).reduce((best, p) => !best || Math.hypot(p.x + 24 - position.x, p.z - position.z) < Math.hypot(best.x + 24 - position.x, best.z - position.z) ? p : best, null);
}

export function endFrames(center) {
  const frames = [];
  for (let offset = -1; offset <= 1; offset++) {
    frames.push({ x: center.x + offset, y: center.y, z: center.z - 2, state: 2 });
    frames.push({ x: center.x + offset, y: center.y, z: center.z + 2, state: 0 });
    frames.push({ x: center.x - 2, y: center.y, z: center.z + offset, state: 1 });
    frames.push({ x: center.x + 2, y: center.y, z: center.z + offset, state: 3 });
  }
  return frames;
}

export function activateEndPortal(world, frame) {
  // The inserted eye can belong to any side, but all twelve faces must point
  // into the same 3x3 interior. Merely having twelve frames nearby is insufficient.
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const center = { x: frame.x + dx, y: frame.y, z: frame.z + dz }, ring = endFrames(center);
    if (!ring.some(p => p.x === frame.x && p.z === frame.z)) continue;
    if (!ring.every(p => world.get(p.x, p.y, p.z, false) === B.END_PORTAL_FRAME && world.getState(p.x, p.y, p.z) === (p.state | 4))) continue;
    for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) world.set(center.x + x, center.y, center.z + z, B.END_PORTAL, 0, false);
    return center;
  }
  return null;
}

export function fortressCenter(seed, gx, gz) {
  seed = seedNumber(seed);
  return { x: gx * 192 + 80 + Math.floor(hash(gx, 930, gz, seed) * 32), y: 58 + Math.floor(hash(gx, 931, gz, seed) * 8), z: gz * 192 + 80 + Math.floor(hash(gx, 932, gz, seed) * 32) };
}

export function fortressNear(seed, x, z) {
  const gx = Math.floor(x / 192), gz = Math.floor(z / 192);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const center = fortressCenter(seed, gx + dx, gz + dz);
    if (Math.max(Math.abs(x - center.x), Math.abs(z - center.z)) <= 43) return center;
  }
  return null;
}

function writer(cx, cz, data, states) {
  const ox = cx * 16, oz = cz * 16;
  const put = (x, y, z, id, state = 0) => {
    const lx = x - ox, lz = z - oz;
    if (lx < 0 || lx >= 16 || lz < 0 || lz >= 16 || y < 0 || y >= 128) return;
    const i = index(lx, y, lz); data[i] = id; states[i] = state;
  };
  const box = (x0, y0, z0, x1, y1, z1, id, state = 0) => {
    for (let z = Math.max(oz, z0); z <= Math.min(oz + 15, z1); z++) for (let x = Math.max(ox, x0); x <= Math.min(ox + 15, x1); x++) for (let y = Math.max(0, y0); y <= Math.min(127, y1); y++) put(x, y, z, id, state);
  };
  return { put, box };
}

export function decorateStrongholds(terrain, cx, cz, data, state) {
  const { put, box } = writer(cx, cz, data, state), ox = cx * 16, oz = cz * 16;
  for (const s of strongholds(terrain.seed)) {
    if (ox > s.x + 33 || ox + 15 < s.x - 24 || oz > s.z + 30 || oz + 15 < s.z - 13) continue;
    const room = (x, z, rx, rz, h, kind) => {
      box(x - rx, s.y, z - rz, x + rx, s.y + h, z + rz, B.STONE_BRICKS);
      box(x - rx + 1, s.y + 1, z - rz + 1, x + rx - 1, s.y + h - 1, z + rz - 1, B.AIR);
      for (let wz = Math.max(oz, z - rz); wz <= Math.min(oz + 15, z + rz); wz++) for (let wx = Math.max(ox, x - rx); wx <= Math.min(ox + 15, x + rx); wx++) {
        if (hash(wx, s.y, wz, terrain.seed) < .2) put(wx, s.y, wz, B.MOSSY_COBBLE);
      }
      if (kind === 'library') {
        for (const dx of [-rx + 1, rx - 1]) box(x + dx, s.y + 1, z - rz + 1, x + dx, s.y + h - 2, z + rz - 1, B.BOOKSHELF);
        for (let dz = -rz + 2; dz <= rz - 2; dz += 4) box(x - 2, s.y + 1, z + dz, x + 2, s.y + 2, z + dz, B.BOOKSHELF);
        put(x + rx - 2, s.y + 1, z + rz - 2, B.CHEST);
      }
      if (kind === 'prison') for (let dz = -rz + 2; dz <= rz - 2; dz += 3) box(x, s.y + 1, z + dz, x + rx - 1, s.y + 3, z + dz, B.IRON_BARS);
      put(x - rx + 1, s.y + 3, z, B.TORCH, 1); put(x + rx - 1, s.y + 3, z, B.TORCH, 2);
    };
    room(s.x, s.z, 6, 6, 6, 'stairs'); room(s.x - 17, s.z, 7, 9, 5, 'prison');
    room(s.x, s.z + 21, 7, 9, 8, 'library'); room(s.x + 24, s.z, 8, 12, 8, 'portal');
    // Connected, traversable corridors, including the portal room doorway.
    box(s.x - 17, s.y, s.z - 2, s.x + 24, s.y + 4, s.z + 2, B.STONE_BRICKS);
    box(s.x - 17, s.y + 1, s.z - 1, s.x + 16, s.y + 3, s.z + 1, B.AIR);
    box(s.x - 2, s.y, s.z + 6, s.x + 2, s.y + 4, s.z + 21, B.STONE_BRICKS);
    box(s.x - 1, s.y + 1, s.z + 5, s.x + 1, s.y + 3, s.z + 21, B.AIR);
    box(s.x + 16, s.y + 1, s.z - 1, s.x + 31, s.y + 6, s.z + 1, B.AIR);
    const center = { x: s.x + 24, y: s.y + 2, z: s.z };
    box(center.x - 3, s.y + 1, center.z - 3, center.x + 3, s.y + 1, center.z + 3, B.STONE_BRICKS);
    box(center.x - 1, s.y + 1, center.z - 1, center.x + 1, s.y + 1, center.z + 1, B.LAVA);
    for (const frame of endFrames(center)) put(frame.x, frame.y, frame.z, B.END_PORTAL_FRAME, frame.state | (hash(frame.x, frame.y, frame.z, terrain.seed) < .1 ? 4 : 0));
    for (let offset = -1; offset <= 1; offset++) put(center.x - 3, s.y + 1, center.z + offset, B.STONE_STAIRS, 3);
    put(s.x - 5, s.y + 1, s.z + 4, B.CHEST);
  }
}

export function decorateFortresses(terrain, cx, cz, data, state) {
  const ox = cx * 16, oz = cz * 16, { put, box } = writer(cx, cz, data, state);
  for (let gz = Math.floor((oz - 44) / 192); gz <= Math.floor((oz + 59) / 192); gz++) for (let gx = Math.floor((ox - 44) / 192); gx <= Math.floor((ox + 59) / 192); gx++) {
    const c = fortressCenter(terrain.seed, gx, gz), y = c.y;
    if (ox > c.x + 43 || ox + 15 < c.x - 43 || oz > c.z + 43 || oz + 15 < c.z - 43) continue;
    for (const axis of [0, 1]) {
      const rotatedBox = (u0, v0, u1, v1, y0, y1, id) => axis ? box(c.x + v0, y0, c.z + u0, c.x + v1, y1, c.z + u1, id) : box(c.x + u0, y0, c.z + v0, c.x + u1, y1, c.z + v1, id);
      rotatedBox(-40, -3, 40, 3, y - 2, y, B.NETHER_BRICKS);
      rotatedBox(-40, -2, 40, 2, y + 1, y + 5, B.AIR);
      for (const side of [-3, 3]) rotatedBox(-40, side, 40, side, y + 1, y + 2, B.NETHER_FENCE);
      for (let u = -36; u <= 36; u += 12) rotatedBox(u - 2, -2, u + 2, 2, y - 18, y - 3, B.NETHER_BRICKS);
    }
    box(c.x - 6, y - 1, c.z - 6, c.x + 6, y + 6, c.z + 6, B.NETHER_BRICKS);
    box(c.x - 5, y + 1, c.z - 5, c.x + 5, y + 5, c.z + 5, B.AIR);
    box(c.x - 7, y + 1, c.z - 1, c.x + 7, y + 4, c.z + 1, B.AIR);
    box(c.x - 1, y + 1, c.z - 7, c.x + 1, y + 4, c.z + 7, B.AIR);
    for (const sign of [-1, 1]) {
      const x = c.x + sign * 35;
      box(x - 6, y - 2, c.z - 6, x + 6, y, c.z + 6, B.NETHER_BRICKS);
      box(x - 6, y + 1, c.z - 6, x + 6, y + 5, c.z + 6, B.AIR);
      for (const edge of [-6, 6]) { box(x + edge, y + 1, c.z - 6, x + edge, y + 2, c.z + 6, B.NETHER_FENCE); box(x - 6, y + 1, c.z + edge, x + 6, y + 2, c.z + edge, B.NETHER_FENCE); }
      box(x - 6, y + 1, c.z - 1, x + 6, y + 3, c.z + 1, B.AIR);
      put(x, y + 1, c.z, B.SPAWNER, 1);
    }
    put(c.x + 4, y + 1, c.z + 4, B.CHEST);
    for (const x of [-4, 4]) put(c.x + x, y + 1, c.z - 4, B.TORCH);
  }
}

export function endPillars(seed) {
  seed = seedNumber(seed);
  const order = Array.from({ length: 10 }, (_, i) => i).sort((a, b) => hash(a, 971, 0, seed) - hash(b, 971, 0, seed));
  return Array.from({ length: 10 }, (_, i) => ({ x: Math.round(Math.cos(i * Math.PI / 5) * 42), z: Math.round(Math.sin(i * Math.PI / 5) * 42), y: 76 + order[i] * 3, radius: 2 + Math.floor(order[i] / 3), cage: order[i] < 2 }));
}

export function generateEnd(terrain, cx, cz) {
  const data = new Uint16Array(32768), state = new Uint8Array(32768), heights = new Uint8Array(256), biomes = new Uint8Array(256).fill(10);
  const ox = cx * 16, oz = cz * 16, { put, box } = writer(cx, cz, data, state);
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const wx = ox + x, wz = oz + z, radius = Math.hypot(wx, wz), noise = terrain.noise.fbm(wx / 44, wz / 44, 3);
    let mass = 1 - radius / 94 + noise * .18;
    if (radius > 850) mass = terrain.noise.fbm(wx / 170 + 300, wz / 170 - 250, 4) * 1.6 - .05;
    if (mass <= 0) continue;
    const top = Math.floor(58 + Math.min(.8, mass) * 10 + noise * 4), bottom = Math.max(5, Math.floor(top - Math.min(.9, mass) * 35 - 2));
    for (let y = bottom; y <= top; y++) data[index(x, y, z)] = B.END_STONE;
    heights[x + z * 16] = top;
  }
  for (const pillar of endPillars(terrain.seed)) {
    if (ox > pillar.x + pillar.radius + 2 || ox + 15 < pillar.x - pillar.radius - 2 || oz > pillar.z + pillar.radius + 2 || oz + 15 < pillar.z - pillar.radius - 2) continue;
    for (let z = pillar.z - pillar.radius; z <= pillar.z + pillar.radius; z++) for (let x = pillar.x - pillar.radius; x <= pillar.x + pillar.radius; x++) {
      if ((x - pillar.x) ** 2 + (z - pillar.z) ** 2 > pillar.radius ** 2 + 1) continue;
      box(x, 35, z, x, pillar.y, z, B.OBSIDIAN);
    }
    put(pillar.x, pillar.y + 1, pillar.z, B.BEDROCK);
    if (pillar.cage) for (let z = -2; z <= 2; z++) for (let x = -2; x <= 2; x++) for (let y = 1; y <= 4; y++) {
      if (Math.abs(x) === 2 || Math.abs(z) === 2 || y === 4) put(pillar.x + x, pillar.y + y, pillar.z + z, B.IRON_BARS);
    }
  }
  // Inactive exit fountain; victory replaces only its center with portal blocks.
  box(-4, 63, -4, 4, 73, 4, B.AIR);
  for (let z = -3; z <= 3; z++) for (let x = -3; x <= 3; x++) if (x * x + z * z <= 12) {
    put(x, 62, z, B.BEDROCK); put(x, 63, z, Math.max(Math.abs(x), Math.abs(z)) >= 3 ? B.BEDROCK : B.AIR);
  }
  box(0, 63, 0, 0, 66, 0, B.BEDROCK);
  for (const [x, z, s] of [[1, 0, 1], [-1, 0, 2], [0, 1, 3], [0, -1, 4]]) put(x, 65, z, B.TORCH, s);
  box(98, 48, -2, 102, 48, 2, B.OBSIDIAN); box(98, 49, -2, 102, 52, 2, B.AIR);
  return { cx, cz, data, state, heights, biomes, maxHeight: 110 };
}
