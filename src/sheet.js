/* the sheet — plica
 *
 * load-bearing invariant: OPENED GEOMETRY IS IMMUTABLE, UNOPENED GEOMETRY IS
 * PROVISIONAL. the paper had not decided where the fold would fall until you
 * committed to opening it; once you did, it can never change its mind.
 *
 * how that holds without any polygon boolean:
 *   every vertex of an open cell is shared by two of its own edges, so it is
 *   determined by that cell plus two of its voronoi NEIGHBOURS — and the pin
 *   rule pins every neighbour of an open cell the moment it becomes one.
 *   loose seeds beyond the ghost ring can therefore churn freely without ever
 *   touching finished geometry.
 */

import { computeVoronoi, polyCentroid } from "./voronoi.js";
import { creaseKey, warpCrease, pathFromRuns } from "./crease.js";
import { mulberry32 } from "./rng.js";

export const CELL = 120;              // constant fold size, in world units

const MIN_GAP = CELL * 0.85;          // no two seeds closer than this
const BAND = CELL * 2.2;              // width of the loose collar around the sheet
const OPEN_CLEARANCE = CELL * 1.9;    // loose seeds must clear the ghost ring
const CULL = CELL * 4;                // bisector clipping radius
const WARP_AMP = CELL * 0.19;
const WARP_FREQ = 0.017;

export class Sheet {
  constructor(seed = (Math.random() * 1e9) | 0, { initialize = true } = {}) {
    this.sheetSeed = seed >>> 0;
    this.creaseSeed = 1;
    this.nextId = 0;
    this.seeds = new Map();
    this.creases = new Map();
    this.cells = new Map();
    this.openOrder = [];      // ids in the order they were committed
    this.unfolds = 0;
    if (initialize) this.init();
  }

  /* A saved sheet keeps the inputs that define the partition plus the creases
     and paths the user actually opened. Unfrozen frontier creases are derived
     again from the saved seed table and creaseSeed. */
  toState() {
    return {
      sheetSeed: this.sheetSeed,
      creaseSeed: this.creaseSeed,
      nextId: this.nextId,
      unfolds: this.unfolds,
      openOrder: [...this.openOrder],
      seeds: [...this.seeds.values()].map(seed => ({ ...seed })),
      creases: [...this.creases.entries()]
        .filter(([, crease]) => crease.frozen)
        .map(([key, crease]) => [key, { frozen: true, pts: crease.pts.map(point => [...point]) }]),
      frozenCells: [...this.cells.values()]
        .filter(cell => cell.frozenPath)
        .map(cell => ({
          id: cell.id,
          path: cell.frozenPath,
          runs: (cell.frozenRuns || cell.runs).map(run => run.map(point => [...point])),
          keys: [...(cell.frozenKeys || cell.keys)],
          centroid: [...(cell.frozenCentroid || cell.centroid)]
        }))
    };
  }

