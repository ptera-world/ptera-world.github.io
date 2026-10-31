import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import {
  analyzeModel, decides, solveLevel, trialRule,
  type Analysis, type Constraint, type Doms, type Emit, type Model, type Rule,
} from "../../lib/grid-kit/csp";
import { cutVertices, neighbours, pieces } from "../../lib/grid-kit/grid";
import { cellList, type Focus } from "../../lib/grid-kit/names";
import { decodeBorders, encodeBorders } from "../../lib/pzpr";
import { parseRegionLetters, regionLetters } from "../../lib/shade-kit/letters";
import { attemptLevel, canonicalRegions, shapeToLevel } from "../../lib/shade-kit/repair";
import {
  ANY, B, W, describeShade, initShade, readShade, reduceShade, solvedShade, wrongShadeHint,
  type ShadeAction, type ShadeInteraction, type ShadeState,
} from "../../lib/shade-kit/state";

export interface LitsPuzzle {
  w: number;
  h: number;
  /** Row-major region id per cell, 0-based and contiguous. */
  regions: number[];
}

export const LEVEL_NAMES = ["easy", "normal", "hard"] as const;
export type Level = 0 | 1 | 2;

export const params = defineSchema({
  width: { type: "int", label: "width", default: 8, min: 5, max: 12 },
  height: { type: "int", label: "height", default: 8, min: 5, max: 12 },
  difficulty: {
    type: "enum", label: "difficulty", default: "normal",
    options: [
      { value: "easy", label: "easy", description: "where a region's piece can and can't go, and no 2×2 blocks" },
      { value: "normal", label: "normal", description: "also matching shapes and keeping the shading in one piece" },
      { value: "hard", label: "hard", description: "also trying a cell both ways" },
    ],
  },
});

export type Shape = "L" | "I" | "T" | "S";

/** A tetromino a region could hold: its cells (ascending) and shape. */
export interface Placement {
  cells: number[];
  shape: Shape;
}

export interface Geometry {
  w: number;
  h: number;
  n: number;
  nbrs: number[][];
  /** Cells of each region. */
  cells: number[][];
  /** Every tetromino inside each region (2×2 squares left out: they can never be shaded). */
  placements: Placement[][];
  /** Regions sharing an edge with each region. */
  touching: number[][];
  /** Top-left cells of every 2×2 block. */
  blocks: number[][];
}

const SHAPES: Record<string, Shape> = {};
{
  const base: [Shape, [number, number][]][] = [
    ["I", [[0, 0], [1, 0], [2, 0], [3, 0]]],
    ["L", [[0, 0], [0, 1], [0, 2], [1, 2]]],
    ["T", [[0, 0], [1, 0], [2, 0], [1, 1]]],
    ["S", [[1, 0], [2, 0], [0, 1], [1, 1]]],
  ];
  for (const [shape, pts] of base) SHAPES[canonical(pts)] = shape;
}

/** The same key for a tetromino under every rotation and reflection. */
function canonical(pts: readonly [number, number][]): string {
  let best = "";
  for (let t = 0; t < 8; t++) {
    const q = pts.map(([x, y]) => {
      const [a, b] = t & 1 ? [y, x] : [x, y];
      return [t & 2 ? -a : a, t & 4 ? -b : b] as [number, number];
    });
    const mx = Math.min(...q.map((p) => p[0])), my = Math.min(...q.map((p) => p[1]));
    const key = q.map(([x, y]) => `${x - mx},${y - my}`).sort().join(";");
    if (!best || key < best) best = key;
  }
  return best;
}

/** The shape of four connected cells, or null for a 2×2 square. */
export function shapeOf(w: number, cells: readonly number[]): Shape | null {
  return SHAPES[canonical(cells.map((c) => [c % w, Math.floor(c / w)]))] ?? null;
}

