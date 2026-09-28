import * as THREE from 'three';
import { B, I, blocks, items, isSolid } from '../core/blocks.js';
import { makeStack, cloneStack, compatible } from '../core/inventory.js';
import { moveBody, bodyBox, collides, intersects } from '../core/physics.js';
import { intersectBox, chunkKey, SEA } from '../core/world.js';
import { hash, seedNumber, clamp, lerp } from '../core/noise.js';
import { texturedBox } from '../render/mesher.js';
import { ownedMesh, disposeOwnedObject } from '../render/resources.js';
import { fluidAt, flowVector } from '../core/fluids.js';
import { EndBattleView } from '../render/end-battle.js';
import { ADVENTURE_MOBS, adventureModel, spawnAdventureMobs, tickAdventureMob, teleportEnderman } from './adventure-mobs.js';
import { impactAdventureProjectile, tickEye } from './adventure-projectiles.js';
import { NavigationScheduler } from '../core/navigation.js';
import { ORDINARY_HOSTILES, spawnHostiles, tickHostile } from './hostile-ai.js';
import { hostileModel } from '../render/hostile-art.js';
import { EntityBatches } from '../render/entity-batches.js';
import { mergeNearbyDrops } from '../core/drop-merge.js';
import { creatureMaterial, lightCreature } from '../render/entity-light.js';

const v3 = p => new THREE.Vector3(p.x, p.y, p.z);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const angleLerp = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
/** Missing chunks are not empty terrain. Keep the whole swept X/Z footprint
 * resident before advancing an entity, including fast arrows at boundaries. */
export function entityAreaLoaded(world, entity) {
  const radius = (entity.width || .1) / 2, vx = entity.vel?.x || 0, vz = entity.vel?.z || 0;
  const minX = Math.floor((entity.pos.x - radius + Math.min(0, vx)) / 16), maxX = Math.floor((entity.pos.x + radius + Math.max(0, vx)) / 16);
  const minZ = Math.floor((entity.pos.z - radius + Math.min(0, vz)) / 16), maxZ = Math.floor((entity.pos.z + radius + Math.max(0, vz)) / 16);
  for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) if (!world.chunks.has(`${x},${z}`)) return false;
  return true;
}
const MOB_FIELDS = ['type', 'pos', 'vel', 'health', 'yaw', 'targetYaw', 'age', 'baby', 'sheared', 'breedCooldown', 'love', 'fire', 'fuse', 'attackCooldown', 'panic', 'walkTime', 'idleTime', 'angry', 'stareTicks', 'volley', 'charging', 'homeY', 'provoked', 'lastPlayerHit', 'lastSeen', 'lastSeenTicks', 'bowDraw', 'air', 'persistent', 'fallDistance'];
const TRANSIENT_FIELDS = {
  falling: ['id', 'pos', 'vel', 'age'], tnt: ['pos', 'vel', 'fuse'],
  projectiles: ['kind', 'owner', 'pos', 'vel', 'damage', 'age', 'stuck', 'target'], orbs: ['amount', 'pos', 'vel', 'age']
};
const fields = (source, names) => Object.fromEntries(names.filter(name => source[name] !== undefined).map(name => [name, source[name]]));
export const MOB_TYPES = {
  ...ADVENTURE_MOBS,
  pig: { health: 10, width: .9, height: .9, passive: true, speed: .065, food: I.APPLE, drops: [[I.PORK, 1, 3]] },
  cow: { health: 10, width: .9, height: 1.4, passive: true, speed: .055, food: I.WHEAT, drops: [[I.BEEF, 1, 3], [I.LEATHER, 0, 2]] },
  sheep: { health: 8, width: .9, height: 1.3, passive: true, speed: .052, food: I.WHEAT, drops: [[I.MUTTON, 1, 2], [B.WOOL, 1, 1]] },
  chicken: { health: 4, width: .4, height: .7, passive: true, speed: .06, food: I.SEEDS, drops: [[I.CHICKEN, 1, 1], [I.FEATHER, 0, 2]] },
  ...ORDINARY_HOSTILES
};

