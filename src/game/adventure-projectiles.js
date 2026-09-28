import { B, I, blocks } from '../core/blocks.js';
import { collides } from '../core/physics.js';
import { makeStack } from '../core/inventory.js';
import { canBurnAt } from '../core/environment.js';

export function safePearlDestination(world, player, point) {
  for (const dy of [0, .5, 1, 2, -1]) for (const [dx, dz] of [[0, 0], [.3, 0], [-.3, 0], [0, .3], [0, -.3]]) {
    const pos = { x: point.x + dx, y: point.y + dy, z: point.z + dz };
    if (pos.y < 1 || pos.y > 125 || !world.chunks.has(`${Math.floor(pos.x / 16)},${Math.floor(pos.z / 16)}`)) continue;
    if (!collides(world, player, pos) && !blocks[world.get(pos.x, pos.y + .1, pos.z, false)]?.liquid) return pos;
  }
  return null;
}

export function impactAdventureProjectile(system, projectile, point) {
  const { world, player } = system.game;
  if (projectile.kind === 'ender_pearl') {
    if (player.health > 0) {
      const target = safePearlDestination(world, player, point);
      if (target) {
        const old = { ...player.pos }; player.pos = target; player.previous = { ...target }; player.vel = { x: 0, y: 0, z: 0 }; player.fallDistance = 0;
        player.damage(5, 'pearl'); system.game.audio.play('enderman_teleport');
        system.game.graphics.burst(old.x - .4, old.y, old.z - .4, B.PORTAL, 10, .5);
        system.game.graphics.burst(target.x - .4, target.y, target.z - .4, B.PORTAL, 10, .5);
      }
    }
  } else if (projectile.kind === 'dragon_breath') {
    const pos = { ...point }; const surface = world.surface(point.x, point.z);
    pos.y = Math.max(1, Math.min(point.y, surface)); world.endFight?.addCloud(pos);
    system.game.graphics.burst(pos.x - .5, pos.y, pos.z - .5, B.PORTAL, 20, .6);
  } else if (projectile.kind === 'blaze_fireball') {
    const x = Math.floor(point.x), y = Math.floor(point.y), z = Math.floor(point.z);
    if (world.get(x, y, z, false) === B.AIR && canBurnAt(world, x, y, z)) world.set(x, y, z, B.FIRE);
    system.game.graphics.burst(point.x - .2, point.y, point.z - .2, B.FIRE, 10, .5);
  }
  projectile.dead = true;
}

export function tickEye(system, projectile) {
  const target = projectile.target; if (!target) { projectile.dead = true; return; }
  const dx = target.x - projectile.pos.x, dy = target.y - projectile.pos.y, dz = target.z - projectile.pos.z;
  const distance = Math.hypot(dx, dy, dz), speed = Math.min(.32, distance);
  if (distance > .01) {
    projectile.vel = { x: dx / distance * speed, y: dy / distance * speed, z: dz / distance * speed };
    projectile.pos.x += projectile.vel.x; projectile.pos.y += projectile.vel.y; projectile.pos.z += projectile.vel.z;
  }
  if (projectile.age % 4 === 0) system.game.graphics.burst(projectile.pos.x - .5, projectile.pos.y - .5, projectile.pos.z - .5, B.PORTAL, 1, .05);
  if (projectile.age >= 80) {
    if (Math.random() < .8) system.drop(makeStack(I.EYE_OF_ENDER), projectile.pos);
    else system.game.graphics.burst(projectile.pos.x - .5, projectile.pos.y, projectile.pos.z - .5, B.END_PORTAL_FRAME, 12, .2);
    projectile.dead = true;
  }
}
