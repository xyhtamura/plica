/* language — plica
 *
 * adapted from cutline, not shared with it. the two pieces have different
 * mechanics and are deployed as separate repos, so the code is plica's own and
 * allowed to drift. what IS shared is the world: okkategorakle.csv is fetched
 * live from ../cutline/, so the ancestors of both pieces stay one deck.
 *
 * the difference from cutline is register. cutline composes a verse — four or
 * more lines, spliced. plica composes a FRAGMENT: one or two short lines that
 * read like something torn off. windows are shorter, splicing is rarer, and a
 * leaf is allowed to be a single phrase.
 */

const RESERVOIR_MAX = 300;
const ANCESTORS_URL = "../cutline/okkategorakle.csv";

/* cutline's operator cards are mechanics, not world — plica has its own */
const OPERATOR_NAMES = new Set([
  "shuffle", "replace first", "replace last", "reinterpret first", "reinterpret last",
  "return first", "return last", "or", "and", "xor", "draw two cards",
  "skip the next card", "remix", "mashup 2", "mashup 3",
  "round eye", "vertical eye", "horizontal eye", "w-eye", "compound eye"
]);

/* if the csv can't be reached, the sheet still has a world to draw on */
const FALLBACK_ANCESTORS = [
  "Blue Honey", "Lighthouse Vanishing", "Fordite Monolith", "Forest Stairs",
  "Ancient Faucet", "Cathedral of Pines", "Smell Memory", "Colony Collapse",
  "Seed Vault", "Moonmilk", "Sea Change", "Triple Point", "Electric Sheep",
  "Fog Machine of War", "Dandelion Fireworks", "Midnight Fridge", "Deep Dream"
];

export const STOP = new Set(("the a an and or but of to in on at for with from by as is are was were be been" +
  " it its this that these those into over under about after before during their your our his her not" +
  " has have had will would can could may might also more most other some such only than then when where" +
  " which while who whom what how all any both each few own same so too very just there here out up down").split(" "));

const NOISE_WORDS = ("sphagnum orrery molybdenum cenotaph isinglass vitrine mycelium ossuary petrichor" +
  " chitin gnomon lacuna palimpsest tessitura umbra sastrugi nacre grimoire loess phlogiston tektite" +
  " apophenia bezoar cassowary dolmen eelgrass fumarole gossamer hyphae ichor jacquard karst limn" +
  " midden noctiluca oubliette pellucid quipu rhizome selenite thurible undertow verglas whalefall" +
  " xenolith yardang zoetrope bioluminescence murmuration spandrel anechoic sfumato katabatic").split(" ");

/* wider than cutline's. a fold shows ONE short line, so a fragment carrying
   dictionary or citation debris has nowhere to hide — cutline stacked four
   lines and the noise averaged out. */
const JUNK = /[<>{}=†‡§¶]|https?:|www\.|\d{4}|\b(retrieved|isbn|doi|archived|redirect|citation needed|edit|category|pp?\.\s*\d)\b/i;

/* ending a fragment on one of these leaves it dangling mid-thought */
const DANGLING = new Set(("and or of the a an to in on at for with from by as is are was were that which" +
  " but nor so yet than then when where who whom whose while its his her their our your my").split(" "));

const rand = a => a[Math.floor(Math.random() * a.length)];
const chance = p => Math.random() < p;
const shuffled = a => [...a].sort(() => Math.random() - 0.5);
const memoryKey = v => String(v || "").toLowerCase().replace(/\s+/g, " ").trim();
const titleCase = w => w.charAt(0).toUpperCase() + w.slice(1);

