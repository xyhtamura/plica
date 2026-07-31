/* plica — a mystical crumpled paper that unfolds indefinitely
 *
 * P1: the paper says something. geometry from P0, content from the shared
 * okkategorakle world plus whatever the outside gives up on the day.
 */

import { Sheet, CELL } from "./sheet.js";
import { Camera } from "./camera.js";
import { pathFromRuns, lerpRuns, easeOutCubic } from "./crease.js";
import { hash32, mulberry32 } from "./rng.js";
import { Language } from "./language.js";
import { Oracle } from "./ghost.js";
import { renderLeaf, renderTell, EFFECT_MARKS } from "./leaf.js";
import { TypeSetter, plateColour } from "./type.js";
import { makePalette } from "./palette.js";
import { makeShape } from "./shape.js";

const SVG = "http://www.w3.org/2000/svg";
const svg = document.getElementById("sheet");
const world = document.getElementById("world");
const clips = document.getElementById("clips");
const cellsEl = document.getElementById("cells");
const debugEl = document.getElementById("debug");
const DEBUG = new URLSearchParams(location.search).has("debug");
if (DEBUG) debugEl.hidden = false;

let sheet, lang, oracle, leaves, type, palette;

/* every sheet invents its own colours — ground included. there is no light mode
   or dark mode, only this paper's mode. */
function applyPalette(p) {
  const root = document.documentElement.style;
  root.setProperty("--ground", p.ground);
  root.setProperty("--vignette", p.vignette);
  root.setProperty("--paper", p.paper);
  root.setProperty("--crease", p.crease);
  root.setProperty("--ghost", p.ghost);
  root.setProperty("--ghost-edge", p.ghostEdge);
  root.setProperty("--reset-face", p.resetFace);
  root.setProperty("--reset-edge", p.resetEdge);
  root.setProperty("--ink", p.ink);
  root.setProperty("--faded", p.faded);
  root.setProperty("--tell", p.tell);
}
const cam = new Camera(world, CELL);
const nodes = new Map();      // seed id -> {g, face, edge, content, clip}
let tween = null;
let collapse = 0;
let ancestorsReady = null;

/* ---------------- content ---------------- */

/* how many pictures a fold holds. one is the common case — a single image torn
   to the shape of the fold reads as a clipping; three every time reads as a
   filter applied to everything. */
function imageCount(id) {
  const roll = hash32(id, sheet.sheetSeed, 0x1439) / 4294967296;
  return roll < 0.58 ? 1 : roll < 0.88 ? 2 : 3;
}

function newLeaf(id) {
  const seed = sheet.seeds.get(id);
  const { kind, tell } = oracle.identity(id);
  const base = { id, tell, imageCount: imageCount(id) };

  if (seed?.role === "reset") return { ...base, kind: "blank", state: "ready" };
  if (seed?.role === "drawn") return { ...base, kind: "mixed", state: "pending", lines: [], images: [] };

  if (kind === "effect") {
    const mark = EFFECT_MARKS[hash32(id, sheet.sheetSeed, 0xefec) % EFFECT_MARKS.length];
    return { ...base, kind, state: "ready", glyph: mark.glyph, gloss: mark.gloss, spent: false };
  }
  if (kind === "blank") return { ...base, kind, state: "ready" };
  if (kind === "shape") {
    return { ...base, kind, state: "ready", shape: makeShape(id, sheet.sheetSeed, palette) };
  }
  if (kind === "plate") {
    const title = seedFor(id);
    return {
      ...base, kind, state: "ready", title,
      colour: plateColour(id, sheet.sheetSeed, palette), lines: [title], images: []
    };
  }
  return { ...base, kind, state: "pending", lines: [], images: [] };
}

/* a fold composes from its already-open neighbours, biased toward the most
   recently opened — so the paper drifts semantically across its own surface and
   two regions grown in different directions genuinely diverge */
