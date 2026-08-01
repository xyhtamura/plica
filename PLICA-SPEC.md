# plica — spec

*A mystical crumpled paper, picked up from the road, that unfolds indefinitely.*

Status: **P0/P1 built; release hardening in progress**, 2026-08-01.

---

## 1. The thing

You have found a piece of paper. It is folded shut except for one panel, which
has something drawn on it, and one panel that is blank except for a crease.

Touching an unopened panel unfolds it. The paper is bigger now. Its ragged edge
has re-creased itself into a new set of possible next panels — different shapes
than a moment ago, because the paper had not decided yet where those folds
would fall. What is already open never moves again.

There is no interface. There is the paper.

The reading is not in any one panel. It is in what ended up next to what.

### Lineage

- **cutline** — the language substrate. Cut-up verse and collage assembled live
  from outside sources; operator cards that are simultaneously a reading and an
  instruction. plica keeps the pipeline and re-houses the operators as *folds*.
- **scute** (`sgueltch/goopCodecs/scute`) — the geometry. Voronoi cells with
  domain-warped organic borders; territory grown from points; annexation rather
  than erasure. plica borrows the look and one structural idea, not the code
  (scute is a WebGL corruption codec; plica is a vector map).
- **Legend of Mana** — the placement fantasy. The world does not exist until you
  put a thing down, and where you put it determines what the world becomes.
- **Minesweeper** — the information layer, not the fail state. Ghost panels leak
  a little of what they hold. There is no losing.

### What plica is not

- Not a deck. cutline draws from a deck; plica grows a surface. Order is not the
  structure — **adjacency** is.
- Not a roguelike run. No score, no win, no death. The reset fold exists because
  a sheet can be finished with, not because you can fail one.
- Not a codec. Nothing is encoded, corrupted, or exported as bytes. (An export
  path is a later question — see §11.)

---

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **sheet** | The whole growing paper. One session, one sheet. |
| **fold** / **scute** | One Voronoi cell. Used interchangeably; *fold* in prose, *scute* in code. |
| **open fold** | Unfolded. Has content. **Geometry is frozen forever.** |
| **ghost** | An unopened fold on the frontier. Clickable. Faint. Shape is provisional. |
| **loose seed** | A seed further out than the ghost ring. Not yet a fold. Re-scattered every unfold. |
| **pinned** | A seed whose position can never change again. |
| **crease** | One border segment between two folds. Warped, not straight. |
| **leaf** | The content inside a fold — image collage, cut-up text, or an effect. |
| **tell** | The faint signal a ghost leaks about its own contents. |
| **deploy** | Spending a dormant effect fold by touching it a second time. |

---

## 3. The load-bearing invariant

> **Opened geometry is immutable. Unopened geometry is provisional.**

Everything else in the design serves this. It is the whole difference between
plica and a map-filling game: the paper had *not decided* where the fold would
fall until you committed to opening it, and once you did, it can never change
its mind. The unrevealed edge is genuinely undetermined and visibly says so, by
re-creasing itself every single time you touch it.

The one exception is explicit and rare: a small number of effects (§7,
*shape-breaking*) can un-freeze a region. Because it's the only thing in the
system that can violate the invariant, it should feel like violence.

---

## 4. Geometry

### 4.1 Substrate: vector, not shader

scute's cells are a WebGL nearest-seed shader with a domain-warp lens. plica
cannot use that directly — every cell here carries live text and images, needs a
hit-test, and must animate one polygon at a time. So: **SVG polygons + an HTML
overlay for text**, both inside one wrapper carrying a single pan/zoom
transform.

- `<svg>` layer — cell fills, warped border paths, `<clipPath>` per cell,
  `<image>` collage layers clipped to the cell.
- `.leaves` HTML layer — text blocks positioned at the cell's inscribed centre,
  clipped with CSS `clip-path: path('M…')` in the *same* untransformed
  coordinate space. HTML rather than `<foreignObject>`: better text rendering,
  selectable, and no Safari clipping bugs.

