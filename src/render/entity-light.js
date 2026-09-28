import * as THREE from 'three';

/** Entity geometry already contains face shading. Apply the voxel light once,
 * as terrain does, rather than darkening by daylight and then again by the
 * scene's Lambert lights. Reuse the material color; no per-frame allocations. */
export function creatureMaterial(atlas) {
  return new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, alphaTest: .45, fog: true });
}

export function lightCreature(color, sky, glow, renderer) {
  const daylight = (sky / 15) ** 2 * renderer.day.value;
  const block = (glow / 15) ** 1.55 * (renderer.flameIntensity?.value ?? 1);
  const tint = renderer.nightTint?.value, ambient = renderer.ambient?.value ?? .0095;
  return color.setRGB(
    Math.max(daylight * (tint?.r ?? 1), block) + ambient,
    Math.max(daylight * (tint?.g ?? 1), block * .79) + ambient,
    Math.max(daylight * (tint?.b ?? 1), block * .55) + ambient
  );
}