function seedFor(id) {
  const nb = [...(sheet.neighbours.get(id) || [])]
    .map(n => sheet.seeds.get(n))
    .filter(s => s && s.tier === "open")
    .sort((a, b) => sheet.openOrder.indexOf(b.id) - sheet.openOrder.indexOf(a.id));

  for (const s of nb) {
    const leaf = leaves.get(s.id);
    if (leaf?.title) return leaf.title;
    if (leaf?.lines?.length) return leaf.lines[0];
  }
  return lang.seedWord();
}

async function fillLeaf(id) {
  const leaf = leaves.get(id);
  if (!leaf || leaf.state !== "pending") return;
  if (ancestorsReady) await ancestorsReady;

  try {
    const pool = await lang.leafPool(seedFor(id));
    leaf.title = lang.title(pool);
    if (leaf.kind !== "drawn") leaf.lines = lang.compose(pool);
    if (leaf.kind !== "written" && leaf.kind !== "plate") {
      leaf.images = await lang.images([leaf.title, seedFor(id)]).catch(() => []);
    }
    // a fold that came back with nothing simply has nothing in it —
    // except a plate, which is already a colour whether or not words arrived
    if (!leaf.lines?.length && !leaf.images?.length && leaf.kind !== "plate") leaf.kind = "blank";
    leaf.state = "ready";
  } catch {
    // the outside was unreachable. errors surface as paper, not as messages:
    // a failed pull is indistinguishable from silence and the fiction holds.
    leaf.kind = "blank";
    leaf.state = "ready";
  }
  setLeafAppearance(id);
  paintContent(id);
}

/* ---------------- render ---------------- */

const tone = id => palette.tone(id);

function ensureNode(id) {
  let n = nodes.get(id);
  if (n) return n;

  const clip = document.createElementNS(SVG, "clipPath");
  clip.id = "c-" + id;
  const clipPath = document.createElementNS(SVG, "path");
  clip.appendChild(clipPath);
  clips.appendChild(clip);

  const g = document.createElementNS(SVG, "g");
  g.setAttribute("class", "cell enter");
  g.dataset.id = id;

  const face = document.createElementNS(SVG, "path");
  face.setAttribute("class", "face");

  const content = document.createElementNS(SVG, "g");
  content.setAttribute("class", "content");
  content.setAttribute("clip-path", `url(#c-${id})`);

  const edge = document.createElementNS(SVG, "path");
  edge.setAttribute("class", "edge");

  g.append(face, content, edge);
  cellsEl.appendChild(g);
  requestAnimationFrame(() => g.classList.remove("enter"));

  n = { g, face, edge, content, clip: clipPath, painted: null };
  nodes.set(id, n);
  return n;
}

function paintContent(id) {
  const n = nodes.get(id);
  const cell = sheet.cells.get(id);
  if (!n || !cell) return;
  const tier = cell.seed.tier;

  if (tier === "ghost") {
    const { tell } = oracle.identity(id);
    renderTell(n.content, cell, tell);
  } else {
    renderLeaf(n.content, cell, leaves.get(id), type);
  }
  n.painted = tier + ":" + (leaves.get(id)?.state || "") + ":" + (leaves.get(id)?.kind || "");
}

function setGeometry(n, cell) {
  n.face.setAttribute("d", cell.path);
  n.edge.setAttribute("d", cell.path);
  n.clip.setAttribute("d", cell.path);
}

function setLeafAppearance(id) {
  const n = nodes.get(id);
  const cell = sheet.cells.get(id);
  if (!n || !cell) return;
  const tier = cell.seed.tier;
  const leaf = leaves.get(id);
  n.g.classList.toggle("has-effect", leaf?.kind === "effect");
  n.g.classList.toggle("is-blank", leaf?.kind === "blank");
  n.face.style.fill = tier !== "open" || cell.seed.role === "reset" ? ""
    : leaf?.kind === "plate" ? leaf.colour
    : tone(cell.id);
}

