/**
 * Planar face/edge/vertex graph shared by every tiling.
 *
 * Invariants:
 * - `fv[f]` lists a face's vertices in cyclic order; `fe[f][i]` is the edge from `fv[f][i]` to `fv[f][i+1]`.
 * - `ve[v]` lists a vertex's edges sorted by angle; `vf[v][i]` is the face in the sector between
 *   `ve[v][i]` and `ve[v][i+1]` (cyclic), or -1 when that sector is outside the grid.
 * - `ef[2e]`, `ef[2e+1]` are the faces on either side of edge e (-1 = outside the grid).
 * - `ring[f]` is every face touching f (by edge or vertex) in cyclic order, -1 for outside; an
 *   entry may repeat.
 * Grids are immutable and cached by key, so puzzles store only (tiling, w, h).
 */
export interface Grid {
  key: string;
  nv: number;
  ne: number;
  nf: number;
  vx: Float64Array;
  vy: Float64Array;
  ev: Int32Array;
  ef: Int32Array;
  fv: number[][];
  fe: number[][];
  ve: number[][];
  vf: number[][];
  ring: number[][];
  fcx: Float64Array;
  fcy: Float64Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Typical edge length, for scaling strokes and hit radii. */
  unit: number;
}

type Pt = readonly [number, number];
type Polys = Pt[][];

export interface Tiling {
  id: string;
  label: string;
  /** Simon Tatham's loopy grid-type number (`t` param), if the face order matches his. */
  sgtType?: number;
  /** Grid description sgt prefixes to the clue string (e.g. "0" for current triangular). */
  sgtDesc?: string;
  /** Smallest width/height that yields a sensible grid. */
  minW: number;
  minH: number;
  /** Not offered for generation (kept for importing). */
  hidden?: boolean;
  /** Faces in a fixed order; that order is the clue order in every text format. */
  faces(w: number, h: number): Polys;
}

const tilings = new Map<string, Tiling>();

/** Registering an existing id replaces it. Extra tilings become available to import, play and generate. */
export function registerTiling(t: Tiling): void {
  tilings.set(t.id, t);
}

export function getTiling(id: string): Tiling | undefined {
  return tilings.get(id);
}

export function listTilings(): Tiling[] {
  return [...tilings.values()];
}

const cache = new Map<string, Grid>();

export function getGrid(tiling: string, w: number, h: number): Grid {
  const key = `${tiling}:${w}x${h}`;
  let g = cache.get(key);
  if (!g) {
    const t = tilings.get(tiling);
    if (!t) throw new Error(`unknown tiling "${tiling}"`);
    g = buildGrid(key, t.faces(w, h));
    if (cache.size > 64) cache.delete(cache.keys().next().value!);
    cache.set(key, g);
  }
  return g;
}

