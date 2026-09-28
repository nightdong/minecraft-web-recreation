import { meshChunk } from './mesher.js';
import { MeshSnapshot, snapshotAtlas, serializeGeometries } from './mesh-snapshot.js';

self.onmessage = event => {
  const { id, key, neighbors, atlas, smooth } = event.data;
  try {
    const begin = performance.now(), world = new MeshSnapshot(neighbors), chunk = world.chunks.get(key);
    if (!chunk) throw new Error(`Missing target chunk ${key}`);
    const { result, transfers } = serializeGeometries(meshChunk(world, chunk, snapshotAtlas(atlas), smooth));
    self.postMessage({ id, result, elapsedMs: performance.now() - begin }, transfers);
  } catch (error) { self.postMessage({ id, error: error.stack || String(error) }); }
};