function render() {
  const live = new Set();
  const open = [], ghosts = [];

  for (const cell of sheet.rendered()) {
    live.add(cell.id);
    const n = ensureNode(cell.id);
    const tier = cell.seed.tier;
    setGeometry(n, cell);

    n.g.classList.toggle("open", tier === "open");
    n.g.classList.toggle("ghost", tier === "ghost");
    n.g.classList.toggle("reset", cell.seed.role === "reset");
    n.g.classList.toggle("drawn", cell.seed.role === "drawn");
    const leaf = leaves.get(cell.id);
    setLeafAppearance(cell.id);

    const want = tier + ":" + (leaf?.state || "") + ":" + (leaf?.kind || "");
    if (n.painted !== want) paintContent(cell.id);

    (tier === "open" ? open : ghosts).push(n.g);
  }

  for (const [id, n] of nodes) {
    if (live.has(id)) continue;
    n.g.remove();
    n.clip.parentNode?.remove();
    nodes.delete(id);
  }

  // the revealed map paints under the frontier
  for (const g of open) cellsEl.appendChild(g);
  for (const g of ghosts) cellsEl.appendChild(g);

  if (DEBUG) {
    const seeds = [...sheet.seeds.values()];
    const kinds = {};
    for (const l of leaves.values()) kinds[l.kind] = (kinds[l.kind] || 0) + 1;
    debugEl.textContent =
      `unfolds ${sheet.unfolds} · open ${seeds.filter(s => s.tier === "open").length}` +
      ` · ghost ${seeds.filter(s => s.tier === "ghost").length}` +
      ` · loose ${seeds.filter(s => s.tier === "loose").length}` +
      ` · leaves ${Object.entries(kinds).map(([k, v]) => k + " " + v).join(" / ")}` +
      ` · reservoir ${lang.reservoir.length} · ancestors ${lang.ancestors.length}`;
  }
}

function viewport() { return { w: svg.clientWidth, h: svg.clientHeight }; }

/* the sheet is framed once, when you find it. after that the camera belongs to
   the user — opening a fold never pulls the view back to fit. */
let lastViewport = null;

/* ---------------- the unfold ---------------- */

function doUnfold(id) {
  const before = new Map();
  for (const cell of sheet.rendered()) {
    if (cell.seed.tier === "ghost") before.set(cell.id, cell.runs);
  }
  if (!sheet.unfold(id)) return;

  leaves.set(id, newLeaf(id));
  fillLeaf(id);

  const pairs = [];
  for (const cell of sheet.rendered()) {
    if (cell.seed.tier !== "ghost") continue;
    const from = before.get(cell.id);
    if (from && from.length === cell.runs.length) pairs.push({ cell, from, to: cell.runs });
  }
  render();
  // the camera does NOT follow an unfold. framing is the user's to hold.
  if (pairs.length) tween = { pairs, t0: performance.now(), dur: 460 };
}

function stepTween(now) {
  if (!tween) return;
  const t = Math.min(1, (now - tween.t0) / tween.dur);
  const e = easeOutCubic(t);
  for (const { cell, from, to } of tween.pairs) {
    const n = nodes.get(cell.id);
    if (!n) continue;
    const d = t >= 1 ? pathFromRuns(to) : pathFromRuns(lerpRuns(from, to, e));
    n.face.setAttribute("d", d);
    n.edge.setAttribute("d", d);
    n.clip.setAttribute("d", d);
  }
  if (t >= 1) {
    // tells sit at the centroid, which moved while the frontier re-creased
    for (const { cell } of tween.pairs) paintContent(cell.id);
    tween = null;
  }
}

/* ---------------- input ---------------- */

