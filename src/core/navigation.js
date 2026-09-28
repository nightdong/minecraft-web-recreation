import { B, blocks, collisionShapes } from './blocks.js';
import { collides } from './physics.js';

const key = (x, y, z) => `${x},${y},${z}`;
const HAZARDS = new Set([B.LAVA, B.FIRE, B.CACTUS]);
const AXES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Loaded terrain only; movement and routing share the real collision shapes. */
export function standPosition(world, x, nearY, z, body, maxDrop = 3) {
  x = Math.floor(x); z = Math.floor(z);
  const radius = (body.width || .6) / 2;
  for (let cz = Math.floor((z + .5 - radius) / 16); cz <= Math.floor((z + .5 + radius) / 16); cz++) {
    for (let cx = Math.floor((x + .5 - radius) / 16); cx <= Math.floor((x + .5 + radius) / 16); cx++) {
      if (!world.chunks.has(`${cx},${cz}`)) return null;
    }
  }
  for (let y = Math.min(126, Math.floor(nearY + 1)); y >= Math.max(0, Math.floor(nearY - maxDrop - 1)); y--) {
    const id = world.get(x, y, z, false);
    if (!blocks[id]?.solid || HAZARDS.has(id)) continue;
    let top = 0;
    for (const shape of collisionShapes(id, world.getState(x, y, z))) {
      if (shape[0] <= .5 && shape[3] >= .5 && shape[2] <= .5 && shape[5] >= .5) top = Math.max(top, shape[4]);
    }
    const feet = y + top;
    if (!top || feet > nearY + 1.25 || feet < nearY - maxDrop - .001) continue;
    const pos = { x: x + .5, y: feet, z: z + .5 };
    if (collides(world, body, pos)) continue;
    if (HAZARDS.has(world.get(x, feet, z, false)) || blocks[world.get(x, feet + .1, z, false)]?.liquid) continue;
    return pos;
  }
  return null;
}

class MinHeap {
  constructor() { this.values = []; }
  push(node) {
    const a = this.values; a.push(node); let i = a.length - 1;
    while (i) { const p = (i - 1) >> 1; if (a[p].f <= node.f) break; a[i] = a[p]; i = p; }
    a[i] = node;
  }
  pop() {
    const a = this.values, first = a[0], last = a.pop();
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let c = i * 2 + 1; if (c + 1 < a.length && a[c + 1].f < a[c].f) c++;
        if (a[c].f >= last.f) break; a[i] = a[c]; i = c;
      }
      a[i] = last;
    }
    return first;
  }
}

export class RouteSearch {
  constructor(world, body, target, maxNodes = 512) {
    this.world = world; this.body = { width: body.width, height: body.height }; this.target = { ...target }; this.maxNodes = maxNodes;
    this.open = new MinHeap(); this.nodes = new Map(); this.expanded = 0; this.done = false; this.path = [];
    const start = standPosition(world, body.pos.x, body.pos.y, body.pos.z, body, 1);
    if (!start) { this.done = true; return; }
    this.start = start;
    const h = this.heuristic(start), node = { ...start, g: 0, h, f: h, parent: null }; this.best = node;
    this.open.push(node); this.nodes.set(key(node.x, node.y, node.z), node);
  }
  heuristic(p) { return Math.abs(p.x - this.target.x) + Math.abs(p.z - this.target.z) + Math.abs(p.y - this.target.y) * 1.4; }
  finish(node) {
    this.done = true; this.path = [];
    for (let n = node; n?.parent; n = n.parent) this.path.push({ x: n.x, y: n.y, z: n.z });
    this.path.reverse();
  }
  step() {
    if (this.done) return;
    if (!this.open.values.length || this.expanded >= this.maxNodes) { this.finish(this.best); return; }
    const current = this.open.pop(); if (current.closed) return; current.closed = true; this.expanded++;
    if (current.h < this.best.h) this.best = current;
    if (Math.hypot(current.x - this.target.x, current.z - this.target.z) < 1.15 && Math.abs(current.y - this.target.y) < 1.6) { this.finish(current); return; }
    for (const [dx, dz] of AXES) {
      const p = standPosition(this.world, current.x + dx, current.y, current.z + dz, this.body);
      if (!p || Math.abs(p.x - this.start.x) > 24 || Math.abs(p.z - this.start.z) > 24) continue;
      if (p.y > current.y + .1 && collides(this.world, this.body, { x: current.x, y: p.y, z: current.z })) continue;
      const k = key(p.x, p.y, p.z), old = this.nodes.get(k), g = current.g + 1 + Math.abs(p.y - current.y) * .7;
      if (old && old.g <= g) continue;
      const h = this.heuristic(p), node = { ...p, g, h, f: g + h * 1.06, parent: current };
      this.nodes.set(k, node); this.open.push(node);
    }
  }
}

/** One bounded queue avoids a full path search per creature in a single tick. */
export class NavigationScheduler {
  constructor(world) {
    this.world = world; this.jobs = [];
    this.stats = { expanded: 0, completed: 0, requested: 0, lastExpanded: 0, maxTickMs: 0 };
  }
  request(body, target) {
    if (body.routeJob || this.jobs.length >= 48) return;
    const search = new RouteSearch(this.world, body, target);
    body.routeJob = search; this.jobs.push({ body, search }); this.stats.requested++;
  }
  tick(maxExpansions = 96, timeBudget = 1.8) {
    const start = performance.now(); let used = 0;
    while (this.jobs.length && used < maxExpansions && performance.now() - start < timeBudget) {
      const { body, search } = this.jobs[0];
      if (body.health <= 0) { body.routeJob = null; this.jobs.shift(); continue; }
      search.step(); used++;
      if (search.done) { body.route = search.path; body.routeIndex = 0; body.routeJob = null; this.jobs.shift(); this.stats.completed++; }
    }
    this.stats.lastExpanded = used; this.stats.expanded += used;
    this.stats.maxTickMs = Math.max(this.stats.maxTickMs, performance.now() - start);
  }
  clear() { for (const job of this.jobs) job.body.routeJob = null; this.jobs.length = 0; }
}