/** Every set of four connected cells within `cells`, as sorted lists. */
function tetrominoes(nbrs: readonly number[][], cells: readonly number[]): number[][] {
  const inside = new Set(cells);
  const seen = new Set<string>(), out: number[][] = [];
  const grow = (set: number[]) => {
    if (set.length === 4) {
      const key = set.join(",");
      if (!seen.has(key)) { seen.add(key); out.push(set); }
      return;
    }
    for (const c of set) for (const d of nbrs[c]!) {
      if (!inside.has(d) || set.includes(d) || d < set[0]!) continue;
      grow([...set, d].sort((a, b) => a - b));
    }
  };
  for (const c of cells) grow([c]);
  return out;
}

const geoCache = new WeakMap<LitsPuzzle, Geometry>();

export function geometry(p: LitsPuzzle): Geometry {
  const hit = geoCache.get(p);
  if (hit) return hit;
  const { w, h } = p, n = w * h;
  const nbrs = neighbours(w, h);
  const count = p.regions.reduce((a, r) => Math.max(a, r + 1), 0);
  const cells: number[][] = Array.from({ length: count }, () => []);
  for (let c = 0; c < n; c++) cells[p.regions[c]!]!.push(c);
  const placements = cells.map((rc) => tetrominoes(nbrs, rc).flatMap((t) => {
    const shape = shapeOf(w, t);
    return shape ? [{ cells: t, shape }] : [];
  }));
  const touching = cells.map((rc, r) => [...new Set(rc.flatMap((c) => nbrs[c]!.map((d) => p.regions[d]!)))].filter((x) => x !== r));
  const blocks: number[][] = [];
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const c = y * w + x;
    blocks.push([c, c + 1, c + w, c + w + 1]);
  }
  const g = { w, h, n, nbrs, cells, placements, touching, blocks };
  geoCache.set(p, g);
  return g;
}

// --- model ---

/** Placements of region r that fit the domains: every shaded cell of the region in it, no unshaded cell in it. */
export function fitting(g: Geometry, r: number, k: Doms): Placement[] {
  const rc = g.cells[r]!;
  return g.placements[r]!.filter((pl) => pl.cells.every((c) => k[c] !== W) && rc.every((c) => k[c] !== B || pl.cells.includes(c)));
}

/** The tetromino region r is known to hold (all four cells shaded), or null. */
function decided(g: Geometry, r: number, k: Doms): Placement | null {
  const shaded = g.cells[r]!.filter((c) => k[c] === B);
  if (shaded.length !== 4) return null;
  return g.placements[r]!.find((pl) => pl.cells.every((c, i) => c === shaded[i])) ?? null;
}

const touches = (g: Geometry, a: readonly number[], b: readonly number[]) => a.some((c) => g.nbrs[c]!.some((d) => b.includes(d)));

/** Shaded cells all connected, and no two touching tetrominoes of the same shape. */
function valid(p: LitsPuzzle, g: Geometry, k: Doms): boolean {
  if (pieces(g.nbrs, (c) => k[c] === B).count > 1) return false;
  const held = g.cells.map((_, r) => decided(g, r, k));
  for (let r = 0; r < held.length; r++) {
    const a = held[r];
    if (!a) return false;
    for (const s of g.touching[r]!) if (s > r && held[s]?.shape === a.shape && touches(g, a.cells, held[s]!.cells)) return false;
  }
  return true;
}

/** Deductions that narrow a region to the placements left: cells in all of them are shaded, cells in none aren't. */
function narrowTo(g: Geometry, r: number, k: Doms, fits: readonly Placement[], kind: string, level: number, because: number[], emit: Emit): boolean {
  const open = g.cells[r]!.filter((c) => k[c] === ANY);
  const must = open.filter((c) => fits.every((pl) => pl.cells.includes(c)));
  const never = open.filter((c) => !fits.some((pl) => pl.cells.includes(c)));
  if (never.length && emit({ kind: `${kind}-never`, level, vars: never, keep: W, because, data: { region: r } })) return true;
  if (must.length && emit({ kind: `${kind}-must`, level, vars: must, keep: B, because, data: { region: r } })) return true;
  return false;
}