A later option, if the paper wants a real substrate texture: a WebGL fill layer
*behind* the SVG, carrying fibre/stain/marbling in cell-local coordinates. Not
in the first build.

### 4.2 Seeds and tiers

The partition is a pure function of the seed table (scute's contract, kept).
Every seed carries a tier:

| Tier | Position | Shape | Recomputed |
|---|---|---|---|
| **open** | pinned | frozen path, stored | never |
| **ghost** (ring 1, adjacent to any open fold) | pinned on promotion | recomputed, but inner creases are frozen | outer creases only |
| **loose** (ring 2+) | free | recomputed | every unfold |

**Pin rule.** The moment a seed becomes a Voronoi neighbour of an open fold, it
is pinned — position fixed forever. This is what guarantees open geometry is
stable: an open cell's shape depends only on its Delaunay neighbours, and by
this rule all of them are pinned.

**Self-heal.** After each re-scatter, walk the Delaunay neighbour list of every
open seed. If any neighbour is unpinned (a loose seed drifted into adjacency),
pin it immediately and re-run. Converges in one or two passes. This is a
correctness guard, not a gameplay mechanic — without it a lucky scatter could
silently deform a finished region.

**No polygon booleans.** The pin rule means one global Voronoi over all seeds
produces geometry that already agrees with the stored frozen paths. No union, no
difference, no clipping library.

### 4.3 The unfold step

1. User touches ghost **G**.
2. G's seed → tier `open`. Its current path is written to storage verbatim.
   Every crease on G's boundary is marked frozen, including its noise seed.
3. Spawn 2–4 new loose seeds in a band beyond G, biased outward from the sheet
   centroid (the paper grows in the direction you pull it).
4. Re-scatter every remaining loose seed: jitter position by a noise field keyed
   to `creaseSeed`, then one step of Lloyd relaxation to keep sizes even.
5. Recompute the global Delaunay/Voronoi. Run the self-heal pass.
6. Promote any loose seed now adjacent to an open fold → ghost, pin it.
7. `creaseSeed++`. Re-derive every **unfrozen** crease's warp (§4.4).
8. Animate: G's fill and leaf materialise; every ghost's outer border morphs
   from its previous path to its new one over ~450 ms, eased. Open cells do not
   move at all — the stillness of the revealed map against the churn of the
   frontier is the whole visual argument.

### 4.4 Creases (organic borders)

A raw Voronoi border is dead-straight and reads as low-poly. scute's answer is a
domain warp in the shader; plica's is the vector equivalent:

- Sample each Voronoi half-edge into *k* points (k ≈ segment length / 8 px).
- Offset each point along the edge normal by `fbm(p * f, creaseSeed) * amp`,
  where the noise field is itself warped by a second field (warp-of-warp, as in
  scute) — this is what makes the border marble rather than merely wobble.
- Smooth with Catmull-Rom → cubic path segment.
- Deckle the sheet's outermost boundary harder: higher amp, plus a torn-fibre
  micro-jitter, so the paper has a genuine ragged edge rather than a polygonal
  silhouette.

**The shared-edge rule is the single hardest correctness point in the build.** A
crease belongs to *two* cells. It must be displaced once, keyed by the sorted
site-id pair (`min(a,b):max(a,b)`), and the resulting point list handed to both
cells — one forward, one reversed. Displace per-cell instead and you get hairline
gaps and overlaps along every border. Build a `creases: Map<pairKey, {points,
seed, frozen}>` and have cell paths be *assembled from* creases, never computed
independently.

Freezing follows the same key: once either side of a crease is open, that entry's
`frozen = true` and its point list is never regenerated.

### 4.5 Camera

**Revised 2026-07-26.** The original design auto-framed after every unfold. That
is wrong: it takes the view away from the user exactly when they are looking at
something, and it makes the sheet feel like it is being presented rather than
handled. The camera now belongs to the user.

- **Framed once**, when the sheet is found (and after a reset). Never again.
- Opening a fold does **not** move, zoom, or re-fit the view. The paper grows
  off the edge of the screen and you go and look at it.
- Manual: drag empty space to pan, wheel/pinch to zoom.
- A resize holds the user's framing — whatever world point was centred stays
  centred — rather than re-fitting the sheet.

Because nothing re-frames, folds are a constant size on screen at a given zoom
and the minimum-legibility clamp only applies to the initial framing.
- **LOD.** Beyond ~400 open cells, cells outside the viewport drop their text
  nodes and images (keep a flat fill + border). Re-hydrate on re-entry. Content
  is stored in state, not in the DOM, so this is free.

---

## 5. Content — the leaf

### 5.1 Sources

Vendored from cutline: keyless, CORS-open, no API keys.

- **Wikipedia** — search snippets, random-article extracts
- **Datamuse** — semantic drift on the seed
- **PoetryDB** — stray poem lines
- **Wikimedia Commons / Openverse** — collage imagery

cutline's pipeline is kept nearly whole: reservoir, entry-grouping so a long
article can't buy extra lottery tickets, use-decay, recent-word penalty,
porosity / drift / chaos. Those three parameters have **no sliders here** — they
are properties of the sheet, drawn once at sheet creation and never shown. Each
found paper has its own temperament.

See §10 for the dependency bookkeeping this vendoring incurs.

### 5.2 Leaf kinds

| Kind | Weight | Content |
|---|---|---|
| **drawn** | ~24% | 1–3 images clipped to the cell. One is the common case — three every time reads as a filter, one reads as a clipping. |
| **written** | ~24% | Type and nothing else. |
| **mixed** | ~18% | A picture with a line bitten out of it. |
| **plate** | ~9% | A flat colour field with locally generated type. A plate is never only colour and does not wait for a network request. |
| **shape** | ~3% | A procedural SVG drawing generated from the fold identity and sheet palette. It renders immediately without a network request. |
| **effect** | ~15% | A glyph and a gloss. Dormant until deployed. See §7. |
| **blank** | ~7% | Nothing. Paper. These matter — a sheet with no silence is noise. |

Weights are per-sheet, jittered at creation. A sheet that runs 40% blank is a
quiet sheet, and that is a legitimate sheet.

### 5.2b Type as image *(added 2026-07-26, after P1)*

The governing fantasy sharpened during the build: not a paper with writing on
it, but a **hyperdimensional magazine collage picked up off the street**. The
fold is therefore not a text box, it is a **clipping mask** — type that overruns
its cell is torn off at the crease, which is exactly what a phrase cut out of a
magazine looks like. Only the `plain` treatment fits itself to the fold; the
rest are allowed to bleed.

Each sheet draws a **typographic heat** once, never shown, alongside porosity /
drift / chaos. Cool sheets set fragments quietly; hot sheets let the letters eat
the fold until the text functions as an image and the words are barely
recoverable. Six treatments — `plain`, `stacked`, `ransom`, `banner`,
`overprint`, `monogram` — weighted by heat, with `plain` falling from roughly
half to a fifth as heat rises and `monogram` climbing from rare to occasional.

Two things are load-bearing:

- **Determinism.** The treatment is a pure function of the fold's seed id. A
  re-render (LOD, tween completion, camera) must never restyle a fold you have
  already read, or the sheet would rewrite itself behind your back.
- **A floor on shrink-to-fit.** `plain` shrinks to fit, but only down to
  `0.15 × inradius`. Without a floor, the one treatment that is supposed to be
  *readable* became the least readable of the six on long lines. Past the floor
  it simply overruns, and the crease tears it — which is the house style anyway.

Fonts are system stacks only (no webfont fetch); the mismatch between them is
the point. Inks are process colours, two or three drawn per sheet so one paper
reads as one press run.

**Colour is free** *(added 2026-07-26)*. Every sheet invents its whole palette:
ground, paper, creases, ghosts, reset fold, inks and plates, all redrawn when a
paper is found and again on every reset. Light ground or dark ground is a coin
flip — plica has no light mode and no dark mode, only *this paper's* mode.

The legibility rule is **deliberately dropped for folds**. A fragment may be
printed in a colour that barely separates from what it sits on. The folds are
graphic material, not a document, and the reading was never in any single fold.
Two exceptions survive, and they are mechanics rather than readability:

- **paper must separate from ground**, or the sheet is invisible (held at ≥28 in
  lightness)
- **ghosts must separate from open folds**, or nothing tells you what is
  clickable (held at ≥11 from both paper and ground, plus the dashed stroke and
  translucency, which carry the distinction independently of hue)

Both are held in *lightness only*; hue and saturation are unconstrained. A
single `CONTRAST_FLOOR` in `src/palette.js` stops an ink landing exactly on its
own backdrop and rendering nothing at all; set it to 0 for total freedom.

Legibility is expected to return in exactly one place: a future splash panel
explaining what plica is. That panel is a document and should be readable.

**Isotropy** *(added 2026-07-26)*. Text and images both take a true random
rotation over the full circle on spawn — a cutting has no up. One consequence is
deliberate and worth stating: the `plain` treatment now lands inverted about
half the time, so "readable" means "legible if you turn your head". That is the
magazine register rather than an oversight. The whole behaviour is one exported
constant, `ISOTROPY` in `src/type.js`; dropping it to ~20 restores an upright,
quietly-tilted sheet. Images are oversized past their own diagonal so a full
rotation can never swing a corner into the fold.

### 5.3 Identity precedes reveal

**A ghost's kind, effect, and seed word are decided when the seed is created,
not when it is opened.** Determined by a seeded RNG over the seed's id. The
*fetch* is lazy (network only on open, or prefetched one ring ahead), but the
identity is not a coin flip at click time.

This is load-bearing for the minesweeper feel. If tells (§6) hinted at a value
that didn't exist yet, the whole information layer would be theatre.

### 5.4 Seeding the next reading

A fold's text is generated from a seed word drawn from its **already-open
neighbours** — biased toward the most recently opened. So the paper drifts
semantically across its own surface, and two regions grown from different
starting directions genuinely diverge. Adjacency is meaning; this is where that
is mechanically true rather than merely asserted.

---

## 6. Ghosts and tells

A ghost is faint — a low-opacity fill, a dotted or half-visible crease, a
slight paper-grain shadow as if something were printed on the far side.

Each ghost leaks **one** tell, rendered as a shadow through paper:

| Tell | Reads as |
|---|---|
| dense grey blot | image-heavy, plate, or shape |
| faint ruled lines | text (written) |
| a ring or halo | effect |
| clean paper | blank |

Tells are **~80% honest**. A foxed or damp ghost lies. Certain effects (§7,
`watermark`) reveal a ring of tells truthfully.

That is the entire information layer. No numbers, no adjacency counts. The
Minesweeper reference is the *shape* of the tension — "something is under there
and I can partly tell what" — not its arithmetic.

---

## 7. Effects

cutline's operator cards, re-housed. The critical change: **targeting is
spatial, not list-order.** cutline operates on "first card" / "last card"; plica
operates on rings, creases, directions, and regions. That is what makes this a
different piece rather than cutline in a new skin.

**Beta implementation (built 2026-08-01).** The beta generates only three
dormant effects: reverse the words in touching folds (`ring 1`), make ghost
tells truthful within two rings (`ring 2`), and re-crease the whole sheet. Each
is deployed by touching its open fold, is consumed once, and becomes a
deterministic ordinary leaf. The wider catalogue below remains design space and
is not generated yet.

### 7.1 The two classes

**Dormant (the default, ~85% of effect folds).** Opening one reveals a glyph and
a gloss. It does nothing. It sits on the map, permanently, until you touch it a
second time — then it fires and is consumed. You may leave it unspent forever.
Most of the interest is in *carrying* unspent effects and deciding, three
unfolds later, that now is the moment.

**Spent effects become ordinary folds** *(decided 2026-07-26)*. A used effect
does not linger as a dead mark; the fold takes on a normal leaf — image, text,
or plate — as though that is what had been under there all along. The sheet has
no gravestones, and a spent region stays as dense and readable as any other.

**The gloss says plainly what tapping it will do** *(decided 2026-07-26)*. These
are instructions, not omens: "change every e to a", not "the sheet forgets its
vowels". The divination lives in what ends up beside what, and a player deciding
whether to spend a scarce effect needs to know what it does — evocative wording
there would only make the choice arbitrary.

**Immediate (~15%).** Fires the instant it is unfolded, on already-open folds.
This is the minesweeper jolt — the fold you opened turns out to have done
something to work you had already finished. Rare on purpose. Should never
destroy a region outright; it should *alter* one.

### 7.2 Targeting vocabulary

`ring 1` (immediate neighbours) · `ring 2` · `the crease line` (every fold
touching one chosen border, followed outward) · `windward` (every fold in one
compass direction from here) · `the whole sheet` · `everything opened before
this one` · `the oldest` / `the drawn fold` (the origin panel).

### 7.3 Effect sketches

*Letterwork (Balatro-adjacent, cheap, sheet-wide, permanent):*
- **all e's become a's** — and its family: every vowel to the next vowel; every
  double letter singled; all capitals to lowercase across the sheet.
- **read the ring backwards** — reverse word order in `ring 1`.
- **the sheet forgets one word** — pick a word appearing 3+ times, delete every
  instance everywhere. Gaps stay as gaps.

*Papercraft:*
- **foxing** — brown stain seeded here, spreads one ring per subsequent unfold,
  degrading text as it goes. Ongoing, not instant.
- **damp** — `ring 1` text loses its vowels.
- **sun bleach** — `ring 1` fades toward the paper colour; still there, barely.
- **watermark** — every tell in `ring 2` becomes truthful and legible.

*Geometric (the shape-breaking exception to §3):*
- **annex** — scute's truncate semantics. A neighbour's seed is deleted; the
  larger neighbour's cell floods outward to swallow the territory, and the
  eaten fold's text is merged into the eater's. No hole is ever left. The
  clearest single import from scute, and the only routine geometry mutation.
- **re-crease** — un-freeze every crease on the sheet, re-derive all warps at
  the current `creaseSeed`, animate the whole map rippling. Positions unchanged,
  so contents stay welded to their cells. Violent, purely cosmetic, and the
  moment the paper most feels alive.
- **drift** — un-pin every seed, jitter, re-partition. The map deforms
  bodily. Should exist at most once per sheet.

*Growth:*
- **duplicate crease** — the next unfold opens two ghosts at once.
- **dry** — the sheet cannot grow windward for N unfolds; ghosts on that side go
  dark and unclickable.
- **the fold that was already there** — spawn a ghost inside the revealed
  region, splitting an existing open fold in two. Terrifying, ideally rare.

### 7.4 The economy

There is no currency and no cost. The scarcity is **position**: an effect fires
from where it sits, and you cannot move it. A `watermark` on the far side of the
sheet is worthless; the same fold two rings closer changes what you dare open
next. Deciding whether to grow *toward* your unspent effects is the strategy
layer, and it's entirely spatial.

---

## 8. The two starting folds

On load, a black-to-paper fade and **two open folds**, nothing else.

**The drawn fold.** Centre. A complete cutline-grade reading — collage plus
verse. This is the thing that was already on the paper when you picked it up. It
is the semantic origin: the first ring's seed words come from it.

**The reset fold.** Adjacent, sharing one crease. Blank except a single fold
glyph. Touching it collapses the entire sheet — an animated re-folding, cells
sweeping inward and creasing shut, ~1.2 s — and a new sheet begins. **No
confirmation dialogue.** It is not a button, it is a fold that does that, and
knowing it's there while you work is part of the object. It never moves and it
is never consumed.

(Accident guard: it takes a deliberate press-and-hold, ~500 ms, with the
collapse animation beginning under your finger and reversible if you release
early. That's a physical gesture, not a modal — the no-UI rule survives.)

---

## 9. Interface

The first visit opens one readable introduction over the sheet. It states what
plica is, names the five gestures needed for the beta, and then gets out of the
way. Dismissal is stored separately from sheet state, so resetting the paper
does not show it again. After that, everything is the paper.

| Gesture | Result |
|---|---|
| tap a ghost | unfold |
| tap an open effect fold | deploy |
| press-and-hold the reset fold | collapse the sheet |
| tap an open fold | zoom to read it large (cutline's collage view, cell-shaped) |
| drag with one pointer | pan |
| wheel / pinch | zoom |
| `Esc` | leave the read view |

Status text: none, except a single line of small type at the very bottom edge
that only appears while a network pull is in flight, and fades. Errors surface
as paper damage, not as messages — a failed fetch opens as a **blank**, which is
a legitimate leaf kind, so failure is indistinguishable from silence and the
fiction never breaks.

Persistence: the sheet autosaves to `localStorage` (seeds, tiers, frozen paths,
leaf content, creaseSeed, spent effects). Reload returns you to the same paper.
The reset fold clears it. Cap the store and drop image URLs first if it
overflows — images can be re-fetched, the map cannot.

---

## 10. Files and dependencies

```
plica/
  index.html
  plica.css
  PLICA-SPEC.md          this document
  README.md              written at P1
  src/
    sheet.js             seed table, tiers, pin rule, growth, adjacency, self-heal
    crease.js            shared-edge warp, path assembly, morph animation
    leaf.js              content generation + render, LOD hydrate/dehydrate
    language.js          VENDORED from cutline — pull pipeline + reservoir
    effects.js           effect table, spatial targeting, application
    gestures.js          two-pointer pinch geometry
    ghost.js             pre-reveal identity RNG, tells
    intro.js             first-use seen state
    camera.js            pan/zoom/auto-frame
    state.js             localStorage save/load/reset
  tests/
    state.test.js        persistence round-trip and recovery tests
    effects.test.js      spatial targeting and re-crease invariants
    interaction.test.js  first-use and pinch geometry tests
    contracts.test.js    live sibling cutline CSV contract
    shipping.test.js     100-unfold timing and geometry gate
  vendor/
    delaunay.js          d3-delaunay, local copy (no CDN)
```

Static, no build step. Served from the root per `CLAUDE.md` — do not start a
server inside `plica/`.

**Dependency bookkeeping.** `src/language.js` is plica's own adaptation of
cutline's pull pipeline and may drift. The ancestor deck does not: plica fetches
`../cutline/okkategorakle.csv` at runtime. Each non-empty row is
`<marker>,<name>` with no header; the first comma is the separator, so later
commas belong to the name. Numeric markers identify the original cards and
later additions use `NEW` or a blank marker. The current live contract is 137
unique names: 117 ancestors and 20 cutline operators that plica filters
case-insensitively. `tests/contracts.test.js` reads the actual sibling file and
checks the runtime parser. `DEPENDENCIES.md` records the cross-repo obligation.

`scute` is **conceptual lineage only** — no code is taken, and nothing in
`sgueltch/goopCodecs/` is touched. No `DEPENDENCIES.md` entry needed. Worth one
line in scute's own doc later noting that its warp idea has vector offspring.

---

## 11. Build phases

**P0 — the paper moves.** Seed table, tiers, pin rule, self-heal, global Voronoi,
shared-edge warp, path assembly, click-to-open, ghost re-crease morph, camera.
No content — cells are flat colour, ghosts are faint. *This phase proves the two
hard things: shared-crease displacement without gaps, and frozen-open /
churning-ghost coexisting in one partition.* If P0 doesn't feel right, nothing
after it will.

**P1 — the paper says something.** Vendor the language pipeline. Leaf kinds,
collage clipped to cells, text set into inscribed circles, the two starting
folds, the reset collapse, neighbour-seeded drift, ghost tells. Write `README.md`
and the `DEPENDENCIES.md` entry.

**P2 — the paper acts.** Effects: the dormant/deploy loop, spatial targeting,
`reverse-ring`, `watermark`, `re-crease`, and spent marks are built. The wider
letterwork family, `annex`, `foxing`, and immediate effects remain.

**P3 — the paper persists.** Versioned localStorage persistence, the first-use
introduction, and two-pointer pinch zoom are built. LOD, read view, deckled outer
edge, paper texture, minimum keyboard access, and the full collapse animation
remain.

### Shipping beta sequence

1. ~~Add versioned save/restore, quota fallback, and reset clearing.~~ Built
   2026-08-01.
2. ~~Implement the minimal dormant effect loop: reverse touching folds, reveal
   nearby ghosts, and re-crease.~~ Built 2026-08-01; no other effect marks are
   generated.
3. ~~Add first-use instructions and pinch zoom.~~ Built 2026-08-01; physical
   touch-device pinch verification remains.
4. Add minimum keyboard access.
5. ~~Set and verify a 100-unfold performance target.~~ Built 2026-08-01.
6. Deploy the Pages beta.

### 100-unfold shipping gate

The deterministic test takes an outward frontier fold every fifth step and a
fixed stride through the frontier otherwise. It times `Sheet.unfold()` only.
The beta regression ceilings are **30 seconds total**, **750 ms p95**, and **2
seconds for any one unfold**. Network pulls, SVG updates, image decode, and paint
are outside this geometry gate and still require browser/device checks.

The same run asserts the load-bearing geometry at every stage: every previously
open path remains byte-identical, every open neighbour is pinned and non-loose,
open cells and their creases are frozen, paths contain finite points and closed
seams, and both sides of each shared crease agree. The 2026-08-01 reference run
completed in 13.35 seconds total, with 378 ms p95 and 585 ms maximum.

### Recovery and layout preflight

Before the Pages beta, exercise a saved grown sheet across a reload, a
structurally plausible but unusable `plica.sheet` record, and an unavailable
cutline request. The reload must preserve frozen paths and the camera and must
still allow another unfold. A corrupt record must produce a new usable sheet,
replace the bad save, and restore that replacement on the following load. A
cutline failure must leave the 17-name built-in ancestor deck intact; this is a
source fallback, not a service-worker guarantee that a fresh page can launch
without its own static files.

Check the introduction and working sheet at 1280×720 and 390×844, plus a short
360×640 phone viewport. The document must not overflow horizontally, the SVG
must fill the viewport, and the introduction must begin at its title on short
screens while remaining internally scrollable to its dismissal button.

**Later, unscheduled.** Export the sheet as a single tall image or SVG. Sound —
paper handling, one crease per unfold. A WebGL substrate layer for fibre and
stain. Whether a sheet can ever be *finished* rather than merely abandoned.

---

## 12. Open questions

1. **Does a sheet ever end?** Currently no — it grows forever and you leave it.
   An ending condition (the paper runs out of folds; the deckle closes into a
   complete shape) would give the object a shape but costs the "indefinitely."
   Leaning: no ending, but a sheet that has been away for a long time might be
   found *differently* on return.
2. **Cell size drift.** Should folds get smaller as the sheet grows (paper
   compressing under its own unfolding) or stay constant? Smaller is beautiful
   and fights legibility. Probably: constant, with the camera doing the work.
3. **Multiple ghosts opened at once.** Should a fast player be able to open
   three before the re-crease settles, or does the animation gate input? Gating
   is safer; not gating might feel better. Test in P0.
4. **Does the paper have a back?** Folds might have a reverse face. Enormous
   scope; noted only so it isn't accidentally foreclosed by the data model —
   keep a `faces[]` array of length 1 rather than a flat leaf field.
5. **Image licensing on export.** Commons/Openverse imagery is fine to display;
   an export feature would need attribution baked in. Deferred with the export
   itself.

---

## Dev Log

- **2026-07-30 — Antigravity** — Initialized standalone Git repository (`main` branch) in `f:\xyhtamura\plica`. Created `.gitignore`, staged all initial project source files, specs, and resources, and committed initial baseline. Verified git repository state cleanly. Remaining: P2 effects loop and P3 persistence/LOD.
- **2026-08-01 — Codex** — Added a versioned `plica.sheet` save containing the
  complete seed table, commit-time frozen cell geometry, frozen creases, open
  order, leaves, dormant/spent fields, language memory, and viewport-independent
  camera framing. Autosave now follows unfolds, content completion, pan, zoom,
  page hiding, and reset. Invalid records fall back to a new sheet; quota
  failures retry without image URLs. Image crops and ghost blot angles are now
  deterministic per fold. Verified with five state tests, a 100-unfold geometry
  stress run, and two browser reload cycles including continued growth after
  restoration. Remaining: the minimal effect loop, first-use instructions,
  pinch/keyboard input, performance targeting, and the rest of P3.
- **2026-08-01 — Codex** — Added the beta's three dormant spatial effects:
  `reverse-ring` mutates text in touching open folds, `watermark` permanently
  makes ghost tells truthful within two rings, and `re-crease` redraws and
  freezes every live crease. Deploying an open effect consumes it and replaces
  it with deterministic ordinary content; truthful tells and the new crease
  generation persist across reloads. Verified with nine automated state/effect
  tests and live browser deployments of all three effects, including a reload
  that preserved every re-creased path. Remaining: first-use instructions,
  pinch zoom, minimum keyboard access, and the 100-unfold performance target.
- **2026-08-01 — Codex** — Added a high-contrast first-visit introduction that
  explains the object and its five beta gestures, remembers dismissal outside
  the sheet save, and stays dismissed after reset or reload. Added two-pointer
  pinch zoom around the moving touch midpoint, including a clean handoff to
  one-pointer pan when a finger lifts. Verified with twelve automated tests,
  desktop and 390×844 browser layouts, dismissal across reload, and a browser
  pan regression check. The browser harness cannot emit two concurrent touch
  contacts, so direct pinch verification remains for a physical touch device.
  Remaining: minimum keyboard access and the 100-unfold performance target.
- **2026-08-01 — Codex** — Added the 100-unfold shipping gate with frozen-path,
  pin-rule, finite-geometry, closed-seam, and shared-crease assertions. Set the
  geometry-only ceilings at 30 s total, 750 ms p95, and 2 s maximum; the
  reference run measured 13.35 s / 378 ms / 585 ms. Made the cutline row parser
  explicit and tested it against the actual sibling CSV: 137 unique names, 117
  ancestors, and 20 filtered operators. The root-served CSV returned 200, and
  the deployed CSV returned 200 with the same rows and contract. Verified all
  fifteen automated tests. Remaining: minimum keyboard access, physical-device
  pinch verification, browser performance QA, and the Pages deployment.
- **2026-08-01 — Codex** — Completed the recovery and responsive-layout
  preflight. A three-unfold sheet kept all four frozen paths and its camera
  transform across reload, then accepted another unfold. A shallow-valid but
  unreconstructable save fell back to a new sheet and the replacement restored
  on the next load. Added an automated rejected-fetch check for the 17-name
  ancestor fallback. Verified the introduction and working sheet at 1280×720,
  390×844, and 360×640 with no horizontal overflow or browser warnings. The
  compact-phone pass found and fixed the dialog auto-focusing its bottom button
  and opening scrolled past the explanation; it now focuses the dialog at the
  top and the button remains reachable. All sixteen automated tests pass; the
  latest 100-unfold run measured 16.41 s total, 400.9 ms p95, and 806.7 ms max.
  Remaining: minimum keyboard access, physical-device pinch verification,
  browser performance QA, and the Pages deployment.

---

*plica · frozen where opened · undecided at the edge*
