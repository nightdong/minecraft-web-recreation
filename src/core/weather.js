import { B, blocks, boxFor } from './blocks.js';

export function precipitationAt(world, x, z) {
  if (world.dimension !== 'overworld') return null;
  x = Math.floor(x); z = Math.floor(z);
  const chunk = world.chunks?.get(`${Math.floor(x / 16)},${Math.floor(z / 16)}`); if (!chunk) return null;
  const biome = chunk.biomes[(x & 15) + (z & 15) * 16];
  return biome === 4 ? null : biome === 6 ? 'snow' : 'rain';
}

export function precipitationHeight(world, x, z) {
  x = Math.floor(x); z = Math.floor(z);
  const chunk = world.chunks?.get(`${Math.floor(x / 16)},${Math.floor(z / 16)}`); if (!chunk) return Infinity;
  const column = (x & 15) + (z & 15) * 16;
  if (chunk.precipitation) return chunk.precipitation[column];
  // Compatibility for immutable render/test neighborhoods without the cache.
  for (let y = 127; y >= 0; y--) {
    const id = world.get(x, y, z, false);
    if (blocks[id]?.solid || blocks[id]?.liquid) return y + (id === B.WATER || id === B.LAVA ? 1 : boxFor(id, world.getState(x, y, z))?.[4] || 1);
  }
  return 0;
}

export function animationStep(game, dt) { return game.activeWorld && game.paused ? 0 : dt; }
