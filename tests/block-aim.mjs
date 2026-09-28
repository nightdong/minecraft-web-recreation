import { selectionShapes } from '../src/core/blocks.js';

/** Candidate points on the actual selectable surfaces. Aiming at a cube's
 * center from a steep angle can hit the next block before reaching that center. */
export function blockAimPoints(position, id, state, eye) {
  const axes = ['x', 'y', 'z'], candidates = [], centers = [];
  for (const shape of selectionShapes(id, state)) {
    const center = Object.fromEntries(axes.map((axis, i) => [axis, position[axis] + (shape[i] + shape[i + 3]) / 2]));
    centers.push(center);
    for (let i = 0; i < 3; i++) for (const sign of [-1, 1]) {
      const axis = axes[i], surface = position[axis] + shape[i + (sign > 0 ? 3 : 0)];
      if ((eye[axis] - surface) * sign <= 0) continue;
      candidates.push({ ...center, [axis]: surface - sign * .001 });
    }
  }
  candidates.sort((a, b) => Math.hypot(a.x - eye.x, a.y - eye.y, a.z - eye.z) - Math.hypot(b.x - eye.x, b.y - eye.y, b.z - eye.z));
  return [...candidates, ...centers];
}
