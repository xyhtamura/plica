import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { Language, OPERATOR_NAMES, parseCutlineCsv } from "../src/language.js";

const LIVE_CSV = new URL("../../cutline/okkategorakle.csv", import.meta.url);

test("the live cutline CSV satisfies plica's ancestor contract", async () => {
  const text = await readFile(LIVE_CSV, "utf8");
  const deck = parseCutlineCsv(text);

  assert.equal(deck.rows.length, 137);
  assert.equal(deck.names.length, 137, "card names must remain unique");
  assert.equal(deck.operators.length, 20);
  assert.equal(deck.ancestors.length, 117);
  assert.deepEqual(new Set(deck.operators.map(name => name.toLowerCase())), OPERATOR_NAMES);
  assert.deepEqual(deck.rows.slice(0, 123).map(row => Number(row.key)),
    Array.from({ length: 123 }, (_, index) => index + 1));
  assert.equal(deck.rows[123].key, "NEW");
  assert.ok(deck.rows.slice(124).every(row => row.key === ""));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(text, { status: 200 });
  try {
    const language = new Language(() => 0.5);
    assert.equal(await language.loadAncestors("contract://cutline"), true);
    assert.deepEqual(language.ancestors, deck.ancestors);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the cutline parser preserves commas in names and rejects malformed rows", () => {
  const parsed = parseCutlineCsv("1,Name, With Comma\nNEW,Another Name\n");
  assert.deepEqual(parsed.ancestors, ["Name, With Comma", "Another Name"]);
  assert.throws(() => parseCutlineCsv("1,Valid\nmalformed"), /line 2 has no comma/);
  assert.throws(() => parseCutlineCsv("1,"), /line 1 has no name/);
});

test("the built-in ancestor deck survives an offline cutline request", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("network unavailable"); };
  try {
    const language = new Language(() => 0.5);
    const fallback = [...language.ancestors];
    assert.equal(await language.loadAncestors("offline://cutline"), false);
    assert.deepEqual(language.ancestors, fallback);
    assert.equal(language.ancestors.length, 17);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
