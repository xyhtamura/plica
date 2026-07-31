/* voronoi by half-plane clipping — plica
 *
 * no delaunator, no cdn. for a few hundred seeds, clipping each cell against
 * every nearby seed's perpendicular bisector is fast enough and hands us three
 * things the pin rule needs for free:
 *   - exact polygons
 *   - which seed produced each edge (so creases can be keyed by site pair)
 *   - the adjacency list (a seed is a neighbour iff its bisector actually cut)
 */

const QUANT = 1e4;   // vertex snap grid — see interning below

/* keep p where |p - si| <= |p - sj|  =>  p·n <= c */
function halfPlane(si, sj) {
  const nx = sj.x - si.x, ny = sj.y - si.y;
  const c = (sj.x * sj.x + sj.y * sj.y - si.x * si.x - si.y * si.y) / 2;
  return { nx, ny, c };
}

/* sutherland-hodgman against one half-plane, carrying edge labels.
   poly is [{x, y, owner}] where owner labels the edge leaving that vertex. */
function clip(poly, hp, label) {
  const out = [];
  const n = poly.length;
  if (!n) return out;
  const f = p => p.x * hp.nx + p.y * hp.ny - hp.c;

  for (let k = 0; k < n; k++) {
    const A = poly[k], B = poly[(k + 1) % n];
    const fa = f(A), fb = f(B);
    const ain = fa <= 0, bin = fb <= 0;

    if (ain) out.push(A);
    if (ain !== bin) {
      const t = fa / (fa - fb);
      const I = { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t, owner: 0 };
      // leaving the region: the edge from here runs along the clip line
      I.owner = ain ? label : A.owner;
      out.push(I);
    }
  }
  return out;
}

/**
 * @param seeds  [{id, x, y}]
 * @param opts   { cull }  ignore clippers further than cull (world units)
 * @returns { cells: Map<id, {verts:number[], owners:number[]}>,
 *            vertices: number[][],           // interned [x, y]
 *            neighbours: Map<id, Set<id>> }
 */
export function computeVoronoi(seeds, opts = {}) {
  const cull = opts.cull ?? Infinity;
  const cull2 = cull * cull;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of seeds) {
    if (s.x < minX) minX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.x > maxX) maxX = s.x;
    if (s.y > maxY) maxY = s.y;
  }
  const pad = Math.max(maxX - minX, maxY - minY) * 0.25 + (opts.pad ?? 400);
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;

  const vertIndex = new Map();
  const vertices = [];
  const intern = (x, y) => {
    const key = Math.round(x * QUANT) + ":" + Math.round(y * QUANT);
    let id = vertIndex.get(key);
    if (id === undefined) {
      id = vertices.length;
      vertices.push([x, y]);
      vertIndex.set(key, id);
    }
    return id;
  };

  const cells = new Map();
  const neighbours = new Map();
  for (const s of seeds) neighbours.set(s.id, new Set());

  /* spatial buckets to gather candidates, then an exact early-out: clippers are
     taken nearest-first, and once half the distance to the next clipper exceeds
     the polygon's own radius, no remaining seed's bisector can touch it. this
     drops each cell from ~150 clips to ~10 without approximating anything. */
  const G = isFinite(cull) ? cull / 2 : Math.max(maxX - minX, maxY - minY);
  const reach = isFinite(cull) ? Math.ceil(cull / G) : 0;
  const bkey = (gx, gy) => (gx + 32768) * 65536 + (gy + 32768);
  const buckets = new Map();
  for (const s of seeds) {
    const k = bkey(Math.floor(s.x / G), Math.floor(s.y / G));
    let b = buckets.get(k);
    if (!b) buckets.set(k, b = []);
    b.push(s);
  }

  const cand = [];
  for (const si of seeds) {
    let poly = [
      { x: minX, y: minY, owner: -1 },
      { x: maxX, y: minY, owner: -1 },
      { x: maxX, y: maxY, owner: -1 },
      { x: minX, y: maxY, owner: -1 }
    ];

    cand.length = 0;
    const gx = Math.floor(si.x / G), gy = Math.floor(si.y / G);
    for (let ox = -reach; ox <= reach; ox++) {
      for (let oy = -reach; oy <= reach; oy++) {
        const b = buckets.get(bkey(gx + ox, gy + oy));
        if (!b) continue;
        for (const sj of b) {
          if (sj.id === si.id) continue;
          const dx = sj.x - si.x, dy = sj.y - si.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > cull2) continue;
          cand.push(sj, d2);
        }
      }
    }
    const order = [];
    for (let k = 0; k < cand.length; k += 2) order.push(k);
    order.sort((a, b) => cand[a + 1] - cand[b + 1]);

    let maxR2 = Infinity;
    for (const k of order) {
      if (cand[k + 1] > 4 * maxR2) break;          // (d/2)^2 > maxR^2
      poly = clip(poly, halfPlane(si, cand[k]), cand[k].id);
      if (poly.length < 3) break;
      maxR2 = 0;
      for (const p of poly) {
        const dx = p.x - si.x, dy = p.y - si.y;
        const r2 = dx * dx + dy * dy;
        if (r2 > maxR2) maxR2 = r2;
      }
    }

    if (poly.length < 3) { cells.set(si.id, { verts: [], owners: [] }); continue; }

    // intern, dropping vertices that collapsed onto each other
    const verts = [], owners = [];
    for (let k = 0; k < poly.length; k++) {
      const v = intern(poly[k].x, poly[k].y);
      if (verts.length && verts[verts.length - 1] === v) { owners[owners.length - 1] = poly[k].owner; continue; }
      verts.push(v);
      owners.push(poly[k].owner);
    }
    if (verts.length > 1 && verts[0] === verts[verts.length - 1]) { verts.pop(); owners.pop(); }

    cells.set(si.id, { verts, owners });
    const nb = neighbours.get(si.id);
    for (const o of owners) if (o >= 0) nb.add(o);
  }

  // adjacency is symmetric by construction, but float clipping can drop one
  // side of a very thin edge; union it so the pin rule never sees a half-link
  for (const [id, set] of neighbours) for (const o of set) neighbours.get(o)?.add(id);

  return { cells, vertices, neighbours };
}

export function polyCentroid(verts, vertices) {
  let a = 0, cx = 0, cy = 0;
  const n = verts.length;
  if (n < 3) return null;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = vertices[verts[i]];
    const [x1, y1] = vertices[verts[(i + 1) % n]];
    const cross = x0 * y1 - x1 * y0;
    a += cross; cx += (x0 + x1) * cross; cy += (y0 + y1) * cross;
  }
  if (Math.abs(a) < 1e-9) return null;
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}
