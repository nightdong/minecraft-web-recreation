import * as THREE from 'three';
import { blocks } from '../core/blocks.js';

/** Fixed-capacity storage: explosions recycle particle objects, vectors and
 * colors instead of allocating hundreds of objects on the animation thread. */
export class ParticlePool {
  constructor(capacity = 768) {
    this.capacity = capacity; this.active = []; this.free = []; this.cursor = 0;
    this.storage = Array.from({ length: capacity }, () => ({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), color: new THREE.Color(), life: 0, size: 0 }));
    this.stats = { spawned: 0, recycled: 0, allocated: capacity, peak: 0 }; this.reset();
  }
  reset() { this.active.length = 0; this.free.length = 0; this.free.push(...this.storage); this.cursor = 0; }
  emit(x, y, z, palette, count, force, limit = this.capacity) {
    limit = Math.max(1, Math.min(this.capacity, limit));
    for (let i = 0; i < count; i++) {
      let particle;
      if (this.active.length < limit) { particle = this.free.pop(); this.active.push(particle); }
      else { particle = this.active[this.cursor++ % this.active.length]; this.stats.recycled++; }
      particle.pos.set(x + Math.random(), y + Math.random(), z + Math.random());
      particle.vel.set((Math.random() - .5) * 4 * force, (Math.random() * 3 + 1) * force, (Math.random() - .5) * 4 * force);
      particle.color.copy(palette[Math.floor(Math.random() * palette.length)]);
      particle.life = .45 + Math.random() * .75; particle.size = .035 + Math.random() * .055; this.stats.spawned++;
    }
    this.stats.peak = Math.max(this.stats.peak, this.active.length);
  }
  tick(dt, world) {
    if (dt <= 0) return;
    for (let i = 0; i < this.active.length;) {
      const p = this.active[i]; p.life -= dt;
      if (p.life <= 0) { this.active[i] = this.active[this.active.length - 1]; this.active.pop(); this.free.push(p); continue; }
      p.vel.y -= dt * 12;
      const x = p.pos.x + p.vel.x * dt, y = p.pos.y + p.vel.y * dt, z = p.pos.z + p.vel.z * dt;
      if (world && blocks[world.get(x, y, z, false)]?.solid) { p.vel.y *= -.22; p.vel.x *= .6; p.vel.z *= .6; }
      else p.pos.set(x, y, z);
      i++;
    }
  }
}
