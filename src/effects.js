/* effects — plica
 *
 * The beta keeps three effects. Their targets are computed from the current
 * Voronoi neighbour graph, so the same mark has different reach depending on
 * where the sheet grew around it.
 */

import { hash32 } from "./rng.js";

export const EFFECTS = Object.freeze([
  Object.freeze({
    id: "reverse-ring",
    glyph: "↺",
    gloss: "reverse the words in touching folds"
  }),
  Object.freeze({
    id: "watermark",
    glyph: "◈",
    gloss: "show what nearby ghosts hold"
  }),
  Object.freeze({
    id: "recrease",
    glyph: "∿",
    gloss: "redraw every crease on the sheet"
  })
]);

const EFFECT_BY_ID = new Map(EFFECTS.map(effect => [effect.id, effect]));
const SPENT_KINDS = ["drawn", "written", "mixed", "plate"];

export function effectFor(seedId, sheetSeed) {
  return EFFECTS[hash32(seedId, sheetSeed, 0xefec) % EFFECTS.length];
}

export function effectById(id) { return EFFECT_BY_ID.get(id) || null; }

export function spentKindFor(seedId, sheetSeed) {
  return SPENT_KINDS[hash32(seedId, sheetSeed, 0x5eedc0de) % SPENT_KINDS.length];
}

/* Every returned id is 1..distance edges away from origin. The origin itself
   is excluded even if a cycle reaches it again. */
export function withinRings(sheet, originId, distance) {
  const found = new Set();
  let frontier = new Set([originId]);
  for (let depth = 0; depth < distance; depth++) {
    const next = new Set();
    for (const id of frontier) {
      for (const neighbour of sheet.neighbours.get(id) || []) {
        if (neighbour === originId || found.has(neighbour)) continue;
        found.add(neighbour);
        next.add(neighbour);
      }
    }
    frontier = next;
    if (!frontier.size) break;
  }
  return found;
}

function reverseWords(value) {
  return String(value).trim().split(/\s+/).filter(Boolean).reverse().join(" ");
}

function reverseRing(sheet, leaves, originId) {
  const changedLeaves = [];
  for (const id of withinRings(sheet, originId, 1)) {
    if (sheet.seeds.get(id)?.tier !== "open") continue;
    const leaf = leaves.get(id);
    if (!leaf) continue;
    let changed = false;
    if (typeof leaf.title === "string" && leaf.title.trim()) {
      leaf.title = reverseWords(leaf.title);
      changed = true;
    }
    if (Array.isArray(leaf.lines) && leaf.lines.some(line => String(line).trim())) {
      leaf.lines = leaf.lines.map(reverseWords);
      changed = true;
    }
    if (changed) changedLeaves.push(id);
  }
  return { changedLeaves, changedTells: [], geometryBefore: null };
}

function watermark(sheet, effectState, originId) {
  const changedTells = [];
  for (const id of withinRings(sheet, originId, 2)) {
    if (sheet.seeds.get(id)?.tier !== "ghost" || effectState.truthfulTells.has(id)) continue;
    effectState.truthfulTells.add(id);
    changedTells.push(id);
  }
  return { changedLeaves: [], changedTells, geometryBefore: null };
}

function recrease(sheet) {
  const geometryBefore = new Map(sheet.rendered().map(cell => [cell.id, cell.runs]));
  sheet.recrease();
  return { changedLeaves: [], changedTells: [], geometryBefore };
}

export function deployEffect({ sheet, leaves, effectState, originId, effectId }) {
  if (!EFFECT_BY_ID.has(effectId)) return null;
  if (effectId === "reverse-ring") return reverseRing(sheet, leaves, originId);
  if (effectId === "watermark") return watermark(sheet, effectState, originId);
  return recrease(sheet);
}

export function restoreEffectState(saved, sheet) {
  const truthfulTells = new Set();
  if (!saved) return { truthfulTells };
  if (!Array.isArray(saved.truthfulTells)) throw new Error("invalid effect state");
  for (const id of saved.truthfulTells) {
    if (!Number.isInteger(id) || !sheet.seeds.has(id)) throw new Error("invalid truthful tell");
    truthfulTells.add(id);
  }
  return { truthfulTells };
}
