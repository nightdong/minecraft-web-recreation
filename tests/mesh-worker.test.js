import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/core/world.js';
import { B, blocks } from '../src/core/blocks.js';
import { captureNeighborhood, MeshSnapshot, snapshotAtlas, serializeGeometries, restoreGeometries } from '../src/render/mesh-snapshot.js';
import { meshChunk } from '../src/render/mesher.js';
import { VoxelRenderer } from '../src/render/renderer.js';
import * as THREE from 'three';

const names = [...new Set(blocks.filter(Boolean).flatMap(block => Array.isArray(block.texture) ? block.texture : [block.texture]))];
const layout = { width: 512, height: 512, tiles: names.map((name, i) => [name, i]) };

test('worker neighborhoods are detached snapshots and meshing them produces identical buffers', () => {
  const world = new World('mesh-worker-invariants');
  for (const [x, id, state] of [[14, B.STONE, 0], [15, B.WATER, 0], [16, B.WATER, 4], [12, B.TORCH, 0], [9, B.LEVER, 8], [10, B.WIRE, 15], [11, B.REDSTONE_LAMP_ON, 0]]) {
    world.set(x, 119, 8, B.STONE, 0, false); world.set(x, 120, 8, id, state, false);
  }
  const chunk = world.ensure(0, 0), neighbors = captureNeighborhood(world, chunk), snapshot = new MeshSnapshot(neighbors), atlas = snapshotAtlas(layout);
  const reference = meshChunk(world, chunk, atlas), alternate = meshChunk(snapshot, snapshot.ensure(0, 0), atlas);
  const restored = restoreGeometries(structuredClone(serializeGeometries(alternate).result));
  for (const name of Object.keys(reference)) {
    assert.equal(!!reference[name], !!restored[name]); if (!reference[name]) continue;
    assert.deepEqual(reference[name].index.array, restored[name].index.array);
    for (const [attributeName, attribute] of Object.entries(reference[name].attributes)) assert.deepEqual(attribute.array, restored[name].getAttribute(attributeName).array);
    assert.deepEqual(reference[name].boundingSphere, restored[name].boundingSphere);
  }
  world.set(14, 120, 8, B.DIAMOND_BLOCK); assert.equal(snapshot.get(14, 120, 8), B.STONE);
  assert.ok(chunk.data.byteLength > 0, 'Capturing must never detach the live collision data');
  for (const geometries of [reference, restored]) for (const geometry of Object.values(geometries)) geometry?.dispose();
});

function pendingRenderer() {
  const requests = [], renderer = Object.create(VoxelRenderer.prototype);
  Object.assign(renderer, { settings: {}, atlas: snapshotAtlas(layout), pendingMeshes: new Map(), meshGeneration: 1, discardedMeshes: 0, installed: 0,
    meshPool: { failed: false, run: () => new Promise(resolve => requests.push(resolve)) },
    installChunk() { this.installed++; } });
  return { renderer, requests };
}

test('an asynchronous mesh cannot resurrect a block edited after its snapshot', async () => {
  const { renderer, requests } = pendingRenderer(), world = new World('async-edit'), chunk = world.ensure(0, 0);
  const job = renderer.build(world, chunk); assert.equal(renderer.pendingMeshes.size, 1);
  assert.equal(renderer.build(world, chunk), job, 'One chunk can have only one pending mesh');
  world.set(8, 120, 8, B.STONE);
  const geometry = new THREE.BoxGeometry(); let disposed = false; geometry.addEventListener('dispose', () => { disposed = true; });
  requests[0]({ solid: geometry, cutout: null, liquid: null });
  assert.equal(await job, false); assert.equal(disposed, true); assert.equal(renderer.installed, 0);
  assert.equal(world.dirty.has(chunk.key), true); assert.equal(renderer.pendingMeshes.size, 0);
  const latest = renderer.build(world, chunk); requests[1]({ solid: null, cutout: null, liquid: null });
  assert.equal(await latest, true); assert.equal(renderer.installed, 1);
});

test('meshes from a previous world generation are disposed rather than installed', async () => {
  const { renderer, requests } = pendingRenderer(), world = new World('async-world');
  const pending = renderer.build(world, world.ensure(0, 0)); renderer.meshGeneration++;
  const geometry = new THREE.BoxGeometry(); let disposed = false; geometry.addEventListener('dispose', () => { disposed = true; });
  requests[0]({ solid: geometry });
  assert.equal(await pending, false); assert.equal(disposed, true); assert.equal(renderer.installed, 0);
});

test('streaming diagnostics distinguish the resident target list from unfinished mesh jobs', () => {
  const renderer = Object.assign(Object.create(VoxelRenderer.prototype), {
    queue: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }],
    chunkMeshes: new Map([['0,0', {}], ['1,0', {}]]), pendingMeshes: new Map(),
    meshPool: { stats: { workers: 2, completed: 7 } }, discardedMeshes: 0
  });
  const world = { dirty: new Set(['1,0']) };
  assert.equal(renderer.streamingDiagnostics(world).queued, 2, 'Missing and dirty targets both count as unfinished');
  renderer.pendingMeshes.set('2,0', {});
  assert.equal(renderer.streamingDiagnostics(world).queued, 1, 'An in-flight job must not also count as waiting');
  assert.equal(renderer.streamingDiagnostics(world).pending, 1);
  renderer.chunkMeshes.set('2,0', {}); renderer.pendingMeshes.clear(); world.dirty.clear();
  const complete = renderer.streamingDiagnostics(world);
  assert.equal(complete.queued, 0, 'Completed visible targets are not still queued forever');
  assert.equal(complete.pending, 0); assert.equal(complete.targets, 3);
  assert.equal(renderer.queue.length, 3, 'Keep resident targets so later edits can rebuild');
});