  static fromState(state) {
    if (!state || typeof state !== "object") throw new Error("invalid sheet state");
    const integer = value => Number.isInteger(value) && value >= 0;
    if (!integer(state.sheetSeed) || !integer(state.creaseSeed) || !integer(state.nextId) ||
        !integer(state.unfolds) || !Array.isArray(state.seeds) || !Array.isArray(state.openOrder) ||
        !Array.isArray(state.creases) || !Array.isArray(state.frozenCells)) {
      throw new Error("invalid sheet state");
    }

    const sheet = new Sheet(state.sheetSeed, { initialize: false });
    const tiers = new Set(["open", "ghost", "loose"]);
    for (const seed of state.seeds) {
      if (!seed || !integer(seed.id) || !Number.isFinite(seed.x) || !Number.isFinite(seed.y) ||
          !tiers.has(seed.tier) || typeof seed.pinned !== "boolean" ||
          typeof seed.committed !== "boolean" ||
          ![null, "drawn", "reset"].includes(seed.role) || sheet.seeds.has(seed.id)) {
        throw new Error("invalid seed state");
      }
      sheet.seeds.set(seed.id, { ...seed });
    }
    const openIds = [...sheet.seeds.values()].filter(seed => seed.tier === "open").map(seed => seed.id);
    if (sheet.seeds.size < 2 || new Set(state.openOrder).size !== state.openOrder.length ||
        state.openOrder.length !== openIds.length ||
        !state.openOrder.every(id => integer(id) && sheet.seeds.get(id)?.tier === "open" &&
          sheet.seeds.get(id)?.committed) ||
        [...sheet.seeds.values()].filter(seed => seed.role === "drawn").length !== 1 ||
        [...sheet.seeds.values()].filter(seed => seed.role === "reset").length !== 1) {
      throw new Error("incomplete sheet state");
    }

    for (const entry of state.creases) {
      const [key, crease] = Array.isArray(entry) ? entry : [];
      if (typeof key !== "string" || sheet.creases.has(key) || !crease || crease.frozen !== true || !Array.isArray(crease.pts) ||
          crease.pts.length < 2 || !crease.pts.every(point => Array.isArray(point) && point.length === 2 &&
            Number.isFinite(point[0]) && Number.isFinite(point[1]))) {
        throw new Error("invalid crease state");
      }
      sheet.creases.set(key, { frozen: true, pts: crease.pts.map(point => [...point]) });
    }

    sheet.creaseSeed = state.creaseSeed;
    const maxSeedId = Math.max(...sheet.seeds.keys());
    sheet.nextId = Math.max(state.nextId, maxSeedId + 1);
    sheet.unfolds = state.unfolds;
    sheet.openOrder = [...state.openOrder];
    sheet.rebuild();

    const frozenCells = new Map();
    for (const saved of state.frozenCells) {
      if (!saved || !integer(saved.id) || frozenCells.has(saved.id) || typeof saved.path !== "string" ||
          !Array.isArray(saved.runs) || !saved.runs.length ||
          !saved.runs.every(run => Array.isArray(run) && run.length >= 2 && run.every(point =>
            Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))) ||
          !Array.isArray(saved.keys) || saved.keys.length !== saved.runs.length ||
          !saved.keys.every(key => typeof key === "string") ||
          !Array.isArray(saved.centroid) || saved.centroid.length !== 2 || !saved.centroid.every(Number.isFinite) ||
          saved.path !== pathFromRuns(saved.runs)) {
        throw new Error("invalid frozen cell state");
      }
      frozenCells.set(saved.id, saved);
    }
    if (frozenCells.size !== openIds.length ||
        [...frozenCells.keys()].some(id => sheet.seeds.get(id)?.tier !== "open")) {
      throw new Error("frozen geometry is incomplete");
    }
    for (const seed of sheet.seeds.values()) {
      if (seed.tier !== "open") continue;
      const cell = sheet.cells.get(seed.id);
      const saved = frozenCells.get(seed.id);
      if (!cell || !saved) throw new Error("frozen geometry is incomplete");
      cell.runs = saved.runs.map(run => run.map(point => [...point]));
      cell.keys = [...saved.keys];
      cell.centroid = [...saved.centroid];
      cell.frozenRuns = cell.runs.map(run => run.map(point => [...point]));
      cell.frozenKeys = [...cell.keys];
      cell.frozenCentroid = [...cell.centroid];
      cell.frozenPath = saved.path;
      cell.path = saved.path;
    }
    return sheet;
  }

  /* ---------------- setup ---------------- */

  init() {
    const drawn = this.addSeed(0, 0, "open");
    drawn.role = "drawn";
    drawn.pinned = true;

    const reset = this.addSeed(CELL * 1.0, CELL * 0.12, "open");
    reset.role = "reset";
    reset.pinned = true;

    this.fillFringe();
    this.rebuild();
    // the two starting folds are already open; committing them raises the first
    // ghost ring, which everything afterwards grows outward from
    for (const s of this.seeds.values()) if (s.tier === "open") this.commit(s.id);
    this.grow();
  }

  /* two passes on purpose. the first lays a band past the open cells; only once
     those neighbours are pinned is the pinned radius large enough for the second
     to lay loose seeds BEYOND the ghost ring. without it the outermost ghosts
     have nothing to be bounded by and stretch to the clipping box. */
  grow() {
    for (let pass = 0; pass < 2; pass++) {
      this.dropLoose();
      this.fillFringe();
      this.rebuild();
      let guard = 0;
      while (this.evictIntruders() > 0 && guard++ < 5) this.rebuild();
    }
  }

  addSeed(x, y, tier) {
    const s = { id: this.nextId++, x, y, tier, pinned: false, committed: false, role: null };
    this.seeds.set(s.id, s);
    return s;
  }

  /* ---------------- growth ---------------- */

  dropLoose() {
    for (const [id, s] of this.seeds) if (s.tier === "loose") this.seeds.delete(id);
  }

  /* a jittered hex lattice, kept to a COLLAR hugging the pinned sheet.
   *
   * filling a disc around the centroid was wrong: unfolding branches, so the
   * sheet is stringy, and most of that disc is empty space nowhere near any
   * frontier. it bought hundreds of pointless seeds and made every rebuild
   * quadratic in nothing.
   *
   * the clearance test is topological rather than a fixed radius: a candidate
   * is refused if its NEAREST pinned seed is an open one, which means it is
   * still inside the ghost ring. that adapts to sparse regions, where a fixed
   * radius kept admitting intruders and eviction kept deleting them — the churn
   * that made the whole thing thrash. */
  fillFringe() {
    const all = [...this.seeds.values()];
    const pinned = all.filter(s => s.pinned);
    if (!pinned.length) return;

    const G = BAND;
    const bkey = (gx, gy) => (gx + 32768) * 65536 + (gy + 32768);
    const grid = new Map();
    const put = s => {
      const k = bkey(Math.floor(s.x / G), Math.floor(s.y / G));
      let b = grid.get(k);
      if (!b) grid.set(k, b = []);
      b.push(s);
    };
    for (const s of all) put(s);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of pinned) {
      if (s.x < minX) minX = s.x;
      if (s.y < minY) minY = s.y;
      if (s.x > maxX) maxX = s.x;
      if (s.y > maxY) maxY = s.y;
    }
    minX -= BAND; minY -= BAND; maxX += BAND; maxY += BAND;

    const rng = mulberry32(this.sheetSeed ^ (this.creaseSeed * 0x2545f491));
    const rowStep = CELL * 0.866;
    let row = 0;

    for (let y = minY; y <= maxY; y += rowStep, row++) {
      for (let x = minX + ((row & 1) ? CELL * 0.5 : 0); x <= maxX; x += CELL) {
        const px = x + (rng() - 0.5) * CELL * 0.7;
        const py = y + (rng() - 0.5) * CELL * 0.7;

        const gx = Math.floor(px / G), gy = Math.floor(py / G);
        let nearestPinned = null, bestPin = Infinity, closest = Infinity, bestOpen = Infinity;
        for (let ox = -1; ox <= 1; ox++) {
          for (let oy = -1; oy <= 1; oy++) {
            const b = grid.get(bkey(gx + ox, gy + oy));
            if (!b) continue;
            for (const s of b) {
              const d = Math.hypot(px - s.x, py - s.y);
              if (d < closest) closest = d;
              if (s.pinned && d < bestPin) { bestPin = d; nearestPinned = s; }
              if (s.committed && d < bestOpen) bestOpen = d;
            }
          }
        }

        if (closest < MIN_GAP) continue;                 // too crowded
        if (!nearestPinned || bestPin > BAND) continue;  // out in the dark
        if (bestOpen < OPEN_CLEARANCE) continue;         // cheap pre-filter
        // inside the ghost ring — but an UNcommitted open fold has no ring yet
        // and needs these candidates in order to get one
        if (nearestPinned.tier === "open" && nearestPinned.committed) continue;

        const s = this.addSeed(px, py, "loose");
        put(s);
      }
    }
  }

  /* the sheet refuses placements that would disturb finished work.
   *
   * voronoi adjacency is not distance-bounded, so no clearance radius can stop
   * a loose seed becoming a neighbour of an open cell — and if one does, that
   * cell's vertices move and its frozen creases no longer meet. pinning the
   * intruder would only lock the damage in. loose seeds carry no identity yet,
   * so the honest repair is to delete them and rebuild. */
  evictIntruders() {
    const doomed = new Set();
    for (const s of this.seeds.values()) {
      if (s.tier !== "open") continue;
      for (const nid of this.neighbours.get(s.id) || []) {
        if (this.seeds.get(nid)?.tier === "loose") doomed.add(nid);
      }
    }
    for (const id of doomed) this.seeds.delete(id);
    return doomed.size;
  }

  /* ---------------- geometry ---------------- */

  rebuild() {
    const list = [...this.seeds.values()];
    const vor = computeVoronoi(list, { cull: CULL, pad: CELL * 3 });
    this.vertices = vor.vertices;
    this.neighbours = vor.neighbours;
    this.raw = vor.cells;

    const rendered = list.filter(s => s.tier !== "loose");
    const live = new Set();

    // pass 1 — every crease touching a rendered cell, built once per site pair
    for (const s of rendered) {
      const cell = this.raw.get(s.id);
      if (!cell || cell.verts.length < 3) continue;
      const n = cell.verts.length;
      for (let k = 0; k < n; k++) {
        const j = cell.owners[k];
        if (j < 0) continue;
        const key = creaseKey(s.id, j);
        live.add(key);
        const A = this.vertices[cell.verts[k]];
        const B = this.vertices[cell.verts[(k + 1) % n]];
        const existing = this.creases.get(key);
        if (existing && existing.frozen) continue;
        this.creases.set(key, {
          pts: warpCrease(A[0], A[1], B[0], B[1], key, this.creaseSeed, WARP_AMP, WARP_FREQ),
          frozen: false
        });
      }
    }
    for (const key of [...this.creases.keys()]) {
      if (!live.has(key) && !this.creases.get(key).frozen) this.creases.delete(key);
    }

    // pass 2 — assemble cell paths OUT OF creases, never independently
    for (const s of rendered) {
      const cell = this.raw.get(s.id);
      const prev = this.cells.get(s.id);
      if (!cell || cell.verts.length < 3) { this.cells.delete(s.id); continue; }

      const n = cell.verts.length;
      const runs = [], keys = [];
      for (let k = 0; k < n; k++) {
        const A = this.vertices[cell.verts[k]];
        const B = this.vertices[cell.verts[(k + 1) % n]];
        const j = cell.owners[k];
        if (j < 0) { runs.push([A, B]); keys.push("-"); continue; }
        const key = creaseKey(s.id, j);
        const cr = this.creases.get(key);
        if (!cr) { runs.push([A, B]); keys.push("-"); continue; }
        // orientation by coordinate, not by vertex id — ids are re-interned every rebuild
        const head = cr.pts[0];
        const forward = Math.hypot(head[0] - A[0], head[1] - A[1]) <=
                        Math.hypot(head[0] - B[0], head[1] - B[1]);
        runs.push(forward ? cr.pts : [...cr.pts].slice().reverse());
        keys.push(key);
      }

      const frozen = Boolean(prev?.frozenPath);
      this.cells.set(s.id, {
        id: s.id,
        seed: s,
        runs: frozen ? prev.frozenRuns : runs,
        keys: frozen ? prev.frozenKeys : keys,
        path: prev?.frozenPath ?? pathFromRuns(runs),
        frozenPath: prev?.frozenPath ?? null,
        frozenRuns: prev?.frozenRuns ?? null,
        frozenKeys: prev?.frozenKeys ?? null,
        frozenCentroid: prev?.frozenCentroid ?? null,
        centroid: frozen ? prev.frozenCentroid : (polyCentroid(cell.verts, this.vertices) || [s.x, s.y])
      });
    }
  }

  /* freeze what the user actually saw, before anything else moves.
   *
   * the pin rule has to fire HERE, not after the next rebuild. a ghost's outer
   * creases border LOOSE seeds; freeze those creases while their far side is
   * still ephemeral and the next dropLoose() leaves them welded to an edge that
   * no longer exists. so: pin the whole neighbourhood first, then freeze. */
  commit(id) {
    for (const nid of this.neighbours.get(id) || []) {
      const n = this.seeds.get(nid);
      if (!n || n.tier === "open") continue;
      n.tier = "ghost";
      n.pinned = true;
    }
    const self = this.seeds.get(id);
    if (self && !self.committed) {
      self.committed = true;
      this.openOrder.push(id);   // semantic drift follows the most recent fold
    }
    const cell = this.cells.get(id);
    if (!cell) return;
    cell.frozenRuns = cell.runs.map(run => run.map(point => [...point]));
    cell.frozenKeys = [...cell.keys];
    cell.frozenCentroid = [...cell.centroid];
    cell.frozenPath = pathFromRuns(cell.runs);
    cell.path = cell.frozenPath;
    for (const key of cell.keys) {
      const cr = this.creases.get(key);
      if (cr) cr.frozen = true;
    }
  }

  /* ---------------- the unfold ---------------- */

  unfold(id) {
    const s = this.seeds.get(id);
    if (!s || s.tier !== "ghost") return false;

    s.tier = "open";
    s.pinned = true;
    this.commit(id);          // committed at the shape it was wearing when touched

    this.creaseSeed++;        // every unfrozen crease re-derives from here
    this.grow();
    this.unfolds++;
    return true;
  }

  /* Re-crease is the explicit exception to frozen-open geometry. Seed positions
     stay fixed; only every live crease's warp is regenerated, then the new
     paths are committed immediately as the sheet's next stable state. */
  recrease() {
    const openIds = [...this.seeds.values()]
      .filter(seed => seed.tier === "open")
      .map(seed => seed.id);
    for (const cell of this.cells.values()) {
      cell.frozenPath = null;
      cell.frozenRuns = null;
      cell.frozenKeys = null;
      cell.frozenCentroid = null;
    }
    for (const crease of this.creases.values()) crease.frozen = false;
    this.creaseSeed++;
    this.rebuild();
    for (const id of openIds) this.commit(id);
  }

  bounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of this.cells.values()) {
      for (const run of c.runs) for (const [x, y] of run) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (!isFinite(minX)) return { minX: -CELL, minY: -CELL, maxX: CELL, maxY: CELL };
    return { minX, minY, maxX, maxY };
  }

  rendered() {
    return [...this.cells.values()].filter(c => c.seed.tier !== "loose");
  }
}
