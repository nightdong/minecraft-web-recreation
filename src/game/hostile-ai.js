import { B, I, blocks } from '../core/blocks.js';
import { moveBody } from '../core/physics.js';
import { fluidAt } from '../core/fluids.js';
import { precipitationHeight } from '../core/weather.js';
import { standPosition } from '../core/navigation.js';

export const ORDINARY_HOSTILES = {
  zombie: { health: 20, width: .6, height: 1.95, speed: .056, damage: 3, drops: [[I.ROTTEN_FLESH, 0, 2]] },
  skeleton: { health: 20, width: .6, height: 1.95, speed: .062, damage: 2, drops: [[I.BONE, 0, 2], [I.ARROW, 0, 2]] },
  creeper: { health: 20, width: .6, height: 1.7, speed: .062, damage: 0, drops: [[I.GUNPOWDER, 0, 2]] },
  spider: { health: 16, width: 1.3, height: .9, speed: .078, damage: 2, drops: [[I.STRING, 0, 2]] }
};

export function sunLevel(world) {
  if (world.dimension !== 'overworld') return world.dimension === 'end' ? .65 : .17;
  return Math.max(.055, Math.min(1, Math.sin(world.time / 24000 * Math.PI * 2) * 3 + .32)) * (world.weather ? .65 : 1);
}
export function exposedToSun(world, mob) {
  return world.dimension === 'overworld' && !world.weather && sunLevel(world) > .8 && mob.pos.y + mob.height > precipitationHeight(world, mob.pos.x, mob.pos.z);
}
export function localBrightness(world, mob) {
  const x=Math.floor(mob.pos.x), y=Math.floor(mob.pos.y+mob.height*.8), z=Math.floor(mob.pos.z);
  const light=world.getLight(x,y,z);
  const sky=mob.pos.y+mob.height*.8>=precipitationHeight(world,x,z)?15:light[0];
  return Math.max(sky*sunLevel(world),light[1])/15;
}
export function visibleTo(world, origin, target) {
  const dx = target.x - origin.x, dy = target.y - origin.y, dz = target.z - origin.z, len = Math.hypot(dx, dy, dz);
  if (len < .001) return true;
  const wall = world.raycast(origin, { x: dx / len, y: dy / len, z: dz / len }, len);
  return !wall || wall.distance >= len - .15;
}
export function canSpawnHostile(world, player, type, pos) {
  const def = ORDINARY_HOSTILES[type];
  if (!def || Math.hypot(pos.x - player.pos.x, pos.y - player.pos.y, pos.z - player.pos.z) < 24) return false;
  const stand = standPosition(world, pos.x, pos.y, pos.z, def, 0);
  if (!stand || Math.abs(stand.y - pos.y) > .15) return false;
  const below = world.get(pos.x, pos.y - .1, pos.z, false);
  if (blocks[below]?.leaves || [B.GLASS, B.ICE, B.BEDROCK].includes(below)) return false;
  const light = world.getLight(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
  // A newly loaded chunk can still have a zero-filled sky array. Its open
  // surface is not a dark cave merely because the mesh worker has not run.
  const sky = pos.y >= precipitationHeight(world, pos.x, pos.z) ? 15 : light[0];
  return light[1] === 0 && sky * sunLevel(world) <= 7;
}

export function spawnHostiles(system) {
  const { world, player, difficulty } = system.game;
  if (difficulty === 'peaceful' || world.dimension !== 'overworld' || !world.chunks.size) return;
  const cap = difficulty === 'hard' ? 36 : 28;
  let count = 0;
  for (const mob of system.mobs) if (mob.health > 0 && ORDINARY_HOSTILES[mob.type]) count++;
  if (count >= cap) return;
  world.updateBlockLight();
  const types = Object.keys(ORDINARY_HOSTILES);
  for (let attempt = 0; attempt < 14 && count < cap; attempt++) {
    const angle = Math.random() * Math.PI * 2, radius = 25 + Math.random() * 35;
    const x = Math.floor(player.pos.x + Math.sin(angle) * radius), z = Math.floor(player.pos.z + Math.cos(angle) * radius);
    if (!world.chunks.has(`${Math.floor(x / 16)},${Math.floor(z / 16)}`)) continue;
    let y = world.surface(x, z);
    if (player.pos.y < 50) {
      y = Math.min(124, Math.floor(player.pos.y + 8));
      for (let k = 0; k < 20; k++, y--) if (blocks[world.get(x, y - 1, z, false)]?.solid && !world.get(x, y, z, false) && !world.get(x, y + 1, z, false)) break;
    }
    const type = types[Math.floor(Math.random() * types.length)], pos = { x: x + .5, y, z: z + .5 };
    if (!canSpawnHostile(world, player, type, pos) || system.mobs.some(m => m.health > 0 && Math.hypot(m.pos.x - pos.x, m.pos.z - pos.z) < 2)) continue;
    system.spawnMob(type, pos); count++;
    if (attempt >= 3) break;
  }
}

function steer(system, mob, target) {
  if (mob.route && mob.routeIndex < mob.route.length) {
    let next = mob.route[mob.routeIndex];
    if (Math.hypot(next.x - mob.pos.x, next.z - mob.pos.z) < .45 && Math.abs(next.y - mob.pos.y) < .7) next = mob.route[++mob.routeIndex];
    if (next) {
      const valid = standPosition(system.game.world, next.x, next.y, next.z, mob, 0);
      if (!valid) { mob.route = null; mob.routeAfter = 0; }
      else {
        if (next.y > mob.pos.y + .2 && mob.onGround) mob.vel.y = .42;
        return Math.atan2(next.x - mob.pos.x, next.z - mob.pos.z);
      }
    }
  }
  if ((mob.horizontalCollision || !mob.visibleTarget) && !mob.routeJob && mob.age >= (mob.routeAfter || 0)) {
    system.navigation?.request(mob, target); mob.routeAfter = mob.age + 30;
  }
  return Math.atan2(target.x - mob.pos.x, target.z - mob.pos.z);
}

export function tickHostile(system, mob) {
  const { world, player, difficulty } = system.game, def = ORDINARY_HOSTILES[mob.type];
  Object.assign(mob.previous, mob.pos);
  if (mob.health <= 0) { mob.death -= .05; return; }
  mob.age++; mob.hurt = Math.max(0, mob.hurt - .05); mob.panic = Math.max(0, mob.panic - .05);
  mob.attackCooldown = Math.max(0, mob.attackCooldown - .05);
  mob.provoked = Math.max(0, (mob.provoked || 0) - 1); mob.attackAnimation = Math.max(0, (mob.attackAnimation || 0) - .05);
  const dx = player.pos.x - mob.pos.x, dz = player.pos.z - mob.pos.z, dy = player.pos.y - mob.pos.y, dist = Math.hypot(dx, dz);
  const liquid = fluidAt(world, mob.pos.x, mob.pos.y + .1, mob.pos.z), sun = exposedToSun(world, mob);
  const origin = { x: mob.pos.x, y: mob.pos.y + mob.height * .8, z: mob.pos.z };
  const canTarget = !player.creative && player.health > 0 && dist < (mob.type === 'zombie' ? 38 : 28) && Math.abs(dy) < 18 && (mob.type !== 'spider' || localBrightness(world,mob) < .5 || mob.provoked > 0);
  if (!canTarget) { mob.visibleTarget = false; mob.lastSeenTicks = 0; mob.bowDraw = 0; }
  else if (mob.age % 5 === (mob.aiId || 0) % 5 || mob.visibleTarget === undefined) {
    mob.visibleTarget = visibleTo(world, origin, player.eye);
    if (mob.visibleTarget) { mob.lastSeen = { ...player.pos }; mob.lastSeenTicks = 80; }
  }
  mob.lastSeenTicks = Math.max(0, (mob.lastSeenTicks || 0) - 1);
  const pursuing = canTarget && (mob.visibleTarget || mob.lastSeenTicks > 0);
  let target = pursuing ? (mob.visibleTarget ? player.pos : mob.lastSeen) : null, moving = !!target, accel = def.speed;
  if (mob.type === 'zombie' || mob.type === 'skeleton') {
    if (sun && liquid !== B.WATER) mob.fire = Math.max(mob.fire, 5);
    if (sun && !target && mob.age % 80 === (mob.aiId || 0) % 80) {
      let best = null;
      for (let n = 0; n < 12; n++) {
        const a = n * Math.PI / 6, r = 4 + (n % 3) * 2;
        const p = standPosition(world, mob.pos.x + Math.sin(a) * r, mob.pos.y, mob.pos.z + Math.cos(a) * r, mob);
        const d = p ? Math.hypot(p.x - mob.pos.x, p.z - mob.pos.z) : Infinity;
        if (p && precipitationHeight(world, p.x, p.z) > p.y + mob.height && (!best || d < best.d)) best = { ...p, d };
      }
      mob.shadeTarget = best;
    }
    if (sun && !target && mob.shadeTarget) { target = mob.shadeTarget; moving = Math.hypot(target.x - mob.pos.x, target.z - mob.pos.z) > .5; }
  }
  let yaw = target ? steer(system, mob, target) : mob.targetYaw;
  if (!target) {
    if (--mob.walkTime <= 0) { mob.walkTime = 40 + Math.random() * 80; mob.targetYaw = mob.yaw + (Math.random() - .5) * 3; mob.idleTime = Math.random() < .6 ? mob.walkTime : 0; }
    moving = mob.idleTime-- <= 0; yaw = mob.targetYaw;
  }
  if (pursuing && mob.visibleTarget) {
    if (mob.type === 'creeper') moving = dist > 2.6;
    else if (mob.type === 'skeleton') {
      moving = dist > 11 || dist < 5;
      if (dist < 5) yaw = Math.atan2(-dx, -dz);
      if (dist >= 5 && dist <= 11 && mob.age % 100 < 50) { moving = true; yaw = Math.atan2(dx, dz) + (Math.floor(mob.age / 100) % 2 ? 1 : -1) * Math.PI / 2; accel *= .55; }
    } else moving = dist > 1.25;
  }
  if (mob.type === 'creeper') {
    const ignite = pursuing && mob.visibleTarget && Math.abs(dy) < 2 && (dist < 3 || mob.fuse > 0 && dist < 6);
    if (ignite && !mob.fuse) system.game.audio.play('fuse', 'stone', Math.max(.1, 1 - dist / 22));
    mob.fuse = ignite ? mob.fuse + .05 : Math.max(0, mob.fuse - .1);
    if (mob.fuse > 0) moving = false;
    if (mob.fuse >= 1.5) { mob.health = 0; mob.death = 0; system.explode(mob.pos.x, mob.pos.y + .6, mob.pos.z, 3); return; }
  }
  if (pursuing && mob.visibleTarget && mob.type === 'skeleton' && dist < 19) {
    if (!mob.attackCooldown) mob.bowDraw = (mob.bowDraw || 0) + .05;
    if (mob.bowDraw >= .8) {
      if (visibleTo(world, origin, player.eye)) {
        const vy = player.eye.y - origin.y + dist * .018, len = Math.hypot(dx, vy, dz);
        system.shoot(origin, { x: dx / len, y: vy / len, z: dz / len }, .4, 'mob', 'arrow'); mob.attackAnimation = .25;
      }
      mob.bowDraw = 0; mob.attackCooldown = difficulty === 'hard' ? 1.2 : 1.8;
    }
  } else mob.bowDraw = 0;
  if (pursuing && mob.visibleTarget && mob.type !== 'skeleton' && mob.type !== 'creeper' && dist < 1.75 && Math.abs(dy) < 1.5 && !mob.attackCooldown && visibleTo(world, origin, player.eye)) {
    const factor = difficulty === 'hard' ? 1.5 : difficulty === 'easy' ? .65 : 1;
    player.damage(def.damage * factor, mob.type, { x: dx / (dist || 1), z: dz / (dist || 1) }); mob.attackCooldown = 1; mob.attackAnimation = .35;
  }
  if (mob.type === 'spider' && pursuing && mob.visibleTarget && dist > 2 && dist < 4 && mob.onGround && !mob.attackCooldown) { mob.vel.y = .4; mob.vel.x += dx / dist * .18; mob.vel.z += dz / dist * .18; mob.attackCooldown = 2; }
  mob.yaw += Math.atan2(Math.sin(yaw - mob.yaw), Math.cos(yaw - mob.yaw)) * .28;
  let climbContact=false;
  if (moving) {
    const sx = Math.sin(mob.yaw), sz = Math.cos(mob.yaw), next = standPosition(world, mob.pos.x + sx * .8, mob.pos.y, mob.pos.z + sz * .8, mob);
    climbContact=mob.type==='spider' && pursuing && blocks[world.get(mob.pos.x+sx*(mob.width/2+.25),mob.pos.y+.45,mob.pos.z+sz*(mob.width/2+.25),false)]?.solid;
    if (next || liquid === B.WATER || climbContact) {
      mob.vel.x += sx * accel * (mob.onGround ? 1 : .3); mob.vel.z += sz * accel * (mob.onGround ? 1 : .3);
      if (next && next.y > mob.pos.y + .2 && mob.onGround) mob.vel.y = .42;
    } else {
      mob.targetYaw += .7;
      if (target && !mob.routeJob && mob.age >= (mob.routeAfter || 0)) { system.navigation?.request(mob, target); mob.routeAfter = mob.age + 30; }
    }
  }
  mob.climbing = mob.type === 'spider' && pursuing && (mob.horizontalCollision || climbContact);
  if (mob.climbing) mob.vel.y = .18;
  if (liquid === B.WATER) mob.vel.y += .04;
  const oldX = mob.pos.x, oldY = mob.pos.y, oldZ = mob.pos.z; moveBody(world, mob, mob.vel.x, mob.vel.y, mob.vel.z, .6);
  mob.walk += Math.hypot(mob.pos.x - oldX, mob.pos.z - oldZ) * 5;
  const impactWater=fluidAt(world,mob.pos.x,mob.pos.y+.05,mob.pos.z)===B.WATER;
  if(impactWater || mob.climbing)mob.fallDistance=0;
  else {
    mob.fallDistance=(mob.fallDistance||0)+Math.max(0,oldY-mob.pos.y);
    if(mob.onGround){const damage=Math.floor(mob.fallDistance-3+1e-6);mob.fallDistance=0;if(damage>0)system.hit(mob,damage,null,false,'environment');}
  }
  const friction = liquid === B.WATER ? .8 : mob.onGround ? .546 : .91;
  mob.vel.x *= friction; mob.vel.z *= friction; mob.vel.y = (mob.vel.y - (liquid === B.WATER ? .02 : .08)) * .98;
  if (liquid === B.LAVA) mob.fire = 10;
  if (world.get(mob.pos.x, mob.pos.y + .2, mob.pos.z, false) === B.FIRE) mob.fire = Math.max(mob.fire, 8);
  if (liquid === B.WATER || world.weather && mob.pos.y + mob.height >= precipitationHeight(world, mob.pos.x, mob.pos.z)) mob.fire = 0;
  if (fluidAt(world, origin.x, origin.y, origin.z) === B.WATER) { mob.air = (mob.air ?? 300) - 1; if (mob.air <= -20) { system.hit(mob, 2, null, false, 'environment'); mob.air = 0; } } else mob.air = 300;
  if (mob.fire > 0) { mob.fire = Math.max(0, mob.fire - .05); if (mob.age % 20 === 0) system.hit(mob, 1, null, false, 'environment'); }
  if (mob.age % 160 === (mob.aiId || 0) % 160 && dist < 28) system.game.audio.play(mob.type, 'stone', .4 * (1 - dist / 30));
  if (mob.pos.y < -10) { mob.health = 0; mob.death = 0; }
}
