/* plica — a mystical crumpled paper that unfolds indefinitely
 *
 * P2: the paper acts. Geometry from P0, content from P1, and three dormant
 * spatial effects that alter neighbouring language, tells, or every crease.
 */

import { Sheet, CELL } from "./sheet.js";
import { Camera } from "./camera.js";
import { pathFromRuns, lerpRuns, easeOutCubic } from "./crease.js";
import { hash32, mulberry32 } from "./rng.js";
import { Language } from "./language.js";
import { Oracle, TELLS } from "./ghost.js";
import { renderLeaf, renderTell } from "./leaf.js";
import { TypeSetter, plateColour } from "./type.js";
import { makePalette } from "./palette.js";
import { makeShape } from "./shape.js";
import {
  deployEffect,
  effectById,
  effectFor,
  restoreEffectState,
  spentKindFor
} from "./effects.js";
import { captureState, clearState, loadState, restoreLanguage, saveState } from "./state.js";
import { applyPinch, pinchFrame } from "./gestures.js";
import { rememberIntro, shouldShowIntro } from "./intro.js";

const SVG = "http://www.w3.org/2000/svg";
const svg = document.getElementById("sheet");
const world = document.getElementById("world");
const clips = document.getElementById("clips");
const cellsEl = document.getElementById("cells");
const debugEl = document.getElementById("debug");
const introEl = document.getElementById("intro");
const introDismissEl = document.getElementById("intro-dismiss");
const DEBUG = new URLSearchParams(location.search).has("debug");
const FORCE_INTRO = new URLSearchParams(location.search).has("intro");
if (DEBUG) debugEl.hidden = false;

let sheet, lang, oracle, leaves, type, palette, effectState;

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
let saveTimer = null;
let lastSave = null;
let storage = null;
try { storage = window.localStorage; } catch { /* private or restricted context */ }

/* ---------------- content ---------------- */

/* how many pictures a fold holds. one is the common case — a single image torn
   to the shape of the fold reads as a clipping; three every time reads as a
   filter applied to everything. */
function imageCount(id) {
  const roll = hash32(id, sheet.sheetSeed, 0x1439) / 4294967296;
  return roll < 0.58 ? 1 : roll < 0.88 ? 2 : 3;
}

function newLeaf(id, forcedKind = null) {
  const seed = sheet.seeds.get(id);
  const identity = oracle.identity(id);
  const kind = forcedKind || identity.kind;
  const tell = identity.tell;
  const base = { id, tell, imageCount: imageCount(id) };

  if (seed?.role === "reset") return { ...base, kind: "blank", state: "ready" };
  if (seed?.role === "drawn") return { ...base, kind: "mixed", state: "pending", lines: [], images: [] };

  if (kind === "effect") {
    const effect = effectFor(id, sheet.sheetSeed);
    return {
      ...base, kind, state: "ready", effectId: effect.id,
      glyph: effect.glyph, gloss: effect.gloss, spent: false
    };
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
  queueSave();
}

async function refillImages(id) {
  const leaf = leaves.get(id);
  if (!leaf?.imagesOmitted) return;
  if (ancestorsReady) await ancestorsReady;
  try { leaf.images = await lang.images([leaf.title || seedFor(id), seedFor(id)]); }
  catch { leaf.images = []; }
  delete leaf.imagesOmitted;
  setLeafAppearance(id);
  paintContent(id);
  queueSave();
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
    const identity = oracle.identity(id);
    const tell = effectState.truthfulTells.has(id) ? TELLS[identity.kind] : identity.tell;
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
      ` · truthful ${effectState.truthfulTells.size}` +
      ` · crease ${sheet.creaseSeed}` +
      ` · reservoir ${lang.reservoir.length} · ancestors ${lang.ancestors.length}`;
  }
}

function viewport() { return { w: svg.clientWidth, h: svg.clientHeight }; }

/* the sheet is framed once, when you find it. after that the camera belongs to
   the user — opening a fold never pulls the view back to fit. */
let lastViewport = null;