export function buildGrid(key: string, polys: Polys): Grid {
  const vIndex = new Map<string, number>();
  const xs: number[] = [], ys: number[] = [];
  const vid = (p: Pt): number => {
    const k = `${p[0]},${p[1]}`;
    let i = vIndex.get(k);
    if (i === undefined) {
      i = xs.length;
      vIndex.set(k, i);
      xs.push(p[0]);
      ys.push(p[1]);
    }
    return i;
  };
  const fv = polys.map((poly) => poly.map(vid));
  const eIndex = new Map<number, number>();
  const evl: number[] = [], efl: number[] = [];
  const nvGuess = xs.length + 1;
  const fe = fv.map((vs, f) => vs.map((a, i) => {
    const b = vs[(i + 1) % vs.length]!;
    const k = Math.min(a, b) * nvGuess + Math.max(a, b);
    let e = eIndex.get(k);
    if (e === undefined) {
      e = evl.length / 2;
      eIndex.set(k, e);
      evl.push(a, b);
      efl.push(f, -1);
    } else {
      if (efl[2 * e + 1] !== -1) throw new Error("edge shared by more than two faces");
      efl[2 * e + 1] = f;
    }
    return e;
  }));
  const nv = xs.length, ne = evl.length / 2, nf = fv.length;
  const vx = Float64Array.from(xs), vy = Float64Array.from(ys);
  const ev = Int32Array.from(evl), ef = Int32Array.from(efl);
  const fcx = new Float64Array(nf), fcy = new Float64Array(nf);
  fv.forEach((vs, f) => {
    for (const v of vs) {
      fcx[f]! += vx[v]!;
      fcy[f]! += vy[v]!;
    }
    fcx[f]! /= vs.length;
    fcy[f]! /= vs.length;
  });

  const ve: number[][] = Array.from({ length: nv }, () => []);
  for (let e = 0; e < ne; e++) {
    ve[ev[2 * e]!]!.push(e);
    ve[ev[2 * e + 1]!]!.push(e);
  }
  const other = (e: number, v: number) => (ev[2 * e] === v ? ev[2 * e + 1]! : ev[2 * e]!);
  const ang = (v: number, x: number, y: number) => Math.atan2(y - vy[v]!, x - vx[v]!);
  for (let v = 0; v < nv; v++) {
    const a = new Map(ve[v]!.map((e) => [e, ang(v, vx[other(e, v)]!, vy[other(e, v)]!)]));
    ve[v]!.sort((p, q) => a.get(p)! - a.get(q)!);
  }
  const vf: number[][] = ve.map((es, v) => es.map((e1, i) => {
    const e2 = es[(i + 1) % es.length]!;
    const a1 = ang(v, vx[other(e1, v)]!, vy[other(e1, v)]!);
    let span = ang(v, vx[other(e2, v)]!, vy[other(e2, v)]!) - a1;
    if (span <= 0) span += 2 * Math.PI;
    for (const f of [ef[2 * e1]!, ef[2 * e1 + 1]!]) {
      if (f < 0 || (ef[2 * e2] !== f && ef[2 * e2 + 1] !== f)) continue;
      let d = ang(v, fcx[f]!, fcy[f]!) - a1;
      if (d <= 0) d += 2 * Math.PI;
      if (d < span) return f;
    }
    return -1;
  }));

  const ring = fv.map((vs, f) => {
    const out: number[] = [];
    const k = vs.length;
    for (let i = 0; i < k; i++) {
      const v = vs[i]!;
      const prevE = fe[f]![(i - 1 + k) % k]!, nextE = fe[f]![i]!;
      const es = ve[v]!, n = es.length;
      const p = es.indexOf(prevE), q = es.indexOf(nextE);
      // walk the sectors around v from prevE to nextE on the side away from f
      if (vf[v]![p] === f && (p + 1) % n === q) {
        for (let j = (p - 1 + n) % n; ; j = (j - 1 + n) % n) {
          out.push(vf[v]![j]!);
          if (j === q) break;
        }
      } else {
        for (let j = p; j !== (q - 1 + n) % n; j = (j + 1) % n) out.push(vf[v]![j]!);
        out.push(vf[v]![(q - 1 + n) % n]!);
      }
    }
    return out;
  });

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let v = 0; v < nv; v++) {
    minX = Math.min(minX, vx[v]!);
    maxX = Math.max(maxX, vx[v]!);
    minY = Math.min(minY, vy[v]!);
    maxY = Math.max(maxY, vy[v]!);
  }
  let total = 0;
  for (let e = 0; e < ne; e++) {
    total += Math.hypot(vx[ev[2 * e]!]! - vx[ev[2 * e + 1]!]!, vy[ev[2 * e]!]! - vy[ev[2 * e + 1]!]!);
  }
  return {
    key, nv, ne, nf, vx, vy, ev, ef, fv, fe, ve, vf, ring, fcx, fcy,
    minX, minY, maxX, maxY, unit: ne ? total / ne : 1,
  };
}

/** The other endpoint of e. */
export function otherEnd(g: Grid, e: number, v: number): number {
  return g.ev[2 * e] === v ? g.ev[2 * e + 1]! : g.ev[2 * e]!;
}

/** The edge joining a and b, or -1. */
export function edgeBetween(g: Grid, a: number, b: number): number {
  for (const e of g.ve[a]!) if (otherEnd(g, e, a) === b) return e;
  return -1;
}

/**
 * Face permutation for a half-turn about the grid's centre, or null if the grid isn't
 * half-turn symmetric.
 */
export function halfTurn(g: Grid): Int32Array | null {
  const cx = g.minX + g.maxX, cy = g.minY + g.maxY;
  const at = new Map<string, number>();
  const key = (x: number, y: number) => `${Math.round(x * 4)},${Math.round(y * 4)}`;
  for (let f = 0; f < g.nf; f++) at.set(key(g.fcx[f]!, g.fcy[f]!), f);
  const out = new Int32Array(g.nf);
  for (let f = 0; f < g.nf; f++) {
    const m = at.get(key(cx - g.fcx[f]!, cy - g.fcy[f]!));
    if (m === undefined) return null;
    out[f] = m;
  }
  return out;
}

// --- built-in tilings ---
// Face order and integer coordinates must match sgt loopy's, so that sgt game ids (clues
// listed in face order) import and export unchanged.

