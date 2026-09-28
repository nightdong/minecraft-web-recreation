import { B, blocks, collisionShapes, selectionShapes, mountPoint, mountBox, orientPoint, orientBox } from '../core/blocks.js';

/** Shared pieces for world meshes, held objects, drops, and inventory icons. */
export function mechanismParts(id, state = 0) {
  const shape = blocks[id]?.shape;
  if (shape === 'lever') {
    const angle = state & 8 ? -.58 : .58;
    return [
      { bounds: mountBox([.25, 0, .3125, .75, .1875, .6875], state & 7), texture: 'cobblestone' },
      { bounds: [.4375, .15, .4375, .5625, .7, .5625], texture: 'lever_handle', transform: point => {
        const y = point[1] - .1875, z = point[2] - .5;
        return mountPoint([point[0], .1875 + y * Math.cos(angle) - z * Math.sin(angle), .5 + y * Math.sin(angle) + z * Math.cos(angle)], state & 7);
      } }
    ];
  }
  if (shape === 'button' || shape === 'plate') return selectionShapes(id, state).map(bounds => ({ bounds, texture: 'stone' }));
  if (shape === 'repeater') {
    const facing = state & 3, texture = state & 16 ? 'redstone_torch' : 'redstone_torch_off', delay = (state >> 2 & 3);
    const parts = [{ bounds: [0, 0, 0, 1, .125, 1], texture: ['stone', 'stone', 'repeater_top', 'stone', 'stone', 'stone'], transform: point => orientPoint(point, facing) }];
    for (const z of [.72, .16 + delay * .125]) parts.push({ bounds: orientBox([.4375, .125, z - .0625, .5625, .5, z + .0625], facing), texture, crop: [7 / 16, 2 / 16, 9 / 16, 1] });
    if (state & 32) parts.push({ bounds: orientBox([.125, .15, .26, .875, .3, .39], facing), texture: 'bedrock' });
    return parts;
  }
  if (shape === 'piston' || shape === 'piston_head') return collisionShapes(id, state).map(bounds => ({ bounds }));
  return null;
}
