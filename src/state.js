/* persistence — plica
 *
 * One stable key holds a versioned record. localStorage writes are atomic. If
 * the full record exceeds the available quota, image URLs are omitted first;
 * geometry and authored text are never traded away to make the save fit.
 */

export const STORAGE_KEY = "plica.sheet";
export const STATE_VERSION = 1;
const MAX_CHARS = 4_000_000;

function languageState(language) {
  return {
    reservoir: language.reservoir.map(fragment => ({ ...fragment, words: [...fragment.words] })),
    recentWords: [...language.recentWords.entries()],
    recentTitles: [...language.recentTitles],
    recentPullSources: [...language.recentPullSources],
    recentImageQueries: [...language.recentImageQueries],
    recentImageUrls: [...language.recentImageUrls],
    accreted: [...language.accreted]
  };
}

export function captureState({ sheet, leaves, camera, language }) {
  return {
    kind: "plica-sheet",
    version: STATE_VERSION,
    savedAt: Date.now(),
    sheet: sheet.toState(),
    leaves: [...leaves.entries()].map(([id, leaf]) => [id, {
      ...leaf,
      lines: leaf.lines ? [...leaf.lines] : undefined,
      images: leaf.images ? [...leaf.images] : undefined
    }]),
    camera: {
      center: [...camera.center],
      scale: camera.scale,
      manual: camera.manual
    },
    language: languageState(language)
  };
}

function withoutImages(snapshot) {
  return {
    ...snapshot,
    imagesOmitted: true,
    leaves: snapshot.leaves.map(([id, leaf]) => [id, leaf.images?.length
      ? { ...leaf, images: [], imagesOmitted: true }
      : leaf])
  };
}

function write(storage, snapshot) {
  const text = JSON.stringify(snapshot);
  if (text.length > MAX_CHARS) throw new Error("state exceeds persistence cap");
  storage.setItem(STORAGE_KEY, text);
  return text.length;
}

export function saveState(storage, snapshot) {
  try {
    return { saved: true, imagesOmitted: false, chars: write(storage, snapshot) };
  } catch {
    try {
      const compact = withoutImages(snapshot);
      return { saved: true, imagesOmitted: true, chars: write(storage, compact) };
    } catch {
      return { saved: false, imagesOmitted: true, chars: 0 };
    }
  }
}

function validRecord(record) {
  return record && record.kind === "plica-sheet" && record.version === STATE_VERSION &&
    record.sheet && Array.isArray(record.leaves) && record.camera && record.language;
}

export function loadState(storage) {
  let raw = null;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const record = JSON.parse(raw);
    if (!validRecord(record)) throw new Error("unsupported state");
    return record;
  } catch {
    try { storage.removeItem(STORAGE_KEY); } catch { /* storage is unavailable */ }
    return null;
  }
}

export function clearState(storage) {
  try { storage.removeItem(STORAGE_KEY); } catch { /* storage is unavailable */ }
}

const strings = value => Array.isArray(value) && value.every(item => typeof item === "string");

export function restoreLanguage(language, state) {
  if (!state || !Array.isArray(state.reservoir) || !Array.isArray(state.recentWords) ||
      !strings(state.recentTitles) || !strings(state.recentPullSources) ||
      !strings(state.recentImageQueries) || !strings(state.recentImageUrls) || !strings(state.accreted)) {
    throw new Error("invalid language state");
  }
  const words = new Map();
  for (const entry of state.recentWords) {
    const [word, heat] = Array.isArray(entry) ? entry : [];
    if (typeof word !== "string" || !Number.isFinite(heat)) throw new Error("invalid word memory");
    words.set(word, heat);
  }
  if (!state.reservoir.every(fragment => fragment && typeof fragment.text === "string" &&
      Array.isArray(fragment.words) && fragment.words.every(word => typeof word === "string"))) {
    throw new Error("invalid reservoir state");
  }
  language.reservoir = state.reservoir.map(fragment => ({ ...fragment, words: [...fragment.words] }));
  language.recentWords = words;
  language.recentTitles = new Set(state.recentTitles);
  language.recentPullSources = [...state.recentPullSources];
  language.recentImageQueries = [...state.recentImageQueries];
  language.recentImageUrls = [...state.recentImageUrls];
  language.accreted = [...state.accreted];
}
