import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeNearbyDrops } from '../src/core/drop-merge.js';
import { B, I } from '../src/core/blocks.js';
import { makeStack } from '../src/core/inventory.js';
import { Terrain } from '../src/core/world.js';

test('spatial drop merging conserves inventory, checks negative boundaries and avoids quadratic distant comparisons',()=>{
  const drops=Array.from({length:1000},(_,i)=>({pos:{x:i*3,y:70,z:0},stack:makeStack(B.STONE),dead:false}));
  const stats=mergeNearbyDrops(drops);assert.equal(stats.comparisons,0);assert.equal(drops.reduce((n,d)=>n+d.stack.count,0),1000);
  const near=[{pos:{x:-.1,y:70,z:0},stack:makeStack(B.STONE,60)},{pos:{x:.1,y:70,z:0},stack:makeStack(B.STONE,12)},{pos:{x:.2,y:70,z:0},stack:makeStack(I.DIAMOND_PICKAXE)}];
  mergeNearbyDrops(near);assert.equal(near[0].stack.count,64);assert.equal(near[1].stack.count,8);assert.equal(near[2].stack.count,1);
  assert.equal(near.reduce((n,d)=>n+(d.stack.id===B.STONE?d.stack.count:0),0),72);
});
test('terrain memoization evicts a bounded batch instead of clearing the whole long-distance cache',()=>{
  const terrain=new Terrain('cache-regression'),expected=terrain.column(200000,200000);
  terrain.columns.clear();for(let i=0;i<65536;i++)terrain.columns.set(`test-${i}`,{});
  const actual=terrain.column(200000,200000);assert.deepEqual(actual,expected);assert.ok(terrain.columns.size>65000&&terrain.columns.size<65536);
});
