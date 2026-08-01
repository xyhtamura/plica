import test from "node:test";
import assert from "node:assert/strict";

import { Sheet } from "../src/sheet.js";
import {
  STORAGE_KEY,
  STATE_VERSION,
  captureState,
  clearState,
  loadState,
  restoreLanguage,
  saveState
} from "../src/state.js";

class MemoryStorage {
  constructor({ failFirstWrite = false } = {}) {
    this.values = new Map();
    this.failFirstWrite = failFirstWrite;
  }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) {
    if (this.failFirstWrite) {
      this.failFirstWrite = false;
      throw new Error("quota exceeded");
    }
    this.values.set(key, value);
  }
  removeItem(key) { this.values.delete(key); }
}

function makeLanguage() {
  return {
    reservoir: [{ text: "folded paper remembers", words: ["folded", "paper", "remembers"], source: "test", url: "", entry: "test:1", uses: 2 }],
    recentWords: new Map([["paper", 1.5]]),
    recentTitles: new Set(["crease"]),
    recentPullSources: ["source:1"],
    recentImageQueries: ["paper crease"],
    recentImageUrls: ["https://example.test/old.jpg"],
    accreted: ["Crease Memory"]
  };
}

function makeSheet(unfolds = 12) {
  const sheet = new Sheet(123456789);
  for (let i = 0; i < unfolds; i++) {
    const ghosts = sheet.rendered().filter(cell => cell.seed.tier === "ghost");
    assert.ok(ghosts.length);
    assert.equal(sheet.unfold(ghosts[i % ghosts.length].id), true);
  }
  return sheet;
}

function makeLeaves(sheet) {
  return new Map(sheet.openOrder.map(id => {
    const leaf = {
      id,
      kind: id === 4 ? "effect" : "written",
      state: "ready",
      lines: [`fold ${id}`],
      images: id === 0 ? ["https://example.test/current.jpg"] : []
    };
    if (id === 4) leaf.spent = false;
    return [id, leaf];
  }));
}

test("sheet, leaves, camera, and language survive a versioned round trip", () => {
  const sheet = makeSheet();
  const leaves = makeLeaves(sheet);
  const language = makeLanguage();
  const camera = { center: [142.5, -31.25], scale: 1.75, manual: true };
  const beforePaths = new Map(sheet.rendered()
    .filter(cell => cell.seed.tier === "open")
    .map(cell => [cell.id, cell.path]));

  const snapshot = captureState({ sheet, leaves, camera, language });
  const storage = new MemoryStorage();
  assert.deepEqual(saveState(storage, snapshot).saved, true);

  const record = loadState(storage);
  assert.equal(record.version, STATE_VERSION);
  assert.deepEqual(record.camera, camera);

  const restored = Sheet.fromState(record.sheet);
  assert.equal(restored.sheetSeed, sheet.sheetSeed);
  assert.equal(restored.creaseSeed, sheet.creaseSeed);
  assert.equal(restored.nextId, sheet.nextId);
  assert.equal(restored.unfolds, sheet.unfolds);
  assert.deepEqual(restored.openOrder, sheet.openOrder);
  assert.deepEqual([...restored.seeds.values()], [...sheet.seeds.values()]);
  for (const [id, path] of beforePaths) assert.equal(restored.cells.get(id)?.path, path);

  const restoredLanguage = makeLanguage();
  restoredLanguage.reservoir = [];
  restoreLanguage(restoredLanguage, record.language);
  assert.deepEqual(restoredLanguage.reservoir, language.reservoir);
  assert.deepEqual([...restoredLanguage.recentWords], [...language.recentWords]);
  assert.deepEqual([...restoredLanguage.recentTitles], [...language.recentTitles]);
  assert.deepEqual(record.leaves, [...leaves.entries()]);
});

test("quota failure retries without image URLs", () => {
  const sheet = makeSheet(2);
  const leaves = makeLeaves(sheet);
  const snapshot = captureState({
    sheet,
    leaves,
    camera: { center: [0, 0], scale: 1, manual: false },
    language: makeLanguage()
  });
  const storage = new MemoryStorage({ failFirstWrite: true });
  const result = saveState(storage, snapshot);
  assert.deepEqual({ saved: result.saved, imagesOmitted: result.imagesOmitted },
    { saved: true, imagesOmitted: true });
  const record = loadState(storage);
  assert.equal(record.imagesOmitted, true);
  const drawn = record.leaves.find(([id]) => id === 0)[1];
  assert.deepEqual(drawn.images, []);
  assert.equal(drawn.imagesOmitted, true);
});

test("invalid and unsupported records are removed", () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, "not json");
  assert.equal(loadState(storage), null);
  assert.equal(storage.getItem(STORAGE_KEY), null);

  storage.setItem(STORAGE_KEY, JSON.stringify({ kind: "plica-sheet", version: 999 }));
  assert.equal(loadState(storage), null);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test("reset removes the saved sheet", () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({ kind: "plica-sheet", version: STATE_VERSION }));
  clearState(storage);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test("frozen paths cannot disagree with their saved creases", () => {
  const state = makeSheet(3).toState();
  state.frozenCells[0].path += "Z";
  assert.throws(() => Sheet.fromState(state), /frozen cell/);
});
