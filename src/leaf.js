/* leaves — plica
 *
 * what lives inside a fold. rendered entirely in SVG rather than an HTML
 * overlay: plica's text is one or two short lines by design, so it fits in the
 * same coordinate system as the geometry and needs no second transform kept in
 * sync with the camera.
 *
 * every leaf is clipped to its own cell path, so imagery is torn to the shape
 * of the fold it was found in.
 */

import { renderShape } from "./shape.js";

const SVG = "http://www.w3.org/2000/svg";

/* P2 will make these act. for now they are dormant marks: a fold that is
   visibly holding something, which you may leave holding it forever.
 *
 * the gloss says plainly what tapping it will do. these are instructions, not
 * omens — the divination is in what ends up beside what, and a player deciding
 * whether to spend an effect needs to know what it does. evocative wording here
 * would only make the choice arbitrary.
 *
 * P2 note: once used, an effect fold becomes an ordinary fold — it takes on a
 * normal leaf (image / text / plate) rather than staying a spent mark. */
export const EFFECT_MARKS = [
  { glyph: "℮", gloss: "change every e to a" },
  { glyph: "↺", gloss: "reverse the words in touching folds" },
  { glyph: "◌", gloss: "delete one word from the whole sheet" },
  { glyph: "❋", gloss: "stain touching folds brown" },
  { glyph: "≈", gloss: "remove the vowels from touching folds" },
  { glyph: "☀", gloss: "fade touching folds" },
  { glyph: "◈", gloss: "show what nearby ghosts hold" },
  { glyph: "▲", gloss: "absorb the smallest touching fold" },
  { glyph: "∿", gloss: "redraw every crease on the sheet" },
  { glyph: "⁙", gloss: "open two folds on the next tap" }
];

export function bbox(runs) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const run of runs) for (const [x, y] of run) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/* how much room a cell actually has at its middle — the radius of the largest
   circle centred on the centroid that still sits inside the fold */
export function inradius(cell) {
  const [cx, cy] = cell.centroid;
  let min = Infinity;
  for (const run of cell.runs) {
    for (const [x, y] of run) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < min) min = d;
    }
  }
  return isFinite(min) ? min : 20;
}

function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

/* ---------------- open folds ---------------- */

function renderImages(g, cell, leaf) {
  const box = bbox(cell.runs);
  // often a fold holds exactly one picture. stacking three every time reads as
  // a filter; one image, torn to the shape of the fold, reads as a clipping.
  const want = leaf.imageCount ?? 1;
  const n = Math.min(leaf.images.length, want);
  for (let i = 0; i < n; i++) {
    const img = document.createElementNS(SVG, "image");
    /* oversize by more than the diagonal so a full-circle rotation can never
       swing a corner into view, then offset so the crop is never the middle of
       the picture */
    const grow = 1.6 + Math.random() * 0.7;
    const w = box.w * grow, h = box.h * grow;
    const x = box.minX - (w - box.w) * Math.random();
    const y = box.minY - (h - box.h) * Math.random();
    img.setAttribute("href", leaf.images[i]);
    img.setAttribute("x", x.toFixed(1));
    img.setAttribute("y", y.toFixed(1));
    img.setAttribute("width", w.toFixed(1));
    img.setAttribute("height", h.toFixed(1));
    img.setAttribute("preserveAspectRatio", "xMidYMid slice");
    img.setAttribute("class", "leaf-img");
    // true isotropy: a cutting has no up
    img.setAttribute("transform",
      `rotate(${(Math.random() * 360).toFixed(1)} ${(x + w / 2).toFixed(1)} ${(y + h / 2).toFixed(1)})`);
    if (i > 0) img.style.mixBlendMode = ["multiply", "luminosity", "hard-light", "screen"][i % 4];
    img.style.opacity = i === 0 ? "0.92" : "0.7";
    g.appendChild(img);
  }
}

function renderText(g, cell, lines, cls = "leaf-text") {
  if (!lines.length) return;
  const [cx, cy] = cell.centroid;
  const r = inradius(cell);
  const size = Math.max(6, r * (lines.length > 1 ? 0.24 : 0.3));

  const text = document.createElementNS(SVG, "text");
  text.setAttribute("class", cls);
  text.setAttribute("x", cx.toFixed(1));
  text.setAttribute("y", cy.toFixed(1));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-size", size.toFixed(2));

  lines.forEach((line, i) => {
    const t = document.createElementNS(SVG, "tspan");
    t.setAttribute("x", cx.toFixed(1));
    t.setAttribute("dy", i === 0 ? `${(-(lines.length - 1) * 0.55).toFixed(2)}em` : "1.15em");
    t.textContent = line;
    text.appendChild(t);
  });
  g.appendChild(text);

  // shrink to fit the room the fold actually has
  let widest = 0;
  for (const t of text.childNodes) {
    try { widest = Math.max(widest, t.getComputedTextLength()); } catch { /* not laid out yet */ }
  }
  const allowed = r * 1.55;
  if (widest > allowed && widest > 0) {
    text.setAttribute("font-size", Math.max(4, size * (allowed / widest)).toFixed(2));
  }
}

