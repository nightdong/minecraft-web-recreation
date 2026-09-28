import * as THREE from 'three';
import { texturedBox } from './mesher.js';
import { ownedMesh } from './resources.js';

/** Hollow body, rear hinge, moving lid and latch; the same model supports
 * single and double chests. Shared atlas textures are never owned by a model. */
export function createChestModel(atlas, baseMaterial, positions, state) {
  const root = new THREE.Group(), material = baseMaterial.clone(), lid = new THREE.Group();
  const width = positions.length === 2 ? 1.875 : .875;
  const box = (size, pos, parent = root, texture = 'chest_side', crop) => {
    const geometry = texturedBox(atlas, texture, size, true);
    if (crop) {
      const uv = geometry.getAttribute('uv');
      for (let face = 0; face < 6; face++) {
        const tex = Array.isArray(texture) ? texture[face] : texture, bounds = atlas.uv(tex, face === 2 || face === 3 ? [0, 0, 1, 1] : crop);
        for (let vertex = 0; vertex < 4; vertex++) uv.setXY(face * 4 + vertex, bounds[vertex & 1 ? 2 : 0], bounds[vertex < 2 ? 3 : 1]);
      }
    }
    const mesh = ownedMesh(new THREE.Mesh(geometry, material)); mesh.position.set(...pos); parent.add(mesh); return mesh;
  };
  const sideTextures = ['chest_side', 'chest_side', 'chest_top', 'chest_top', 'chest_side', 'chest_side'];
  box([width, .0625, .875], [0, .03125, 0], root, 'chest_top');
  box([width, .5, .0625], [0, .3125, .40625], root, sideTextures, [0, .4375, 1, 1]);
  box([width, .5, .0625], [0, .3125, -.40625], root, sideTextures, [0, .4375, 1, 1]);
  box([.0625, .5, .75], [-width / 2 + .03125, .3125, 0], root, sideTextures, [0, .4375, 1, 1]);
  box([.0625, .5, .75], [width / 2 - .03125, .3125, 0], root, sideTextures, [0, .4375, 1, 1]);
  // The shadowed inner floor remains visible when the lid opens.
  const inner = box([width - .125, .008, .75], [0, .067, 0], root, 'oak_log'); inner.material = material.clone(); inner.material.color.setScalar(.35);
  lid.position.set(0, .5625, -.4375); root.add(lid);
  box([width, .3125, .875], [0, .15625, .4375], lid, sideTextures, [0, 0, 1, .375]);
  box([.125, .25, .0625], [0, .035, .90625], lid, 'iron_block');
  const a = positions[0], b = positions.at(-1);
  root.position.set((a.x + b.x) / 2 + .5, a.y, (a.z + b.z) / 2 + .5);
  root.rotation.y = Math.PI - (state & 3) * Math.PI / 2;
  return { root, lid, material, innerMaterial: inner.material, positions, progress: 0 };
}

export function animateChest(model, open, dt, brightness = 1) {
  const change = Math.min(.1, Math.max(0, dt)) * 3;
  model.progress = open ? Math.min(1, model.progress + change) : Math.max(0, model.progress - change);
  model.lid.rotation.x = model.progress ? -(1 - Math.pow(1 - model.progress, 3)) * Math.PI / 2 : 0;
  model.material.color.setScalar(brightness); model.innerMaterial.color.setScalar(brightness * .35);
}
