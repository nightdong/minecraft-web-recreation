import { B, blocks, items, collisionShapes } from './blocks.js';
export { collisionShapes } from './blocks.js';
import { Inventory } from './inventory.js';
import { clamp, lerp } from './noise.js';
import { fluidAt, flowVector } from './fluids.js';

const EPS = 1e-7;
export const intersects = (a, b) => a[0] < b[3] - EPS && a[3] > b[0] + EPS && a[1] < b[4] - EPS && a[4] > b[1] + EPS && a[2] < b[5] - EPS && a[5] > b[2] + EPS;
export function bodyBox(body, pos = body.pos) {
  const r = (body.width || .6) / 2;
  return [pos.x - r, pos.y, pos.z - r, pos.x + r, pos.y + (body.height || 1.8), pos.z + r];
}
export function obstacles(world, bounds) {
  const result = [];
  for (let y = Math.floor(bounds[1]) - 1; y <= Math.floor(bounds[4] + EPS); y++) {
    for (let z = Math.floor(bounds[2]); z <= Math.floor(bounds[5] + EPS); z++) for (let x = Math.floor(bounds[0]); x <= Math.floor(bounds[3] + EPS); x++) {
      const id = world.get(x, y, z, false);
      if (!blocks[id]?.solid) continue;
      for (const box of collisionShapes(id, world.getState(x, y, z))) result.push([x + box[0], y + box[1], z + box[2], x + box[3], y + box[4], z + box[5]]);
    }
  }
  return result;
}
export function collides(world, body, pos = body.pos) {
  const radius = (body.width || .6) / 2;
  const x0=pos.x-radius, x1=pos.x+radius, y0=pos.y, y1=pos.y+(body.height||1.8), z0=pos.z-radius, z1=pos.z+radius;
  // Boolean occupancy checks dominate A* expansions. Early out directly from
  // the voxel shapes; avoid constructing a world-space obstacle array.
  for(let y=Math.floor(y0)-1;y<=Math.floor(y1+EPS);y++)for(let z=Math.floor(z0);z<=Math.floor(z1+EPS);z++)for(let x=Math.floor(x0);x<=Math.floor(x1+EPS);x++) {
    const id=world.get(x,y,z,false); if(!blocks[id]?.solid)continue;
    for(const box of collisionShapes(id,world.getState(x,y,z))) {
      if(x0<x+box[3]-EPS && x1>x+box[0]+EPS && y0<y+box[4]-EPS && y1>y+box[1]+EPS && z0<z+box[5]-EPS && z1>z+box[2]+EPS)return true;
    }
  }
  return false;
}
function clipAxis(box, obs, axis, movement) {
  const a = (axis + 1) % 3, c = (axis + 2) % 3;
  for (const b of obs) {
    if (box[a+3]<=b[a]+EPS || box[a]>=b[a+3]-EPS || box[c+3]<=b[c]+EPS || box[c]>=b[c+3]-EPS) continue;
    if (movement > 0 && box[axis + 3] <= b[axis] + EPS) movement = Math.min(movement, b[axis] - box[axis + 3]);
    if (movement < 0 && box[axis] >= b[axis + 3] - EPS) movement = Math.max(movement, b[axis + 3] - box[axis]);
  }
  return movement;
}
const translateBox = (box, axis, d) => { box[axis] += d; box[axis + 3] += d; };
function clippedMove(original, obs, dx, dy, dz) {
  const box = original.slice();
  dy = clipAxis(box, obs, 1, dy); translateBox(box, 1, dy);
  dx = clipAxis(box, obs, 0, dx); translateBox(box, 0, dx);
  dz = clipAxis(box, obs, 2, dz); translateBox(box, 2, dz);
  return { box, dx, dy, dz };
}
/** Axis clipping is swept, not discrete overlap correction: high-speed falls cannot tunnel. */
export function moveBody(world, body, dx, dy, dz, stepHeight = .6, sneak = false) {
  const start = bodyBox(body), wasGrounded = body.onGround;
  if (sneak && wasGrounded) {
    const supported = (x, z) => {
      const shifted = [start[0] + x, start[1] - .6, start[2] + z, start[3] + x, start[4] - .6, start[5] + z];
      return obstacles(world, shifted).some(b => intersects(shifted, b));
    };
    const shrink = d => Math.abs(d) <= .05 ? 0 : d - Math.sign(d) * .05;
    while (dx && !supported(dx, 0)) dx = shrink(dx);
    while (dz && !supported(0, dz)) dz = shrink(dz);
    while (dx && dz && !supported(dx, dz)) { dx = shrink(dx); dz = shrink(dz); }
  }
  const sweep = [start[0] + Math.min(0, dx), start[1] + Math.min(0, dy), start[2] + Math.min(0, dz),
    start[3] + Math.max(0, dx), start[4] + Math.max(stepHeight, dy), start[5] + Math.max(0, dz)];
  const obs = obstacles(world, sweep);
  let result = clippedMove(start, obs, dx, dy, dz);
  if (stepHeight > 0 && (wasGrounded || dy < 0 && result.dy !== dy) && (Math.abs(result.dx - dx) > EPS || Math.abs(result.dz - dz) > EPS)) {
    const stepped = clippedMove(start, obs, dx, stepHeight, dz);
    const down = clipAxis(stepped.box, obs, 1, -stepped.dy + Math.min(0, dy));
    translateBox(stepped.box, 1, down); stepped.dy += down;
    if (stepped.dx * stepped.dx + stepped.dz * stepped.dz > result.dx * result.dx + result.dz * result.dz + EPS) result = stepped;
  }
  body.pos.x = (result.box[0] + result.box[3]) / 2; body.pos.y = result.box[1]; body.pos.z = (result.box[2] + result.box[5]) / 2;
  body.onGround = dy < 0 && Math.abs(result.dy - dy) > EPS;
  body.horizontalCollision = Math.abs(result.dx - dx) > EPS || Math.abs(result.dz - dz) > EPS;
  if (body.vel) {
    if (Math.abs(result.dx - dx) > EPS) body.vel.x = 0;
    if (Math.abs(result.dy - dy) > EPS) body.vel.y = 0;
    if (Math.abs(result.dz - dz) > EPS) body.vel.z = 0;
  }
  return result;
}

