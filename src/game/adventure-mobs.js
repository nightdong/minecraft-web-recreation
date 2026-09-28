import * as THREE from 'three';
import { B, I, blocks, isSolid } from '../core/blocks.js';
import { moveBody, collides } from '../core/physics.js';
import { fluidAt } from '../core/fluids.js';
import { fortressNear } from '../core/adventure.js';
import { ownedMesh } from '../render/resources.js';

export const ADVENTURE_MOBS = {
  enderman: { health: 40, width: .6, height: 2.9, speed: .075, damage: 7, drops: [[I.ENDER_PEARL, 0, 1]] },
  blaze: { health: 20, width: .6, height: 1.8, speed: .045, damage: 6, fireproof: true, drops: [[I.BLAZE_ROD, 0, 1]] },
  silverfish: { health: 8, width: .4, height: .3, speed: .07, damage: 1, drops: [] }
};

export function adventureModel(type, model, part, limb) {
  if (type === 'enderman') {
    model.head.position.set(0, 2.4, 0); part('enderman', [.5, .5, .5], [0, .25, 0], model.head, 'enderman_face');
    part('enderman', [.5, .75, .25], [0, 2.025, 0]);
    for (const side of [-1, 1]) {
      limb('enderman', [.125, 1.65, .125], [side * .16, 1.65, 0]); limb('enderman', [.125, 1.8, .125], [side * .36, 2.4, 0], model.arms);
      const eye = ownedMesh(new THREE.Mesh(new THREE.BoxGeometry(.14, .06, .015), new THREE.MeshBasicMaterial({ color: 0xd596f2 })));
      eye.position.set(side * .14, .26, .255); model.head.add(eye);
    }
  } else if (type === 'blaze') {
    model.head.position.set(0, 1.25, 0); part('blaze', [.5, .5, .5], [0, .25, 0], model.head, 'blaze_face');
    model.rods = [];
    for (let layer = 0; layer < 3; layer++) for (let rod = 0; rod < 4; rod++) {
      const mesh = part('blaze', [.125, .5, .125], [0, 1.35 - layer * .45, 0]); model.rods.push({ mesh, layer, rod });
    }
  } else if (type === 'silverfish') {
    model.head.position.set(0, .17, .35); part('silverfish', [.3, .25, .28], [0, 0, 0], model.head);
    for (let i = 0; i < 5; i++) {
      const width = .4 - Math.abs(i - 2) * .06; part('silverfish', [width, .22, .23], [0, .13, .12 - i * .18]);
      for (const side of [-1, 1]) { const leg = limb('silverfish', [.035, .2, .035], [side * width / 2, .12, .12 - i * .18]); leg.rotation.z = side * 1.2; }
    }
  }
}

export function teleportEnderman(system, mob) {
  const world = system.game.world, old = { ...mob.pos };
  for (let attempt = 0; attempt < 24; attempt++) {
    const x = Math.floor(old.x + (Math.random() - .5) * 32), z = Math.floor(old.z + (Math.random() - .5) * 32);
    if (!world.chunks.has(`${Math.floor(x / 16)},${Math.floor(z / 16)}`)) continue;
    let y = Math.min(124, Math.floor(old.y + (Math.random() - .5) * 16));
    while (y > 1 && !isSolid(world.get(x, y - 1, z, false))) y--;
    const target = { x: x + .5, y, z: z + .5 };
    if (!isSolid(world.get(x, y - 1, z, false)) || fluidAt(world, target.x, y + .1, target.z) || collides(world, mob, target)) continue;
    mob.pos = target; mob.previous = { ...target }; mob.vel = { x: 0, y: 0, z: 0 };
    system.game.graphics.burst(old.x - .3, old.y, old.z - .3, B.PORTAL, 10, .4); system.game.graphics.burst(x, y, z, B.PORTAL, 10, .4);
    system.game.audio.play('enderman_teleport'); return true;
  }
  return false;
}

