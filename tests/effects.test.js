import test from "node:test";
import assert from "node:assert/strict";

import { Sheet } from "../src/sheet.js";
import {
  EFFECTS,
  deployEffect,
  effectFor,
  restoreEffectState,
  withinRings
} from "../src/effects.js";

function grownSheet(unfolds = 6) {
  const sheet = new Sheet(246813579);
  for (let step = 0; step < unfolds; step++) {
    const ghosts = sheet.rendered().filter(cell => cell.seed.tier === "ghost");
    assert.ok(ghosts.length);
    assert.equal(sheet.unfold(ghosts[step % ghosts.length].id), true);
  }
  return sheet;
}

function leavesFor(sheet) {
  return new Map(sheet.openOrder.map(id => [id, {
    id,
    kind: "written",
    state: "ready",
    title: `title fold ${id}`,
    lines: [`alpha beta ${id}`, "gamma delta"],
    images: []
  }]));
}

function geometryFailures(sheet, tolerance = 0.01) {
  const seen = new Map();
  const failures = [];
  for (const cell of sheet.rendered()) {
    for (let index = 0; index < cell.runs.length; index++) {
      const run = cell.runs[index];
      const next = cell.runs[(index + 1) % cell.runs.length];
      if (Math.hypot(run.at(-1)[0] - next[0][0], run.at(-1)[1] - next[0][1]) > tolerance) {
        failures.push(`seam:${cell.id}:${index}`);
      }
      const key = cell.keys[index];
      if (key === "-") continue;
      if (!seen.has(key)) { seen.set(key, run); continue; }
      const other = seen.get(key);
      const same = other.length === run.length && (
        other.every((point, i) => Math.hypot(point[0] - run[i][0], point[1] - run[i][1]) < tolerance) ||
        other.every((point, i) => {
          const reverse = run[run.length - 1 - i];
          return Math.hypot(point[0] - reverse[0], point[1] - reverse[1]) < tolerance;
        })
      );
      if (!same) failures.push(`shared:${key}`);
    }
  }
  return failures;
}

test("only the three beta effects can be assigned", () => {
  assert.deepEqual(EFFECTS.map(effect => effect.id), ["reverse-ring", "watermark", "recrease"]);
  const assigned = new Set(Array.from({ length: 100 }, (_, id) => effectFor(id, 1234).id));
  assert.deepEqual(assigned, new Set(EFFECTS.map(effect => effect.id)));
});

test("reverse-ring changes text only in touching open folds", () => {
  const sheet = grownSheet(5);
  const leaves = leavesFor(sheet);
  const originId = sheet.openOrder.at(-1);
  const targets = [...withinRings(sheet, originId, 1)]
    .filter(id => sheet.seeds.get(id)?.tier === "open");
  const before = new Map([...leaves].map(([id, leaf]) => [id, structuredClone(leaf)]));

  const result = deployEffect({
    sheet, leaves, originId, effectId: "reverse-ring",
    effectState: { truthfulTells: new Set() }
  });

  assert.deepEqual(new Set(result.changedLeaves), new Set(targets));
  for (const [id, leaf] of leaves) {
    if (targets.includes(id)) {
      assert.equal(leaf.title, `${id} fold title`);
      assert.deepEqual(leaf.lines, [`${id} beta alpha`, "delta gamma"]);
    } else {
      assert.deepEqual(leaf, before.get(id));
    }
  }
});

test("watermark makes ghost tells truthful within two rings", () => {
  const sheet = grownSheet(4);
  const originId = sheet.openOrder.at(-1);
  const expected = [...withinRings(sheet, originId, 2)]
    .filter(id => sheet.seeds.get(id)?.tier === "ghost");
  const effectState = restoreEffectState(null, sheet);

  const first = deployEffect({
    sheet, leaves: leavesFor(sheet), effectState, originId, effectId: "watermark"
  });
  assert.deepEqual(new Set(first.changedTells), new Set(expected));
  assert.deepEqual(effectState.truthfulTells, new Set(expected));

  const second = deployEffect({
    sheet, leaves: leavesFor(sheet), effectState, originId, effectId: "watermark"
  });
  assert.deepEqual(second.changedTells, []);
});

test("re-crease changes paths, preserves sites, and freezes the new sheet", () => {
  const sheet = grownSheet(10);
  const leaves = leavesFor(sheet);
  const originId = sheet.openOrder.at(-1);
  const seedTable = JSON.stringify([...sheet.seeds.values()]);
  const openOrder = [...sheet.openOrder];
  const beforePaths = new Map(sheet.rendered()
    .filter(cell => cell.seed.tier === "open")
    .map(cell => [cell.id, cell.path]));
  const creaseSeed = sheet.creaseSeed;

  const result = deployEffect({
    sheet, leaves, originId, effectId: "recrease",
    effectState: { truthfulTells: new Set() }
  });

  assert.ok(result.geometryBefore instanceof Map);
  assert.equal(sheet.creaseSeed, creaseSeed + 1);
  assert.equal(JSON.stringify([...sheet.seeds.values()]), seedTable);
  assert.deepEqual(sheet.openOrder, openOrder);
  assert.ok([...beforePaths].some(([id, path]) => sheet.cells.get(id)?.path !== path));
  assert.ok(sheet.rendered().filter(cell => cell.seed.tier === "open")
    .every(cell => cell.path === cell.frozenPath && cell.frozenRuns));
  assert.deepEqual(geometryFailures(sheet), []);

  const frozen = new Map(sheet.rendered()
    .filter(cell => cell.seed.tier === "open")
    .map(cell => [cell.id, cell.path]));
  const nextGhost = sheet.rendered().find(cell => cell.seed.tier === "ghost");
  assert.equal(sheet.unfold(nextGhost.id), true);
  for (const [id, path] of frozen) assert.equal(sheet.cells.get(id)?.path, path);
});
