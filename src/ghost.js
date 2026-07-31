/* ghosts — plica
 *
 * a ghost's kind is decided when its SEED is created, not when it is opened.
 * this is load-bearing: tells (below) hint at what a fold holds, and if the
 * value were rolled at click time the whole information layer would be theatre.
 * the fetch is lazy; the identity is not.
 */

import { hash32, mulberry32 } from "./rng.js";

export const KINDS = ["drawn", "written", "mixed", "plate", "shape", "effect", "blank"];

/* what a ghost leaks — a shadow through paper, never a number.
   the minesweeper reference is the SHAPE of the tension, not its arithmetic. */
export const TELLS = {
  drawn: "blot",     // dense grey mass
  mixed: "blot",
  plate: "blot",     // a flat colour field reads as mass too
  shape: "blot",
  written: "ruled",  // faint ruled lines
  effect: "halo",    // a ring
  blank: "clean"     // paper
};

const HONESTY = 0.8;

export class Oracle {
  constructor(sheetSeed) {
    this.sheetSeed = sheetSeed >>> 0;
    const rng = mulberry32(hash32(sheetSeed, 0x1eaf));

    /* weights are per-sheet. a sheet that runs heavily blank is a quiet sheet,
       and that is a legitimate sheet. */
    const jitter = base => Math.max(0.02, base * (0.6 + rng() * 0.8));
    this.weights = {
      drawn: jitter(0.24),
      written: jitter(0.24),
      mixed: jitter(0.18),
      plate: jitter(0.09),
      shape: jitter(0.03),
      effect: jitter(0.15),
      blank: jitter(0.07)
    };
    const total = Object.values(this.weights).reduce((a, b) => a + b, 0);
    for (const k of KINDS) this.weights[k] /= total;
  }

  /* deterministic in the seed id — asking twice always gives the same answer */
  identity(seedId) {
    const h = hash32(seedId, this.sheetSeed, 0x5eed);
    let roll = (h / 4294967296);
    let kind = KINDS[KINDS.length - 1];
    for (const k of KINDS) {
      if (roll < this.weights[k]) { kind = k; break; }
      roll -= this.weights[k];
    }

    const honest = (hash32(seedId, this.sheetSeed, 0x7e11) / 4294967296) < HONESTY;
    let tell = TELLS[kind];
    if (!honest) {
      const options = [...new Set(Object.values(TELLS))].filter(t => t !== TELLS[kind]);
      tell = options[hash32(seedId, this.sheetSeed, 0x11e) % options.length];
    }
    return { kind, tell, honest };
  }
}