export function spawnAdventureMobs(system, spawners = false) {
  const { world, player, difficulty } = system.game;
  if (difficulty === 'peaceful') return;
  if (spawners) {
    for (const chunk of world.chunks.values()) for (const i of chunk.spawners || []) {
      const pos = { x: chunk.cx * 16 + (i & 15) + .5, y: (i >> 8) + .5, z: chunk.cz * 16 + ((i >> 4) & 15) + .5 };
      if (Math.hypot(pos.x - player.pos.x, pos.y - player.pos.y, pos.z - player.pos.z) > 16) continue;
      const type = chunk.state[i] === 1 ? 'blaze' : chunk.state[i] === 2 ? 'silverfish' : 'zombie';
      if (system.mobs.filter(mob => mob.type === type && mob.health > 0 && Math.hypot(mob.pos.x - pos.x, mob.pos.z - pos.z) < 12).length >= 6) continue;
      for (let attempt = 0; attempt < 8; attempt++) {
        const target = { x: pos.x + (Math.random() - .5) * 7, y: pos.y - .5 + (type === 'blaze' ? Math.random() : 0), z: pos.z + (Math.random() - .5) * 7 };
        if (!collides(world, { pos: target, width: ADVENTURE_MOBS[type]?.width || .6, height: ADVENTURE_MOBS[type]?.height || 1.8 })) { system.spawnMob(type, target); break; }
      }
    }
    return;
  }
  if (system.mobs.filter(mob => ADVENTURE_MOBS[mob.type] && mob.health > 0).length >= (world.dimension === 'end' ? 20 : 10)) return;
  const tries = world.dimension === 'end' ? 8 : 3;
  for (let attempt = 0; attempt < tries; attempt++) {
    const a = Math.random() * Math.PI * 2, r = 24 + Math.random() * 34, x = Math.floor(player.pos.x + Math.sin(a) * r), z = Math.floor(player.pos.z + Math.cos(a) * r);
    if (!world.chunks.has(`${Math.floor(x / 16)},${Math.floor(z / 16)}`)) continue;
    let y = world.surface(x, z), type = 'enderman';
    if (world.dimension === 'nether') {
      const fortress = fortressNear(world.seed, x, z); if (!fortress) continue;
      y = fortress.y + 1; type = 'blaze';
    } else if (world.dimension === 'overworld') {
      if (Math.random() > .16 || system.renderer.day.value > .4) continue;
    }
    if (!isSolid(world.get(x, y - 1, z, false)) || blocks[world.get(x, y, z, false)]?.liquid) continue;
    const target = { x: x + .5, y: y + .02, z: z + .5 };
    if (collides(world, { pos: target, width: ADVENTURE_MOBS[type].width, height: ADVENTURE_MOBS[type].height })) continue;
    system.spawnMob(type, target); if (world.dimension !== 'end') break;
  }
}

