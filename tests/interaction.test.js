import test from "node:test";
import assert from "node:assert/strict";

import { Camera } from "../src/camera.js";
import { applyPinch, pinchFrame } from "../src/gestures.js";
import { INTRO_KEY, rememberIntro, shouldShowIntro } from "../src/intro.js";

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

test("the introduction is remembered separately from sheet state", () => {
  const storage = new MemoryStorage();
  assert.equal(shouldShowIntro(storage), true);
  rememberIntro(storage);
  assert.equal(storage.getItem(INTRO_KEY), "seen");
  assert.equal(shouldShowIntro(storage), false);
  assert.equal(shouldShowIntro(null), true);
});

test("a pinch frame uses the midpoint and distance between two pointers", () => {
  const frame = pinchFrame(new Map([
    [7, { x: 20, y: 30 }],
    [9, { x: 80, y: 110 }]
  ]));
  assert.deepEqual(frame, { x: 50, y: 70, distance: 100 });
  assert.equal(pinchFrame(new Map([[7, { x: 20, y: 30 }]])), null);
});

test("pinch zoom keeps the midpoint world position under the moving fingers", () => {
  const camera = new Camera({ setAttribute() {} }, 100);
  camera.tx = camera.x = 12;
  camera.ty = camera.y = -8;
  camera.tk = camera.k = 1.25;
  const before = { x: 140, y: 90, distance: 80 };
  const after = { x: 170, y: 115, distance: 144 };
  const world = [(before.x - camera.tx) / camera.tk, (before.y - camera.ty) / camera.tk];

  applyPinch(camera, before, after);

  assert.ok(Math.abs(world[0] * camera.tk + camera.tx - after.x) < 1e-9);
  assert.ok(Math.abs(world[1] * camera.tk + camera.ty - after.y) < 1e-9);
  assert.equal(camera.tk, 2.25);
  assert.equal(camera.manual, true);
});