export class Player {
  constructor(spawn, saved = {}, mode = 'survival') {
    this.pos = { ...spawn, ...saved.pos }; this.previous = { ...this.pos }; this.vel = { x: 0, y: 0, z: 0, ...saved.velocity };
    this.spawnPoint = saved.spawnPoint || { ...spawn }; this.bedSpawn = saved.bedSpawn || null; this.yaw = saved.yaw ?? .6; this.pitch = saved.pitch ?? -.05;
    this.width = .6; this.height = saved.sneaking ? 1.5 : 1.8; this.eyeHeight = saved.eyeHeight ?? 1.62; this.onGround = saved.onGround || false;
    this.mode = saved.mode || mode; this.flying = saved.flying || false; this.sneaking = saved.sneaking || false; this.sprinting = false;
    this.inventory = new Inventory(36, saved.inventory); this.armor = saved.armor || Array(4).fill(null); this.offhand = saved.offhand || null;
    this.selected = saved.selected || 0; this.health = saved.health ?? 20; this.hunger = saved.hunger ?? 20;
    this.saturation = saved.saturation ?? 5; this.exhaustion = saved.exhaustion || 0; this.air = saved.air ?? 300;
    this.xp = saved.xp || 0; this.level = saved.level || 0; this.score = saved.score || 0;
    this.fallDistance = saved.fallDistance ?? 0; this.walkDistance = 0; this.walkSpeed = 0; this.lastStep = 0;
    this.hurtTime = saved.hurtTime ?? 0; this.burnTime = saved.burnTime ?? 0;
    this.regenTicks = saved.regenTicks ?? 0; this.hazardTicks = saved.hazardTicks ?? 0; this.jumpCooldown = saved.jumpCooldown ?? 0;
    this.perspective = 0; this.events = []; this.underwater = false; this.inWater = false; this.deathReported = false;
    this.pearlCooldown = saved.pearlCooldown || 0; this.eyeCooldown = saved.eyeCooldown || 0;
  }
  get creative() { return this.mode === 'creative'; }
  get defense() { return this.armor.reduce((n, s) => n + (s ? items[s.id]?.defense || 0 : 0), 0); }
  get eye() { return { x: this.pos.x, y: this.pos.y + this.eyeHeight, z: this.pos.z }; }
  get direction() { const c = Math.cos(this.pitch); return { x: -Math.sin(this.yaw) * c, y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * c }; }
  tick(world, input, difficulty = 'normal') {
    this.pearlCooldown = Math.max(0, this.pearlCooldown - 1); this.eyeCooldown = Math.max(0, this.eyeCooldown - 1);
    this.previous = { ...this.pos }; const keys = input.keys || new Set(), held = code => keys.has(code);
    this.hurtTime = Math.max(0, this.hurtTime - .05); this.jumpCooldown = Math.max(0, this.jumpCooldown - 1);
    if (this.health <= 0) return;
    world.ensure(Math.floor(this.pos.x / 16), Math.floor(this.pos.z / 16));
    const water = fluidAt(world, this.pos.x, this.pos.y + .05, this.pos.z), eyeBlock = fluidAt(world, this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
    const wasInWater = this.inWater; this.inWater = water === B.WATER; this.inLava = water === B.LAVA;
    this.underwater = eyeBlock === B.WATER;
    if (!wasInWater && this.inWater) this.events.push({ type: 'splash' });
    const wantsSneak = held('ShiftLeft') || held('ShiftRight');
    if (wantsSneak && !this.flying) { this.sneaking = true; this.height = 1.5; }
    else { this.height = 1.8; if (collides(world, this)) { this.height = 1.5; this.sneaking = true; } else this.sneaking = false; }
    this.eyeHeight = lerp(this.eyeHeight, this.sneaking ? 1.27 : 1.62, .55);
    let forward = Number(held('KeyW') || held('ArrowUp')) - Number(held('KeyS') || held('ArrowDown'));
    let strafe = Number(held('KeyD')) - Number(held('KeyA'));
    this.sprinting = !this.sneaking && forward > 0 && (this.hunger > 6 || this.creative) && (held('ControlLeft') || held('ControlRight') || input.sprintLatch);
    if (!forward) input.sprintLatch = false;
    if (held('ArrowLeft')) this.yaw += .06; if (held('ArrowRight')) this.yaw -= .06;
    const jump = held('Space') || !!input.jumpPressed; input.jumpPressed = false; const below = world.get(this.pos.x, this.pos.y - .05, this.pos.z, false);
    const slippery = below === B.ICE ? .98 : .6, drag = this.onGround ? slippery * .91 : .91;
    let accel = this.onGround ? .1 * (.16277136 / (drag * drag * drag)) : .02;
    if (this.sprinting) accel *= 1.3;
    if (this.sneaking) { forward *= .3; strafe *= .3; }
    if (this.usingItem) { forward *= .2; strafe *= .2; }
    if (this.inWater || this.inLava) accel = .02;
    if (this.flying) accel = this.sprinting ? .10 : .05;
    const length = Math.hypot(strafe, forward); if (length > 1) { strafe /= length; forward /= length; }
    strafe *= .98; forward *= .98;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    this.vel.x += (strafe * cos - forward * sin) * accel;
    this.vel.z += (-strafe * sin - forward * cos) * accel;
    if (this.inWater && !this.flying) {
      const [fx, fy, fz] = flowVector(world, this.pos.x, this.pos.y + .05, this.pos.z);
      this.vel.x += fx * .014; this.vel.y += fy * .014; this.vel.z += fz * .014;
    }
    if (this.flying) {
      this.vel.y += (Number(jump) - Number(wantsSneak)) * .15; this.fallDistance = 0;
    } else if (this.inWater || this.inLava) {
      if (jump) this.vel.y += .04;
      if (wantsSneak) this.vel.y -= .02;
      this.fallDistance = 0;
    } else if (jump && this.onGround && !this.jumpCooldown) {
      this.vel.y = .42; this.jumpCooldown = 10;
      if (this.sprinting) { this.vel.x -= sin * .2; this.vel.z -= cos * .2; }
      this.exhaust(this.sprinting ? .2 : .05); this.events.push({ type: 'jump' });
    }
    const ladder = world.get(this.pos.x, this.pos.y + .2, this.pos.z, false) === B.LADDER;
    if (ladder) {
      this.vel.x = clamp(this.vel.x, -.15, .15); this.vel.z = clamp(this.vel.z, -.15, .15);
      this.vel.y = Math.max(this.vel.y, this.sneaking ? 0 : -.15); this.fallDistance = 0;
      if (jump || this.horizontalCollision) this.vel.y = .2;
    }
    if (blocks[below]?.slow) { this.vel.x *= .4; this.vel.z *= .4; }
    const incomingY = this.vel.y, oldX = this.pos.x, oldZ = this.pos.z;
    const motion = moveBody(world, this, this.vel.x, this.vel.y, this.vel.z, this.flying ? 0 : .6, this.sneaking && !this.flying);
    const distance = Math.hypot(this.pos.x - oldX, this.pos.z - oldZ);
    this.walkSpeed = distance * 20; this.walkDistance += distance;
    // A swept fall may enter a shallow pool and hit its floor within one tick.
    // Sample at the actual destination before deciding whether impact is dry.
    const impactFluid = fluidAt(world, this.pos.x, this.pos.y + .05, this.pos.z);
    if (!this.inWater && impactFluid === B.WATER) this.events.push({ type: 'splash' });
    this.inWater = impactFluid === B.WATER; this.inLava = impactFluid === B.LAVA;
    this.underwater = fluidAt(world, this.pos.x, this.pos.y + this.eyeHeight, this.pos.z) === B.WATER;
    if (motion.dy < 0 && !this.inWater && !ladder && !this.flying) this.fallDistance -= motion.dy;
    if (this.onGround && this.fallDistance > 3 && !this.inWater && !this.flying) this.damage(Math.ceil(this.fallDistance - 3), 'fall');
    if (this.onGround || this.inWater || ladder || this.flying) this.fallDistance = 0;
    if (this.onGround && this.walkDistance - this.lastStep > (this.sprinting ? 1.8 : 1.55) && distance > .01 && !this.sneaking) {
      this.lastStep = this.walkDistance; this.events.push({ type: 'step', block: below });
    }
    if (this.onGround) this.exhaust(distance * (this.sprinting ? .1 : 0));
    if (this.inWater) this.exhaust(distance * .01);
    if (this.flying) {
      this.vel.x *= .91; this.vel.z *= .91; this.vel.y *= .6;
      if (this.onGround && incomingY < 0) this.flying = false;
    } else if (this.inWater || this.inLava) {
      const friction = this.inLava ? .5 : .8; this.vel.x *= friction; this.vel.z *= friction;
      this.vel.y = this.vel.y * friction - .02;
      if (this.horizontalCollision && jump && !collides(world, this, { ...this.pos, y: this.pos.y + .6 })) this.vel.y = .3;
    } else { this.vel.x *= drag; this.vel.z *= drag; this.vel.y = (this.vel.y - .08) * .98; }
    if (Math.abs(this.vel.x) < .003) this.vel.x = 0; if (Math.abs(this.vel.z) < .003) this.vel.z = 0;
    this.survivalTick(world, difficulty);
  }
  exhaust(amount) { if (!this.creative) this.exhaustion += amount; }
  survivalTick(world, difficulty) {
    if (this.creative) { this.air = 300; this.burnTime = 0; return; }
    this.hazardTicks++;
    if (this.underwater) { if (--this.air < -20) { this.air = 0; this.damage(2, 'drown'); } }
    else this.air = Math.min(300, this.air + 4);
    if (this.inWater || world.weather && this.pos.y >= world.surface(this.pos.x, this.pos.z)) this.burnTime = 0;
    if (this.inLava) { this.burnTime = 15; if (this.hazardTicks % 10 === 0) this.damage(4, 'lava'); }
    if (world.get(this.pos.x, this.pos.y + .2, this.pos.z, false) === B.FIRE && !this.inWater) {
      this.burnTime = 8;
      if (this.hazardTicks % 10 === 0) this.damage(1, 'fire');
    }
    if (this.burnTime > 0) { this.burnTime -= .05; if (this.hazardTicks % 20 === 0) this.damage(1, 'fire'); }
    if (this.hazardTicks % 10 === 0) {
      const r = this.width / 2 + .02;
      for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) if (world.get(this.pos.x + dx, this.pos.y + .4, this.pos.z + dz, false) === B.CACTUS) this.damage(1, 'cactus');
      if (blocks[world.get(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z, false)]?.opaque) this.damage(1, 'suffocate');
    }
    if (this.pos.y < -10) this.damage(4, 'void');
    while (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else if (difficulty !== 'peaceful') this.hunger = Math.max(0, this.hunger - 1);
    }
    if (difficulty === 'peaceful') {
      if (this.hazardTicks % 20 === 0) this.health = Math.min(20, this.health + 1);
      if (this.hazardTicks % 10 === 0) this.hunger = Math.min(20, this.hunger + 1);
    } else if (this.hunger >= 18 && this.health < 20) {
      if (++this.regenTicks >= 80) { this.health = Math.min(20, this.health + 1); this.exhaust(6); this.regenTicks = 0; }
    } else if (this.hunger === 0) {
      if (++this.regenTicks >= 80) { if (this.health > (difficulty === 'hard' ? 0 : difficulty === 'easy' ? 10 : 1)) this.damage(1, 'starve'); this.regenTicks = 0; }
    } else this.regenTicks = 0;
  }
  damage(amount, cause = 'attack', direction) {
    if (this.creative || this.health <= 0 || this.hurtTime > .1) return false;
    if (!['fall', 'drown', 'void', 'starve', 'suffocate', 'pearl', 'dragon_breath'].includes(cause)) {
      amount *= 1 - Math.min(20, this.defense) * .04;
      for (let i = 0; i < 4; i++) if (this.armor[i]) {
        this.armor[i].durability -= Math.max(1, Math.floor(amount / 4)); if (this.armor[i].durability <= 0) this.armor[i] = null;
      }
    }
    this.health = Math.max(0, this.health - amount); this.hurtTime = .5;
    if (direction) { this.vel.x += direction.x * .4; this.vel.z += direction.z * .4; this.vel.y = .32; }
    this.exhaust(.1); this.events.push({ type: 'hurt', cause, amount });
    if (this.health <= 0 && !this.deathReported) { this.deathReported = true; this.events.push({ type: 'death', cause }); }
    return true;
  }
  eat(id) {
    const item = items[id]; if (!item?.food || this.hunger >= 20) return false;
    this.hunger = Math.min(20, this.hunger + item.food); this.saturation = Math.min(this.hunger, this.saturation + item.saturation); return true;
  }
  addXP(amount) {
    this.xp += amount; this.score += amount;
    const cost = level => level < 16 ? 7 + level * 2 : level < 31 ? 37 + (level - 15) * 5 : 112 + (level - 30) * 9;
    while (this.xp >= cost(this.level)) { this.xp -= cost(this.level); this.level++; this.events.push({ type: 'level' }); }
  }
  toJSON() {
    return { pos: this.pos, spawnPoint: this.spawnPoint, bedSpawn: this.bedSpawn, yaw: this.yaw, pitch: this.pitch, mode: this.mode,
      flying: this.flying, inventory: this.inventory.toJSON(), armor: this.armor, offhand: this.offhand, selected: this.selected,
      health: this.health, hunger: this.hunger, saturation: this.saturation, exhaustion: this.exhaustion, air: this.air,
      xp: this.xp, level: this.level, score: this.score, pearlCooldown: this.pearlCooldown, eyeCooldown: this.eyeCooldown, velocity: { ...this.vel }, onGround: this.onGround,
      sneaking: this.sneaking, eyeHeight: this.eyeHeight, fallDistance: this.fallDistance,
      hurtTime: this.hurtTime, burnTime: this.burnTime, regenTicks: this.regenTicks, hazardTicks: this.hazardTicks, jumpCooldown: this.jumpCooldown };
  }
}