/* activation resolves on pointerdown/pointerup, NOT on a `click` listener.
 *
 * calling setPointerCapture on the svg root retargets the events that follow —
 * including the click — to the capture element, so `ev.target.closest(".cell")`
 * was always null and no ghost could ever be picked. capture is now taken only
 * once a drag has actually begun, and the fold under the press is remembered
 * rather than re-derived from a later event's target.
 */

let press = null;

svg.addEventListener("pointerdown", ev => {
  const g = ev.target.closest?.(".cell");
  const id = g ? Number(g.dataset.id) : null;
  if (id !== null && sheet.seeds.get(id)?.role === "reset") { press = null; startHold(); return; }
  press = {
    id, pointerId: ev.pointerId, moved: false,
    x: ev.clientX, y: ev.clientY, lx: ev.clientX, ly: ev.clientY
  };
});

svg.addEventListener("pointermove", ev => {
  if (!press) return;
  if (!press.moved && Math.abs(ev.clientX - press.x) + Math.abs(ev.clientY - press.y) > 4) {
    press.moved = true;
    try { svg.setPointerCapture(press.pointerId); } catch { /* pointer already gone */ }
  }
  if (press.moved) cam.panBy(ev.clientX - press.lx, ev.clientY - press.ly);
  press.lx = ev.clientX; press.ly = ev.clientY;
});

svg.addEventListener("pointerup", () => {
  const p = press;
  press = null;
  if (!p) return;
  if (p.moved) { try { svg.releasePointerCapture(p.pointerId); } catch { /* already released */ } return; }
  if (p.id === null) return;
  if (sheet.seeds.get(p.id)?.tier === "ghost") doUnfold(p.id);
  // open effect folds are dormant marks in P1; deploying them is P2
});

svg.addEventListener("pointercancel", () => { press = null; });