/* ---------------- persistence ---------------- */

function saveNow() {
  if (!sheet || !leaves || !lang || !lastViewport) return null;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const snapshot = captureState({
    sheet,
    leaves,
    camera: cam.toState(viewport()),
    language: lang,
    effects: effectState
  });
  lastSave = saveState(storage, snapshot);
  if (DEBUG) debugEl.dataset.persistence = lastSave.saved
    ? `saved${lastSave.imagesOmitted ? "-without-images" : ""}`
    : "unavailable";
  return lastSave;
}

function queueSave(delay = 120) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, delay);
}

function restoreLeaves(entries) {
  const restored = new Map();
  for (const entry of entries) {
    const [id, leaf] = Array.isArray(entry) ? entry : [];
    if (!Number.isInteger(id) || !sheet.seeds.has(id) || !leaf || typeof leaf !== "object" ||
        leaf.id !== id || !["pending", "ready"].includes(leaf.state) || restored.has(id)) {
      throw new Error("invalid leaf state");
    }
    if (leaf.lines !== undefined && (!Array.isArray(leaf.lines) ||
        !leaf.lines.every(line => typeof line === "string"))) throw new Error("invalid leaf lines");
    if (leaf.images !== undefined && (!Array.isArray(leaf.images) ||
        !leaf.images.every(url => typeof url === "string"))) throw new Error("invalid leaf images");
    const restoredLeaf = {
      ...leaf,
      lines: leaf.lines ? [...leaf.lines] : undefined,
      images: leaf.images ? [...leaf.images] : undefined
    };
    if (restoredLeaf.kind === "effect") {
      const effect = effectById(restoredLeaf.effectId) || effectFor(id, sheet.sheetSeed);
      restoredLeaf.effectId = effect.id;
      restoredLeaf.glyph = effect.glyph;
      restoredLeaf.gloss = effect.gloss;
      restoredLeaf.spent = false;
    }
    restored.set(id, restoredLeaf);
  }
  return restored;
}

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
    if (runsMatch(from, cell.runs)) pairs.push({ cell, from, to: cell.runs });
  }
  render();
  // the camera does NOT follow an unfold. framing is the user's to hold.
  if (pairs.length) tween = { pairs, t0: performance.now(), dur: 460 };
  queueSave();
}

function runsMatch(from, to) {
  return Boolean(from) && from.length === to.length &&
    from.every((run, index) => run.length === to[index].length);
}

function doDeploy(id) {
  const leaf = leaves.get(id);
  if (!leaf || leaf.kind !== "effect" || leaf.spent || !effectById(leaf.effectId)) return false;

  const effectId = leaf.effectId;
  const result = deployEffect({ sheet, leaves, effectState, originId: id, effectId });
  if (!result) return false;

  const replacement = newLeaf(id, spentKindFor(id, sheet.sheetSeed));
  replacement.spentEffect = effectId;
  leaves.set(id, replacement);
  if (replacement.state === "pending") fillLeaf(id);

  const pairs = [];
  if (result.geometryBefore) {
    for (const cell of sheet.rendered()) {
      const from = result.geometryBefore.get(cell.id);
      if (runsMatch(from, cell.runs)) pairs.push({ cell, from, to: cell.runs });
    }
  }

  render();
  for (const changedId of result.changedLeaves) paintContent(changedId);
  for (const changedId of result.changedTells) paintContent(changedId);
  if (pairs.length) tween = { pairs, t0: performance.now(), dur: 620 };
  queueSave();
  return true;
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
    // content stays welded to the cell while a frontier or whole-sheet morphs
    for (const { cell } of tween.pairs) paintContent(cell.id);
    tween = null;
  }
}

/* ---------------- input ---------------- */

/* activation resolves on pointerdown/pointerup, NOT on a `click` listener.
 *
 * calling setPointerCapture on the svg root retargets the events that follow —
 * including the click — to the capture element, so `ev.target.closest(".cell")`
 * was always null and no ghost could ever be picked. Capture begins once a drag
 * starts or a second touch begins, and the fold under a tap is remembered
 * rather than re-derived from a later event's target.
 */

