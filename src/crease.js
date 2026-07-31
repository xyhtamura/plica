/* creases — plica
 *
 * a crease belongs to TWO folds. it must be displaced once, keyed by the sorted
 * site pair, and handed to both cells (one of them reversed). displace per-cell
 * instead and you get hairline gaps down every border.
 *
 * endpoints are never displaced. a voronoi vertex is shared by three creases;
 * moving it separates all three. the amplitude envelope goes to zero at both
 * ends so the junctions stay welded.
 */

import { warpedNoise, strHash } from "./rng.js";

export const SAMPLES = 14;   // fixed, so two states of one crease can be lerped

export function creaseKey(a, b) { return a < b ? a + ":" + b : b + ":" + a; }

/**
 * Sample a crease from A to B, offset along its normal.
 * Returns SAMPLES points, endpoints exact.
 */
export function warpCrease(ax, ay, bx, by, key, creaseSeed, amp, freq) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const seed = strHash(key) ^ Math.imul(creaseSeed, 0x9e3779b9);
  // long creases get more excursion, but never more than they can carry
  const a = amp * Math.min(1, len / 90);

  const pts = new Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    const t = i / (SAMPLES - 1);
    const px = ax + dx * t, py = ay + dy * t;
    const env = Math.sin(Math.PI * t);          // 0 at both ends — welds junctions
    const d = warpedNoise(px * freq, py * freq, seed) * a * env;
    pts[i] = [px + nx * d, py + ny * d];
  }
  return pts;
}

/* catmull-rom through one crease's points, as cubic beziers.
   smoothing stays WITHIN a crease so voronoi vertices keep their hard corner. */
function spline(pts, out) {
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, n - 1)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    out.push(`C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`);
  }
}

/** Assemble a closed path from an ordered list of per-crease point arrays. */
export function pathFromRuns(runs) {
  if (!runs.length) return "";
  const first = runs[0][0];
  const out = [`M${first[0].toFixed(2)},${first[1].toFixed(2)}`];
  for (const pts of runs) spline(pts, out);
  out.push("Z");
  return out.join("");
}

export function lerpRuns(from, to, t) {
  const out = new Array(to.length);
  for (let i = 0; i < to.length; i++) {
    const a = from[i], b = to[i];
    const pts = new Array(b.length);
    for (let k = 0; k < b.length; k++) {
      pts[k] = [a[k][0] + (b[k][0] - a[k][0]) * t, a[k][1] + (b[k][1] - a[k][1]) * t];
    }
    out[i] = pts;
  }
  return out;
}

export const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