svg.addEventListener("wheel", ev => {
  ev.preventDefault();
  cam.zoomAt(ev.clientX, ev.clientY, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });

/* the reset fold is a gesture, not a dialogue: the collapse begins under your
   finger and reverses if you let go early */
let hold = null;
function startHold(now = performance.now()) {
  hold = { t0: now };
  const release = () => {
    window.removeEventListener("pointerup", release);
    window.removeEventListener("pointercancel", release);
    hold = null;
  };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
}

function stepHold(now = performance.now()) {
  const target = hold ? Math.min(1, (now - hold.t0) / 520) : 0;
  collapse += (target - collapse) * (hold ? 0.3 : 0.18);
  if (collapse < 0.002) { collapse = 0; svg.style.removeProperty("--collapse"); return; }
  svg.style.setProperty("--collapse", collapse.toFixed(3));
  if (hold && target >= 1) { hold = null; newSheet(); }
}

/* ---------------- boot ---------------- */

function newSheet() {
  for (const [, n] of nodes) { n.g.remove(); n.clip.parentNode?.remove(); }
  nodes.clear();
  tween = null;
  collapse = 0;
  svg.style.removeProperty("--collapse");

  const seed = (Math.random() * 1e9) | 0;
  sheet = new Sheet(seed);
  oracle = new Oracle(sheet.sheetSeed);
  palette = makePalette(sheet.sheetSeed, mulberry32(hash32(sheet.sheetSeed, 0xc010)));
  applyPalette(palette);
  type = new TypeSetter(sheet.sheetSeed, mulberry32(hash32(sheet.sheetSeed, 0x7ee)), palette);
  const prevAncestors = lang?.ancestors;
  lang = new Language(mulberry32(sheet.sheetSeed));
  if (prevAncestors) lang.ancestors = prevAncestors;   // the world is already known
  leaves = new Map();

  for (const s of sheet.seeds.values()) {
    if (s.tier === "open") { leaves.set(s.id, newLeaf(s.id)); fillLeaf(s.id); }
  }

  render();
  cam.manual = false;
  lastViewport = viewport();
  cam.frame(sheet.bounds(), lastViewport, null);
  cam.snap();
}

/* one frame of the animation loop, factored out so it can be driven manually.
   requestAnimationFrame does not fire when the page is not being composited,
   which makes the camera, the hold gesture and the morph untestable otherwise. */
function frame(now = performance.now()) {
  stepHold(now);
  stepTween(now);
  cam.step();
}

function loop() {
  frame();
  requestAnimationFrame(loop);
}

/* hold the user's framing across a resize: keep whatever world point was in the
   middle of the viewport in the middle of it, rather than re-fitting the sheet */
addEventListener("resize", () => {
  const v = viewport();
  if (lastViewport) cam.shift((v.w - lastViewport.w) / 2, (v.h - lastViewport.h) / 2);
  lastViewport = v;
});

/* the shared world: okkategorakle.csv lives in cutline and is fetched live, so
   both pieces keep the same ancestors. unreachable is survivable. */
sheet = new Sheet();
oracle = new Oracle(sheet.sheetSeed);
palette = makePalette(sheet.sheetSeed, mulberry32(hash32(sheet.sheetSeed, 0xc010)));
applyPalette(palette);
type = new TypeSetter(sheet.sheetSeed, mulberry32(hash32(sheet.sheetSeed, 0x7ee)), palette);
lang = new Language(mulberry32(sheet.sheetSeed));
leaves = new Map();
ancestorsReady = lang.loadAncestors().then(ok => { ancestorsReady = null; return ok; });

for (const s of sheet.seeds.values()) {
  if (s.tier === "open") { leaves.set(s.id, newLeaf(s.id)); fillLeaf(s.id); }
}

render();
lastViewport = viewport();
cam.frame(sheet.bounds(), lastViewport, null);
cam.snap();
requestAnimationFrame(loop);

if (DEBUG) {
  window.plica = {
    get sheet() { return sheet; },
    get lang() { return lang; },
    get leaves() { return leaves; },
    get cam() { return cam; },
    get palette() { return palette; },
    get tweening() { return !!tween; },
    /* drive the loop by hand when rAF is asleep (headless / hidden tab) */
    step(n = 1, dt = 16) {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) frame(t0 + i * dt);
    },
    unfold: id => doUnfold(id),
    ghosts: () => sheet.rendered().filter(c => c.seed.tier === "ghost").map(c => c.id),
    checkSeams(tol = 0.01) {
      const bad = [];
      for (const cell of sheet.rendered()) {
        for (let i = 0; i < cell.runs.length; i++) {
          const a = cell.runs[i][cell.runs[i].length - 1];
          const b = cell.runs[(i + 1) % cell.runs.length][0];
          const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          if (d > tol) bad.push({ cell: cell.id, edge: i, gap: +d.toFixed(3) });
        }
      }
      return bad;
    },
    checkShared(tol = 0.01) {
      const seen = new Map(), bad = [];
      for (const cell of sheet.rendered()) {
        cell.keys.forEach((key, i) => {
          if (key === "-") return;
          const pts = cell.runs[i];
          if (!seen.has(key)) { seen.set(key, pts); return; }
          const other = seen.get(key);
          if (other.length !== pts.length) { bad.push({ key, why: "length" }); return; }
          const fwd = other.every((p, k) => Math.hypot(p[0] - pts[k][0], p[1] - pts[k][1]) < tol);
          const rev = other.every((p, k) => {
            const q = pts[pts.length - 1 - k];
            return Math.hypot(p[0] - q[0], p[1] - q[1]) < tol;
          });
          if (!fwd && !rev) bad.push({ key, why: "diverged" });
        });
      }
      return bad;
    },
    snapshotOpen() {
      const m = {};
      for (const c of sheet.rendered()) if (c.seed.tier === "open") m[c.id] = c.path;
      return m;
    },
    diffOpen(before) {
      const now = this.snapshotOpen();
      return Object.keys(before).filter(id => now[id] !== undefined && now[id] !== before[id]);
    }
  };
}