const activePointers = new Map();
let press = null;
let pinch = null;

function rememberPointer(ev) {
  activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
}

function captureActivePointers() {
  for (const id of activePointers.keys()) {
    try { svg.setPointerCapture(id); } catch { /* pointer already gone */ }
  }
}

function finishPinch() {
  pinch = null;
  queueSave();
  const remaining = [...activePointers.entries()][0];
  press = remaining ? {
    id: null, pointerId: remaining[0], moved: true,
    x: remaining[1].x, y: remaining[1].y,
    lx: remaining[1].x, ly: remaining[1].y
  } : null;
}

svg.addEventListener("pointerdown", ev => {
  rememberPointer(ev);
  if (activePointers.size >= 2) {
    cancelHold();
    press = null;
    if (!pinch) pinch = pinchFrame(activePointers);
    captureActivePointers();
    ev.preventDefault();
    return;
  }
  const g = ev.target.closest?.(".cell");
  const id = g ? Number(g.dataset.id) : null;
  if (id !== null && sheet.seeds.get(id)?.role === "reset") { press = null; startHold(); return; }
  press = {
    id, pointerId: ev.pointerId, moved: false,
    x: ev.clientX, y: ev.clientY, lx: ev.clientX, ly: ev.clientY
  };
});

svg.addEventListener("pointermove", ev => {
  if (!activePointers.has(ev.pointerId)) return;
  rememberPointer(ev);
  if (pinch) {
    const next = pinchFrame(activePointers);
    if (next) {
      applyPinch(cam, pinch, next);
      pinch = next;
    }
    return;
  }
  if (!press) return;
  if (!press.moved && Math.abs(ev.clientX - press.x) + Math.abs(ev.clientY - press.y) > 4) {
    press.moved = true;
    try { svg.setPointerCapture(press.pointerId); } catch { /* pointer already gone */ }
  }
  if (press.moved) cam.panBy(ev.clientX - press.lx, ev.clientY - press.ly);
  press.lx = ev.clientX; press.ly = ev.clientY;
});

