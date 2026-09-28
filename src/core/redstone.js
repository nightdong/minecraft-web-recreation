import { B, blocks, isOpaque, isSolid, PISTON_DIRECTIONS } from './blocks.js';
import { attachmentOffset, removeBlock } from './environment.js';
import { bodyBox, intersects, moveBody } from './physics.js';

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const SIDES = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const key = (x, y, z) => `${x},${y},${z}`;
const same = (a, b) => a.every((v, i) => v === b[i]);
const at = (p, d, scale = 1) => ({ x: p.x + d[0] * scale, y: p.y + d[1] * scale, z: p.z + d[2] * scale });

/** Connections use actual collision/occlusion and may cross one-block steps.
 * This is shared with the renderer, so a drawn wire is an electrical wire. */
export function wireConnections(world, x, y, z, components = true) {
  const connections = [];
  for (let direction = 0; direction < 4; direction++) {
    const [dx, dz] = SIDES[direction], adjacent = world.get(x + dx, y, z + dz, false);
    if (adjacent === B.WIRE) connections.push({ x: x + dx, y, z: z + dz, direction });
    else if (isOpaque(adjacent) && !isOpaque(world.get(x, y + 1, z, false)) && world.get(x + dx, y + 1, z + dz, false) === B.WIRE) {
      connections.push({ x: x + dx, y: y + 1, z: z + dz, direction });
    } else if (!isOpaque(adjacent) && world.get(x + dx, y - 1, z + dz, false) === B.WIRE) {
      connections.push({ x: x + dx, y: y - 1, z: z + dz, direction });
    } else if (components && blocks[adjacent]?.circuit) {
      const kind = blocks[adjacent].circuit, state = world.getState(x + dx, y, z + dz);
      if (kind !== 'repeater' || (state & 1) === (direction & 1)) connections.push({ x: x + dx, y, z: z + dz, direction });
    }
  }
  return connections;
}