const modelCache = new WeakMap<LitsPuzzle, Model>();

/** One tetromino per region, no shaded 2×2, all shading connected, no two touching tetrominoes alike. */
export function model(p: LitsPuzzle): Model {
  const hit = modelCache.get(p);
  if (hit) return hit;
  const g = geometry(p);
  const constraints: Constraint[] = [];
  g.cells.forEach((rc, r) => {
    constraints.push({
      vars: rc,
      run(k, emit) {
        const fits = fitting(g, r, k);
        if (!fits.length) return false;
        narrowTo(g, r, k, fits, "fit", 0, rc.filter((c) => k[c] !== ANY), emit);
        return true;
      },
    });
  });
  for (const blk of g.blocks) {
    constraints.push({
      vars: blk,
      run(k, emit) {
        const shaded = blk.filter((c) => k[c] === B), open = blk.filter((c) => k[c] === ANY);
        if (shaded.length === 4) return false;
        if (shaded.length === 3 && open.length === 1) emit({ kind: "pool", level: 0, vars: open, keep: W, because: shaded });
        return true;
      },
    });
  }
  /** Placements that would sit beside a known tetromino of the same shape, or finish a shaded 2×2, are out. */
  const shapes: Rule = {
    level: 0,
    kinds: ["shape-never", "shape-must"],
    run(k, emit) {
      const held = g.cells.map((_, r) => decided(g, r, k));
      for (let r = 0; r < g.cells.length; r++) {
        if (held[r]) continue;
        const before = fitting(g, r, k);
        const clash = new Set<number>();
        const fits = before.filter((pl) => {
          for (const s of g.touching[r]!) {
            const o = held[s];
            if (o && o.shape === pl.shape && touches(g, pl.cells, o.cells)) { o.cells.forEach((c) => clash.add(c)); return false; }
          }
          const on = new Set(pl.cells);
          return !g.blocks.some((blk) => blk.some((c) => on.has(c)) && blk.every((c) => on.has(c) || k[c] === B));
        });
        if (fits.length === before.length) continue;
        if (!fits.length) return false;
        if (narrowTo(g, r, k, fits, "shape", 0, [...clash], emit)) return true;
      }
      return true;
    },
  };
  /** Shading is one piece: shaded cells must still reach each other, and a cell every path between them needs is shaded. */
  const connect: Rule = {
    level: 1,
    kinds: ["connect"],
    run(k, emit) {
      const open = (c: number) => k[c] !== W;
      const pc = pieces(g.nbrs, open);
      const shaded = Array.from({ length: g.n }, (_, c) => c).filter((c) => k[c] === B);
      if (!shaded.length) return true;
      if (shaded.some((c) => pc.id[c] !== pc.id[shaded[0]!])) return false;
      const cut = cutVertices(g.nbrs, open);
      for (let c = 0; c < g.n; c++) {
        if (!cut[c] || k[c] !== ANY) continue;
        const rest = pieces(g.nbrs, (d) => d !== c && open(d));
        if (shaded.every((d) => rest.id[d] === rest.id[shaded[0]!])) continue;
        if (emit({ kind: "connect", level: 1, vars: [c], keep: B, because: shaded })) return true;
      }
      return true;
    },
  };
  const m: Model = { n: g.n, constraints, rules: [shapes, connect], countLevel: 0, complete: (k) => valid(p, g, k) };
  m.rules.push(trialRule(m, 2, 1));
  modelCache.set(p, m);
  return m;
}

export const initialDoms = (p: LitsPuzzle): Doms => new Int32Array(p.w * p.h).fill(ANY);

const analyses = new WeakMap<LitsPuzzle, Analysis>();

export function analyze(p: LitsPuzzle): Analysis {
  let a = analyses.get(p);
  if (!a) analyses.set(p, a = analyzeModel(model(p), initialDoms(p), 2));
  return a;
}