function each(w: number, h: number, fn: (x: number, y: number, out: Polys) => void): Polys {
  const out: Polys = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fn(x, y, out);
  return out;
}

registerTiling({
  id: "square", label: "squares", sgtType: 0, minW: 2, minH: 2,
  faces: (w, h) => each(w, h, (x, y, out) => {
    const a = 20, px = a * x, py = a * y;
    out.push([[px, py], [px + a, py], [px + a, py + a], [px, py + a]]);
  }),
});

function triangular(w: number, h: number, legacy: boolean): Polys {
  const vx = 15, vy = 26;
  const out: Polys = [];
  if (legacy) {
    const dot = (x: number, y: number): Pt => [x * 2 * vx + (y % 2 ? vx : 0), y * vy];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (y % 2) {
          out.push([dot(x, y), dot(x + 1, y + 1), dot(x, y + 1)]);
          out.push([dot(x, y), dot(x + 1, y), dot(x + 1, y + 1)]);
        } else {
          out.push([dot(x, y), dot(x + 1, y), dot(x, y + 1)]);
          out.push([dot(x + 1, y), dot(x + 1, y + 1), dot(x, y + 1)]);
        }
      }
    }
    return out;
  }
  for (let y = 0; y < h; y++) {
    let y0 = y * vy, y1 = y * vy;
    if (y % 2) y1 += vy;
    else y0 += vy;
    for (let x = 0; x <= w; x++) {
      if (h % 2 === 1 && y === h - 1 && (x === 0 || x === w)) continue;
      const x0 = 2 * x * vx, x1 = x0 + vx, x2 = x1 + vx;
      out.push([[x0, y0], [x1, y1], [x2, y0]]);
    }
    for (let x = 0; x < w; x++) {
      const x0 = (2 * x + 1) * vx, x1 = x0 + vx, x2 = x1 + vx;
      out.push([[x0, y1], [x1, y0], [x2, y1]]);
    }
  }
  return out;
}

registerTiling({
  id: "triangular", label: "triangles", sgtType: 1, sgtDesc: "0", minW: 3, minH: 3,
  faces: (w, h) => triangular(w, h, false),
});

registerTiling({
  id: "triangular-legacy", label: "triangles (old sgt layout)", sgtType: 1, minW: 3, minH: 3, hidden: true,
  faces: (w, h) => triangular(w, h, true),
});

registerTiling({
  id: "honeycomb", label: "hexagons", sgtType: 2, minW: 2, minH: 2,
  faces: (w, h) => each(w, h, (x, y, out) => {
    const a = 15, b = 26, cx = 3 * a * x, cy = 2 * b * y + (x % 2 ? b : 0);
    out.push([[cx - a, cy - b], [cx + a, cy - b], [cx + 2 * a, cy], [cx + a, cy + b], [cx - a, cy + b], [cx - 2 * a, cy]]);
  }),
});

registerTiling({
  id: "snub-square", label: "snub square", sgtType: 3, minW: 3, minH: 3,
  faces: (w, h) => each(w, h, (x, y, out) => {
    const a = 15, b = 26, px = (a + b) * x, py = (a + b) * y, odd = (x + y) % 2 === 1;
    out.push(odd
      ? [[px + a, py], [px + a + b, py + a], [px + b, py + a + b], [px, py + b]]
      : [[px + b, py], [px + a + b, py + b], [px + a, py + a + b], [px, py + a]]);
    if (x > 0) {
      out.push(odd
        ? [[px + a, py], [px, py + b], [px - a, py]]
        : [[px, py + a], [px + a, py + a + b], [px - a, py + a + b]]);
    }
    if (y > 0) {
      out.push(odd
        ? [[px + a, py], [px + a + b, py - a], [px + a + b, py + a]]
        : [[px, py - a], [px + b, py], [px, py + a]]);
    }
  }),
});

registerTiling({
  id: "cairo", label: "cairo pentagons", sgtType: 4, minW: 3, minH: 3,
  faces: (w, h) => each(w, h, (x, y, out) => {
    const a = 14, b = 31, px = 2 * b * x, py = 2 * b * y, odd = (x + y) % 2 === 1;
    if (y > 0) {
      out.push(odd
        ? [[px + a, py - b], [px + 2 * b - a, py - b], [px + 2 * b, py], [px + b, py + a], [px, py]]
        : [[px, py], [px + b, py - a], [px + 2 * b, py], [px + 2 * b - a, py + b], [px + a, py + b]]);
    }
    if (x > 0) {
      out.push(odd
        ? [[px, py], [px + b, py + a], [px + b, py + 2 * b - a], [px, py + 2 * b], [px - a, py + b]]
        : [[px, py], [px + a, py + b], [px, py + 2 * b], [px - b, py + 2 * b - a], [px - b, py + a]]);
    }
  }),
});

