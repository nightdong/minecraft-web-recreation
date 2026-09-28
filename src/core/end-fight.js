import { endPillars } from './adventure.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const angleTowards = (from, to, amount) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * amount;
const moveTowards = (position, target, speed) => {
  const d = distance(position, target), amount = d > speed ? speed / d : 1;
  for (const key of ['x', 'y', 'z']) position[key] += (target[key] - position[key]) * amount;
  return d;
};

export function dragonParts(state) {
  const forward = { x: Math.sin(state.yaw), z: Math.cos(state.yaw) }, right = { x: Math.cos(state.yaw), z: -Math.sin(state.yaw) };
  const part = (name, ahead, across, up, width, height, depth) => {
    const center = { x: state.pos.x + forward.x * ahead + right.x * across, y: state.pos.y + up, z: state.pos.z + forward.z * ahead + right.z * across };
    const rx = Math.abs(right.x) * width / 2 + Math.abs(forward.x) * depth / 2;
    const rz = Math.abs(right.z) * width / 2 + Math.abs(forward.z) * depth / 2;
    return { name, center, box: [center.x - rx, center.y - height / 2, center.z - rz, center.x + rx, center.y + height / 2, center.z + rz] };
  };
  return [part('head', 7.2, 0, .7, 2.3, 1.7, 3), part('body', 0, 0, 0, 3.5, 3, 6),
    part('left-wing', -1, -5, .2, 8, 1, 5), part('right-wing', -1, 5, .2, 8, 1, 5), part('tail', -6, 0, .3, 1.6, 1.5, 6)];
}

/** Deterministic fixed-tick boss simulation, separate from rendering. All
 * persistent fight state lives in the world's save, never in a UI health bar. */