const never = () => false;
export const readMarks = (p: LitsPuzzle, s: ShadeState): Doms => readShade(initialDoms(p), analyze(p), s, never);

// --- rules check ---

export interface LitsConflicts extends Record<string, number[]> {
  /** Regions with more than four shaded cells, or four that aren't connected (their shaded cells). */
  regions: number[];
  /** Shaded 2×2 blocks. */
  pools: number[];
  /** Touching tetrominoes of the same shape. */
  alike: number[];
}

export function findConflicts(p: LitsPuzzle, marks: readonly number[]): LitsConflicts {
  const g = geometry(p);
  const shaded = (c: number) => marks[c] === 1;
  const regions: number[] = [];
  const held: (Placement | null)[] = g.cells.map((rc, r) => {
    const s = rc.filter(shaded);
    if (s.length > 4 || (s.length === 4 && !g.placements[r]!.some((pl) => pl.cells.every((c, i) => c === s[i])))) regions.push(...s);
    return s.length === 4 ? g.placements[r]!.find((pl) => pl.cells.every((c, i) => c === s[i])) ?? null : null;
  });
  const pools = [...new Set(g.blocks.filter((blk) => blk.every(shaded)).flat())];
  const alike = new Set<number>();
  held.forEach((a, r) => {
    if (!a) return;
    for (const s of g.touching[r]!) if (held[s]?.shape === a.shape && touches(g, a.cells, held[s]!.cells)) a.cells.forEach((c) => alike.add(c));
  });
  return { regions, pools, alike: [...alike] };
}

export function isSolved(p: LitsPuzzle, s: ShadeState): boolean {
  const k = Int32Array.from(s.marks, (m) => (m === 1 ? B : W));
  const g = geometry(p);
  return g.blocks.every((blk) => !blk.every((c) => k[c] === B)) && valid(p, g, k);
}

// --- formats ---

const URL_RE = /(?:^|[?/])lits\/(\d+)\/(\d+)\/([0-9a-v]+)\/?$/;

function checked(w: number, h: number, regions: number[]): LitsPuzzle {
  if (!(w >= 2 && h >= 2 && w <= 40 && h <= 40)) throw new Error("size must be between 2×2 and 40×40");
  return { w, h, regions };
}

/** puzz.link / pzv.jp URLs: `…?lits/W/H/<borders>`. */
export const pzprFormat: Format<LitsPuzzle> = {
  id: "pzpr",
  label: "puzz.link URL",
  detect: (t) => URL_RE.test(t.trim()),
  parse(t) {
    const m = URL_RE.exec(t.trim());
    if (!m) throw new Error("expected a puzz.link LITS URL, e.g. https://puzz.link/p?lits/8/8/…");
    const w = Number(m[1]), h = Number(m[2]);
    return checked(w, h, decodeBorders(w, h, m[3]!).regions);
  },
  serialize: (p) => `https://puzz.link/p?lits/${p.w}/${p.h}/${encodeBorders(p.w, p.h, p.regions)}`,
};

/** One row per line, one character per cell; each connected group of equal characters is one region. */
export const textFormat: Format<LitsPuzzle> = {
  id: "text",
  label: "region letters, one row per line",
  detect: (t) => /^[^\s]+(\n[^\s]+)+$/.test(t.trim()),
  parse: (t) => { const r = parseRegionLetters(t); return checked(r.w, r.h, r.regions); },
  serialize: (p) => regionLetters(p.w, p.h, p.regions),
};

// --- hints ---

export const wrongMarksHint = (p: LitsPuzzle, s: ShadeState): Hint<ShadeAction> | null => wrongShadeHint(p, analyze(p), s);