export class EntitySystem {
  constructor(game, saved = {}) {
    this.game = game; this.renderer = game.graphics; this.scene = this.renderer.scene; this.atlas = game.atlas;
    this.mobs = []; this.drops = []; this.falling = []; this.tnt = []; this.projectiles = []; this.orbs = [];
    this.spawned = new Set(saved.spawned || []); this.geometry = new Map(); this.ticks = saved.ticks || 0;
    this.navigation = new NavigationScheduler(game.world); this.batches = new EntityBatches(this.scene); this.nextMobId = 1;
    this.entityFrustum=new THREE.Frustum();this.entityProjection=new THREE.Matrix4();
    this.shadowTexture = this.makeShadow(); this.shadowGeometry = new THREE.PlaneGeometry(1.25, 1.25);
    this.shadowMaterial = new THREE.MeshBasicMaterial({ map: this.shadowTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    this.accentMaterial=creatureMaterial(this.atlas);this.accentMaterial.color.setScalar(.85);
    this.playerModel = this.model('steve'); this.scene.add(this.playerModel.root);
    for (const mob of saved.mobs || []) if (MOB_TYPES[mob.type]) this.spawnMob(mob.type, mob.pos, mob);
    for (const drop of saved.drops || []) this.drop(drop.stack, drop.pos, drop.vel, drop.delay ?? 0, drop.age || 0);
    for (const data of saved.falling || []) this.restoreBody(this.fall(data.id, data.pos.x - .5, data.pos.y, data.pos.z - .5), data, 'falling');
    for (const data of saved.tnt || []) this.restoreBody(this.primeTNT(data.pos.x - .5, data.pos.y, data.pos.z - .5, data.fuse, true), data, 'tnt');
    for (const data of saved.projectiles || []) this.restoreBody(this.shoot(data.pos, { x: 0, y: 0, z: 1 }, 1, data.owner, data.kind, true), data, 'projectiles');
    for (const data of saved.orbs || []) this.restoreBody(this.xp(data.amount, data.pos), data, 'orbs');
    this.endBattle = game.world.endFight ? new EndBattleView(game, this) : null;
  }
  restoreBody(entity, data, type) {
    if (!entity) return;
    Object.assign(entity, structuredClone(fields(data, TRANSIENT_FIELDS[type])));
    entity.previous = { ...entity.pos }; entity.mesh.position.set(entity.pos.x, entity.pos.y, entity.pos.z);
    if (type === 'projectiles') entity.mesh.lookAt(entity.pos.x + entity.vel.x, entity.pos.y + entity.vel.y, entity.pos.z + entity.vel.z);
  }
  makeShadow() {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16; const ctx = canvas.getContext('2d');
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const a = Math.max(0, 1 - Math.hypot(x - 7.5, y - 7.5) / 7.5) * .38;
      ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(x, y, 1, 1);
    }
    const texture = new THREE.CanvasTexture(canvas); texture.magFilter = THREE.NearestFilter; return texture;
  }
  part(texture, size, position, parent, material, faceTexture) {
    const key = `${texture}:${faceTexture || ''}:${size.join(',')}`;
    if (!this.geometry.has(key)) this.geometry.set(key, texturedBox(this.atlas, faceTexture ? [texture, texture, texture, texture, faceTexture, texture] : texture, size, true));
    const mesh = new THREE.Mesh(this.geometry.get(key), material); mesh.position.set(...position); parent.add(mesh); return mesh;
  }
  model(type) {
    const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
    const material = type === 'steve' ? this.renderer.entityMaterial.clone() : creatureMaterial(this.atlas);
    const model = { root, body, material, legs: [], arms: [], head: new THREE.Group() };
    body.add(model.head);
    const part = (tex, size, pos, parent = body, face) => this.part(tex, size, pos, parent, tex==='moss_heart'||tex==='weaver_eye' ? this.accentMaterial : material, face);
    const limb = (tex, size, pivotPos, array = model.legs) => {
      const pivot = new THREE.Group(); pivot.position.set(...pivotPos); body.add(pivot); part(tex, size, [0, -size[1] / 2, 0], pivot); array.push(pivot); return pivot;
    };
    if (ORDINARY_HOSTILES[type]) {
      hostileModel(type, model, part, limb);
      if (type === 'skeleton') { const bow = this.renderer.makeItem(I.BOW, .65); bow.position.set(0, -.52, .04); model.arms[1].add(bow); }
    }
    else if (ADVENTURE_MOBS[type]) adventureModel(type, model, part, limb);
    else if (type === 'steve') {
      model.head.position.set(0,1.5,0);part('skin',[.5,.5,.5],[0,.25,0],model.head,'steve_face');part('steve_back',[.505,.1,.505],[0,.46,0],model.head);
      part('shirt',[.5,.75,.25],[0,1.125,0]);
      for(const side of [-1,1]){limb('trousers',[.25,.75,.25],[side*.125,.75,0]);const arm=limb('skin',[.25,.75,.25],[side*.375,1.5,0],model.arms);part('shirt',[.255,.25,.255],[0,-.125,0],arm);}
      body.scale.setScalar(.9);
    } else if (type === 'chicken') {
      part('chicken', [.375, .4, .375], [0, .4, 0]); model.head.position.set(0, .6, .18);
      part('chicken', [.25, .375, .25], [0, .09, 0], model.head, 'chicken_face');
      part('gold_block', [.25, .1, .13], [0, .02, .18], model.head); part('red_wool', [.12, .18, .07], [0, -.09, .16], model.head);
      limb('oak_planks', [.0625, .2, .0625], [-.095, .2, 0]); limb('oak_planks', [.0625, .2, .0625], [.095, .2, 0]);
      for (const side of [-1, 1]) { const wing = limb('chicken', [.065, .3, .31], [side * .21, .58, 0], model.arms); wing.rotation.z = side * .12; }
    } else {
      const pig = type === 'pig', sheep = type === 'sheep', texture = type === 'cow' ? 'cow' : sheep ? 'sheep' : 'pig';
      const legHeight = pig ? .375 : .55, bodyHeight = pig ? .5 : .65;
      part(texture, [pig ? .7 : .75, bodyHeight, pig ? 1 : 1.1], [0, legHeight + bodyHeight / 2, 0]);
      model.head.position.set(0, pig ? .75 : 1.05, .65);
      part(texture, [.5, pig ? .5 : .6, pig ? .5 : .4], [0, 0, 0], model.head, `${type}_face`);
      if (pig) part('pig', [.28, .18, .13], [0, -.07, .28], model.head, 'pig_face');
      if (type === 'cow') {
        for (const x of [-.29, .29]) part('sand', [.12, .18, .12], [x, .3, -.02], model.head);
        part('pig', [.32, .15, .35], [0, .5, -.2]);
      }
      if (sheep) {
        model.wool = part('wool', [.81, .72, 1.15], [0, .92, 0]);
        part('wool', [.53, .2, .42], [0, .22, 0], model.head);
      }
      for (const [x, z] of [[-.22, .35], [.22, .35], [-.22, -.35], [.22, -.35]]) {
        const leg = limb(texture, [.25, legHeight, .25], [x, legHeight, z]);
        if (!pig) part('oak_log', [.255, .12, .255], [0, -legHeight + .06, 0], leg);
      }
    }
    const shadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    shadow.rotation.x = -Math.PI / 2; root.add(shadow); model.shadow = shadow;
    return model;
  }
  spawnMob(type, pos, saved = {}) {
    const def = MOB_TYPES[type]; if (!def) return null;
    const mob = { type, aiId: this.nextMobId++, pos: { ...pos }, previous: { ...pos }, vel: { x: 0, y: 0, z: 0 }, width: def.width, height: def.height,
      health: def.health, yaw: Math.random() * Math.PI * 2, targetYaw: 0, walk: 0, walkTime: 0, idleTime: 0, homeY: pos.y,
      onGround: false, hurt: 0, panic: 0, age: 0, love: 0, breedCooldown: 0, fuse: 0, fire: 0, attackCooldown: 0,
      ...structuredClone(fields(saved, MOB_FIELDS)), model: this.model(type) };
    if (mob.baby) { mob.width *= .5; mob.height *= .5; mob.model.body.scale.multiplyScalar(.5); }
    this.mobs.push(mob); return mob;
  }
  naturalSpawns() {
    const { world, player, difficulty } = this.game, seed = seedNumber(world.seed), cx = Math.floor(player.pos.x / 16), cz = Math.floor(player.pos.z / 16);
    spawnAdventureMobs(this);
    if (world.dimension !== 'overworld') return;
    if (world.dimension === 'overworld') {
      const nearby = [...world.chunks.values()].filter(c => Math.abs(c.cx - cx) <= 3 && Math.abs(c.cz - cz) <= 3).sort((a, b) => (a.cx - cx) ** 2 + (a.cz - cz) ** 2 - (b.cx - cx) ** 2 - (b.cz - cz) ** 2);
      for (const c of nearby) {
        if (this.spawned.has(c.key)) continue; this.spawned.add(c.key);
        if (this.mobs.filter(m => MOB_TYPES[m.type].passive).length >= 24 || hash(c.cx, 191, c.cz, seed) > .22) continue;
        const x = c.cx * 16 + 3 + Math.floor(hash(c.cx, 192, c.cz, seed) * 10), z = c.cz * 16 + 3 + Math.floor(hash(c.cx, 193, c.cz, seed) * 10);
        const y = world.surface(x, z); if (world.get(x, y - 1, z, false) !== B.GRASS || y <= SEA) continue;
        const type = ['pig', 'cow', 'sheep', 'chicken'][Math.floor(hash(c.cx, 194, c.cz, seed) * 4)];
        const count = 2 + Math.floor(hash(c.cx, 195, c.cz, seed) * 3);
        for (let i = 0; i < count; i++) {
          const px = x + (i % 2) * 2 + .5, pz = z + Math.floor(i / 2) * 2 + .5, py = world.surface(px, pz);
          if (Math.abs(py - y) < 3 && !isSolid(world.get(px, py, pz, false)) && !isSolid(world.get(px, py + 1, pz, false))) this.spawnMob(type, { x: px, y: py + .02, z: pz });
        }
      }
    }
  }
  drop(stack, pos, vel, delay = 10, age = 0) {
    if (!stack?.count || !items[stack.id]) return;
    const drop = { stack: cloneStack(stack), pos: { ...pos }, previous: { ...pos }, vel: vel ? { ...vel } : { x: (Math.random() - .5) * .1, y: .18, z: (Math.random() - .5) * .1 },
      width: .25, height: .25, onGround: false, delay, age, rotation: Math.random() * 6.28, mesh: this.renderer.makeItem(stack.id, items[stack.id].block === undefined ? .4 : .25) };
    this.drops.push(drop); this.scene.add(drop.mesh); return drop;
  }
  xp(amount, pos) {
    if (!amount) return;
    const material = new THREE.MeshBasicMaterial({ color: 0x85e32f });
    const orb = { amount, pos: { ...pos }, vel: { x: 0, y: .12, z: 0 }, width: .15, height: .15, age: 0,
      mesh: new THREE.Mesh(new THREE.OctahedronGeometry(.11), material) };
    ownedMesh(orb.mesh); this.orbs.push(orb); this.scene.add(orb.mesh); return orb;
  }
  fall(id, x, y, z) {
    const entity = { id, pos: { x: x + .5, y, z: z + .5 }, previous: { x: x + .5, y, z: z + .5 }, vel: { x: 0, y: 0, z: 0 }, width: .98, height: .98, age: 0, mesh: this.renderer.makeItem(id, .98) };
    this.falling.push(entity); this.scene.add(entity.mesh); return entity;
  }
  primeTNT(x, y, z, fuse = 80, restoring = false) {
    if (!restoring) this.game.world.set(x, y, z, B.AIR);
    const entity = { pos: { x: x + .5, y, z: z + .5 }, vel: { x: (Math.random() - .5) * .04, y: .2, z: (Math.random() - .5) * .04 }, width: .98, height: .98, fuse, mesh: this.renderer.makeItem(B.TNT, .98) };
    entity.mesh.material = entity.mesh.material.clone(); ownedMesh(entity.mesh, { geometry: false });
    this.tnt.push(entity); this.scene.add(entity.mesh); if (!restoring) this.game.audio.play('fuse'); return entity;
  }
  shoot(origin, direction, charge = 1, owner = 'player', kind = 'arrow', restoring = false) {
    const root = new THREE.Group();
    if (kind === 'arrow') {
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(.035, .035, .55), new THREE.MeshBasicMaterial({ color: 0x896736 })); root.add(shaft);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(.065, .12, 4), new THREE.MeshBasicMaterial({ color: 0xc3c7c4 })); tip.rotation.x = Math.PI / 2; tip.position.z = .31; root.add(tip);
      for (const rotation of [0, Math.PI / 2]) {
        const feather = new THREE.Mesh(new THREE.PlaneGeometry(.17, .17), new THREE.MeshBasicMaterial({ color: 0xe8e6d6, side: THREE.DoubleSide })); feather.rotation.x = Math.PI / 2; feather.rotation.z = rotation; feather.position.z = -.2; root.add(feather);
      }
      root.traverse(object => { if (object.isMesh) ownedMesh(object); });
    } else if (kind === 'blaze_fireball' || kind === 'dragon_breath') {
      const color = kind === 'blaze_fireball' ? 0xffb132 : 0x9b38bc;
      root.add(ownedMesh(new THREE.Mesh(new THREE.OctahedronGeometry(kind === 'blaze_fireball' ? .18 : .42, 0), new THREE.MeshBasicMaterial({ color }))));
    } else root.add(this.renderer.makeItem(({ ender_pearl: I.ENDER_PEARL, eye_of_ender: I.EYE_OF_ENDER })[kind] || I.EGG, .25));
    const speed = kind === 'arrow' ? .8 + charge * 1.8 : kind === 'blaze_fireball' ? .7 : kind === 'dragon_breath' ? .65 : 1.2;
    const p = { kind, owner, pos: { ...origin }, vel: { x: direction.x * speed, y: direction.y * speed, z: direction.z * speed }, damage: 2 + charge * 4, age: 0, stuck: false, mesh: root };
    this.projectiles.push(p); this.scene.add(root); if (!restoring) this.game.audio.play('bow'); return p;
  }
  hitTest(origin, direction, reach = 4.5, ignored) {
    let closest = this.endBattle?.hitTest(origin, direction, reach) || null;
    for (const mob of this.mobs) {
      if (mob.health <= 0 || mob === ignored) continue;
      const hit = intersectBox([origin.x, origin.y, origin.z], [direction.x, direction.y, direction.z], bodyBox(mob));
      if (hit && hit.distance <= reach && (!closest || hit.distance < closest.distance)) closest = { ...hit, mob };
    }
    return closest;
  }
  hit(mob, damage, direction, burning = false, cause = 'melee') {
    if (mob.boss) return this.endBattle?.hit(mob, damage, cause) || false;
    if (mob.type === 'enderman' && cause === 'arrow' && teleportEnderman(this, mob)) { mob.angry = 60; return false; }
    if (mob.type === 'enderman') mob.angry = 60;
    if (mob.health <= 0 || mob.hurt > .1) return false;
    if (cause === 'melee' || cause === 'arrow') { mob.lastPlayerHit = mob.age; mob.provoked = 1200; mob.lastSeen = { ...this.game.player.pos }; mob.lastSeenTicks = 80; }
    mob.health -= damage; mob.hurt = .5; mob.panic = 4;
    if (direction) { mob.vel.x += direction.x * .4; mob.vel.z += direction.z * .4; mob.vel.y = .32; }
    if (burning && !MOB_TYPES[mob.type].fireproof) mob.fire = 8;
    this.game.audio.play(mob.type === 'creeper' || mob.type === 'spider' ? 'hit' : mob.type, 'stone', .7);
    if (mob.health <= 0) {
      mob.death = .8;
      if (!mob.baby) for (const [id, min, max] of MOB_TYPES[mob.type].drops) {
        if (mob.sheared && id === B.WOOL) continue;
        const count = min + Math.floor(Math.random() * (max - min + 1));
        const cooked = mob.fire > 0 ? ({ [I.PORK]: I.COOKED_PORK, [I.BEEF]: I.STEAK, [I.MUTTON]: I.COOKED_MUTTON, [I.CHICKEN]: I.COOKED_CHICKEN }[id] || id) : id;
        if (count) this.drop(makeStack(cooked, count), { x: mob.pos.x, y: mob.pos.y + .35, z: mob.pos.z });
      }
      if (mob.lastPlayerHit !== undefined && mob.age - mob.lastPlayerHit <= 100) {
        this.xp(MOB_TYPES[mob.type].passive ? 1 + Math.floor(Math.random() * 3) : mob.type === 'blaze' ? 10 : 5, { ...mob.pos, y: mob.pos.y + .5 });
        this.game.advancement(MOB_TYPES[mob.type].passive ? 'hunt' : 'monster');
      }
    }
    return true;
  }
  interact(mob) {
    const player = this.game.player, stack = player.inventory.slots[player.selected], item = items[stack?.id];
    if (!item || !MOB_TYPES[mob.type]?.passive) return false;
    if (mob.type === 'sheep' && item?.id === I.SHEARS && !mob.sheared && !mob.baby) {
      mob.sheared = true; this.drop(makeStack(B.WOOL, 1 + Math.floor(Math.random() * 3)), { ...mob.pos, y: mob.pos.y + .5 });
      if (!player.creative) player.inventory.damage(player.selected); this.game.audio.play('break', 'cloth'); return true;
    }
    if (stack?.id === MOB_TYPES[mob.type]?.food && !mob.love && !mob.breedCooldown) {
      mob.love = 30; if (!player.creative) player.inventory.consume(player.selected); this.game.ui.toast('爱意绵绵', '靠近另一只同种动物，它们就会繁殖。', B.POPPY); return true;
    }
    return false;
  }
  tickMob(mob) {
    if (ORDINARY_HOSTILES[mob.type]) return tickHostile(this, mob);
    if (ADVENTURE_MOBS[mob.type]) return tickAdventureMob(this, mob);
    const { world, player } = this.game, def = MOB_TYPES[mob.type]; Object.assign(mob.previous,mob.pos);
    if (mob.health <= 0) { mob.death -= .05; return; }
    mob.age++; mob.hurt = Math.max(0, mob.hurt - .05); mob.panic = Math.max(0, mob.panic - .05);
    mob.love = Math.max(0, mob.love - .05); mob.breedCooldown = Math.max(0, mob.breedCooldown - .05); mob.attackCooldown = Math.max(0, mob.attackCooldown - .05);
    const dx = player.pos.x - mob.pos.x, dz = player.pos.z - mob.pos.z, dy = player.pos.y - mob.pos.y, dist = Math.hypot(dx, dz);
    const held = player.inventory.slots[player.selected]?.id, tempted = def.passive && held === def.food && dist < 9;
    let moving = false, targetYaw = mob.yaw, accel = def.speed;
    if (tempted) { targetYaw = Math.atan2(dx,dz); moving = dist>2.1; }
    else if (mob.panic) { targetYaw = Math.atan2(-dx, -dz); moving = true; accel *= 1.6; }
    else {
      if (--mob.walkTime <= 0) { mob.walkTime = 30 + Math.random() * 100; mob.targetYaw = mob.yaw + (Math.random() - .5) * 3; mob.idleTime = Math.random() < .35 ? mob.walkTime : 0; }
      moving = mob.idleTime-- <= 0; targetYaw = mob.targetYaw;
    }
    if (mob.love && !mob.baby) {
      const mate = this.mobs.find(m => m !== mob && m.type === mob.type && m.love > 0 && !m.baby && distance(m.pos, mob.pos) < 8);
      if (mate) {
        targetYaw = Math.atan2(mate.pos.x - mob.pos.x, mate.pos.z - mob.pos.z); moving = true;
        if (distance(mate.pos, mob.pos) < 1.7) {
          mob.love = mate.love = 0; mob.breedCooldown = mate.breedCooldown = 300;
          this.spawnMob(mob.type, { ...mob.pos }, { baby: true }); this.xp(3, { ...mob.pos, y: mob.pos.y + .5 }); this.game.advancement('breed');
        }
      }
    }
    mob.yaw = angleLerp(mob.yaw, targetYaw, .2);
    if (moving) {
      const sx = Math.sin(mob.yaw), sz = Math.cos(mob.yaw), fx = mob.pos.x + sx, fz = mob.pos.z + sz;
      const ahead = world.get(fx, mob.pos.y + .1, fz, false), lower = world.get(fx, mob.pos.y - 2, fz, false);
      if (ahead === B.LAVA || !lower && mob.onGround) { mob.targetYaw += Math.PI * .65; moving = false; }
      else {
        mob.vel.x += sx * accel * (mob.onGround ? 1 : .3); mob.vel.z += sz * accel * (mob.onGround ? 1 : .3);
        if ((mob.horizontalCollision || isSolid(ahead)) && mob.onGround) {
          if (!isSolid(world.get(fx, mob.pos.y + 1.2, fz, false))) mob.vel.y = .42;
          else { mob.targetYaw += .8; mob.yaw += .4; }
        }
      }
    }
    const liquid = fluidAt(world, mob.pos.x, mob.pos.y + .1, mob.pos.z);
    if (liquid === B.WATER || liquid === B.LAVA) mob.vel.y += .04;
    const oldX=mob.pos.x,oldZ=mob.pos.z;moveBody(world,mob,mob.vel.x,mob.vel.y,mob.vel.z,.6);
    mob.walk+=Math.hypot(mob.pos.x-oldX,mob.pos.z-oldZ)*5;
    const friction = liquid === B.WATER ? .8 : mob.onGround ? .546 : .91;
    mob.vel.x *= friction; mob.vel.z *= friction; mob.vel.y = (mob.vel.y - (liquid === B.WATER ? .02 : .08)) * .98;
    if (mob.type === 'chicken' && mob.vel.y < -.1) mob.vel.y = -.1;
    if (liquid === B.LAVA) mob.fire = 10;
    if (world.get(mob.pos.x, mob.pos.y + .2, mob.pos.z, false) === B.FIRE) mob.fire = 8;
    if (liquid === B.WATER) mob.fire = 0;
    if (mob.age % 20 === 0 && ['zombie', 'skeleton'].includes(mob.type) && this.renderer.day.value > .8 && !world.weather && world.dimension === 'overworld') {
      const c = world.chunks.get(chunkKey(Math.floor(mob.pos.x / 16), Math.floor(mob.pos.z / 16)));
      const h = c?.heights[(Math.floor(mob.pos.x) & 15) + (Math.floor(mob.pos.z) & 15) * 16];
      if (mob.pos.y + mob.height > h + 1) mob.fire = 5;
    }
    if (mob.fire > 0) { mob.fire -= .05; if (mob.age % 20 === 0) this.hit(mob, 1, null, false, 'environment'); }
    if (mob.age % 200 === 0 && Math.random() < .28 && dist < 22) this.game.audio.play(mob.type, 'stone', .45 * (1 - dist / 25));
    if (mob.type === 'chicken' && !mob.baby && mob.age % 7200 === 0) this.drop(makeStack(I.EGG), { ...mob.pos, y: mob.pos.y + .2 });
    if (mob.type === 'sheep' && mob.sheared && mob.age % 2400 === 0 && world.get(mob.pos.x, mob.pos.y - .1, mob.pos.z, false) === B.GRASS) { mob.sheared = false; world.set(mob.pos.x, mob.pos.y - .1, mob.pos.z, B.DIRT); }
    if (mob.baby && mob.age > 12000) { mob.baby = false; mob.width *= 2; mob.height *= 2; mob.model.body.scale.multiplyScalar(2); }
    if (mob.pos.y < -5) { mob.health = 0; mob.death = 0; }
  }
  explode(x, y, z, strength = 4) {
    const { world, player } = this.game;
    this.game.audio.play('explode', 'stone', clamp(1 - distance(player.pos, { x, y, z }) / 50, .08, 1));
    this.renderer.burst(x - .5, y - .5, z - .5, B.STONE, 120, 3);
    const radius = Math.ceil(strength), changes = [];
    for (let dy = -radius; dy <= radius; dy++) for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      const bx = Math.floor(x + dx), by = Math.floor(y + dy), bz = Math.floor(z + dz), id = world.get(bx, by, bz, false);
      if (!id || [B.BEDROCK, B.OBSIDIAN, B.WATER, B.LAVA, B.PORTAL].includes(id)) continue;
      const d = Math.hypot(dx, dy, dz), resistance = (blocks[id]?.hardness || .1) * .13;
      if (d + resistance < strength * (.8 + Math.random() * .35)) changes.push({ x: bx, y: by, z: bz, id });
    }
    for (const hit of changes) {
      if (hit.id === B.TNT) this.primeTNT(hit.x, hit.y, hit.z, 10 + Math.floor(Math.random() * 20));
      else this.game.breakBlock(hit, true, Math.random() < .3);
    }
    const hitBody = (body, callback) => {
      const center = { x: body.pos.x, y: body.pos.y + body.height / 2, z: body.pos.z }, d = distance(center, { x, y, z });
      if (d > strength * 2) return;
      const dir = v3(center).sub(new THREE.Vector3(x, y, z)).normalize(), wall = world.raycast({ x, y, z }, dir, d);
      const exposure = wall ? .3 : 1, power = (1 - d / (strength * 2)) * exposure;
      callback(Math.ceil((power * power + power) * 7 * strength + 1), dir);
      body.vel.x += dir.x * power; body.vel.y += dir.y * power + .15; body.vel.z += dir.z * power;
    };
    hitBody(player, (damage, dir) => player.damage(damage, 'explosion', dir));
    for (const mob of this.mobs) if (mob.health > 0) hitBody(mob, (damage, dir) => this.hit(mob, damage, dir, false, 'explosion'));
  }
  tick() {
    const { world, player } = this.game; this.ticks++;
    if (this.ticks === 1 || this.ticks % 100 === 0) this.naturalSpawns();
    if (this.ticks % 20 === 0 && world.chunks) spawnHostiles(this);
    this.navigation?.tick();
    if (this.ticks % 200 === 0 && world.chunks) spawnAdventureMobs(this, true);
    for (const mob of this.mobs) {
      if (!MOB_TYPES[mob.type].passive && (this.game.difficulty === 'peaceful' || !mob.persistent && distance(mob.pos, player.pos) > 128)) { mob.health = 0; mob.death = 0; continue; }
      if (!entityAreaLoaded(world, mob)) continue;
      if (distance(mob.pos, player.pos) > 95 && MOB_TYPES[mob.type].passive) continue;
      this.tickMob(mob);
    }
    this.mobs = this.mobs.filter(mob => {
      if (mob.health <= 0 && mob.death <= 0) { disposeOwnedObject(mob.model.root); mob.model.material.dispose(); return false; } return true;
    });
    for (const drop of this.drops) {
      if (!entityAreaLoaded(world, drop)) continue;
      Object.assign(drop.previous,drop.pos); drop.age++; drop.delay--;
      const inWater = fluidAt(world, drop.pos.x, drop.pos.y + .01, drop.pos.z) === B.WATER;
      if (inWater) {
        const flow = flowVector(world, drop.pos.x, drop.pos.y, drop.pos.z);
        drop.vel.x += flow[0] * .014; drop.vel.z += flow[2] * .014;
      }
      drop.vel.y -= inWater ? .004 : .04;
      if (inWater && drop.vel.y < -.01) drop.vel.y += .008;
      moveBody(world, drop, drop.vel.x, drop.vel.y, drop.vel.z, 0);
      drop.vel.x *= drop.onGround ? .58 : .98; drop.vel.z *= drop.onGround ? .58 : .98; drop.vel.y *= .98;
      if (drop.delay <= 0 && Math.hypot(drop.pos.x - player.pos.x, drop.pos.z - player.pos.z) < 1.25 && drop.pos.y > player.pos.y - .6 && drop.pos.y < player.pos.y + player.height && player.health > 0) {
        const oldCount = drop.stack.count, leftover = player.inventory.add(drop.stack);
        if (!leftover || leftover.count < oldCount) {
          this.game.audio.play('pickup'); this.game.onPickup({ ...drop.stack, count: oldCount - (leftover?.count || 0) });
          drop.stack = leftover; if (!leftover) drop.dead = true;
        }
      }
      if (drop.age > 6000 || drop.pos.y < -10 || fluidAt(world, drop.pos.x, drop.pos.y, drop.pos.z) === B.LAVA) drop.dead = true;
    }
    if(this.ticks%20===0)this.dropMergeStats=mergeNearbyDrops(this.drops,drop=>entityAreaLoaded(world,drop));
    this.drops = this.drops.filter(d => { if (d.dead) disposeOwnedObject(d.mesh); return !d.dead; });
    for (const falling of this.falling) {
      if (!entityAreaLoaded(world, falling)) continue;
      falling.previous = { ...falling.pos }; falling.age++; falling.vel.y -= .04;
      moveBody(world, falling, 0, falling.vel.y, 0, 0); falling.vel.y *= .98;
      if (falling.onGround) {
        const x = Math.floor(falling.pos.x), y = Math.floor(falling.pos.y + .05), z = Math.floor(falling.pos.z);
        if (!isSolid(world.get(x, y, z, false))) world.set(x, y, z, falling.id);
        else this.drop(makeStack(falling.id), falling.pos);
        falling.dead = true;
      }
      if (falling.age > 600 || falling.pos.y < -5) falling.dead = true;
    }
    this.falling = this.falling.filter(f => { if (f.dead) disposeOwnedObject(f.mesh); return !f.dead; });
    for (const tnt of this.tnt) {
      if (!entityAreaLoaded(world, tnt)) continue;
      tnt.vel.y -= .04; moveBody(world, tnt, tnt.vel.x, tnt.vel.y, tnt.vel.z, 0); tnt.vel.x *= .98; tnt.vel.z *= .98;
      if (--tnt.fuse <= 0) { tnt.dead = true; this.explode(tnt.pos.x, tnt.pos.y + .5, tnt.pos.z, 4); }
    }
    this.tnt = this.tnt.filter(t => { if (t.dead) disposeOwnedObject(t.mesh); return !t.dead; });
    for (const p of this.projectiles) {
      if (!entityAreaLoaded(world, p)) continue;
      p.age++;
      if (p.kind === 'eye_of_ender') { tickEye(this, p); continue; }
      if (p.stuck) {
        if (p.owner === 'player' && distance(p.pos, player.pos) < 1.5 && !player.inventory.add(makeStack(I.ARROW))) p.dead = true;
        if (p.age > 1200) p.dead = true; continue;
      }
      const direction = v3(p.vel), length = direction.length(); direction.normalize();
      const wall = world.raycast(p.pos, direction, length), target = p.owner === 'player' ? this.hitTest(p.pos, direction, length) : (() => {
        const hit = intersectBox([p.pos.x, p.pos.y, p.pos.z], [direction.x, direction.y, direction.z], bodyBox(player)); return hit && hit.distance <= length ? hit : null;
      })();
      if (target && (!wall || target.distance < wall.distance)) {
        const point = { x: p.pos.x + direction.x * target.distance, y: p.pos.y + direction.y * target.distance, z: p.pos.z + direction.z * target.distance };
        if (p.owner === 'player') { if (p.kind === 'arrow') this.hit(target.mob, p.damage, direction, false, 'arrow'); }
        else if (p.kind === 'blaze_fireball') { player.damage(5, 'blaze', direction); if (!player.creative) player.burnTime = Math.max(5, player.burnTime); }
        else if (p.kind === 'arrow') player.damage(p.damage, 'arrow', direction);
        if (['ender_pearl', 'blaze_fireball', 'dragon_breath'].includes(p.kind)) impactAdventureProjectile(this, p, point);
        p.dead = true;
      } else if (wall) {
        p.pos = { x: wall.point.x - direction.x * .03, y: wall.point.y - direction.y * .03, z: wall.point.z - direction.z * .03 }; p.stuck = true;
        if (p.kind === 'egg') { p.dead = true; if (Math.random() < .125) this.spawnMob('chicken', { ...p.pos }, { baby: true }); }
        if (['ender_pearl', 'blaze_fireball', 'dragon_breath'].includes(p.kind)) impactAdventureProjectile(this, p, p.pos);
      } else {
        p.pos.x += p.vel.x; p.pos.y += p.vel.y; p.pos.z += p.vel.z;
        const fireball = p.kind === 'blaze_fireball' || p.kind === 'dragon_breath';
        if (!fireball) { p.vel.x *= .99; p.vel.z *= .99; p.vel.y = p.vel.y * .99 - (p.kind === 'ender_pearl' || p.kind === 'egg' ? .03 : .05); }
      }
      if (p.age > 1200 || p.pos.y < -10) p.dead = true;
    }
    this.projectiles = this.projectiles.filter(p => { if (p.dead) disposeOwnedObject(p.mesh); return !p.dead; });
    for (const orb of this.orbs) {
      if (!entityAreaLoaded(world, orb)) continue;
      orb.age++; const target = { x: player.pos.x, y: player.pos.y + .7, z: player.pos.z }, d = distance(orb.pos, target);
      if (d < 8 && d > .01) {
        const pull = (1 - d / 8) ** 2 * .07; orb.vel.x += (target.x - orb.pos.x) / d * pull; orb.vel.y += (target.y - orb.pos.y) / d * pull; orb.vel.z += (target.z - orb.pos.z) / d * pull;
      } else orb.vel.y -= .025;
      moveBody(world, orb, orb.vel.x, orb.vel.y, orb.vel.z, 0); orb.vel.x *= .9; orb.vel.y *= .9; orb.vel.z *= .9;
      if (d < .8 && player.health > 0) { player.addXP(orb.amount); this.game.audio.play('xp'); orb.dead = true; }
      if (orb.age > 6000) orb.dead = true;
    }
    this.orbs = this.orbs.filter(o => { if (o.dead) disposeOwnedObject(o.mesh); return !o.dead; });
    this.endBattle?.tick();
  }
  render(alpha, dt) {
    const { player, world } = this.game;
    for (const mob of this.mobs) {
      const m = mob.model, p = mob.pos;
      m.root.visible = distance(p, player.pos) < (this.renderer.settings.renderDistance || 6) * 16;
      if (!m.root.visible) continue;
      m.root.position.set(lerp(mob.previous.x, p.x, alpha), lerp(mob.previous.y, p.y, alpha), lerp(mob.previous.z, p.z, alpha));
      m.body.rotation.y = mob.yaw;
      const amplitude = Math.min(1, Math.hypot(mob.vel.x, mob.vel.z) * 13), swing = Math.sin(mob.walk) * amplitude * .8;
      m.legs.forEach((leg, i) => { if (mob.type === 'spider') leg.rotation.x = Math.sin(mob.walk + i) * .4 + (i % 4 - 1.5) * .3; else leg.rotation.x = swing * (i % 3 === 0 ? 1 : -1); });
      if (mob.type === 'chicken') m.arms.forEach((arm, i) => arm.rotation.z = (i ? -1 : 1) * (.15 + (mob.onGround ? .05 : Math.sin(mob.age) * .7)));
      if (mob.type === 'zombie') m.arms.forEach((arm, i) => { arm.rotation.x = -1.1 - Math.sin((mob.attackAnimation || 0) * 9) * .65 + Math.sin(mob.age * .07 + i) * .05; });
      if (mob.type === 'skeleton') m.arms.forEach((arm, i) => { arm.rotation.x = -.7 - Math.min(1, (mob.bowDraw || 0) / .8) * .8; arm.rotation.y = i ? -.22 : .45; });
      if (mob.type === 'creeper') m.body.scale.set(1 + (mob.fuse || 0) * .09, 1 + (mob.fuse || 0) * .05, 1 + (mob.fuse || 0) * .09);
      const facing = Math.atan2(player.pos.x - p.x, player.pos.z - p.z);
      m.head.rotation.y = clamp(Math.atan2(Math.sin(facing - mob.yaw), Math.cos(facing - mob.yaw)), -.6, .6);
      if (m.wool) m.wool.visible = !mob.sheared;
      if (m.rods) for (const { mesh, layer, rod } of m.rods) {
        const angle = mob.age * .09 * (layer % 2 ? -1 : 1) + rod * Math.PI / 2 + layer;
        mesh.position.set(Math.cos(angle) * (.65 - layer * .09), 1.1 - layer * .42 + Math.sin(mob.age * .07 + rod) * .1, Math.sin(angle) * (.65 - layer * .09));
      }
      const l = world.getLight(Math.floor(p.x), Math.floor(p.y + mob.height * .7), Math.floor(p.z));
      lightCreature(m.material.color, l[0], l[1], this.renderer);
      if (mob.type === 'blaze') m.material.color.setScalar(mob.charging ? 1.5 : 1);
      if (mob.hurt > 0 || mob.fire > 0 && Math.floor(mob.age / 4) % 2) {
        m.material.color.r = Math.max(.5, m.material.color.r); m.material.color.g *= .35; m.material.color.b *= .35;
      } else if (mob.fuse > 0 && Math.floor(mob.fuse * 12) % 2) m.material.color.multiplyScalar(1.7);
      m.shadow.visible = mob.onGround; m.shadow.position.y = .012;
      if (mob.health <= 0) m.body.rotation.z = (1 - mob.death / .8) * Math.PI / 2;
      m.root.visible = distance(mob.pos, player.pos) < (this.renderer.settings.renderDistance || 6) * 16;
    }
    this.renderer.camera.updateMatrixWorld();
    this.entityProjection.multiplyMatrices(this.renderer.camera.projectionMatrix,this.renderer.camera.matrixWorldInverse);
    this.entityFrustum.setFromProjectionMatrix(this.entityProjection);
    this.batches.render(this.mobs,this.entityFrustum);
    for (const d of this.drops) {
      d.rotation += dt; d.mesh.position.set(lerp(d.previous.x, d.pos.x, alpha), lerp(d.previous.y, d.pos.y, alpha) + .16 + Math.sin(d.age * .08) * .065, lerp(d.previous.z, d.pos.z, alpha)); d.mesh.rotation.y = d.rotation;
    }
    for (const f of this.falling) f.mesh.position.set(lerp(f.previous.x, f.pos.x, alpha), lerp(f.previous.y, f.pos.y, alpha) + .5, lerp(f.previous.z, f.pos.z, alpha));
    for (const t of this.tnt) { t.mesh.position.set(t.pos.x, t.pos.y + .5, t.pos.z); t.mesh.material.color.setScalar(Math.floor(t.fuse / 5) % 2 ? 1 : 2.4); t.mesh.scale.setScalar(.98 + Math.max(0, 10 - t.fuse) * .012); }
    for (const p of this.projectiles) { p.mesh.position.set(p.pos.x, p.pos.y, p.pos.z); if (!p.stuck) p.mesh.lookAt(p.pos.x + p.vel.x, p.pos.y + p.vel.y, p.pos.z + p.vel.z); }
    for (const orb of this.orbs) { orb.mesh.position.set(orb.pos.x, orb.pos.y + .1, orb.pos.z); orb.mesh.rotation.y += dt * 2; orb.mesh.material.color.setHSL(.22 + Math.sin(orb.age * .1) * .035, 1, .55); }
    this.endBattle?.render(alpha);
    const m = this.playerModel; m.root.visible = player.perspective > 0 && this.game.screen === 'playing';
    m.root.position.copy(this.renderer.camera.position); m.root.position.set(lerp(player.previous.x, player.pos.x, alpha), lerp(player.previous.y, player.pos.y, alpha), lerp(player.previous.z, player.pos.z, alpha));
    m.body.rotation.y = player.yaw + Math.PI; m.head.rotation.x = -player.pitch;
    m.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(player.walkDistance * 4) * Math.min(1, player.walkSpeed / 4.3) * (i ? 1 : -1); });
    m.arms.forEach((arm, i) => { arm.rotation.x = Math.sin(player.walkDistance * 4) * Math.min(1, player.walkSpeed / 4.3) * (i ? -1 : 1); });
    m.shadow.position.y = .015; m.shadow.visible = player.onGround;
  }
  toJSON() {
    return { ticks: this.ticks, spawned: [...this.spawned], mobs: this.mobs.filter(m => m.health > 0).map(m => fields(m, MOB_FIELDS)),
      drops: this.drops.filter(d => !d.dead).map(({ stack, pos, vel, delay, age }) => ({ stack, pos, vel, delay, age })),
      ...Object.fromEntries(Object.entries(TRANSIENT_FIELDS).map(([type, names]) => [type, (this[type] || []).filter(entity => !entity.dead).map(entity => fields(entity, names))])) };
  }
  dispose() {
    this.navigation?.clear(); this.batches?.dispose();
    this.endBattle?.dispose();
    for (const mob of this.mobs) { disposeOwnedObject(mob.model.root); mob.model.material.dispose(); }
    for (const group of [this.drops, this.falling, this.tnt, this.projectiles, this.orbs]) for (const entity of group) disposeOwnedObject(entity.mesh);
    disposeOwnedObject(this.playerModel.root); this.playerModel.material.dispose(); this.shadowTexture.dispose();
    this.shadowGeometry.dispose(); this.shadowMaterial.dispose();
    this.accentMaterial.dispose();
    for (const geometry of this.geometry.values()) geometry.dispose();
  }
}