export class EndFight {
  constructor(seed, saved = {}) {
    this.pillars = endPillars(seed); this.events = [];
    this.state = {
      health: saved.health ?? 200, crystals: saved.crystals?.slice() || Array(10).fill(true), phase: saved.phase || 'circle',
      phaseTicks: saved.phaseTicks || 0, ticks: saved.ticks || 0, angle: saved.angle || 0, yaw: saved.yaw || 0,
      pos: { ...(saved.pos || { x: 0, y: 87, z: 40 }) }, hurt: saved.hurt || 0,
      deathTicks: saved.deathTicks || 0, defeated: saved.defeated || false, rewarded: saved.rewarded || false,
      healing: saved.healing ?? -1, landingY: saved.landingY ?? 65.5, clouds: structuredClone(saved.clouds || [])
    };
    this.previous = { ...this.state.pos };
  }
  crystalPosition(index) { const pillar = this.pillars[index]; return { x: pillar.x + .5, y: pillar.y + 2.1, z: pillar.z + .5 }; }
  destroyCrystal(index) {
    const s = this.state; if (!s.crystals[index]) return false;
    s.crystals[index] = false; const position = this.crystalPosition(index);
    this.events.push({ type: 'crystalExplosion', position, index });
    if (s.health > 0 && s.healing === index) { s.health = Math.max(0, s.health - 10); s.hurt = 10; }
    return true;
  }
  damage(amount, part = 'head', cause = 'melee') {
    const s = this.state;
    if (s.defeated || s.health <= 0 || s.hurt > 0 || !(amount > 0) || !Number.isFinite(amount)) return false;
    if (s.phase === 'perch' && cause === 'arrow') return false;
    const actual = part === 'head' ? amount : amount / 4;
    s.health = Math.max(0, s.health - actual); s.hurt = 10;
    this.events.push({ type: 'dragonHurt', damage: actual }); return true;
  }
  addCloud(position) {
    this.state.clouds.push({ pos: { ...position }, age: 0, life: 160 });
    if (this.state.clouds.length > 12) this.state.clouds.shift();
  }
  tick(player) {
    const s = this.state; this.previous = { ...s.pos }; s.ticks++; s.hurt = Math.max(0, s.hurt - 1);
    for (const cloud of s.clouds) { cloud.age++; cloud.life--; }
    s.clouds = s.clouds.filter(cloud => cloud.life > 0);
    if (!player.creative && player.health > 0) for (const cloud of s.clouds) {
      const radius = Math.min(4.5, .7 + cloud.age * .07);
      if (cloud.age > 10 && s.ticks % 10 === 0 && Math.hypot(player.pos.x - cloud.pos.x, player.pos.z - cloud.pos.z) < radius && Math.abs(player.pos.y - cloud.pos.y) < 2) player.damage(3, 'dragon_breath');
    }
    if (s.defeated) return;
    if (s.health <= 0) {
      s.phase = 'dying'; s.deathTicks++; s.pos.y += .03; s.healing = -1;
      if (s.deathTicks % 10 === 0) this.events.push({ type: 'deathParticles', position: { ...s.pos } });
      if (s.deathTicks >= 200 && !s.rewarded) {
        s.defeated = true; s.rewarded = true; s.phase = 'defeated'; this.events.push({ type: 'dragonDefeated', xp: 12000 });
      }
      return;
    }
    let closest = -1, best = 32;
    for (let i = 0; i < s.crystals.length; i++) if (s.crystals[i]) {
      const d = distance(s.pos, this.crystalPosition(i)); if (d < best) { best = d; closest = i; }
    }
    s.healing = closest;
    if (closest >= 0 && s.ticks % 10 === 0) s.health = Math.min(200, s.health + 1);
    s.phaseTicks++;
    if (s.phase === 'circle') {
      s.angle += .014;
      const target = { x: Math.sin(s.angle) * 54, y: 87 + Math.sin(s.angle * 2) * 9, z: Math.cos(s.angle) * 54 };
      const old = { ...s.pos }; moveTowards(s.pos, target, .9);
      s.yaw = angleTowards(s.yaw, Math.atan2(s.pos.x - old.x, s.pos.z - old.z), .2);
      if (s.phaseTicks >= (s.crystals.some(Boolean) ? 440 : 280)) { s.phase = 'approach'; s.phaseTicks = 0; }
      if (!player.creative && player.health > 0 && s.phaseTicks % 100 === 0 && distance(player.pos, s.pos) < 80) this.fireAt(player);
    } else if (s.phase === 'approach') {
      const remaining = moveTowards(s.pos, { x: .5, y: s.landingY, z: .5 }, .65);
      s.yaw = angleTowards(s.yaw, Math.atan2(player.pos.x - s.pos.x, player.pos.z - s.pos.z), .06);
      if (remaining < .7) { s.phase = 'perch'; s.phaseTicks = 0; }
    } else if (s.phase === 'perch') {
      s.yaw = angleTowards(s.yaw, Math.atan2(player.pos.x - s.pos.x, player.pos.z - s.pos.z), .035);
      if (!player.creative && player.health > 0 && s.phaseTicks > 40 && s.phaseTicks % 50 === 0) {
        const head = dragonParts(s)[0].center;
        this.addCloud({ x: head.x + Math.sin(s.yaw) * 2, y: 63, z: head.z + Math.cos(s.yaw) * 2 });
        this.events.push({ type: 'dragonBreath', position: head });
      }
      if (s.phaseTicks >= 240) { s.phase = 'takeoff'; s.phaseTicks = 0; }
    } else if (s.phase === 'takeoff') {
      moveTowards(s.pos, { x: Math.sin(s.yaw) * 42, y: 95, z: Math.cos(s.yaw) * 42 }, .8);
      if (s.phaseTicks >= 100) { s.phase = 'circle'; s.phaseTicks = 0; s.angle = Math.atan2(s.pos.x, s.pos.z); }
    }
    if (!player.creative && player.health > 0 && s.ticks % 10 === 0) {
      for (const part of dragonParts(s).slice(0, 4)) {
        const [x0, y0, z0, x1, y1, z1] = part.box;
        if (player.pos.x > x0 - .3 && player.pos.x < x1 + .3 && player.pos.z > z0 - .3 && player.pos.z < z1 + .3 && player.pos.y + 1.8 > y0 && player.pos.y < y1) {
          const dx = player.pos.x - s.pos.x, dz = player.pos.z - s.pos.z, distance = Math.hypot(dx, dz) || 1;
          player.damage(part.name === 'head' ? 10 : 5, 'dragon', { x: dx / distance, z: dz / distance }); break;
        }
      }
    }
  }
  fireAt(player) {
    const origin = dragonParts(this.state)[0].center, target = { x: player.pos.x, y: player.pos.y + .8, z: player.pos.z }, length = distance(origin, target) || 1;
    this.events.push({ type: 'dragonProjectile', position: origin, direction: { x: (target.x - origin.x) / length, y: (target.y - origin.y) / length, z: (target.z - origin.z) / length } });
  }
  toJSON() { return structuredClone(this.state); }
}
