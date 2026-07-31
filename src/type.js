/* typography — plica
 *
 * the fold is not a text box, it is a clipping mask. text that overruns its
 * cell is torn off at the crease, which is exactly what a phrase cut out of a
 * magazine looks like. so nothing here shrinks to fit except `plain`.
 *
 * a sheet carries a typographic HEAT, drawn once and never shown. cool sheets
 * set their fragments quietly; hot ones let the letters eat the fold until the
 * text is functioning as an image and the words are barely recoverable.
 */

import { hash32, mulberry32 } from "./rng.js";

const SVG = "http://www.w3.org/2000/svg";

/* system stacks only — no webfont fetch, and the mismatch between them is the
   point. a real ransom note is made of whatever was lying around. */
const FONTS = [
  'Georgia, "Iowan Old Style", serif',
  '"Arial Narrow", "Helvetica Neue", Arial, sans-serif',
  'Impact, Haettenschweiler, "Arial Black", sans-serif',
  '"Times New Roman", Times, serif',
  'ui-monospace, "Courier New", monospace',
  '"Brush Script MT", "Segoe Script", cursive',
  '"Trebuchet MS", "Gill Sans", sans-serif',
  'Papyrus, "Comic Sans MS", fantasy'
];

const TREATMENTS = ["plain", "stacked", "ransom", "banner", "overprint", "monogram"];

/* how far a piece of type may swing from upright, in degrees.
 *
 * 180 means true isotropy — a fragment is as likely to land upside down as the
 * right way up, because a cutting has no up. this DOES mean the `plain`
 * treatment is often inverted, so "readable" becomes "legible if you turn your
 * head"; that is the magazine-collage register, not an oversight. drop this to
 * ~20 to get an upright, quietly-tilted sheet back.
 */
export const ISOTROPY = 180;

const spin = rng => (rng() * 2 - 1) * ISOTROPY;

export function plateColour(seedId, sheetSeed, palette) {
  return palette.plates[hash32(seedId, sheetSeed, 0x91a7e) % palette.plates.length];
}

export class TypeSetter {
  constructor(sheetSeed, rng = Math.random, sheetPalette) {
    this.sheetSeed = sheetSeed >>> 0;
    /* half the sheets sit near readable; a few run genuinely feral */
    this.heat = Math.pow(rng(), 1.6) * 0.85 + 0.08;

    // two to four of this sheet's inks, so one paper reads as one press run
    const shuffled = [...sheetPalette.inks].sort(() => rng() - 0.5);
    this.palette = shuffled.slice(0, 2 + Math.floor(rng() * 3));
    this.sheetPalette = sheetPalette;
  }

  weights() {
    const h = this.heat;
    return {
      plain: Math.max(0.12, 0.52 - h * 0.34),
      stacked: 0.18,
      ransom: 0.12 + h * 0.16,
      banner: 0.09 + h * 0.11,
      overprint: 0.05 + h * 0.06,
      monogram: 0.02 + h * 0.10
    };
  }

  /* deterministic per fold — a re-render must never restyle a fold you have
     already read, or the sheet would rewrite itself behind you */
  treatment(seedId) {
    const w = this.weights();
    const total = TREATMENTS.reduce((a, k) => a + w[k], 0);
    let roll = (hash32(seedId, this.sheetSeed, 0x7ea1) / 4294967296) * total;
    for (const k of TREATMENTS) {
      if (roll < w[k]) return k;
      roll -= w[k];
    }
    return "plain";
  }

  rng(seedId, salt) { return mulberry32(hash32(seedId, this.sheetSeed, salt)); }
  ink(rng) { return this.palette[Math.floor(rng() * this.palette.length)]; }
  font(rng) { return FONTS[Math.floor(rng() * FONTS.length)]; }

  /* ---------------- treatments ---------------- */

  render(g, cell, lines, seedId, inradius) {
    if (!lines?.length) return;
    const mode = this.treatment(seedId);
    const rng = this.rng(seedId, 0x5e77);
    const [cx, cy] = cell.centroid;
    const ctx = { g, cx, cy, r: inradius, rng, text: lines.join(" · "), lines };
    switch (mode) {
      case "stacked": return this.stacked(ctx);
      case "ransom": return this.ransom(ctx);
      case "banner": return this.banner(ctx);
      case "overprint": return this.overprint(ctx);
      case "monogram": return this.monogram(ctx);
      default: return this.plain(ctx);
    }
  }

  node(g, { x, y, size, font, fill, rotate = 0, anchor = "middle", opacity = 1, cls = "type", weight = null, letterSpacing = null }) {
    const t = document.createElementNS(SVG, "text");
    t.setAttribute("class", cls);
    t.setAttribute("x", x.toFixed(1));
    t.setAttribute("y", y.toFixed(1));
    t.setAttribute("text-anchor", anchor);
    t.setAttribute("font-size", size.toFixed(2));
    t.style.fontFamily = font;
    t.style.fill = fill;
    if (weight) t.style.fontWeight = weight;
    if (letterSpacing) t.style.letterSpacing = letterSpacing;
    if (opacity !== 1) t.style.opacity = String(opacity);
    if (rotate) t.setAttribute("transform", `rotate(${rotate.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})`);
    g.appendChild(t);
    return t;
  }

