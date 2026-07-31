# plica

*A mystical crumpled paper, picked up from the road, that unfolds indefinitely.*

You have found a piece of paper. It is folded shut except for one panel, which
has something drawn on it, and one panel that is blank except for a crease.

Touching an unopened panel unfolds it. The paper is bigger now, and its ragged
edge has re-creased itself into a different set of possible next panels —
because the paper had not decided yet where those folds would fall. What is
already open never moves again.

There is no interface. There is the paper.

The reading is not in any one panel. It is in what ended up next to what.

## Run

Static, no build step. Serve from the root (`F:\xyh\serve_root.bat`, or
`python -m http.server 8000` at `f:\xyh`), then open:

```text
http://localhost:8000/plica/
```

Serving from the root matters: plica fetches its ancestor deck from
`../cutline/`. Add `?debug` for counters and geometry probes.

No API keys. All sources are keyless and CORS-open:

- **Wikipedia** — search snippets, random-article extracts
- **Datamuse** — semantic drift on the seed
- **PoetryDB** — stray poem lines
- **Wikimedia Commons / Openverse** — collage imagery

## Gestures

| | |
|---|---|
| tap a ghost | unfold it |
| drag empty space | pan |
| wheel / pinch | zoom |
| press and hold the reset fold | collapse the sheet and find a new one |

The collapse begins under your finger and reverses if you let go early. It is
not a button; it is a fold that does that.

The sheet is framed once, when you find it. After that the camera is yours —
opening a fold never pulls the view back to fit. The paper grows off the edge of
the screen and you go and look at it.

## The load-bearing invariant

> **Opened geometry is immutable. Unopened geometry is provisional.**

This is the whole difference between plica and a map-filling game. The paper had
not decided where a fold would fall until you committed to opening it, and once
you did, it can never change its mind. The unrevealed edge is genuinely
undetermined and says so, by re-creasing itself every time you touch it.

It holds without any polygon boolean, through the **pin rule**: every vertex of
an open cell is shared by two of its own edges, so it is determined by that cell
plus two of its Voronoi neighbours — and every neighbour of an open cell is
pinned the moment the cell is committed. Loose seeds beyond the ghost ring churn
freely without ever touching finished work. If one would intrude, the sheet
deletes it rather than admitting it.

## Folds

Each fold holds a **leaf**, decided when its seed is created rather than when it
is opened — so the tells below are real information, not theatre.

| Kind | What is in it |
|---|---|
| **drawn** | one to three pictures, torn to the shape of the fold |
| **written** | type, and nothing else |
| **mixed** | a picture with a line bitten out of it |
| **plate** | a flat colour field with locally generated type; no network wait |
| **shape** | a procedural SVG drawing made from the sheet palette |
| **effect** | a glyph and a gloss. dormant (P2 will make these act) |
| **blank** | nothing. paper. |

Weights are drawn per sheet, so a sheet that runs heavily blank is a quiet
sheet, and that is a legitimate sheet. Likewise porosity, drift and chaos are
properties of the paper you happened to find, drawn once and never shown.

A fold composes from its already-open neighbours, biased toward the most
recently opened, so the paper drifts semantically across its own surface and
two regions grown in different directions genuinely diverge. **Adjacency is
meaning** — that is where it is mechanically true rather than merely asserted.

## Colour

Every sheet invents its own palette — ground, paper, creases, ghosts, inks,
plates — drawn fresh when you find the paper and again on every reset. Light
ground or dark ground is a coin flip. There is no light mode and no dark mode,
only this paper's mode.

Colour is not constrained for legibility. A fragment may be printed in something
that barely separates from the fold it sits on; the folds are graphic material,
not a document, and the reading was never in any single fold. Only two things
are held, and both are mechanics rather than readability: paper always separates
from ground, and ghosts always separate from open folds — otherwise nothing
would tell you what is clickable.

## Type as image

A fold is not a text box, it is a clipping mask. Type that overruns its cell is
torn off at the crease — which is what a phrase cut out of a magazine looks
like. Only the quiet setting fits itself to the fold; the rest are allowed to
bleed.

Every sheet carries a **typographic heat**, drawn once and never shown. Cool
sheets set their fragments plainly. Hot ones let the letters eat the fold until
the text is functioning as an image and the words are barely recoverable — a
phrase cut out by an avant-garde designer in 1994 who has gone too far.

| Treatment | |
|---|---|
| **plain** | readable, set quietly in italic serif. the only one that shrinks to fit |
| **stacked** | one word per line, each a different size — a column of shouting |
| **ransom** | every word (or, when hot, every letter) its own font, size, colour, angle |
| **banner** | one line scaled well past the fold so the crease tears it |
| **overprint** | the same words twice, off by a hair, multiplied — misregistered printing |
| **monogram** | a single letter, enormous, off-centre so it bleeds out the side |

Fonts are system stacks only, no webfont fetch, and the mismatch between them is
the point: a real ransom note is made of whatever was lying around. Inks are
process colours, two or three drawn per sheet so one paper reads as one press
run.

Text and images both take a true random rotation over the full circle when they
spawn — a cutting has no up. So `plain` lands inverted about half the time, and
"readable" means "legible if you turn your head". If you want an upright sheet,
drop `ISOTROPY` in `src/type.js` from 180 to about 20.

The treatment is deterministic in the fold's seed. A fold you have already read
never restyles itself behind you.

## Ghosts and tells

A ghost leaks one signal, rendered as a shadow through paper: a dense blot means
imagery, a plate, or a shape; faint ruled lines mean text; a ring means an
effect; clean paper means blank. Tells are about **80% honest**. There are no
numbers and no adjacency counts — the Minesweeper reference is the shape of the
tension, not its arithmetic.

## Lineage

- **cutline** — the language substrate. plica keeps the reservoir, entry
  grouping, use-decay and recent-word penalty, but composes in a different
  register: cutline writes a verse, plica writes a fragment.
- **scute** (`sgueltch/goopCodecs/scute`) — the geometry. Voronoi territory
  grown from points, with organic rather than crystalline borders. Conceptual
  lineage only; no code is shared. scute warps its borders in a WebGL shader,
  plica does the vector equivalent — sampling each crease and displacing it with
  warped-of-warped noise, with the amplitude going to zero at both ends so the
  junctions where three folds meet stay welded.
- **Legend of Mana** — the placement fantasy. The world does not exist until you
  put a thing down, and where you put it decides what the world becomes.

## Errors

A failed pull opens as a **blank**, which is a legitimate leaf kind. Failure is
indistinguishable from silence and the fiction never breaks. If the ancestor CSV
is unreachable, a small built-in deck stands in.

## Status

P0 (geometry) and P1 (content) are built. P2 is effects — the dormant/deploy
loop, spatial targeting, `annex`, `foxing`, `watermark`. P3 is persistence, LOD,
the read view and the deckled outer edge. See [PLICA-SPEC.md](PLICA-SPEC.md).

---

*plica · frozen where opened · undecided at the edge*