export function tickAdventureMob(system, mob) {
  const { world, player, difficulty } = system.game; mob.previous = { ...mob.pos };
  if (mob.health <= 0) { mob.death -= .05; return; }
  if (difficulty === 'peaceful') { mob.health = 0; mob.death = 0; return; }
  mob.age++; mob.hurt = Math.max(0, mob.hurt - .05); mob.attackCooldown = Math.max(0, mob.attackCooldown - .05); mob.panic = Math.max(0, mob.panic - .05);
  mob.angry = Math.max(0, (mob.angry || 0) - .05);
  const dx = player.pos.x - mob.pos.x, dz = player.pos.z - mob.pos.z, distance = Math.hypot(dx, dz), dy = player.pos.y - mob.pos.y;
  if (distance > 128) return;
  const water = fluidAt(world, mob.pos.x, mob.pos.y + .1, mob.pos.z) === B.WATER;
  const targetEye = { x: player.pos.x, y: player.pos.y + player.eyeHeight, z: player.pos.z }, eye = { x: mob.pos.x, y: mob.pos.y + mob.height * .85, z: mob.pos.z };
  const direction = new THREE.Vector3(targetEye.x - eye.x, targetEye.y - eye.y, targetEye.z - eye.z), length = direction.length(); direction.normalize();
  const wall = length < 35 ? world.raycast(eye, direction, length) : true, visible = !wall || wall.distance > length - .4;
  if (mob.type === 'enderman' && !player.creative && player.health > 0 && visible && distance < 32) {
    const gaze = player.direction;
    if (-(gaze.x * direction.x + gaze.y * direction.y + gaze.z * direction.z) > 1 - .025 / Math.max(1, distance)) {
      mob.stareTicks = (mob.stareTicks || 0) + 1;
      if (mob.stareTicks > 5) { if (!mob.angry) system.game.audio.play('enderman_angry'); mob.angry = 60; }
    } else mob.stareTicks = 0;
  }
  const hostile = !player.creative && player.health > 0 && distance < 35 && (mob.type !== 'enderman' || mob.angry > 0);
  let walking = false, targetYaw = mob.yaw;
  if (hostile) { targetYaw = Math.atan2(dx, dz); walking = distance > (mob.type === 'blaze' ? 7 : 1.3); }
  else {
    if (--mob.walkTime <= 0) { mob.walkTime = 40 + Math.random() * 100; mob.targetYaw = mob.yaw + (Math.random() - .5) * 3; mob.idleTime = Math.random() < .6 ? mob.walkTime : 0; }
    walking = mob.idleTime-- <= 0; targetYaw = mob.targetYaw;
  }
  mob.yaw += Math.atan2(Math.sin(targetYaw - mob.yaw), Math.cos(targetYaw - mob.yaw)) * .22;
  if (walking) { const speed = mob.type === 'enderman' && hostile ? .12 : ADVENTURE_MOBS[mob.type].speed; mob.vel.x += Math.sin(mob.yaw) * speed * (mob.onGround || mob.type === 'blaze' ? 1 : .3); mob.vel.z += Math.cos(mob.yaw) * speed * (mob.onGround || mob.type === 'blaze' ? 1 : .3); }
  if (mob.type === 'blaze') {
    const targetHeight = hostile ? player.pos.y + 1.5 : (mob.homeY ?? mob.pos.y) + .7 + Math.sin(mob.age * .035) * .5;
    mob.vel.y += Math.max(-.03, Math.min(.03, (targetHeight - mob.pos.y) * .03));
    if (hostile && visible && distance < 16 && !mob.attackCooldown) {
      mob.volley = (mob.volley || 0) + 1;
      if (mob.volley === 1) { mob.attackCooldown = 1; mob.charging = true; system.game.audio.play('blaze_charge'); }
      else if (mob.volley <= 4) {
        direction.x += (Math.random() - .5) * .08; direction.z += (Math.random() - .5) * .08; direction.normalize();
        system.shoot(eye, direction, 1, 'mob', 'blaze_fireball'); mob.attackCooldown = .3;
      } else { mob.volley = 0; mob.charging = false; mob.attackCooldown = 5; }
    }
    if (water && mob.age % 20 === 0) system.hit(mob, 1, null, false, 'drown');
  } else {
    if (walking && mob.horizontalCollision && mob.onGround) mob.vel.y = .42;
    if (water) mob.vel.y += .04;
    if (mob.type === 'enderman' && (water || mob.fire > 0)) { if (mob.age % 20 === 0) system.hit(mob, 1, null, false, 'drown'); teleportEnderman(system, mob); mob.fire = 0; }
  }
  if (hostile && visible && distance < 1.7 && Math.abs(dy) < 2 && !mob.attackCooldown) {
    const factor = difficulty === 'easy' ? .65 : difficulty === 'hard' ? 1.5 : 1;
    player.damage(ADVENTURE_MOBS[mob.type].damage * factor, mob.type, { x: dx / (distance || 1), z: dz / (distance || 1) }); mob.attackCooldown = 1;
  }
  const before = { ...mob.pos }; moveBody(world, mob, mob.vel.x, mob.vel.y, mob.vel.z, .6); mob.walk += Math.hypot(mob.pos.x - before.x, mob.pos.z - before.z) * 5;
  const drag = mob.type === 'blaze' ? .83 : water ? .8 : mob.onGround ? .546 : .91;
  mob.vel.x *= drag; mob.vel.z *= drag; mob.vel.y = mob.type === 'blaze' ? Math.max(-.12, mob.vel.y * .8) : (mob.vel.y - .08) * .98;
  if (mob.age % 280 === 0 && distance < 24) system.game.audio.play(mob.type, 'stone', .3);
  if (mob.pos.y < -10) { mob.health = 0; mob.death = 0; }
}
