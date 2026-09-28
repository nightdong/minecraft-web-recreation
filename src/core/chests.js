import { B, blocks } from './blocks.js';

const axisFor = state => state & 1 ? [0, 1] : [1, 0];
const positionKey = p => `${p.x},${p.y},${p.z}`;

export function chestPositions(world, x, y, z) {
  const own = { x, y, z }; if (world.get(x, y, z, false) !== B.CHEST) return [];
  const state = world.getState(x, y, z), side = state & 12;
  if (side !== 4 && side !== 8) return [own];
  const [dx, dz] = axisFor(state), sign = side === 4 ? 1 : -1;
  const other = { x: x + dx * sign, y, z: z + dz * sign };
  if (world.get(other.x, y, other.z, false) !== B.CHEST) return [own];
  const neighbor = world.getState(other.x, y, other.z);
  if ((neighbor & 3) !== (state & 3) || (neighbor & 12) !== (side === 4 ? 8 : 4)) return [own];
  return side === 4 ? [own, other] : [other, own];
}

/** Pair state belongs to the two blocks, while their 27-slot stores remain
 * separate. Breaking one half can never duplicate or delete the other half. */
export function reconcileChest(world, x, y, z, oldId, oldState, id) {
  if (oldId === B.CHEST && id !== B.CHEST && oldState & 12) {
    const [dx, dz] = axisFor(oldState), sign = oldState & 4 ? 1 : -1;
    const nx = x + dx * sign, nz = z + dz * sign;
    if (world.get(nx, y, nz) === B.CHEST) {
      const other = world.getState(nx, y, nz);
      if ((other & 3) === (oldState & 3) && (other & 12) === (sign > 0 ? 8 : 4)) world.set(nx, y, nz, B.CHEST, other & 3, false);
    }
  }
  if (id !== B.CHEST || oldId === B.CHEST) return;
  const state = world.getState(x, y, z); if (state & 12) return;
  const [dx, dz] = axisFor(state);
  for (const sign of [-1, 1]) {
    const nx = x + dx * sign, nz = z + dz * sign;
    if (world.get(nx, y, nz, false) !== B.CHEST || world.getState(nx, y, nz) !== (state & 3)) continue;
    // Materialize legitimate natural loot before pairing marks the old block as edited.
    world.container(nx, y, nz, 'chest');
    world.set(x, y, z, B.CHEST, (state & 3) | (sign > 0 ? 4 : 8), false);
    world.set(nx, y, nz, B.CHEST, (state & 3) | (sign > 0 ? 8 : 4), false);
    break;
  }
}

export function chestBlocked(world, x, y, z) {
  const positions = chestPositions(world, x, y, z);
  return !positions.length || positions.some(p => blocks[world.get(p.x, p.y + 1, p.z, false)]?.opaque);
}

export function chestView(world, x, y, z) {
  const positions = chestPositions(world, x, y, z);
  if (!positions.length) return null;
  const stores = positions.map(p => world.container(p.x, p.y, p.z, 'chest'));
  if (stores.length === 1) return { type: 'chest', name: '箱子', positions, slots: stores[0].slots };
  // An array-compatible live view, not a copied inventory. Array iteration,
  // index replacement, split stacks and shift transfers all address the owners.
  const slots = new Proxy(Array(54).fill(null), {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^(?:0|[1-9]\d*)$/.test(property)) {
        const i = Number(property); return i < 54 ? stores[Math.floor(i / 27)].slots[i % 27] : undefined;
      }
      return Reflect.get(target, property, receiver);
    },
    set(target, property, value) {
      if (typeof property === 'string' && /^(?:0|[1-9]\d*)$/.test(property)) {
        const i = Number(property); if (i >= 54) return false;
        stores[Math.floor(i / 27)].slots[i % 27] = value; return true;
      }
      return property === 'length' && value === 54;
    }
  });
  return { type: 'chest', name: '大型箱子', positions, slots, signature: positions.map(positionKey).join('|') };
}