function renderEffect(g, cell, leaf) {
  const [cx, cy] = cell.centroid;
  const r = inradius(cell);

  const ring = document.createElementNS(SVG, "circle");
  ring.setAttribute("class", "leaf-ring");
  ring.setAttribute("cx", cx.toFixed(1));
  ring.setAttribute("cy", cy.toFixed(1));
  ring.setAttribute("r", (r * 0.52).toFixed(1));
  g.appendChild(ring);

  const mark = document.createElementNS(SVG, "text");
  mark.setAttribute("class", "leaf-glyph");
  mark.setAttribute("x", cx.toFixed(1));
  mark.setAttribute("y", (cy - r * 0.02).toFixed(1));
  mark.setAttribute("text-anchor", "middle");
  mark.setAttribute("dominant-baseline", "central");
  mark.setAttribute("font-size", (r * 0.6).toFixed(1));
  mark.textContent = leaf.glyph;
  g.appendChild(mark);

  renderText(g, { centroid: [cx, cy + r * 0.62], runs: cell.runs }, [leaf.gloss], "leaf-gloss");
}

export function renderLeaf(g, cell, leaf, type) {
  clear(g);
  if (!leaf || leaf.kind === "blank") return;

  if (leaf.state === "pending") {
    const [cx, cy] = cell.centroid;
    const dot = document.createElementNS(SVG, "circle");
    dot.setAttribute("class", "leaf-pending");
    dot.setAttribute("cx", cx.toFixed(1));
    dot.setAttribute("cy", cy.toFixed(1));
    dot.setAttribute("r", (inradius(cell) * 0.08).toFixed(1));
    g.appendChild(dot);
    return;
  }

  if (leaf.kind === "effect") { renderEffect(g, cell, leaf); return; }
  if (leaf.kind === "shape") { renderShape(g, cell, leaf.shape, inradius(cell)); return; }

  // A plate's face carries its flat colour; type is always drawn on top.
  if (leaf.images?.length && leaf.kind !== "written" && leaf.kind !== "plate") {
    renderImages(g, cell, leaf);
  }
  const lines = leaf.lines?.length ? leaf.lines
    : leaf.kind === "plate" && leaf.title ? [leaf.title]
    : [];
  if (lines.length && leaf.kind !== "drawn") {
    if (type) type.render(g, cell, lines, leaf.id, inradius(cell));
    else renderText(g, cell, lines);
  }
}

/* ---------------- ghosts ---------------- */

/* a shadow through paper. one bit of information, sometimes a lie. */
export function renderTell(g, cell, tell) {
  clear(g);
  const [cx, cy] = cell.centroid;
  const r = inradius(cell);

  if (tell === "blot") {
    const blot = document.createElementNS(SVG, "ellipse");
    blot.setAttribute("class", "tell-blot");
    blot.setAttribute("cx", cx.toFixed(1));
    blot.setAttribute("cy", cy.toFixed(1));
    blot.setAttribute("rx", (r * 0.62).toFixed(1));
    blot.setAttribute("ry", (r * 0.48).toFixed(1));
    blot.setAttribute("transform", `rotate(${(Math.random() * 60 - 30).toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})`);
    g.appendChild(blot);
  } else if (tell === "ruled") {
    for (let i = -1; i <= 1; i++) {
      const l = document.createElementNS(SVG, "line");
      l.setAttribute("class", "tell-rule");
      const w = r * (0.62 - Math.abs(i) * 0.16);
      const y = cy + i * r * 0.32;
      l.setAttribute("x1", (cx - w).toFixed(1));
      l.setAttribute("x2", (cx + w).toFixed(1));
      l.setAttribute("y1", y.toFixed(1));
      l.setAttribute("y2", y.toFixed(1));
      g.appendChild(l);
    }
  } else if (tell === "halo") {
    const ring = document.createElementNS(SVG, "circle");
    ring.setAttribute("class", "tell-halo");
    ring.setAttribute("cx", cx.toFixed(1));
    ring.setAttribute("cy", cy.toFixed(1));
    ring.setAttribute("r", (r * 0.44).toFixed(1));
    g.appendChild(ring);
  }
  // "clean" draws nothing — that is the tell
}
