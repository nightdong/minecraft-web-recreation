import * as THREE from 'three';
import { B } from '../core/blocks.js';
import { HEIGHT, index } from '../core/world.js';
import { atlasUV } from './atlas-uv.js';

/** Capture only the 3x3 immutable neighborhood required by the mesher. Copies
 * are owned by the job and can be transferred without detaching live chunks. */
export function captureNeighborhood(world, chunk) {
  const neighbors = [];
  for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) neighbors.push(world.ensure(chunk.cx + x, chunk.cz + z));
  for (const neighbor of neighbors) world.light(neighbor);
  return neighbors.map(c => ({ key: c.key, cx: c.cx, cz: c.cz, maxHeight: c.maxHeight, dimension: world.dimension,
    data: c.data.slice(), state: c.state.slice(), sky: c.sky.slice(), glow: c.glow.slice() }));
}

export class MeshSnapshot {
  constructor(neighbors) { this.dimension = neighbors[0]?.dimension || 'overworld'; this.chunks = new Map(neighbors.map(chunk => [chunk.key, chunk])); }
  ensure(x, z) {
    const chunk = this.chunks.get(`${x},${z}`);
    if (!chunk) throw new Error(`Mesher exceeded its immutable guard neighborhood: ${x},${z}`);
    return chunk;
  }
  light() { /* Sky and block light are captured at one simulation instant. */ }
  get(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0) return this.dimension === 'end' ? B.AIR : B.BEDROCK; if (y >= HEIGHT) return B.AIR;
    return this.chunks.get(`${Math.floor(x / 16)},${Math.floor(z / 16)}`)?.data[index(x & 15, y, z & 15)] ?? B.AIR;
  }
  getState(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0 || y >= HEIGHT) return 0;
    return this.chunks.get(`${Math.floor(x / 16)},${Math.floor(z / 16)}`)?.state[index(x & 15, y, z & 15)] ?? 0;
  }
}

export function snapshotAtlas(layout) {
  const tiles = new Map(layout.tiles);
  return { uv: (name, crop) => atlasUV(tiles, layout.width, layout.height, name, crop) };
}

export function serializeGeometries(geometries) {
  const result = {}, transfers = [];
  for (const [name, geometry] of Object.entries(geometries)) {
    if (!geometry) { result[name] = null; continue; }
    const attributes = {};
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      attributes[name] = { array: attribute.array, itemSize: attribute.itemSize, normalized: attribute.normalized };
      transfers.push(attribute.array.buffer);
    }
    result[name] = { attributes, index: geometry.index.array, bounds: { center: geometry.boundingSphere.center.toArray(), radius: geometry.boundingSphere.radius }, userData: geometry.userData };
    transfers.push(geometry.index.array.buffer); geometry.dispose();
  }
  return { result, transfers };
}

export function restoreGeometries(payload) {
  const result = {};
  for (const [name, data] of Object.entries(payload)) {
    if (!data) { result[name] = null; continue; }
    const geometry = new THREE.BufferGeometry();
    for (const [key, value] of Object.entries(data.attributes)) geometry.setAttribute(key, new THREE.BufferAttribute(value.array, value.itemSize, value.normalized));
    geometry.setIndex(new THREE.BufferAttribute(data.index, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(...data.bounds.center), data.bounds.radius);
    geometry.userData = data.userData || {}; result[name] = geometry;
  }
  return result;
}
