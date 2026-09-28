import { hash, seedNumber } from '../core/noise.js';

export const HOSTILE_TEXTURES = ['husk_wrap', 'husk_coat', 'husk_face', 'ashbone', 'ashbone_face', 'moss_shell', 'moss_face', 'moss_heart', 'weaver_shell', 'weaver_leg', 'weaver_eye'];
const palettes = {
  husk_wrap: [133, 120, 81], husk_coat: [45, 83, 78], husk_face: [91, 104, 77],
  ashbone: [172, 175, 158], ashbone_face: [153, 163, 151],
  moss_shell: [65, 101, 75], moss_face: [56, 81, 61], moss_heart: [237, 177, 83],
  weaver_shell: [64, 54, 88], weaver_leg: [47, 82, 86], weaver_eye: [234, 173, 94]
};

/** Original "amber / verdigris" pixel palette. Low-frequency clusters plus
 * deliberate seams replace unstructured speckle; no external image assets. */
export function paintHostileTexture(ctx, name) {
  const base = palettes[name]; if (!base) return false;
  const seed = seedNumber(name), rect = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const cluster = (hash(x >> 1, y >> 1, 1, seed) - .5) * 23, fine = (hash(x, y, 2, seed) - .5) * 7;
    rect(x, y, 1, 1, `rgb(${base.map(v => Math.max(0, Math.min(255, Math.round(v + cluster + fine)))).join(',')})`);
  }
  if (name === 'husk_wrap') for (let y = 1; y < 16; y += 4) { rect(0, y, 16, 1, '#655f45'); rect(0, y + 1, 16, 1, '#b0a57e'); }
  if (name === 'husk_coat') { rect(7, 0, 2, 16, '#273f3e'); rect(1, 11, 14, 2, '#795944'); rect(7, 11, 3, 2, '#c5a373'); }
  if (name === 'husk_face') { rect(1, 3, 14, 3, '#a6996f'); rect(3, 6, 10, 2, '#303d35'); rect(10, 6, 2, 2, '#efd08a'); rect(5, 11, 6, 1, '#414b3b'); }
  if (name === 'ashbone') { rect(3, 1, 1, 13, '#818f86'); rect(12, 0, 2, 14, '#d0cdb6'); rect(6, 6, 3, 3, '#678a87'); }
  if (name === 'ashbone_face') { rect(2, 4, 5, 4, '#303f46'); rect(9, 4, 5, 4, '#303f46'); rect(4, 6, 2, 1, '#9bd3c4'); rect(10, 6, 2, 1, '#9bd3c4'); rect(6, 9, 4, 2, '#63716f'); for (let x = 3; x < 14; x += 3) rect(x, 12, 1, 3, '#687a77'); }
  if (name === 'moss_shell') for (let y = 0; y < 16; y += 4) for (let x = (y % 8) / 2; x < 16; x += 4) { rect(x, y, 3, 1, '#91a777'); rect(x, y + 1, 1, 3, '#304d3a'); }
  if (name === 'moss_face') { rect(3, 3, 10, 8, '#293e32'); rect(5, 4, 6, 6, '#bf8748'); rect(7, 3, 2, 9, '#f1ca77'); rect(3, 12, 10, 1, '#94a879'); }
  if (name === 'weaver_shell') { for (let y = 1; y < 14; y += 4) { rect(2, y, 12, 1, '#8a799d'); rect(2, y + 1, 12, 1, '#342f4c'); } rect(6, 4, 4, 7, '#507d84'); }
  if (name === 'weaver_leg') for (const y of [3, 10]) { rect(0, y, 16, 2, '#9db0a3'); rect(0, y + 2, 16, 1, '#303647'); }
  return true;
}

export function hostileModel(type, model, part, limb) {
  if (type === 'zombie') {
    model.head.position.set(0, 1.45, .02); part('husk_wrap', [.5, .5, .5], [0, .25, 0], model.head, 'husk_face');
    part('moss_heart',[.07,.045,.012],[.09,.26,.256],model.head);
    part('husk_coat', [.55, .75, .32], [0, 1.075, 0]); part('husk_wrap', [.61, .14, .4], [0, 1.4, 0]);
    for (const side of [-1, 1]) { limb('husk_wrap', [.21, .7, .23], [side * .15, .7, 0]); const arm = limb('husk_coat', [.22, .73, .24], [side * .38, 1.43, 0], model.arms); part('husk_wrap', [.225, .25, .245], [0, -.6, 0], arm); }
  } else if (type === 'skeleton') {
    model.head.position.set(0, 1.46, 0); part('ashbone', [.5, .5, .46], [0, .25, 0], model.head, 'ashbone_face');
    for(const x of [-.105,.105])part('weaver_eye',[.055,.035,.012],[x,.25,.236],model.head);
    part('ashbone', [.17, .74, .2], [0, 1.1, 0]);
    for (let y = .92; y < 1.48; y += .17) part('ashbone', [.54, .065, .3], [0, y, 0]);
    for (const side of [-1, 1]) { limb('ashbone', [.13, .73, .14], [side * .17, .73, 0]); limb('ashbone', [.13, .7, .13], [side * .36, 1.45, 0], model.arms); }
    part('husk_coat', [.36, .26, .34], [-.25, 1.4, 0]);
  } else if (type === 'creeper') {
    part('moss_shell', [.5, .76, .32], [0, .84, 0]);
    model.head.position.set(0, 1.21, 0); part('moss_shell', [.58, .48, .53], [0, .24, 0], model.head, 'moss_face');
    part('moss_heart', [.19, .35, .035], [0, .91, .18]);
    for (const x of [-.21, .21]) for (const z of [-.2, .2]) limb('moss_shell', [.22, .46, .26], [x, .46, z]);
    part('moss_shell', [.22, .12, .2], [-.13, .54, 0], model.head);
  } else if (type === 'spider') {
    part('weaver_shell', [.8, .5, .85], [0, .48, -.26]); part('weaver_leg', [.4, .32, .4], [0, .4, .26]);
    model.head.position.set(0, .45, .55); part('weaver_shell', [.48, .3, .35], [0, 0, 0], model.head);
    for (const x of [-.17, -.065, .065, .17]) part('weaver_eye', [.06, .06, .025], [x, .03, .186], model.head);
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) { const leg = limb('weaver_leg', [.07, .85, .09], [side * .28, .48, (i - 1.5) * .22]); leg.rotation.z = side; leg.rotation.x = (i - 1.5) * .25; }
  }
}
