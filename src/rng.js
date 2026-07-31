/* deterministic noise + rng — plica */

export function hash32(a, b = 0, c = 0) {
  let h = 2166136261 >>> 0;
  h = Math.imul(h ^ (a >>> 0), 16777619);
  h = Math.imul(h ^ (b >>> 0), 16777619);
  h = Math.imul(h ^ (c >>> 0), 16777619);
  h ^= h >>> 15; h = Math.imul(h, 2246822507);
  h ^= h >>> 13; h = Math.imul(h, 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function strHash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

const smooth = t => t * t * (3 - 2 * t);

/* value noise, [-1, 1] */
export function noise2(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const g = (a, b) => hash32(a, b, seed) / 4294967296;
  const u = smooth(xf), v = smooth(yf);
  const a = g(xi, yi), b = g(xi + 1, yi), c = g(xi, yi + 1), d = g(xi + 1, yi + 1);
  const top = a + (b - a) * u, bot = c + (d - c) * u;
  return (top + (bot - top) * v) * 2 - 1;
}

export function fbm2(x, y, seed, octaves = 2) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * freq, y * freq, seed + i * 7919) * amp;
    norm += amp;
    amp *= 0.5; freq *= 2.07;
  }
  return sum / norm;
}

/* warp-of-warp: the field is itself displaced by a second field.
   this is what makes a border marble rather than merely wobble. */
export function warpedNoise(x, y, seed, warp = 1.6) {
  const wx = fbm2(x * 0.6, y * 0.6, seed ^ 0x9e3779b9, 2) * warp;
  const wy = fbm2(x * 0.6 + 5.2, y * 0.6 - 3.1, seed ^ 0x85ebca6b, 2) * warp;
  return fbm2(x + wx, y + wy, seed, 2);
}
