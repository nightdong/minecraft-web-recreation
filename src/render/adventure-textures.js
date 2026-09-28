import { hash, seedNumber } from '../core/noise.js';

export const ADVENTURE_TEXTURES = ['end_frame_eye', 'dragon_skin', 'dragon_spine', 'dragon_eye', 'blaze', 'blaze_face', 'enderman', 'enderman_face', 'silverfish'];
const rgb = (r, g, b) => `rgb(${Math.max(0, Math.min(255, r | 0))},${Math.max(0, Math.min(255, g | 0))},${Math.max(0, Math.min(255, b | 0))})`;

export function paintAdventureTexture(ctx, name, frame) {
  if (!['nether_bricks', 'spawner', 'iron_bars', 'end_stone', 'end_portal', 'dragon_egg', 'end_frame_top', 'end_frame_side', ...ADVENTURE_TEXTURES].includes(name)) return false;
  const seed = seedNumber(name), rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const noise = (color, range = 20) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const n = (hash(x, y, 4, seed) - .5) * range; rect(x, y, 1, 1, rgb(color[0] + n, color[1] + n, color[2] + n)); }
  };
  if (name === 'end_stone') {
    noise([219, 220, 161], 28);
    for (let i = 0; i < 30; i++) { const x = hash(i, 1, 0, seed) * 16 | 0, y = hash(i, 2, 0, seed) * 16 | 0; rect(x, y, 2, 1, '#b0b27e'); rect(x, y + 1, 1, 1, '#eeedb5'); }
  } else if (name === 'nether_bricks') {
    noise([52, 25, 30], 14);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (y % 4 === 0 || (x + (y >> 2) * 4) % 8 === 0) rect(x, y, 1, 1, '#201317'); else if (y % 4 === 1) rect(x, y, 1, 1, '#482c32');
    }
  } else if (name === 'spawner' || name === 'iron_bars') {
    for (const x of name === 'spawner' ? [0, 5, 10, 15] : [1, 6, 11]) { rect(x, 0, 1, 16, name === 'spawner' ? '#26343a' : '#555956'); rect(x + 1, 0, 1, 16, name === 'spawner' ? '#526369' : '#c4c6bd'); }
    for (const y of name === 'spawner' ? [0, 5, 10, 15] : [3, 12]) { rect(0, y, 16, 1, '#626b66'); rect(0, y + 1, 16, 1, '#282e2e'); }
  } else if (name.startsWith('end_frame')) {
    noise(name === 'end_frame_side' ? [193, 193, 137] : [109, 128, 91], 18);
    if (name === 'end_frame_side') {
      rect(0, 0, 16, 4, '#557765'); rect(0, 3, 16, 1, '#2f594c');
      for (const x of [1, 6, 11]) { rect(x, 5, 3, 7, '#9eae78'); rect(x + 1, 6, 2, 4, '#7d9463'); }
    } else {
      rect(2, 2, 12, 12, '#355647'); rect(3, 3, 10, 10, '#607559'); rect(5, 5, 6, 6, '#172c25'); rect(1, 1, 14, 1, '#bcc99a'); rect(1, 1, 1, 14, '#a7b788');
      if (name === 'end_frame_eye') { rect(5, 5, 6, 6, '#a8c583'); rect(6, 6, 4, 4, '#2b6954'); rect(7, 5, 2, 6, '#112b24'); rect(5, 5, 1, 2, '#e3ebbd'); }
    }
  } else if (name === 'end_portal') {
    rect(0, 0, 16, 16, '#030c13');
    for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 14; i++) {
      const x = ((hash(i, layer, 1, seed) * 16 | 0) + (frame >> (layer + 1))) & 15, y = ((hash(i, layer, 2, seed) * 16 | 0) - (frame >> (3 - layer))) & 15;
      rect(x, y, 1, 1, ['#154942', '#368c8c', '#8193ba'][layer]);
    }
  } else if (name === 'dragon_egg') {
    noise([13, 10, 19], 12); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x + (y >> 1)) % 4 === 0 && y % 3 === 0) rect(x, y, 2, 1, '#342940');
  } else if (name === 'dragon_eye') rect(0, 0, 16, 16, '#eec6ff');
  else if (name === 'dragon_spine') noise([73, 68, 81], 10);
  else if (name === 'dragon_skin') {
    noise([25, 23, 28], 9); for (let y = 0; y < 16; y += 4) for (let x = (y % 8) / 2; x < 16; x += 4) { rect(x, y, 3, 1, '#353039'); rect(x, y + 1, 1, 2, '#1c1920'); }
  } else if (name.startsWith('enderman')) {
    noise([18, 18, 19], 6); if (name === 'enderman_face') { rect(1, 7, 5, 2, '#c786df'); rect(10, 7, 5, 2, '#c786df'); rect(3, 7, 1, 2, '#faf0ff'); rect(12, 7, 1, 2, '#faf0ff'); }
  } else if (name.startsWith('blaze')) {
    noise([219, 164, 44], 32); for (let i = 0; i < 14; i++) rect(hash(i, 1, 7, seed) * 16 | 0, hash(i, 2, 7, seed) * 16 | 0, 2, 2, '#c16f1c');
    if (name === 'blaze_face') { rect(2, 5, 4, 2, '#382617'); rect(10, 5, 4, 2, '#382617'); rect(6, 10, 5, 2, '#80531a'); rect(7, 12, 3, 1, '#3e2b12'); }
  } else noise([131, 133, 124], 38);
  return true;
}

export function paintAdventureItem(ctx, name) {
  if (!['ender_pearl', 'eye_of_ender', 'blaze_rod', 'blaze_powder', 'nether_brick'].includes(name)) return false;
  const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  if (name === 'ender_pearl' || name === 'eye_of_ender') {
    for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) { const d = (x - 7.5) ** 2 + (y - 7.5) ** 2; if (d <= 45) rect(x, y, 1, 1, d > 31 ? '#123c37' : x + y < 13 ? '#5db9a2' : '#277b6c'); }
    rect(4, 3, 3, 1, '#a4e1ca'); rect(3, 4, 2, 2, '#7bceb8');
    if (name === 'eye_of_ender') { rect(3, 5, 10, 6, '#9bac60'); rect(5, 4, 6, 8, '#b9c875'); rect(6, 5, 4, 6, '#22694b'); rect(7, 4, 2, 8, '#112b21'); rect(6, 5, 1, 2, '#e9efd1'); }
  } else if (name === 'blaze_rod') {
    for (let i = 2; i < 14; i++) { rect(i - 1, 14 - i, 3, 2, '#7a3e09'); rect(i, 14 - i, 2, 1, '#efbc35'); rect(i, 13 - i, 1, 1, '#fff284'); }
  } else if (name === 'nether_brick') { rect(2, 5, 11, 6, '#231217'); rect(4, 3, 8, 2, '#593039'); rect(3, 5, 11, 3, '#512832'); rect(3, 5, 1, 5, '#704047'); }
  else for (const [x, y] of [[2, 10], [5, 6], [8, 3], [11, 8], [7, 11], [10, 12]]) { rect(x, y, 3, 3, '#9d4011'); rect(x, y, 2, 2, '#ef8c18'); rect(x, y, 1, 1, '#ffe95a'); }
  return true;
}
