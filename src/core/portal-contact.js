import { B } from './blocks.js';

/** Portal contact is separate from the targeting ray (which intentionally skips
 * portal surfaces). A fast creative flight must not skip a one-block portal. */
export function portalContact(world, player, swept = player.creative) {
  const from = swept && player.previous ? player.previous : player.pos, to = player.pos;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), Math.abs(to.z - from.z)) * 4));
  const radius = (player.width || .6) / 2 - .001;
  for (let step = swept ? 0 : steps; step <= steps; step++) {
    const t = step / steps, x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t, z = from.z + (to.z - from.z) * t;
    for (const [dx, dz] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
      for (const dy of [.1, .9, (player.height || 1.8) - .1]) {
        const bx = Math.floor(x + dx), by = Math.floor(y + dy), bz = Math.floor(z + dz), id = world.get(bx, by, bz, false);
        if (id === B.PORTAL || id === B.END_PORTAL && y <= by + .8) return { id, x: bx, y: by, z: bz };
      }
    }
  }
  return null;
}
