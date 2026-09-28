/** Pure atlas layout shared by the browser and mesh workers. The same texel
 * inset is used in both paths, including partial-block texture crops. */
export function atlasUV(tiles, width, height, name, crop = [0, 0, 1, 1]) {
  const i = tiles.get(name) ?? 0, x = (i % 16) * 32 + 8, y = Math.floor(i / 16) * 32 + 8;
  return [(x + crop[0] * 16 + .02) / width, 1 - (y + crop[3] * 16 - .02) / height,
    (x + crop[2] * 16 - .02) / width, 1 - (y + crop[1] * 16 + .02) / height];
}