registerTiling({
  id: "great-hexagonal", label: "great hexagonal", sgtType: 5, minW: 3, minH: 3,
  faces: (w, h) => each(w, h, (x, y, out) => {
    const a = 15, b = 26, px = (3 * a + b) * x, py = (2 * a + 2 * b) * y + (x % 2 ? a + b : 0);
    out.push([[px - a, py - b], [px + a, py - b], [px + 2 * a, py], [px + a, py + b], [px - a, py + b], [px - 2 * a, py]]);
    if (y < h - 1) out.push([[px - a, py + b], [px + a, py + b], [px + a, py + 2 * a + b], [px - a, py + 2 * a + b]]);
    if (x < w - 1 && (x % 2 === 0 || y < h - 1)) {
      out.push([[px + 2 * a, py], [px + 2 * a + b, py + a], [px + a + b, py + a + b], [px + a, py + b]]);
    }
    if (x > 0 && (x % 2 === 0 || y < h - 1)) {
      out.push([[px - 2 * a, py], [px - a, py + b], [px - a - b, py + a + b], [px - 2 * a - b, py + a]]);
    }
    if (x < w - 1 && y < h - 1) out.push([[px + a, py + b], [px + a + b, py + a + b], [px + a, py + 2 * a + b]]);
    if (x > 0 && y < h - 1) out.push([[px - a, py + b], [px - a, py + 2 * a + b], [px - a - b, py + a + b]]);
  }),
});

registerTiling({
  id: "octagonal", label: "octagons", sgtType: 6, minW: 2, minH: 2,
  faces: (w, h) => each(w, h, (x, y, out) => {
    const a = 29, b = 41, px = (2 * a + b) * x, py = (2 * a + b) * y;
    out.push([
      [px + a, py], [px + a + b, py], [px + 2 * a + b, py + a], [px + 2 * a + b, py + a + b],
      [px + a + b, py + 2 * a + b], [px + a, py + 2 * a + b], [px, py + a + b], [px, py + a],
    ]);
    if (x > 0 && y > 0) out.push([[px, py - a], [px + a, py], [px, py + a], [px - a, py]]);
  }),
});

registerTiling({
  id: "kites", label: "kites", sgtType: 7, minW: 2, minH: 2,
  faces: (w, h) => each(w, h, (x, y, out) => {
    const a = 15, b = 26, px = 4 * b * x + (y % 2 ? 2 * b : 0), py = 6 * a * y;
    const o: Pt = [px, py];
    out.push([o, [px + 2 * b, py], [px + 2 * b, py + 2 * a], [px + b, py + 3 * a]]);
    out.push([o, [px + b, py + 3 * a], [px, py + 4 * a], [px - b, py + 3 * a]]);
    out.push([o, [px - b, py + 3 * a], [px - 2 * b, py + 2 * a], [px - 2 * b, py]]);
    out.push([o, [px - 2 * b, py], [px - 2 * b, py - 2 * a], [px - b, py - 3 * a]]);
    out.push([o, [px - b, py - 3 * a], [px, py - 4 * a], [px + b, py - 3 * a]]);
    out.push([o, [px + b, py - 3 * a], [px + 2 * b, py - 2 * a], [px + 2 * b, py]]);
  }),
});

registerTiling({
  id: "kagome", label: "kagome", sgtType: 14, minW: 2, minH: 2,
  faces: (w, h) => each(w, h, (x, y, out) => {
    const a = 15, b = 26, px = 4 * a * x + (y % 2 ? 2 * a : 0), py = 2 * b * y;
    out.push([[px + a, py - b], [px + 2 * a, py], [px + a, py + b], [px - a, py + b], [px - 2 * a, py], [px - a, py - b]]);
    if (x < w - 1 || (!(y % 2) && y)) out.push([[px + 3 * a, py - b], [px + 2 * a, py], [px + a, py - b]]);
    if (x < w - 1 || (!(y % 2) && y < h - 1)) out.push([[px + 3 * a, py + b], [px + a, py + b], [px + 2 * a, py]]);
    if (!x && y % 2) {
      out.push([[px - a, py - b], [px - 2 * a, py], [px - 3 * a, py - b]]);
      if (y < h - 1) out.push([[px - a, py + b], [px - 3 * a, py + b], [px - 2 * a, py]]);
    }
  }),
});
