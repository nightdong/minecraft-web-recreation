import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/core/world.js';
import { B, collisionShapes } from '../src/core/blocks.js';
import { bodyBox, obstacles, intersects, collides, moveBody } from '../src/core/physics.js';

test('boolean collision agrees with swept obstacle geometry at partial blocks and negative boundaries', () => {
  const world = new World('collision-hotpath-equivalence');
  const variants = [[B.STONE,0],[B.OAK_SLAB,0],[B.OAK_SLAB,4],[B.OAK_STAIRS,0],[B.OAK_STAIRS,5],[B.DOOR,4],[B.CHEST,0],[B.IRON_BARS,0],[B.END_PORTAL_FRAME,4],[B.PISTON_HEAD,5]];
  let cases = 0;
  for (let i = 0; i < variants.length; i++) {
    const x = i - 5, z = -2; world.set(x, 119, z, ...variants[i], false);
  }
  for (const width of [.25,.6,1.3]) for (let x = -5.7; x < 5.8; x += .29) for (let y = 118.8; y < 121; y += .31) for (const z of [-2.4,-1.8,-.8]) {
    const body = {pos:{x,y,z},width,height:width>1?.9:1.8}, box = bodyBox(body);
    assert.equal(collides(world,body), obstacles(world,box).some(shape=>intersects(box,shape))); cases++;
  }
  assert.ok(cases > 2000);
});

test('movement retains swept clipping, zero-axis contact and stable grounding after collision optimization', () => {
  const world = new World('clipping-hotpath'); world.set(-1,119,-1,B.STONE,0,false); world.set(0,120,-1,B.STONE,0,false);
  const body = {pos:{x:-.5,y:125,z:-.5},width:.6,height:1.8,vel:{x:0,y:-12,z:0},onGround:false};
  moveBody(world,body,0,-12,0,0); assert.equal(body.pos.y,120); assert.equal(body.onGround,true);
  moveBody(world,body,12,-.08,0,0); assert.ok(body.pos.x<=-.3); assert.equal(body.horizontalCollision,true);
  assert.equal(collides(world,body),false);
});

test('collision shape caches cannot be corrupted by a caller or grow with repeated lookups', () => {
  const first = collisionShapes(B.OAK_STAIRS,5);
  assert.equal(collisionShapes(B.OAK_STAIRS,5), first);
  assert.equal(Object.isFrozen(first),true); assert.equal(Object.isFrozen(first[0]),true);
  assert.throws(()=>{first[0][0]=999;},TypeError);
  assert.notEqual(collisionShapes(B.OAK_STAIRS,0),first);
});