svg.addEventListener("pointerup", ev => {
  const wasPinching = Boolean(pinch);
  activePointers.delete(ev.pointerId);
  try { svg.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
  if (wasPinching) {
    if (activePointers.size >= 2) pinch = pinchFrame(activePointers);
    else finishPinch();
    return;
  }
  const p = press;
  press = null;
  if (!p) return;
  if (p.moved) {
    try { svg.releasePointerCapture(p.pointerId); } catch { /* already released */ }
    queueSave();
    return;
  }
  if (p.id === null) return;
  const seed = sheet.seeds.get(p.id);
  if (seed?.tier === "ghost") doUnfold(p.id);
  else if (seed?.tier === "open") doDeploy(p.id);
});

svg.addEventListener("pointercancel", ev => {
  const wasPinching = Boolean(pinch);
  activePointers.delete(ev.pointerId);
  if (wasPinching) {
    if (activePointers.size >= 2) pinch = pinchFrame(activePointers);
    else finishPinch();
  } else if (press?.pointerId === ev.pointerId) {
    if (press.moved) queueSave();
    press = null;
  }
});

svg.addEventListener("wheel", ev => {
  ev.preventDefault();
  cam.zoomAt(ev.clientX, ev.clientY, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
  queueSave();
}, { passive: false });

/* the reset fold is a gesture, not a dialogue: the collapse begins under your
   finger and reverses if you let go early */
let hold = null;
let holdRelease = null;

function cancelHold() {
  if (holdRelease) {
    window.removeEventListener("pointerup", holdRelease);
    window.removeEventListener("pointercancel", holdRelease);
  }
  holdRelease = null;
  hold = null;
}

function startHold(now = performance.now()) {
  cancelHold();
  hold = { t0: now };
  holdRelease = cancelHold;
  window.addEventListener("pointerup", holdRelease);
  window.addEventListener("pointercancel", holdRelease);
}

function stepHold(now = performance.now()) {
  const target = hold ? Math.min(1, (now - hold.t0) / 520) : 0;
  collapse += (target - collapse) * (hold ? 0.3 : 0.18);
  if (collapse < 0.002) { collapse = 0; svg.style.removeProperty("--collapse"); return; }
  svg.style.setProperty("--collapse", collapse.toFixed(3));
  if (hold && target >= 1) { cancelHold(); newSheet(); }
}

/* ---------------- boot ---------------- */

function clearScene() {
  for (const [, n] of nodes) { n.g.remove(); n.clip.parentNode?.remove(); }
  nodes.clear();
  tween = null;
  collapse = 0;
  svg.style.removeProperty("--collapse");
}

function configureSheet(record = null, previousAncestors = null) {
  sheet = record ? Sheet.fromState(record.sheet) : new Sheet();
  oracle = new Oracle(sheet.sheetSeed);
  palette = makePalette(sheet.sheetSeed, mulberry32(hash32(sheet.sheetSeed, 0xc010)));
  applyPalette(palette);
  type = new TypeSetter(sheet.sheetSeed, mulberry32(hash32(sheet.sheetSeed, 0x7ee)), palette);
  lang = new Language(mulberry32(sheet.sheetSeed));
  if (record) restoreLanguage(lang, record.language);
  if (previousAncestors) lang.ancestors = previousAncestors;
  effectState = restoreEffectState(record?.effects, sheet);
  leaves = record ? restoreLeaves(record.leaves) : new Map();

  for (const seed of sheet.seeds.values()) {
    if (seed.tier === "open" && !leaves.has(seed.id)) leaves.set(seed.id, newLeaf(seed.id));
  }

  ancestorsReady = previousAncestors ? null
    : lang.loadAncestors().then(ok => { ancestorsReady = null; return ok; });
  render();
  lastViewport = viewport();
  if (record) cam.fromState(record.camera, lastViewport);
  else { cam.frame(sheet.bounds(), lastViewport, null); cam.snap(); }

  for (const [id, leaf] of leaves) {
    if (leaf.state === "pending") fillLeaf(id);
    else if (leaf.imagesOmitted) refillImages(id);
  }
}

function newSheet() {
  const previousAncestors = lang?.ancestors;
  activePointers.clear();
  pinch = null;
  press = null;
  clearScene();
  clearState(storage);
  configureSheet(null, previousAncestors);
  saveNow();
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

addEventListener("pagehide", saveNow);
document.addEventListener("visibilitychange", () => { if (document.hidden) saveNow(); });

function showIntro() {
  if (!FORCE_INTRO && !shouldShowIntro(storage)) return;
  if (typeof introEl.showModal === "function") introEl.showModal();
  else introEl.setAttribute("open", "");
}

function dismissIntro() {
  rememberIntro(storage);
  if (typeof introEl.close === "function") introEl.close();
  else introEl.removeAttribute("open");
}

introDismissEl.addEventListener("click", dismissIntro);
introEl.addEventListener("close", () => rememberIntro(storage));

/* the shared world: okkategorakle.csv lives in cutline and is fetched live, so
   both pieces keep the same ancestors. unreachable is survivable. */
const saved = loadState(storage);
if (DEBUG) debugEl.dataset.restore = saved ? "pending" : "none";
try {
  configureSheet(saved);
  if (DEBUG && saved) debugEl.dataset.restore = "restored";
}
catch (error) {
  if (DEBUG) debugEl.dataset.restore = error instanceof Error ? error.message : "invalid";
  clearState(storage);
  clearScene();
  configureSheet();
}
saveNow();
showIntro();
requestAnimationFrame(loop);

if (DEBUG) {
  window.plica = {
    get sheet() { return sheet; },
    get lang() { return lang; },
    get leaves() { return leaves; },
    get cam() { return cam; },
    get palette() { return palette; },
    get effects() { return effectState; },
    get tweening() { return !!tween; },
    get persistence() { return lastSave; },
    save: saveNow,
    deploy: doDeploy,
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
