/* shapes — plica
 *
 * Rare procedural leaves. They are generated from the fold id and sheet seed,
 * so they appear immediately and redraw identically whenever the fold returns
 * to the viewport.
 */

import { hash32, mulberry32 } from "./rng.js";

const SVG = "http://www.w3.org/2000/svg";
const FAMILIES = ["orbit", "shards", "bars", "blocks", "constellation", "loop"];

function node(name, attrs = {}) {
  const el = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

function colour(rng, colours) {
  return colours[Math.floor(rng() * colours.length)];
}

export function makeShape(seedId, sheetSeed, palette) {
  const seed = hash32(seedId, sheetSeed, 0x5a9e);
  const rng = mulberry32(seed);
  const source = [...palette.inks, ...palette.plates];
  const colours = [];
  while (colours.length < 3) {
    const next = colour(rng, source);
    if (!colours.includes(next) || colours.length >= source.length) colours.push(next);
  }
  return {
    seed,
    family: FAMILIES[Math.floor(rng() * FAMILIES.length)],
    angle: rng() * 360,
    scale: 0.72 + rng() * 0.3,
    colours
  };
}

export function renderShape(g, cell, shape, radius) {
  if (!shape) return;
  const rng = mulberry32(hash32(shape.seed, 0xd2a7));
  const [cx, cy] = cell.centroid;
  const r = radius * shape.scale;
  const colours = shape.colours;
  const group = node("g", {
    class: `leaf-shape shape-${shape.family}`,
    transform: `translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${shape.angle.toFixed(1)})`
  });

  if (shape.family === "orbit") {
    const rings = 1 + (rng() < 0.45 ? 1 : 0);
    for (let i = 0; i < rings; i++) {
      group.appendChild(node("circle", {
        cx: ((rng() - 0.5) * r * 0.25).toFixed(1),
        cy: ((rng() - 0.5) * r * 0.25).toFixed(1),
        r: (r * (0.3 + rng() * 0.25)).toFixed(1),
        fill: "none",
        stroke: colours[i % colours.length],
        "stroke-width": (r * (0.05 + rng() * 0.08)).toFixed(1),
        opacity: (0.7 + rng() * 0.25).toFixed(2)
      }));
    }
    group.appendChild(node("circle", {
      cx: ((rng() - 0.5) * r * 1.05).toFixed(1),
      cy: ((rng() - 0.5) * r * 1.05).toFixed(1),
      r: (r * (0.1 + rng() * 0.16)).toFixed(1),
      fill: colours[2],
      opacity: "0.9"
    }));
  } else if (shape.family === "shards") {
    const count = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i++) {
      const points = [];
      const sides = 3 + Math.floor(rng() * 3);
      const ox = (rng() - 0.5) * r, oy = (rng() - 0.5) * r;
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2 + rng() * 0.7;
        const d = r * (0.2 + rng() * 0.42);
        points.push(`${(ox + Math.cos(a) * d).toFixed(1)},${(oy + Math.sin(a) * d).toFixed(1)}`);
      }
      group.appendChild(node("polygon", {
        points: points.join(" "),
        fill: colours[i % colours.length],
        opacity: (0.62 + rng() * 0.3).toFixed(2)
      }));
    }
  } else if (shape.family === "bars") {
    const count = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < count; i++) {
      const y = -r * 0.7 + (i / Math.max(1, count - 1)) * r * 1.4;
      const inset = rng() * r * 0.45;
      group.appendChild(node("line", {
        x1: (-r + inset).toFixed(1),
        y1: (y + (rng() - 0.5) * r * 0.16).toFixed(1),
        x2: (r - rng() * r * 0.45).toFixed(1),
        y2: (y + (rng() - 0.5) * r * 0.16).toFixed(1),
        stroke: colours[i % colours.length],
        "stroke-width": (r * (0.06 + rng() * 0.13)).toFixed(1),
        "stroke-linecap": rng() < 0.5 ? "round" : "square",
        opacity: (0.68 + rng() * 0.3).toFixed(2)
      }));
    }
  } else if (shape.family === "blocks") {
    const count = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i++) {
      const w = r * (0.45 + rng() * 0.85);
      const h = r * (0.22 + rng() * 0.55);
      const x = (rng() - 0.5) * r * 0.9 - w / 2;
      const y = (rng() - 0.5) * r * 0.9 - h / 2;
      group.appendChild(node("rect", {
        x: x.toFixed(1), y: y.toFixed(1),
        width: w.toFixed(1), height: h.toFixed(1),
        rx: (rng() < 0.35 ? h * 0.5 : 0).toFixed(1),
        fill: colours[i % colours.length],
        opacity: (0.66 + rng() * 0.3).toFixed(2),
        transform: `rotate(${((rng() - 0.5) * 45).toFixed(1)} ${(x + w / 2).toFixed(1)} ${(y + h / 2).toFixed(1)})`
      }));
    }
  } else if (shape.family === "constellation") {
    const count = 4 + Math.floor(rng() * 4);
    const points = [];
    for (let i = 0; i < count; i++) {
      points.push([(rng() - 0.5) * r * 1.55, (rng() - 0.5) * r * 1.55]);
    }
    group.appendChild(node("polyline", {
      points: points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "),
      fill: "none",
      stroke: colours[0],
      "stroke-width": (r * 0.045).toFixed(1),
      opacity: "0.7"
    }));
    points.forEach(([x, y], i) => group.appendChild(node("circle", {
      cx: x.toFixed(1), cy: y.toFixed(1),
      r: (r * (0.07 + rng() * 0.1)).toFixed(1),
      fill: colours[(i + 1) % colours.length],
      opacity: "0.92"
    })));
  } else {
    const p = () => (rng() - 0.5) * r * 1.7;
    const x0 = p(), y0 = p();
    const x1 = p(), y1 = p(), x2 = p(), y2 = p(), x3 = p(), y3 = p();
    group.appendChild(node("path", {
      d: `M ${x0.toFixed(1)} ${y0.toFixed(1)} C ${x1.toFixed(1)} ${y1.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}, ${x3.toFixed(1)} ${y3.toFixed(1)}`,
      fill: "none",
      stroke: colours[0],
      "stroke-width": (r * (0.08 + rng() * 0.12)).toFixed(1),
      "stroke-linecap": "round",
      opacity: "0.88"
    }));
    group.appendChild(node("circle", {
      cx: x3.toFixed(1), cy: y3.toFixed(1),
      r: (r * (0.11 + rng() * 0.11)).toFixed(1),
      fill: colours[1],
      opacity: "0.92"
    }));
  }

  g.appendChild(group);
}
