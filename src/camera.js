/* camera — plica
 * folds are a constant size, so the camera does all the work as the sheet grows:
 * frame the whole paper until cells would drop below legibility, then stop
 * zooming out and follow the last thing you opened instead.
 */

const MIN_CELL_PX = 74;

export class Camera {
  constructor(el, cellSize) {
    this.el = el;
    this.cellSize = cellSize;
    this.x = 0; this.y = 0; this.k = 1;
    this.tx = 0; this.ty = 0; this.tk = 1;
    this.manual = false;
  }

  get minScale() { return MIN_CELL_PX / this.cellSize; }

  frame(bounds, viewport, focus) {
    const w = Math.max(bounds.maxX - bounds.minX, 1);
    const h = Math.max(bounds.maxY - bounds.minY, 1);
    const margin = 0.88;
    let k = Math.min((viewport.w / w) * margin, (viewport.h / h) * margin);
    k = Math.min(k, 1.35);

    // folds are a constant size, so legibility wins over framing the whole
    // paper: past this point the camera stops pulling back and follows instead
    let cx = (bounds.minX + bounds.maxX) / 2;
    let cy = (bounds.minY + bounds.maxY) / 2;
    if (k < this.minScale) {
      k = this.minScale;
      if (focus) { cx = focus[0]; cy = focus[1]; }
    }
    this.tk = k;
    this.tx = viewport.w / 2 - cx * k;
    this.ty = viewport.h / 2 - cy * k;
    this.manual = false;
  }

  panBy(dx, dy) { this.tx += dx; this.ty += dy; this.x += dx; this.y += dy; this.manual = true; }

  /* translate without claiming the camera — used to hold framing across a resize */
  shift(dx, dy) { this.tx += dx; this.ty += dy; this.x += dx; this.y += dy; }

  zoomAt(px, py, factor) {
    const k = Math.max(0.18, Math.min(4, this.tk * factor));
    const ratio = k / this.tk;
    this.tx = px - (px - this.tx) * ratio;
    this.ty = py - (py - this.ty) * ratio;
    this.tk = k;
    this.manual = true;
  }

  toWorld(px, py) { return [(px - this.x) / this.k, (py - this.y) / this.k]; }

  step() {
    const e = 0.14;
    this.x += (this.tx - this.x) * e;
    this.y += (this.ty - this.y) * e;
    this.k += (this.tk - this.k) * e;
    this.el.setAttribute("transform", `translate(${this.x.toFixed(2)},${this.y.toFixed(2)}) scale(${this.k.toFixed(4)})`);
    return Math.abs(this.tx - this.x) + Math.abs(this.ty - this.y) + Math.abs(this.tk - this.k) * 100 > 0.4;
  }

  snap() { this.x = this.tx; this.y = this.ty; this.k = this.tk; this.step(); }
}