export function hint(p: LitsPuzzle, s: ShadeState): Hint<ShadeAction> | null {
  const c = findConflicts(p, s.marks);
  if (c.pools.length) return { message: `${cellList(p, c.pools)} make a shaded 2×2 block`, focus: { cells: c.pools, because: [] } satisfies Focus };
  if (c.regions.length) return { message: `${cellList(p, c.regions)} can't all be one region's tetromino`, focus: { cells: c.regions, because: [] } satisfies Focus };
  if (c.alike.length) return { message: `${cellList(p, c.alike)} are touching tetrominoes of the same shape`, focus: { cells: c.alike, because: [] } satisfies Focus };
  const a = analyze(p);
  if (a.count === 0) return { message: "this puzzle has no solution" };
  if (a.count === 2) return { message: "this puzzle has more than one solution, so it can need a guess" };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: LitsPuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 3 };
  return { label: LEVEL_NAMES[a.level]!, score: a.level };
}

// --- generation ---

/**
 * A dense, connected shading of tetrominoes that follows the rules: no shaded 2×2, and no two
 * touching pieces of the same shape. Greedy packing, then rounds of taking one piece out (when
 * the rest stays connected) and packing again, kept whenever the piece count doesn't drop.
 */
export function plantTetrominoes(w: number, h: number, rng: Rng): { owner: Int32Array; pieces: Placement[] } {
  const n = w * h, nbrs = neighbours(w, h);
  const all = tetrominoes(nbrs, Array.from({ length: n }, (_, c) => c)).flatMap((t) => {
    const shape = shapeOf(w, t);
    return shape ? [{ cells: t, shape }] : [];
  });
  const pack = (start: Placement[]): Placement[] => {
    const placed = start.slice();
    const owner = new Int32Array(n).fill(-1);
    placed.forEach((pl, i) => pl.cells.forEach((c) => (owner[c] = i)));
    const fits = (pl: Placement) => {
      if (pl.cells.some((c) => owner[c] !== -1)) return false;
      if (placed.length && !pl.cells.some((c) => nbrs[c]!.some((d) => owner[d] !== -1))) return false;
      for (const c of pl.cells) for (const d of nbrs[c]!) {
        const o = owner[d]!;
        if (o !== -1 && placed[o]!.shape === pl.shape) return false;
      }
      const on = (c: number) => owner[c] !== -1 || pl.cells.includes(c);
      for (const c of pl.cells) {
        const x = c % w, y = Math.floor(c / w);
        for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]] as const) {
          const tx = x + dx, ty = y + dy;
          if (tx < 0 || ty < 0 || tx >= w - 1 || ty >= h - 1) continue;
          const t = ty * w + tx;
          if (on(t) && on(t + 1) && on(t + w) && on(t + w + 1)) return false;
        }
      }
      return true;
    };
    for (;;) {
      const options = all.filter(fits);
      if (!options.length) return placed;
      const pl = rng.pick(options);
      pl.cells.forEach((c) => (owner[c] = placed.length));
      placed.push(pl);
    }
  };
  let best = pack([]);
  for (let round = 0; round < 2 * n; round++) {
    const drop = rng.int(best.length);
    const rest = best.filter((_, i) => i !== drop);
    const on = new Set(rest.flatMap((pl) => pl.cells));
    if (rest.length && pieces(nbrs, (c) => on.has(c)).count !== 1) continue;
    const next = pack(rest);
    if (next.length >= best.length) best = next;
  }
  const owner = new Int32Array(n).fill(-1);
  best.forEach((pl, i) => pl.cells.forEach((c) => (owner[c] = i)));
  return { owner, pieces: best };
}

/**
 * Regions grown from each planted tetromino until every cell belongs to one, each step giving
 * some unshaded cell to the neighbouring region whose tetromino count it raises least. Null when
 * some cell can't be reached.
 */
