import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { Sheet } from "../src/sheet.js";

const UNFOLDS = 100;
const TARGET = Object.freeze({ totalMs: 30_000, p95Ms: 750, maxMs: 2_000 });
const TOLERANCE = 0.01;

function distance(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

function sameRun(a, b) {
  if (a.length !== b.length) return false;
  const forward = a.every((point, index) => distance(point, b[index]) < TOLERANCE);
  const reverse = a.every((point, index) => distance(point, b[b.length - 1 - index]) < TOLERANCE);
  return forward || reverse;
}

function assertFinalInvariants(sheet) {
  const openIds = [...sheet.seeds.values()].filter(seed => seed.tier === "open").map(seed => seed.id);
  assert.equal(new Set(sheet.openOrder).size, sheet.openOrder.length, "open order has duplicates");
  assert.deepEqual(new Set(sheet.openOrder), new Set(openIds), "open order must contain every open seed");
  assert.equal([...sheet.seeds.values()].filter(seed => seed.role === "drawn").length, 1);
  assert.equal([...sheet.seeds.values()].filter(seed => seed.role === "reset").length, 1);

  const shared = new Map();
  for (const cell of sheet.rendered()) {
    assert.ok(cell.runs.length >= 3, `cell ${cell.id} has fewer than three edges`);
    assert.ok(cell.centroid.every(Number.isFinite), `cell ${cell.id} has an invalid centroid`);
    for (let index = 0; index < cell.runs.length; index++) {
      const run = cell.runs[index];
      const next = cell.runs[(index + 1) % cell.runs.length];
      assert.ok(run.length >= 2, `cell ${cell.id} has an empty edge`);
      assert.ok(run.every(point => point.length === 2 && point.every(Number.isFinite)),
        `cell ${cell.id} has a non-finite edge point`);
      assert.ok(distance(run.at(-1), next[0]) < TOLERANCE,
        `cell ${cell.id} has an open seam at edge ${index}`);
      const key = cell.keys[index];
      if (key === "-") continue;
      if (!shared.has(key)) shared.set(key, []);
      shared.get(key).push({ id: cell.id, run });
    }

    if (cell.seed.tier === "open") {
      assert.equal(cell.seed.pinned, true, `open seed ${cell.id} is not pinned`);
      assert.equal(cell.seed.committed, true, `open seed ${cell.id} is not committed`);
      assert.equal(cell.path, cell.frozenPath, `open cell ${cell.id} is not frozen`);
      assert.ok(cell.frozenRuns && cell.frozenKeys && cell.frozenCentroid,
        `open cell ${cell.id} has incomplete frozen geometry`);
      for (const key of cell.keys) {
        if (key !== "-") assert.equal(sheet.creases.get(key)?.frozen, true,
          `open crease ${key} is not frozen`);
      }
      for (const neighbourId of sheet.neighbours.get(cell.id) || []) {
        const neighbour = sheet.seeds.get(neighbourId);
        assert.ok(neighbour, `open cell ${cell.id} has a missing neighbour`);
        assert.notEqual(neighbour.tier, "loose", `loose seed ${neighbourId} touches open cell ${cell.id}`);
        assert.equal(neighbour.pinned, true, `neighbour ${neighbourId} of open cell ${cell.id} is not pinned`);
      }
    } else {
      assert.equal(cell.seed.tier, "ghost");
      assert.equal(cell.seed.pinned, true, `ghost seed ${cell.id} is not pinned`);
    }
  }

  for (const [key, edges] of shared) {
    assert.ok(edges.length <= 2, `crease ${key} belongs to more than two rendered cells`);
    if (edges.length === 2) assert.ok(sameRun(edges[0].run, edges[1].run),
      `crease ${key} disagrees between cells ${edges[0].id} and ${edges[1].id}`);
  }
}

test("100-unfold shipping gate meets timing and geometry invariants", { timeout: 45_000 }, t => {
  const sheet = new Sheet(123456789);
  const frozenPaths = new Map(sheet.rendered()
    .filter(cell => cell.seed.tier === "open")
    .map(cell => [cell.id, cell.path]));
  const durations = [];

  for (let step = 0; step < UNFOLDS; step++) {
    const ghosts = sheet.rendered().filter(cell => cell.seed.tier === "ghost");
    assert.ok(ghosts.length, `no frontier at unfold ${step + 1}`);
    const outward = ghosts.reduce((best, cell) =>
      Math.hypot(cell.seed.x, cell.seed.y) > Math.hypot(best.seed.x, best.seed.y) ? cell : best);
    const target = step % 5 === 0 ? outward : ghosts[(step * 17) % ghosts.length];
    const started = performance.now();
    assert.equal(sheet.unfold(target.id), true);
    durations.push(performance.now() - started);

    for (const [id, path] of frozenPaths) {
      assert.equal(sheet.cells.get(id)?.path, path, `open cell ${id} moved at unfold ${step + 1}`);
    }
    frozenPaths.set(target.id, sheet.cells.get(target.id).path);
  }

  assert.equal(sheet.unfolds, UNFOLDS);
  assert.equal(sheet.openOrder.length, UNFOLDS + 2);
  assertFinalInvariants(sheet);

  const sorted = durations.toSorted((a, b) => a - b);
  const total = durations.reduce((sum, value) => sum + value, 0);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  const max = sorted.at(-1);
  t.diagnostic(`100 unfolds: ${total.toFixed(1)} ms total, ${p95.toFixed(1)} ms p95, ${max.toFixed(1)} ms max`);
  assert.ok(total <= TARGET.totalMs, `total ${total.toFixed(1)} ms exceeds ${TARGET.totalMs} ms`);
  assert.ok(p95 <= TARGET.p95Ms, `p95 ${p95.toFixed(1)} ms exceeds ${TARGET.p95Ms} ms`);
  assert.ok(max <= TARGET.maxMs, `max ${max.toFixed(1)} ms exceeds ${TARGET.maxMs} ms`);
});
