import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/core/world.js';
import { B } from '../src/core/blocks.js';
import { Player, collides } from '../src/core/physics.js';
import { RouteSearch, NavigationScheduler, standPosition } from '../src/core/navigation.js';
import { canSpawnHostile, exposedToSun, tickHostile, ORDINARY_HOSTILES } from '../src/game/hostile-ai.js';
import { EntityBatches } from '../src/render/entity-batches.js';
import { EntitySystem } from '../src/game/entities.js';

function arena() {
  const world = new World('hostile-regression'); world.time = 18000;
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) world.set(x, 109, z, B.STONE, 0, false);
  return world;
}
function actor(type, x = 3.5, z = 8.5) {
  return { ...ORDINARY_HOSTILES[type], type, pos: { x, y: 110, z }, previous: { x, y: 110, z }, vel: { x: 0, y: 0, z: 0 },
    age: 0, aiId: 1, yaw: Math.PI/2, targetYaw: 0, walk: 0, walkTime: 1, idleTime: 0, hurt: 0, fire: 0, fuse: 0, panic: 0, attackCooldown: 0, onGround: true };
}
function system(world, mob, player = new Player({ x: 12.5, y: 110, z: 8.5 })) {
  const events = [], s = Object.assign(Object.create(EntitySystem.prototype), {
    game: { world, player, difficulty: 'normal', audio: { play: name => events.push(name) }, advancement: id => events.push(id) },
    mobs: [mob], navigation: new NavigationScheduler(world), shoot: (...args) => events.push({ shot: args }),
    explode: (...args) => events.push({ explosion: args }), drop: stack => events.push({ drop: stack }), xp: amount => events.push({ xp: amount })
  });
  return { s, events, player };
}
test('bounded path search routes around a two-block wall without generating terrain or crossing solid cells', () => {
  const world = arena(), mob = actor('zombie');
  for (let z = 4; z <= 12; z++) for (let y = 110; y < 113; y++) world.set(7,y,z,B.STONE,0,false);
  const before = world.chunks.size, search = new RouteSearch(world,mob,{x:12.5,y:110,z:8.5});
  for (let i=0;i<1000&&!search.done;i++)search.step();
  assert.ok(search.done && search.path.length > 9); assert.equal(world.chunks.size,before); assert.ok(search.expanded<=512);
  assert.ok(search.path.some(p=>p.z<4 || p.z>13));
  assert.ok(search.path.every(p=>!collides(world,mob,p)));
  assert.ok(Math.hypot(search.path.at(-1).x-12.5,search.path.at(-1).z-8.5)<1.15);
});
test('routes reject lava, unloaded edges, insufficient headroom and fatal drops; slabs retain their real height', () => {
  const world=arena(),mob=actor('zombie');
  world.set(5,109,5,B.LAVA,0,false); assert.equal(standPosition(world,5,110,5,mob,0),null);
  assert.equal(standPosition(world,80,110,80,mob),null);
  world.set(6,111,6,B.STONE,0,false);assert.equal(standPosition(world,6,110,6,mob,0),null);
  world.set(7,109,7,B.OAK_SLAB,0,false); assert.equal(standPosition(world,7,110,7,mob).y,109.5);
  world.set(8,109,8,B.AIR,0,false);assert.equal(standPosition(world,8,110,8,mob),null);
});
test('the shared AI scheduler caps total work even with 36 simultaneous route requests', () => {
  const world=arena(),scheduler=new NavigationScheduler(world);
  for(let i=0;i<36;i++)scheduler.request(actor('zombie',1.5,1.5),{x:14.5,y:110,z:14.5});
  scheduler.tick(37,1000);assert.equal(scheduler.stats.lastExpanded,37);assert.ok(scheduler.jobs.length>0);
  scheduler.clear();assert.equal(scheduler.jobs.length,0);
});
test('a chasing creature actually traverses its wall-detour path rather than merely computing one', () => {
  const world=arena(),mob=actor('zombie'),{s}=system(world,mob);
  mob.lastSeen={...s.game.player.pos};mob.lastSeenTicks=80;
  for(let z=5;z<=11;z++)for(let y=110;y<=112;y++)world.set(7,y,z,B.STONE,0,false);
  for(let i=0;i<700;i++){s.navigation.tick(96,20);tickHostile(s,mob);}
  assert.ok(mob.pos.x>9, `Mob remained stuck at ${JSON.stringify(mob.pos)}`);
  assert.ok(s.navigation.stats.completed>0);
});
test('spawn checks require a dark dry supported location outside the player radius, including unlit newly loaded sky arrays', () => {
  const world=arena(),player=new Player({x:-30,y:110,z:8});const pos={x:8.5,y:110,z:8.5};
  assert.equal(canSpawnHostile(world,player,'zombie',pos),true);
  world.time=6000;assert.equal(canSpawnHostile(world,player,'zombie',pos),false);
  world.time=18000;player.pos.x=8;assert.equal(canSpawnHostile(world,player,'zombie',pos),false);
  player.pos.x=-30;world.set(9,110,8,B.TORCH);world.light(world.ensure(0,0));assert.equal(canSpawnHostile(world,player,'zombie',pos),false);
});
test('skeleton charges and releases real arrows but does not shoot through a newly built wall', () => {
  const world=arena(),mob=actor('skeleton'),{s,events}=system(world,mob);
  for(let i=0;i<30;i++)tickHostile(s,mob);assert.ok(events.some(e=>e.shot));
  events.length=0;mob.attackCooldown=0;mob.bowDraw=.75;
  for(let y=110;y<114;y++)for(let z=0;z<16;z++)world.set(8,y,z,B.STONE,0,false);
  for(let i=0;i<60;i++)tickHostile(s,mob);assert.equal(events.filter(e=>e.shot).length,0);
});
test('creeper fuse cancels after losing sight and a second full approach creates exactly one explosion', () => {
  const world=arena(),mob=actor('creeper',8.5,8.5),player=new Player({x:10.8,y:110,z:8.5}),{s,events}=system(world,mob,player);
  for(let i=0;i<15;i++)tickHostile(s,mob);assert.ok(mob.fuse>0);
  world.set(9,110,8,B.STONE,0,false);world.set(9,111,8,B.STONE,0,false);
  for(let i=0;i<20;i++)tickHostile(s,mob);assert.equal(mob.fuse,0);
  world.set(9,110,8,B.AIR,0,false);world.set(9,111,8,B.AIR,0,false);
  for(let i=0;i<100;i++)tickHostile(s,mob);assert.equal(events.filter(e=>e.explosion).length,1);
});
test('zombies burn in sunlight, roofs protect them, water extinguishes fire and daylight spiders are neutral', () => {
  const world=arena(),mob=actor('zombie'),{s,player}=system(world,mob);world.time=6000;
  assert.equal(exposedToSun(world,mob),true);tickHostile(s,mob);assert.ok(mob.fire>0);
  world.set(3,113,8,B.STONE,0,false);assert.equal(exposedToSun(world,mob),false);
  world.set(3,110,8,B.WATER,0,false);tickHostile(s,mob);assert.equal(mob.fire,0);
  const spider=actor('spider',player.pos.x-1.5,player.pos.z);for(let i=0;i<30;i++)tickHostile(s,spider);assert.equal(player.health,20);
});
test('environmental mob deaths have normal drops but cannot award remote combat XP or achievements', () => {
  const world=arena(),mob=actor('zombie'),{s,events}=system(world,mob);
  s.hit(mob,30,null,false,'environment');assert.equal(events.filter(e=>e.xp).length,0);assert.ok(!events.includes('monster'));
  const second=actor('zombie');s.hit(second,30,null,false,'melee');assert.equal(events.filter(e=>e.xp).length,1);assert.ok(events.includes('monster'));
});
test('a pursuing spider actually climbs a vertical wall rather than treating it as a fatal drop',()=>{
  const world=arena(),mob=actor('spider',6.2,8.5),player=new Player({x:8.5,y:114,z:8.5}),{s}=system(world,mob,player);
  for(let y=110;y<114;y++)for(let z=0;z<16;z++)world.set(7,y,z,B.STONE,0,false);
  mob.lastSeen={...player.pos};mob.lastSeenTicks=80;let highest=mob.pos.y;
  for(let i=0;i<65;i++){tickHostile(s,mob);highest=Math.max(highest,mob.pos.y);}
  assert.ok(highest>112,`Spider never climbed the actual wall: highest=${highest}`);
});
test('instanced creature rendering preserves bone transforms, per-mob tint and visibility while bounding draw calls', () => {
  const scene=new THREE.Scene(),batcher=new EntityBatches(scene),geometry=new THREE.BoxGeometry(),material=new THREE.MeshBasicMaterial({color:0xff0000});
  const mobs=[];for(let i=0;i<40;i++){const root=new THREE.Group();root.position.x=i;const mesh=new THREE.Mesh(geometry,material.clone());root.add(mesh);mobs.push({model:{root}});}
  batcher.render(mobs);assert.equal(batcher.stats.draws,1);assert.equal(batcher.stats.instances,40);
  const batch=[...batcher.batches.values()][0];assert.equal(batch.mesh.instanceMatrix.array[39*16+12],39);
  mobs[0].model.root.visible=false;batcher.render(mobs);assert.equal(batcher.stats.instances,39);
  let disposed=false;geometry.addEventListener('dispose',()=>disposed=true);batcher.dispose();assert.equal(disposed,false);assert.equal(scene.children.length,0);
});

