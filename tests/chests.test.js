import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/core/world.js';
import { B, I } from '../src/core/blocks.js';
import { makeStack } from '../src/core/inventory.js';
import * as THREE from 'three';
import { createChestModel, animateChest } from '../src/render/chests.js';
import { disposeOwnedObject } from '../src/render/resources.js';

test('two same-facing adjacent chests expose one live 54-slot inventory from either half', () => {
  const world = new World('chest-pairs'); world.set(0, 120, 0, B.CHEST, 0); world.set(1, 120, 0, B.CHEST, 0);
  const left = world.chestView(0, 120, 0), right = world.chestView(1, 120, 0);
  assert.equal(left.slots.length, 54); assert.equal(right.slots.length, 54);
  left.slots[0] = makeStack(I.DIAMOND, 3); left.slots[53] = makeStack(B.DIRT, 19);
  assert.equal(right.slots[0].count, 3); assert.equal(right.slots[53].count, 19);
  assert.equal(world.container(0, 120, 0, 'chest').slots[0].id, I.DIAMOND);
  assert.equal(world.container(1, 120, 0, 'chest').slots[26].count, 19);
  right.slots[53] = null; assert.equal(left.slots[53], null);
  assert.equal(left.slots.map(item => item?.count || 0).reduce((a, b) => a + b, 0), 3);
});

test('a third chest cannot join an existing pair and differently-facing chests stay separate', () => {
  const world = new World('no-triples');
  for (const x of [0, 1, 2]) world.set(x, 120, 0, B.CHEST, 0);
  assert.equal(world.chestView(0, 120, 0).slots.length, 54); assert.equal(world.chestView(2, 120, 0).slots.length, 27);
  world.set(8, 120, 0, B.CHEST, 0); world.set(9, 120, 0, B.CHEST, 2);
  assert.equal(world.chestView(8, 120, 0).slots.length, 27);
});

test('removing half a large chest preserves the surviving half and its exact contents', () => {
  const world = new World('chest-split'); world.set(0, 120, 0, B.CHEST, 0); world.set(1, 120, 0, B.CHEST, 0);
  const joined = world.chestView(0, 120, 0); joined.slots[0] = makeStack(I.IRON, 7); joined.slots[30] = makeStack(B.COBBLE, 11);
  world.set(0, 120, 0, B.AIR);
  const survivor = world.chestView(1, 120, 0); assert.equal(survivor.slots.length, 27); assert.equal(survivor.slots[3].count, 11);
  assert.equal(survivor.slots.filter(Boolean).length, 1); assert.equal(world.getState(1, 120, 0) & 12, 0);
});

test('cross-chunk chest pairing and slot ownership survive real world serialization', () => {
  const world = new World('chest-save'); world.set(15, 120, 0, B.CHEST, 0); world.set(16, 120, 0, B.CHEST, 0);
  world.chestView(15, 120, 0).slots[40] = makeStack(I.GOLD, 4);
  const restored = new World(world.seed, JSON.parse(JSON.stringify(world.toJSON()))); restored.ensure(0, 0); restored.ensure(1, 0);
  const view = restored.chestView(16, 120, 0); assert.equal(view.slots.length, 54); assert.deepEqual(view.slots[40], makeStack(I.GOLD, 4));
  assert.equal(restored.chestBlocked(15, 120, 0), false);
  restored.set(16, 121, 0, B.STONE); assert.equal(restored.chestBlocked(15, 120, 0), true, 'A blocked lid on either half must prevent opening');
});

test('the lid is a real hinged model that opens upward and closes without drifting', () => {
  const atlas = { uv: () => [0, 0, 1, 1] }, shared = new THREE.MeshBasicMaterial();
  const model = createChestModel(atlas, shared, [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], 0);
  let sharedDisposed = false; shared.addEventListener('dispose', () => { sharedDisposed = true; });
  const front = new THREE.Vector3(0, .15, .85);
  model.root.updateMatrixWorld(true); const closed = model.lid.localToWorld(front.clone());
  for (let i = 0; i < 10; i++) animateChest(model, true, .05);
  model.root.updateMatrixWorld(true); const opened = model.lid.localToWorld(front.clone());
  assert.ok(opened.y > closed.y + .6); assert.equal(model.progress, 1);
  for (let i = 0; i < 10; i++) animateChest(model, false, .05);
  assert.equal(model.progress, 0); assert.equal(model.lid.rotation.x, 0);
  disposeOwnedObject(model.root); assert.equal(sharedDisposed, false); shared.dispose();
});

test('a chest is not treated as a full opaque cube when calculating its daylight', () => {
  const world = new World('chest-light'); world.set(8, 120, 8, B.CHEST, 0);
  world.light(world.ensure(0, 0));
  assert.equal(world.getLight(8, 120, 8)[0], 15, 'A hollow partial-height chest should not shade itself black');
});