export function cleanWords(text) {
  return String(text || "").toLowerCase()
    .split(/[^a-z0-9'’-]+/i)
    .map(w => w.replace(/^['’-]+|['’-]+$/g, ""))
    .filter(w => w.length > 2);
}

function decodeEntities(text) {
  const el = document.createElement("textarea");
  el.innerHTML = text;
  return el.value;
}

function stripTags(text) {
  return String(text || "").replace(/<[^>]*>/g, " ").replace(/<[^>]*$/, " ").replace(/^[^<]*>/, " ");
}

function rememberRecent(list, value, max) {
  if (!value) return;
  const at = list.indexOf(value);
  if (at >= 0) list.splice(at, 1);
  list.push(value);
  while (list.length > max) list.shift();
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export class Language {
  /* porosity / drift / chaos are properties of the SHEET, drawn once and never
     shown. each found paper has its own temperament. */
  constructor(rng = Math.random) {
    this.porosity = 0.45 + rng() * 0.45;
    this.drift = 0.2 + rng() * 0.6;
    this.chaos = 0.15 + rng() * 0.5;

    this.reservoir = [];
    this.recentWords = new Map();
    this.recentTitles = new Set();
    this.recentPullSources = [];
    this.recentImageQueries = [];
    this.recentImageUrls = [];
    this.ancestors = FALLBACK_ANCESTORS.slice();
    this.accreted = [];
  }

  /* the shared world. same-origin on the live site (xyhtamura.github.io/cutline)
     and when serving F:\xyh from the root locally, so one relative path
     covers both. a failure here is survivable — see FALLBACK_ANCESTORS. */
  async loadAncestors(url = ANCESTORS_URL) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const names = (await res.text())
        .split(/\r?\n/)
        .map(line => line.split(",").slice(1).join(",").trim())
        .filter(Boolean)
        .filter(n => !OPERATOR_NAMES.has(n.toLowerCase()));
      if (names.length) { this.ancestors = [...new Set(names)]; return true; }
    } catch { /* the paper still has a world */ }
    return false;
  }

  seedWord() {
    const pool = this.accreted.length && chance(0.35) ? this.accreted : this.ancestors;
    return rand(pool);
  }

  /* ---------------- reservoir ---------------- */

  addFragment(text, source, url, entry) {
    const clean = decodeEntities(stripTags(text))
      .replace(/_([^_]+)_/g, "$1")     // poetrydb marks emphasis with underscores
      .replace(/\s+/g, " ").trim();
    const words = cleanWords(clean);
    if (words.length < 3 || words.length > 24) return;
    if (JUNK.test(clean)) return;
    if (this.reservoir.some(f => f.text === clean)) return;
    this.reservoir.push({
      text: clean, words, source, url: url || "",
      entry: entry || `${memoryKey(source) || "fragment"}:${memoryKey(clean)}`,
      uses: 0
    });
    while (this.reservoir.length > RESERVOIR_MAX) this.reservoir.shift();
  }

  harvest(text, source, url) {
    const entry = `${memoryKey(source) || "outside"}:${url || memoryKey(text)}`;
    String(text || "")
      .split(/[.;:!?()\[\]{}"«»]|—|–|\|/)
      .forEach(chunk => this.addFragment(chunk, source, url, entry));
  }

  /* composition is hierarchical: each source is ONE entry however many
     fragments it yielded, so a long article can't buy extra lottery tickets */
  groupEntries(pool) {
    const grouped = new Map();
    for (const f of pool) {
      const key = f.entry || `${memoryKey(f.source) || "fragment"}:${memoryKey(f.text)}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(f);
    }
    return [...grouped.entries()];
  }

  score(f) {
    let s = 1 / Math.pow(1 + f.uses, 1.6);
    let overlap = 0;
    for (const w of f.words) if (this.recentWords.has(w)) overlap++;
    s *= 1 - 0.7 * (overlap / f.words.length);
    return Math.max(s, 0.02);
  }

  sample(pool, exclude, entries) {
    const available = pool.filter(f => !exclude.has(f));
    if (!available.length) return null;
    let groups = this.groupEntries(available);
    const unused = groups.filter(([e]) => !entries.has(e));
    if (unused.length) groups = unused;
    const [entry, fragments] = rand(groups);
    entries.add(entry);

    const scores = fragments.map(f => this.score(f));
    let roll = Math.random() * scores.reduce((a, b) => a + b, 0);
    for (let i = 0; i < fragments.length; i++) {
      roll -= scores[i];
      if (roll <= 0) { fragments[i].uses++; return fragments[i]; }
    }
    const last = fragments[fragments.length - 1];
    last.uses++;
    return last;
  }

  decayHeat() {
    for (const [w, h] of this.recentWords) {
      const next = h * 0.6;
      if (next < 0.2) this.recentWords.delete(w); else this.recentWords.set(w, next);
    }
  }

  heatUp(words) {
    for (const w of words) this.recentWords.set(w, (this.recentWords.get(w) || 0) + 1);
  }

  /* ---------------- outside sources (keyless, CORS-open) ---------------- */

  async datamuseWords(seed) {
    const q = encodeURIComponent(seed);
    const [ml, trg] = await Promise.all([
      getJson(`https://api.datamuse.com/words?ml=${q}&max=16`).catch(() => []),
      getJson(`https://api.datamuse.com/words?rel_trg=${encodeURIComponent(cleanWords(seed)[0] || seed)}&max=10`).catch(() => [])
    ]);
    return shuffled([...ml, ...trg].map(x => x.word).filter(Boolean));
  }

  async wikiSearch(query) {
    const data = await getJson("https://en.wikipedia.org/w/api.php?origin=*&format=json&action=query&list=search&srlimit=8&srprop=snippet&srsearch=" + encodeURIComponent(query));
    return (data?.query?.search || []).map(item => ({
      text: item.snippet || "",
      source: item.title,
      url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(item.title.replace(/ /g, "_"))
    }));
  }

  async wikiRandom() {
    const data = await getJson("https://en.wikipedia.org/w/api.php?origin=*&format=json&action=query&generator=random&grnnamespace=0&grnlimit=3&prop=extracts&exintro=1&explaintext=1&exchars=400");
    return Object.values(data?.query?.pages || {}).map(p => ({
      text: p.extract || "",
      source: p.title,
      url: "https://en.wikipedia.org/wiki/" + encodeURIComponent((p.title || "").replace(/ /g, "_"))
    }));
  }

  async poetryRandom() {
    const data = await getJson("https://poetrydb.org/random/1");
    const poem = Array.isArray(data) && data[0];
    if (!poem) return [];
    return shuffled(poem.lines || []).slice(0, 6)
      .map(line => ({ text: line, source: poem.author || "poetrydb", url: "" }));
  }

  async commonsImages(query) {
    const data = await getJson("https://commons.wikimedia.org/w/api.php?origin=*&format=json&action=query&generator=search&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url|mime&iiurlwidth=520&gsrsearch=" + encodeURIComponent(query));
    return Object.values(data?.query?.pages || {})
      .map(p => p.imageinfo?.[0])
      .filter(info => info && /image\/(jpeg|png)/.test(info.mime))
      .map(info => info.thumburl || info.url);
  }

  async openverseImages(query) {
    const data = await getJson("https://api.openverse.org/v1/images/?page_size=10&q=" + encodeURIComponent(query));
    return (data?.results || []).map(r => r.thumbnail || r.url).filter(Boolean);
  }

  async images(terms) {
    const phrases = terms.map(t => cleanWords(t).filter(w => !STOP.has(w)).slice(0, 3).join(" ")).filter(Boolean);
    const words = [...new Set(phrases.flatMap(cleanWords))];
    const candidates = [...new Set([...phrases, ...shuffled(words)])];
    const unseen = candidates.filter(q => !this.recentImageQueries.includes(memoryKey(q)));
    const queries = [...unseen, ...candidates.filter(q => !unseen.includes(q))].slice(0, 2);

    let urls = [];
    for (const q of queries) {
      if (urls.length >= 4) break;
      rememberRecent(this.recentImageQueries, memoryKey(q), 24);
      urls = urls.concat(await this.commonsImages(q).catch(() => []));
    }
    if (urls.length < 3 && queries.length) {
      urls = urls.concat(await this.openverseImages(queries[0]).catch(() => []));
    }
    const fresh = [...new Set(urls)].filter(u => !this.recentImageUrls.includes(u));
    const picked = shuffled(fresh).slice(0, 6);
    picked.forEach(u => rememberRecent(this.recentImageUrls, u, 72));
    return picked;
  }

  /* ---------------- the pull ---------------- */

  async buildQuery(seed) {
    const seedWords = shuffled(cleanWords(seed).filter(w => !STOP.has(w))).slice(0, 2);
    const parts = [...seedWords];
    if (this.drift > 0.05) {
      const related = await this.datamuseWords(seed).catch(() => []);
      parts.push(...related.slice(0, Math.round(this.drift * 2.4)));
    }
    if (chance(this.drift * 0.45)) parts.push(rand(NOISE_WORDS));
    return shuffled(parts).slice(0, 4).join(" ") || seed;
  }

  async pull(seed) {
    const query = await this.buildQuery(seed);
    const jobs = [this.wikiSearch(query).catch(() => [])];
    if (chance(this.porosity * 0.5)) jobs.push(this.wikiRandom().catch(() => []));
    if (chance(0.35)) jobs.push(this.poetryRandom().catch(() => []));

    let results = (await Promise.all(jobs)).flat();
    if (!results.length) {
      const narrow = cleanWords(seed).filter(w => !STOP.has(w)).slice(0, 2).join(" ") || seed;
      results = await this.wikiSearch(narrow).catch(() => []);
    }
    if (!results.length) results = await this.wikiRandom().catch(() => []);

    const unseen = results.filter(r => !this.recentPullSources.includes(memoryKey(r.source)));
    if (unseen.length) results = unseen;
    results = results.slice(0, 5);
    results.forEach(r => rememberRecent(this.recentPullSources, memoryKey(r.source), 24));

    const fresh = [];
    for (const item of results) {
      const before = this.reservoir.length;
      this.harvest(item.text, item.source, item.url);
      for (let i = before; i < this.reservoir.length; i++) fresh.push(this.reservoir[i]);
    }
    return { fresh, sources: results.slice(0, 2) };
  }

  /* ---------------- composition, fragmentary ---------------- */

  /* a window that starts on a stopword reads as a sentence caught mid-stride,
     and one that ends on a connective dangles. cutline could absorb both; a
     single line alone in a fold cannot. so: try a few cuts, keep the cleanest. */
  windowScore(slice) {
    if (!slice.length) return -99;
    const bare = w => String(w).toLowerCase().replace(/[^a-z'’]/g, "");
    let s = 0;
    if (STOP.has(bare(slice[0]))) s -= 2;
    if (DANGLING.has(bare(slice[slice.length - 1]))) s -= 3;
    if (/\d/.test(slice.join(" "))) s -= 2;
    if (slice.some(w => w.length > 18)) s -= 2;
    return s + Math.random() * 0.6;
  }

  /* shorter than cutline's window on purpose — a leaf should read torn, not
     written. two to five words, and the splice is the exception. */
  window(words) {
    const len = Math.min(words.length, 2 + Math.floor(Math.random() * 4));
    const span = Math.max(1, words.length - len + 1);
    let best = null, bestScore = -Infinity;
    for (let attempt = 0; attempt < 5; attempt++) {
      const start = Math.floor(Math.random() * span);
      const candidate = words.slice(start, start + len);
      const score = this.windowScore(candidate);
      if (score > bestScore) { bestScore = score; best = candidate; }
    }
    return best || words.slice(0, len);
  }

  line(pool, exclude, entries) {
    const a = this.sample(pool, exclude, entries);
    if (!a) return null;
    exclude.add(a);
    let words = this.window(a.text.split(/\s+/));

    if (chance(this.chaos * 0.4)) {
      const b = this.sample(pool, exclude, entries);
      if (b) {
        exclude.add(b);
        const cut = 1 + Math.floor(Math.random() * Math.max(1, words.length - 1));
        words = words.slice(0, cut).concat(this.window(b.text.split(/\s+/)));
      }
    }

    let line = words.join(" ").replace(/^[,'"”’\s]+|[,‘“"'\s]+$/g, "");
    if (chance(this.chaos * 0.35)) line = line.toLowerCase();
    if (chance(this.chaos * 0.12)) {
      const parts = line.split(" ");
      const i = Math.floor(Math.random() * parts.length);
      parts[i] = parts[i].toUpperCase();
      line = parts.join(" ");
    }
    return line;
  }

  /* one or two lines. a leaf is allowed to be a single phrase. */
  compose(pool, lineCount = 1 + (Math.random() < 0.45 ? 1 : 0)) {
    const exclude = new Set(), entries = new Set(), lines = [];
    for (let i = 0; i < lineCount * 3 && lines.length < lineCount; i++) {
      const line = this.line(pool, exclude, entries);
      if (line && cleanWords(line).length >= 2) lines.push(line);
    }
    lines.forEach(l => this.heatUp(cleanWords(l).filter(w => !STOP.has(w))));
    return lines;
  }

  titleCandidates(pool) {
    const seen = new Map();
    for (const f of pool) {
      for (const raw of f.text.split(/\s+/)) {
        const w = raw.replace(/[^A-Za-z'’-]/g, "");
        const lower = w.toLowerCase();
        if (w.length < 4 || w.length > 13 || STOP.has(lower)) continue;
        if (this.recentTitles.has(lower)) continue;
        let score = w.length * 0.4 + (/^[A-Z]/.test(w) ? 2 : 0) + Math.random() * 3;
        if (this.recentWords.has(lower)) score -= 2;
        if (!seen.has(lower) || seen.get(lower).score < score) seen.set(lower, { word: lower, score });
      }
    }
    return [...seen.values()].sort((x, y) => y.score - x.score).map(x => x.word);
  }

  title(pool) {
    const entries = this.groupEntries(pool)
      .map(([entry, fragments]) => ({ entry, words: this.titleCandidates(fragments) }))
      .filter(item => item.words.length);
    if (!entries.length) return titleCase(rand(NOISE_WORDS));
    const first = rand(entries);
    const others = entries.filter(i => i.entry !== first?.entry && i.words.some(w => w !== first?.words[0]));
    const second = rand(others.length ? others : entries);
    const a = first?.words[0] || rand(NOISE_WORDS);
    const b = second?.words.find(w => w !== a) || first?.words.find(w => w !== a) || rand(NOISE_WORDS);
    this.recentTitles.add(a); this.recentTitles.add(b);
    if (this.recentTitles.size > 60) this.recentTitles.delete(this.recentTitles.values().next().value);
    const A = titleCase(a), B = titleCase(b);
    const t = rand([`${A} ${B}`, `${A} ${B}`, `${A} of ${B}`, `The ${A} ${B}`, `${A}’s ${B}`]);
    this.accreted.push(t);
    if (this.accreted.length > 60) this.accreted.shift();
    return t;
  }

  /* the pool a single leaf composes from: the seed itself, plus whatever the
     outside gave up, falling back to the reservoir when the net is quiet */
  async leafPool(seed) {
    this.decayHeat();
    let pool = [];
    try {
      if (chance(this.porosity) || this.reservoir.length < 24) {
        pool = (await this.pull(seed)).fresh;
      }
    } catch { /* handled by the caller — a failed pull opens as blank */ }
    if (!pool.length) pool = this.reservoir.slice(-50);

    const text = decodeEntities(stripTags(seed)).replace(/\s+/g, " ").trim();
    const words = cleanWords(text);
    if (words.length) {
      pool = [{ text, words, source: "seed", url: "", entry: `seed:${memoryKey(text)}`, uses: 0 }, ...pool];
    }
    return pool;
  }
}