test('spiders use local cave and torch illumination, not the time of day alone', () => {
  const world=arena(); world.time=6000;
  for(let x=0;x<16;x++)for(let z=0;z<16;z++)world.set(x,113,z,B.STONE,0,false);
  for(let n=0;n<16;n++)for(let y=110;y<113;y++)for(const [x,z]of [[0,n],[15,n],[n,0],[n,15]])world.set(x,y,z,B.STONE,0,false);
  world.light(world.ensure(0,0));
  const spider=actor('spider',8.5,8.5),player=new Player({x:10,y:110,z:8.5}),{s}=system(world,spider,player);
  for(let i=0;i<30;i++)tickHostile(s,spider);
  assert.ok(player.health<20,'A dark cave spider remains hostile during daytime');
  const lit=actor('spider',8.5,8.5),safe=new Player({x:10,y:110,z:8.5}),next=system(world,lit,safe);
  world.set(8,110,9,B.TORCH,0,false);world.light(world.ensure(0,0));
  for(let i=0;i<30;i++)tickHostile(next.s,lit);
  assert.equal(safe.health,20,'A well-lit spider is neutral until provoked');
});

test('ordinary monsters take real fall damage while water and climbing clear accumulated falls', () => {
  const world=arena(),mob=actor('zombie',8.5,8.5),player=new Player({x:1,y:110,z:1},{},'creative'),{s}=system(world,mob,player);
  mob.pos.y=120;mob.onGround=false;mob.walkTime=1000;mob.idleTime=1000;
  for(let i=0;i<40;i++)tickHostile(s,mob);
  assert.equal(mob.pos.y,110);assert.equal(mob.health,13,'Ten blocks of descent cause seven fall damage');
  assert.equal(mob.fallDistance,0);
  const swimmer=actor('zombie',8.5,8.5);swimmer.fallDistance=15;
  world.set(8,110,8,B.WATER,0,false);tickHostile(s,swimmer);
  assert.equal(swimmer.fallDistance,0);assert.equal(swimmer.health,20);
});
