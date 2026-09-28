/** Mark only resources exclusively owned by this mesh. Atlas textures and
 * cached item geometry/materials remain shared and must never be disposed here.
 */
export function ownedMesh(mesh, { geometry = true, material = true } = {}) {
  mesh.userData.ownsGeometry = geometry; mesh.userData.ownsMaterial = material; return mesh;
}
export function disposeOwnedObject(root) {
  if (!root) return;
  const geometries = new Set(), materials = new Set();
  root.traverse(object => {
    if (object.userData.ownsGeometry && object.geometry) geometries.add(object.geometry);
    if (object.userData.ownsMaterial && object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    object.userData.ownsGeometry = false; object.userData.ownsMaterial = false;
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  root.removeFromParent();
}
