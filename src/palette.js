/* palette — plica
 *
 * every sheet invents its own colours. ground, paper, creases, ghosts, inks and
 * plates are all drawn fresh when you find a paper and again on every reset.
 * light ground or dark ground is a coin flip; there is no light mode or dark
 * mode, only this paper's mode.
 *
 * legibility is NOT a goal here. a fragment may be printed in a colour that
 * barely separates from the fold it sits on, and that is allowed — the folds
 * are graphic material, not a document. two structural exceptions survive,
 * because they are mechanics rather than readability:
 *
 *   - paper must separate from ground, or the sheet is invisible
 *   - ghosts must separate from open folds, or you cannot tell what is clickable
 *
 * both are held in LIGHTNESS only; hue and saturation are free.
 */

import { hash32, mulberry32 } from "./rng.js";

/* the mildest possible guard against a fold's ink landing exactly on its own
   backdrop and rendering nothing at all. lower it to 0 for total freedom. */
export const CONTRAST_FLOOR = 8;

const wrap = h => ((h % 360) + 360) % 360;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const hsl = (h, s, l) => `hsl(${wrap(h).toFixed(0)} ${clamp(s, 0, 100).toFixed(0)}% ${clamp(l, 0, 100).toFixed(0)}%)`;

export function makePalette(sheetSeed, rng = Math.random) {
  const lightGround = rng() < 0.5;

  const gH = rng() * 360;
  const gS = 3 + rng() * 46;
  const gL = lightGround ? 72 + rng() * 24 : 4 + rng() * 20;

  // paper crosses the ground in lightness; hue is unrelated on purpose
  const pH = wrap(gH + (rng() * 300 - 150));
  const pS = 4 + rng() * 62;
  const pL = lightGround
    ? clamp(gL - (28 + rng() * 42), 6, 64)
    : clamp(gL + (32 + rng() * 46), 38, 97);

  /* ghosts sit between the two and are held clear of BOTH by at least 11 in
     lightness — a ghost that reads as an open fold breaks the only affordance
     the interface has. the jitter is clamped rather than trusted. */
  const ghH = wrap(pH + (rng() * 160 - 80));
  const ghS = 3 + rng() * 44;
  const lo = Math.min(gL, pL), hi = Math.max(gL, pL);
  const ghL = clamp((gL + pL) / 2 + (rng() * 16 - 8), lo + 11, hi - 11);

  // creases read against paper
  const crH = wrap(pH + (rng() * 120 - 60));
  const crS = 5 + rng() * 55;
  const crL = pL > 50 ? clamp(pL - (26 + rng() * 38), 2, 58) : clamp(pL + (28 + rng() * 44), 42, 98);

  const vignetteDark = gL > 50 ? rng() < 0.35 : true;

  /* inks and plates are completely free — any hue, any saturation, any
     lightness. this is where the legibility rule is deliberately dropped. */
  const inks = [];
  for (let i = 0; i < 5; i++) inks.push(hsl(rng() * 360, 20 + rng() * 80, 12 + rng() * 76));
  const plates = [];
  for (let i = 0; i < 6; i++) plates.push(hsl(rng() * 360, 15 + rng() * 80, 15 + rng() * 70));

  const paperL = pL;

  return {
    lightGround,
    ground: hsl(gH, gS, gL),
    vignette: vignetteDark ? "rgba(0,0,0,.72)" : "rgba(255,255,255,.55)",
    paper: hsl(pH, pS, pL),
    crease: hsl(crH, crS, crL),
    ghost: hsl(ghH, ghS, ghL),
    ghostEdge: hsl(ghH, ghS + 10, ghL > 50 ? ghL - 26 : ghL + 26),
    resetFace: hsl(wrap(pH + 40), pS, clamp(pL + (pL > 50 ? -10 : 10), 4, 96)),
    resetEdge: hsl(crH, crS, crL),
    ink: hsl(crH, crS + 8, crL),
    faded: hsl(crH, crS * 0.7, pL > 50 ? crL + 14 : crL - 14),
    tell: hsl(ghH, ghS + 6, ghL > 50 ? ghL - 18 : ghL + 18),
    inks,
    plates,

    /* per-fold variation around the sheet's paper, deterministic in the id */
    tone(id) {
      const h = hash32(id, sheetSeed, 0x70e);
      const r = mulberry32(h);
      return hsl(pH + (r() * 26 - 13), pS + (r() * 22 - 11), paperL + (r() * 14 - 7));
    },

    /* keep a colour from vanishing into the surface it is printed on */
    lift(colour, backdropL) {
      const m = /hsl\((\d+) (\d+)% (\d+)%\)/.exec(colour);
      if (!m) return colour;
      const [, h, s, l] = m.map(Number);
      if (Math.abs(l - backdropL) >= CONTRAST_FLOOR) return colour;
      return hsl(h, s, l > backdropL ? l + CONTRAST_FLOOR * 2 : l - CONTRAST_FLOOR * 2);
    },

    paperL
  };
}