export function layout(w: number, h: number, rng: Rng): { regions: number[]; shaded: Uint8Array } | null {
  const n = w * h, nbrs = neighbours(w, h);
  const { owner, pieces: placed } = plantTetrominoes(w, h, rng);
  const region = Int32Array.from(owner);
  const members = placed.map((pl) => pl.cells.slice());
  const count = members.map((m) => tetrominoes(nbrs, m).length);
  for (;;) {
    let best: { c: number; r: number; cost: number } | null = null;
    for (const c of rng.shuffle(Array.from({ length: n }, (_, i) => i))) {
      if (region[c] !== -1) continue;
      for (const r of new Set(nbrs[c]!.map((d) => region[d]!).filter((x) => x >= 0))) {
        const cost = tetrominoes(nbrs, [...members[r]!, c]).length - count[r]!;
        if (!best || cost < best.cost) best = { c, r, cost };
      }
    }
    if (!best) break;
    region[best.c] = best.r;
    members[best.r]!.push(best.c);
    count[best.r]! += best.cost;
  }
  if (region.some((r) => r === -1)) return null;
  return { regions: Array.from(region), shaded: Uint8Array.from(owner, (o) => +(o >= 0)) };
}

/** Regions reshaped around the planted shading until the puzzle needs exactly `level`; null if that doesn't settle. */
export function shapeRegions(w: number, h: number, start: { regions: number[]; shaded: Uint8Array }, level: Level, rng: Rng, ctx: GenerateContext): Promise<number[] | null> {
  return shapeToLevel({
    nbrs: neighbours(w, h), regions: start.regions, intended: Array.from(start.shaded), counts: (v) => v === 1, level, rng, ctx,
    setup: (regions) => { const p: LitsPuzzle = { w, h, regions: regions.slice() }; return { model: model(p), start: initialDoms(p) }; },
  });
}

/** Deterministic in (params, rng): a puzzle that needs exactly `level`, or the hardest found below it. */
export function generatePuzzle(w: number, h: number, level: Level, rng: Rng, ctx: GenerateContext): Promise<LitsPuzzle> {
  return attemptLevel({
    level, rng, ctx,
    async attempt(r) {
      const start = layout(w, h, r);
      const regions = start && await shapeRegions(w, h, start, level, r, ctx);
      return regions ? { w, h, regions: canonicalRegions(regions) } : null;
    },
    levelOf: (p) => (decides(model(p), initialDoms(p), level) ? solveLevel(model(p), initialDoms(p), level) : null),
  });
}

export const lits: PuzzleDef<LitsPuzzle, ShadeState, ShadeAction, ShadeInteraction, typeof params> = {
  id: "lits",
  name: "LITS",
  aliases: ["nuruomino"],
  tags: ["logic", "grid", "regions", "shading", "nikoli"],
  description: "shade one tetromino in every region so that all the shading is one connected piece, with no 2×2 shaded block, and no two touching tetrominoes of the same shape.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "6×6 easy", params: { width: 6, height: 6, difficulty: "easy" } },
    { label: "8×8 normal", params: { width: 8, height: 8, difficulty: "normal" } },
    { label: "10×10 normal", params: { width: 10, height: 10, difficulty: "normal" } },
    { label: "10×10 hard", params: { width: 10, height: 10, difficulty: "hard" } },
  ],
  generate: (v: Values<typeof params>, rng, ctx) => generatePuzzle(v.width, v.height, LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) as Level, rng, ctx),
  formats: [pzprFormat, textFormat],
  init: (p) => initShade(p.w * p.h),
  initInteraction: () => ({ cursor: 0 }),
  reduce: (p, s, a) => reduceShade(p.w * p.h, never, s, a),
  isRetraction: (a) => a.value === 0,
  rules: () => [
    "shade four connected cells in every region outlined by thick lines: an L, I, T or S tetromino.",
    "all shaded cells form one connected piece.",
    "no 2×2 block is all shaded.",
    "two tetrominoes of the same shape never touch along a side, counting rotations and mirror images as the same shape.",
    "a dot is your own note that a cell stays unshaded. it doesn't count for anything.",
  ],
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? { board: solvedShade(a.solution, never) } : null;
  },
  hint,
  rate,
  describeAction: (p, a, before, after) => describeShade(p, a, before, after),
  describe: (p) => `${p.w}×${p.h}`,
};