export class RedstoneSystem {
  constructor(world, saved = {}) {
    this.world = world; this.nodes = new Map(); this.pending = new Map(saved.pending || []);
    this.dirty = true; this.applying = false; this.strong = new Map(); this.weak = new Map(); this.power = new Map();
  }
  registerChunk(chunk) {
    chunk.circuits = new Set();
    for (let i = 0; i < chunk.data.length; i++) if (blocks[chunk.data[i]]?.circuit) {
      const x = chunk.cx * 16 + (i & 15), y = i >> 8, z = chunk.cz * 16 + ((i >> 4) & 15);
      this.nodes.set(key(x, y, z), { x, y, z, id: chunk.data[i] }); chunk.circuits.add(i);
    }
    this.dirty = true;
  }
  unload(chunk) {
    for (const i of chunk.circuits) this.nodes.delete(key(chunk.cx * 16 + (i & 15), i >> 8, chunk.cz * 16 + ((i >> 4) & 15)));
    this.dirty = true;
  }
  changed(x, y, z, old, id, chunk, i) {
    const position = key(x, y, z);
    if (blocks[id]?.circuit) { this.nodes.set(position, { x, y, z, id }); chunk.circuits.add(i); }
    else { this.nodes.delete(position); chunk.circuits.delete(i); }
    if (blocks[old]?.circuit !== blocks[id]?.circuit) this.pending.delete(position);
    if (!this.applying || id !== B.WIRE) this.dirty = true;
  }
  state(node) { return this.world.getState(node.x, node.y, node.z); }
  id(node) { return this.world.get(node.x, node.y, node.z, false); }
  write(node, id, state) { return this.world.set(node.x, node.y, node.z, id, state, false); }
  sourceOutput(node, destination) {
    const id = this.id(node), type = blocks[id]?.circuit, state = this.state(node);
    const direction = [destination.x - node.x, destination.y - node.y, destination.z - node.z];
    if (direction.reduce((sum, v) => sum + Math.abs(v), 0) !== 1) return 0;
    if (type === 'source') return 15;
    if (type === 'lever' || type === 'button' || type === 'plate') return state & 8 ? 15 : 0;
    if (type === 'torch' && id === B.REDSTONE_TORCH) return same(direction, attachmentOffset(id, state)) ? 0 : 15;
    if (type === 'repeater' && state & 16) return same(direction, PISTON_DIRECTIONS[state & 3]) ? 15 : 0;
    return 0;
  }
  wireOutput(node, destination) {
    const strength = this.power.get(key(node.x, node.y, node.z)) || 0;
    if (!strength) return 0;
    const dx = destination.x - node.x, dy = destination.y - node.y, dz = destination.z - node.z;
    if (dx === 0 && dy === -1 && dz === 0) return strength;
    if (dy || Math.abs(dx) + Math.abs(dz) !== 1) return 0;
    const direction = SIDES.findIndex(d => d[0] === dx && d[1] === dz);
    const links = wireConnections(this.world, node.x, node.y, node.z), connected = links.map(l => l.direction);
    if (connected.length === 1) connected.push((connected[0] + 2) & 3);
    return !connected.length || connected.includes(direction) ? strength : 0;
  }
  inputAt(destination, direction) {
    let result = 0;
    for (const d of direction ? [direction] : DIRS) {
      const neighbor = at(destination, d), node = this.nodes.get(key(neighbor.x, neighbor.y, neighbor.z));
      if (node) result = Math.max(result, this.sourceOutput(node, destination), this.wireOutput(node, destination));
      if (isOpaque(this.id(neighbor))) result = Math.max(result, this.strong.get(key(neighbor.x, neighbor.y, neighbor.z)) || 0, this.weak.get(key(neighbor.x, neighbor.y, neighbor.z)) || 0);
    }
    return result;
  }
  defer(node, kind, target, delay) {
    const position = key(node.x, node.y, node.z), old = this.pending.get(position);
    if (old?.kind === kind && old.target === target) return;
    this.pending.set(position, { kind, target, due: this.world.totalTicks + delay });
  }
  interact(x, y, z) {
    const node = this.nodes.get(key(x, y, z)); if (!node) return false;
    const type = blocks[node.id]?.circuit, state = this.state(node);
    if (type === 'lever') this.write(node, node.id, state ^ 8);
    else if (type === 'button') { this.write(node, node.id, state | 8); this.defer(node, 'button', false, 20); }
    else if (type === 'repeater') { this.write(node, node.id, (state & ~12) | (((state >> 2 & 3) + 1) % 4 << 2)); this.pending.delete(key(x, y, z)); }
    else return false;
    this.world.events.push({ type: 'circuit-click', x, y, z }); return true;
  }
  applyPending() {
    for (const [position, update] of [...this.pending]) {
      if (update.due > this.world.totalTicks) continue;
      const node = this.nodes.get(position); if (!node) continue; // unloaded circuits stay suspended
      this.pending.delete(position);
      const type = blocks[this.id(node)]?.circuit, state = this.state(node);
      if (type !== update.kind) continue;
      if (type === 'button' || type === 'plate') this.write(node, node.id, state & ~8);
      if (type === 'repeater' && !(state & 32)) this.write(node, node.id, update.target ? state | 16 : state & ~16);
      if (type === 'torch') this.write(node, update.target ? B.REDSTONE_TORCH : B.REDSTONE_TORCH_OFF, state);
      if (type === 'lamp' && !update.target) this.write(node, B.REDSTONE_LAMP, 0);
    }
  }
  tick(bodies = []) {
    this.applyPending();
    for (const node of this.nodes.values()) if (blocks[node.id]?.circuit === 'plate') {
      const occupied = bodies.some(body => body.pos && body.health !== 0 && intersects(bodyBox(body), [node.x + .125, node.y, node.z + .125, node.x + .875, node.y + .25, node.z + .875]));
      const state = this.state(node);
      if (occupied) { if (!(state & 8)) this.write(node, node.id, state | 8); this.pending.delete(key(node.x, node.y, node.z)); }
      else if (state & 8) this.defer(node, 'plate', false, 10);
    }
    if (!this.dirty) return;
    this.dirty = false; this.strong.clear(); this.weak.clear(); this.power.clear();
    const nodes = [...this.nodes.values()], wires = nodes.filter(n => n.id === B.WIRE);
    const powerBlock = (map, node, strength) => { if (isOpaque(this.id(node))) { const k = key(node.x, node.y, node.z); map.set(k, Math.max(map.get(k) || 0, strength)); } };
    for (const node of nodes) {
      const type = blocks[this.id(node)]?.circuit, state = this.state(node);
      if ((type === 'lever' || type === 'button') && state & 8) powerBlock(this.strong, at(node, attachmentOffset(node.id, state)), 15);
      if (type === 'plate' && state & 8) powerBlock(this.strong, at(node, [0, -1, 0]), 15);
      if (node.id === B.REDSTONE_TORCH) powerBlock(this.strong, at(node, [0, 1, 0]), 15);
      if (type === 'repeater' && state & 16) powerBlock(this.strong, at(node, PISTON_DIRECTIONS[state & 3]), 15);
    }
    const queue = [];
    for (const node of wires) {
      let strength = 0;
      for (const d of DIRS) {
        const neighbor = at(node, d), source = this.nodes.get(key(neighbor.x, neighbor.y, neighbor.z));
        strength = Math.max(strength, source ? this.sourceOutput(source, node) : 0, this.strong.get(key(neighbor.x, neighbor.y, neighbor.z)) || 0);
      }
      if (strength) { this.power.set(key(node.x, node.y, node.z), strength); queue.push(node); }
    }
    for (let read = 0; read < queue.length; read++) {
      const node = queue[read], strength = (this.power.get(key(node.x, node.y, node.z)) || 0) - 1;
      if (strength <= 0) continue;
      for (const neighbor of wireConnections(this.world, node.x, node.y, node.z, false)) {
        const k = key(neighbor.x, neighbor.y, neighbor.z);
        if ((this.power.get(k) || 0) < strength) { this.power.set(k, strength); queue.push(neighbor); }
      }
    }
    this.applying = true;
    for (const node of wires) {
      this.write(node, B.WIRE, this.power.get(key(node.x, node.y, node.z)) || 0);
      for (const d of DIRS) { const neighbor = at(node, d); powerBlock(this.weak, neighbor, this.wireOutput(node, neighbor)); }
    }
    this.applying = false;
    for (const node of nodes) {
      const type = blocks[this.id(node)]?.circuit, state = this.state(node), position = key(node.x, node.y, node.z);
      if (type === 'torch') {
        const support = at(node, attachmentOffset(node.id, state)), k = key(support.x, support.y, support.z);
        const desired = !Math.max(this.strong.get(k) || 0, this.weak.get(k) || 0), active = node.id === B.REDSTONE_TORCH;
        if (active !== desired) this.defer(node, 'torch', desired, 2); else this.pending.delete(position);
      } else if (type === 'repeater') {
        const d = PISTON_DIRECTIONS[state & 3], sides = [[d[2], 0, -d[0]], [-d[2], 0, d[0]]];
        const locked = sides.some(side => { const n = at(node, side), other = this.nodes.get(key(n.x, n.y, n.z)); return other?.id === B.REPEATER && this.sourceOutput(other, node) > 0; });
        if (locked !== !!(state & 32)) this.write(node, node.id, locked ? state | 32 : state & ~32);
        if (locked) { this.pending.delete(position); continue; }
        const active = !!(state & 16), desired = this.inputAt(node, d.map(v => -v)) > 0;
        if (desired !== active) this.defer(node, 'repeater', desired, 2 * ((state >> 2 & 3) + 1)); else this.pending.delete(position);
      } else if (type === 'lamp') {
        const desired = this.inputAt(node) > 0;
        if (desired) { this.pending.delete(position); if (node.id !== B.REDSTONE_LAMP_ON) this.write(node, B.REDSTONE_LAMP_ON, 0); }
        else if (node.id === B.REDSTONE_LAMP_ON) this.defer(node, 'lamp', false, 4);
      } else if (type === 'door' && node.id === B.DOOR) {
        const desired = this.inputAt(node) > 0 || this.inputAt(at(node, [0, 1, 0])) > 0;
        if (desired !== !!(state & 8)) {
          const next = desired ? state | 12 : state & ~12;
          this.write(node, B.DOOR, next);
          if (this.world.get(node.x, node.y + 1, node.z, false) === B.DOOR_TOP) this.world.set(node.x, node.y + 1, node.z, B.DOOR_TOP, next, false);
          this.world.events.push({ type: 'circuit-click', ...node });
        }
      } else if (type === 'tnt' && this.inputAt(node) > 0) {
        this.world.set(node.x, node.y, node.z, B.AIR); this.world.events.push({ type: 'prime', ...node });
      } else if (type === 'piston') {
        const desired = this.inputAt(node) > 0;
        if (desired !== !!(state & 8)) this.piston(node, desired, bodies);
      }
    }
  }
  piston(node, extend, bodies) {
    const world = this.world, state = this.state(node), d = PISTON_DIRECTIONS[state & 7] || PISTON_DIRECTIONS[0], head = at(node, d);
    if (!extend) {
      if (this.id(head) === B.PISTON_HEAD && world.getState(head.x, head.y, head.z) === (state & 7)) world.set(head.x, head.y, head.z, B.AIR);
      this.write(node, B.PISTON, state & ~8); world.events.push({ type: 'piston', ...node, extending: false }); return true;
    }
    const moved = []; let cursor = head;
    while (true) {
      const id = this.id(cursor), definition = blocks[id], s = this.state(cursor);
      if (cursor.y < 1 || cursor.y >= 128 || !world.chunks.has(`${Math.floor(cursor.x / 16)},${Math.floor(cursor.z / 16)}`)) return false;
      if (!isSolid(id)) break;
      if (moved.length >= 12 || [B.BEDROCK, B.OBSIDIAN, B.PISTON_HEAD].includes(id) || definition?.station || id === B.PISTON && s & 8) return false;
      moved.push({ ...cursor, id, state: s }); cursor = at(cursor, d);
    }
    if (this.id(cursor) && !blocks[this.id(cursor)]?.liquid) removeBlock(world, cursor.x, cursor.y, cursor.z);
    // Push collision bodies before installing the destination blocks. No direct
    // teleport: the same swept collision routine handles surrounding obstacles.
    for (const target of [...moved.map(p => at(p, d)), head]) for (const body of bodies) {
      if (!body.pos || body.health === 0) continue;
      const a = bodyBox(body), b = [target.x, target.y, target.z, target.x + 1, target.y + 1, target.z + 1];
      if (!intersects(a, b)) continue;
      const axis = d.findIndex(v => v !== 0), shift = d[axis] > 0 ? b[axis + 3] - a[axis] + .001 : a[axis + 3] - b[axis] + .001;
      moveBody(world, body, d[0] * shift, d[1] * shift, d[2] * shift, 0);
      if (body.previous) body.previous = { ...body.pos };
    }
    for (let i = moved.length - 1; i >= 0; i--) { const block = moved[i], dest = at(block, d); world.set(dest.x, dest.y, dest.z, block.id, block.state); }
    world.set(head.x, head.y, head.z, B.PISTON_HEAD, state & 7);
    this.write(node, B.PISTON, state | 8); world.events.push({ type: 'piston', ...node, extending: true }); return true;
  }
  toJSON() { return { pending: [...this.pending].map(([position, update]) => [position, { ...update }]) }; }
}
