/** Deterministic integer hashing and improved gradient noise. */
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const mod = (n, d) => ((n % d) + d) % d;
export function seedNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value | 0;
  const text = String(value || 'A new world'); let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h | 0;
}
export function hash(x, y = 0, z = 0, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function random(seed) {
  let s = seedNumber(seed);
  return () => {
    s += 0x6d2b79f5; let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
function grad(h, x, y, z) {
  h &= 15; const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}
export class Noise {
  constructor(seed) {
    const rand = random(seed), p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    this.p = new Uint16Array(512);
    for (let i = 0; i < 512; i++) this.p[i] = p[i & 255];
  }
  at(x, y, z = 0) {
    const p = this.p, ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const X = ix & 255, Y = iy & 255, Z = iz & 255;
    x -= ix; y -= iy; z -= iz;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    return lerp(lerp(lerp(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u),
      lerp(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u), v),
    lerp(lerp(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u),
      lerp(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u), v), w);
  }
  fbm(x, z, octaves = 4, persistence = .5) {
    let result = 0, a = 1, norm = 0;
    for (let i = 0; i < octaves; i++) { result += this.at(x, z, i * 13.37) * a; norm += a; x *= 2.03; z *= 2.03; a *= persistence; }
    return result / norm;
  }
}
