import * as THREE from 'three';

/** Detached animated scene graphs remain the source of bone transforms. Their
 * shared mesh parts are submitted as instanced draws, with per-creature tint. */
export class EntityBatches {
  constructor(scene) { this.scene = scene; this.batches = new Map(); this.cache = new WeakMap(); this.sphere = new THREE.Sphere(); this.stats = { draws: 0, instances: 0, capacity: 0 }; }
  batchFor(source) {
    const cached=this.cache.get(source);if(cached&&this.batches.get(cached.key)===cached)return cached;
    const m = source.material;
    const signature = `${source.geometry.uuid}:${m.type}:${m.map?.uuid || ''}:${m.alphaTest}:${m.side}:${m.transparent}:${m.depthWrite}`;
    let batch = this.batches.get(signature);
    if (!batch) {
      const material = m.clone(); material.color.setRGB(1, 1, 1);
      batch = { key: signature, geometry: source.geometry, material, count: 0, capacity: 32, mesh: null };
      this.allocate(batch); this.batches.set(signature, batch);
    }
    this.cache.set(source,batch);return batch;
  }
  allocate(batch) {
    if (batch.mesh) { batch.mesh.removeFromParent(); batch.mesh.dispose(); }
    const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(batch.capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0; mesh.frustumCulled = false;
    // Contact shadows precede water: one instanced origin cannot sort the
    // separate creatures' transparent surfaces by depth.
    if(batch.material.transparent)mesh.renderOrder=-1;
    batch.mesh = mesh; this.scene.add(mesh);
  }
  render(mobs, frustum = null) {
    for (const batch of this.batches.values()) batch.count = 0;
    for (const mob of mobs) {
      const root = mob.model.root; if (!root.visible) continue;
      if(frustum){this.sphere.center.copy(root.position);this.sphere.center.y+=(mob.height||2)/2;this.sphere.radius=Math.max(mob.height||2,mob.width||1)+1.5;if(!frustum.intersectsSphere(this.sphere))continue;}
      root.updateMatrixWorld(true);
      root.traverseVisible(source => {
        if (!source.isMesh || Array.isArray(source.material)) return;
        const batch = this.batchFor(source);
        if (batch.count === batch.capacity) {
          const matrices = batch.mesh.instanceMatrix.array, colors = batch.mesh.instanceColor.array;
          batch.capacity *= 2; this.allocate(batch);
          batch.mesh.instanceMatrix.array.set(matrices); batch.mesh.instanceColor.array.set(colors);
        }
        source.matrixWorld.toArray(batch.mesh.instanceMatrix.array, batch.count * 16);
        source.material.color.toArray(batch.mesh.instanceColor.array, batch.count * 3); batch.count++;
      });
    }
    this.stats.draws = 0; this.stats.instances = 0; this.stats.capacity = 0;
    for (const [key, batch] of this.batches) {
      const mesh = batch.mesh; mesh.count = batch.count; mesh.visible = batch.count > 0;
      batch.unused = batch.count ? 0 : (batch.unused || 0) + 1;
      if (batch.unused > 120) { mesh.removeFromParent(); mesh.dispose(); batch.material.dispose(); this.batches.delete(key); continue; }
      if (batch.count) {
        mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, batch.count * 16); mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.clearUpdateRanges(); mesh.instanceColor.addUpdateRange(0, batch.count * 3); mesh.instanceColor.needsUpdate = true;
        this.stats.draws++; this.stats.instances += batch.count;
      }
      this.stats.capacity += batch.capacity;
    }
  }
  dispose() {
    for (const batch of this.batches.values()) { batch.mesh.removeFromParent(); batch.mesh.dispose(); batch.material.dispose(); }
    this.batches.clear();
  }
}