  /* the quiet setting — the only one that fits itself to the fold */
  plain({ g, cx, cy, r, rng, lines }) {
    const size = Math.max(6, r * (lines.length > 1 ? 0.24 : 0.3));
    const t = this.node(g, {
      x: cx, y: cy, size, font: FONTS[0], fill: this.ink(rng), cls: "type type-plain",
      rotate: spin(rng)
    });
    t.style.fontStyle = "italic";
    lines.forEach((line, i) => {
      const s = document.createElementNS(SVG, "tspan");
      s.setAttribute("x", cx.toFixed(1));
      s.setAttribute("dy", i === 0 ? `${(-(lines.length - 1) * 0.55).toFixed(2)}em` : "1.15em");
      s.textContent = line;
      t.appendChild(s);
    });
    let widest = 0;
    for (const s of t.childNodes) {
      try { widest = Math.max(widest, s.getComputedTextLength()); } catch { /* not laid out */ }
    }
    /* shrink to fit, but only so far. shrinking without a floor made the one
       treatment that is supposed to be READABLE the least readable of the six.
       past the floor the line simply overruns and the crease tears it, which is
       the house style anyway. */
    if (widest > r * 1.55 && widest > 0) {
      const fitted = size * (r * 1.55 / widest);
      t.setAttribute("font-size", Math.max(r * 0.15, fitted).toFixed(2));
    }
  }

  /* one word per line, each a different size — a column of shouting */
  stacked({ g, cx, cy, r, rng, text }) {
    const words = text.split(/\s+/).filter(Boolean).slice(0, 5);
    const base = r * 0.34;
    const font = this.font(rng);
    const fill = this.ink(rng);
    const tilt = spin(rng);
    let y = cy - (words.length - 1) * base * 0.55;
    for (const w of words) {
      const size = base * (0.62 + rng() * 0.95);
      this.node(g, {
        x: cx + (rng() - 0.5) * r * 0.5, y, size, font, fill,
        rotate: tilt + (rng() - 0.5) * 5,
        weight: rng() < 0.4 ? "700" : null
      }).textContent = w;
      y += size * 1.02;
    }
  }

  /* every word its own font, size, colour, angle. letters at high heat. */
  ransom({ g, cx, cy, r, rng, text }) {
    const asLetters = rng() < this.heat * 0.55;
    const pieces = asLetters
      ? text.replace(/\s+/g, "").split("").slice(0, 14)
      : text.split(/\s+/).filter(Boolean).slice(0, 8);
    if (!pieces.length) return;

    const angle = (rng() - 0.5) * 0.9;
    const base = r * (asLetters ? 0.5 : 0.3);
    let x = cx - r * 0.85, y = cy;

    for (const piece of pieces) {
      const size = base * (0.55 + rng() * 1.1);
      const advance = size * (asLetters ? 0.72 : 0.5 * piece.length + 0.3);
      this.node(g, {
        x: x + advance / 2,
        y: y + (rng() - 0.5) * r * 0.45,
        size,
        font: this.font(rng),
        fill: this.ink(rng),
        rotate: spin(rng),
        weight: rng() < 0.45 ? "700" : null,
        opacity: 0.82 + rng() * 0.18
      }).textContent = piece;
      x += advance * (0.86 + rng() * 0.3);
      y += angle * advance * 0.5;
      if (x > cx + r * 1.5) { x = cx - r * 0.9; y += base * 1.15; }
    }
  }

  /* scaled well past the fold so the crease tears it — a cut-out headline */
  banner({ g, cx, cy, r, rng, text }) {
    const line = text.split(/\s+/).slice(0, 3).join(" ").toUpperCase();
    this.node(g, {
      x: cx + (rng() - 0.5) * r * 0.5,
      y: cy + r * 0.22 + (rng() - 0.5) * r * 0.4,
      size: r * (0.85 + rng() * 0.9),
      font: FONTS[2],
      fill: this.ink(rng),
      rotate: spin(rng),
      weight: "700",
      letterSpacing: `${(-0.04 + rng() * 0.1).toFixed(3)}em`
    }).textContent = line;
  }

  /* misregistered printing: the same words twice, off by a hair, blended */
  overprint({ g, cx, cy, r, rng, text }) {
    const line = text.split(/\s+/).slice(0, 4).join(" ");
    const size = r * (0.34 + rng() * 0.3);
    const font = this.font(rng);
    const tilt = spin(rng);
    const passes = 2 + (rng() < 0.35 ? 1 : 0);
    for (let i = 0; i < passes; i++) {
      const t = this.node(g, {
        x: cx + (i - (passes - 1) / 2) * r * 0.12,
        y: cy + (i - (passes - 1) / 2) * r * 0.09,
        size, font, fill: this.ink(rng), rotate: tilt, weight: "700",
        opacity: 0.72
      });
      t.textContent = line;
      t.style.mixBlendMode = "multiply";
    }
  }

  /* one letter, enormous, deliberately off-centre so it bleeds out the side */
  monogram({ g, cx, cy, r, rng, text }) {
    const letters = text.replace(/[^A-Za-z]/g, "");
    if (!letters) return;
    const ch = letters[Math.floor(rng() * letters.length)];
    this.node(g, {
      x: cx + (rng() - 0.5) * r * 1.1,
      y: cy + r * (0.5 + rng() * 0.5),
      size: r * (2.1 + rng() * 2.4),
      font: this.font(rng),
      fill: this.ink(rng),
      rotate: spin(rng),
      weight: "700",
      opacity: 0.9
    }).textContent = rng() < 0.5 ? ch.toUpperCase() : ch;
  }
}
