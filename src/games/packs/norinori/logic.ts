import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import {
  analyzeModel, decides, solveLevel, trialRule,
  type Analysis, type Constraint, type Doms, type Model, type Rule,
} from "../../lib/grid-kit/csp";
import { neighbours, pieces } from "../../lib/grid-kit/grid";
import { cellList, type Focus } from "../../lib/grid-kit/names";
import { decodeBorders, encodeBorders } from "../../lib/pzpr";
import { parseRegionLetters, regionLetters } from "../../lib/shade-kit/letters";
import { attemptLevel, canonicalRegions, shapeToLevel } from "../../lib/shade-kit/repair";
import {
  ANY, B, W, describeShade, initShade, readShade, reduceShade, solvedShade, wrongShadeHint,
  type ShadeAction, type ShadeInteraction, type ShadeState,
} from "../../lib/shade-kit/state";

export interface NorinoriPuzzle {
  w: number;
  h: number;
  /** Row-major region id per cell, 0-based and contiguous. */
  regions: number[];
}

export const LEVEL_NAMES = ["easy", "normal", "hard"] as const;
export type Level = 0 | 1 | 2;

export const params = defineSchema({
  width: { type: "int", label: "width", default: 8, min: 4, max: 16 },
  height: { type: "int", label: "height", default: 8, min: 4, max: 16 },
  difficulty: {
    type: "enum", label: "difficulty", default: "normal",
    options: [
      { value: "easy", label: "easy", description: "full regions, and cells next to finished dominoes" },
      { value: "normal", label: "normal", description: "also where a region's two cells can and can't go" },
      { value: "hard", label: "hard", description: "also trying a cell both ways" },
    ],
  },
});

export interface Geometry {
  w: number;
  h: number;
  n: number;
  nbrs: number[][];
  /** Cells of each region. */
  cells: number[][];
}

const geoCache = new WeakMap<NorinoriPuzzle, Geometry>();

export function geometry(p: NorinoriPuzzle): Geometry {
  const hit = geoCache.get(p);
  if (hit) return hit;
  const n = p.w * p.h;
  const count = p.regions.reduce((a, r) => Math.max(a, r + 1), 0);
  const cells: number[][] = Array.from({ length: count }, () => []);
  for (let c = 0; c < n; c++) cells[p.regions[c]!]!.push(c);
  const g = { w: p.w, h: p.h, n, nbrs: neighbours(p.w, p.h), cells };
  geoCache.set(p, g);
  return g;
}

// --- model ---

const modelCache = new WeakMap<NorinoriPuzzle, Model>();

/** Each region holds exactly two shaded cells; each shaded cell has exactly one shaded neighbor. */
export function model(p: NorinoriPuzzle): Model {
  const hit = modelCache.get(p);
  if (hit) return hit;
  const g = geometry(p);
  const constraints: Constraint[] = [];
  g.cells.forEach((cells, r) => {
    constraints.push({
      vars: cells,
      run(k, emit) {
        const black = cells.filter((c) => k[c] === B), open = cells.filter((c) => k[c] === ANY);
        if (black.length > 2 || black.length + open.length < 2) return false;
        if (!open.length) return true;
        if (black.length === 2) emit({ kind: "region-full", level: 0, vars: open, keep: W, because: black, data: { region: r } });
        else if (black.length + open.length === 2) emit({ kind: "region-fill", level: 0, vars: open, keep: B, because: cells.filter((c) => k[c] === W), data: { region: r } });
        return true;
      },
    });
  });
  for (let c = 0; c < g.n; c++) {
    const around = g.nbrs[c]!;
    constraints.push({
      vars: [c, ...around],
      run(k, emit) {
        if (k[c] !== B) return true;
        const black = around.filter((d) => k[d] === B), open = around.filter((d) => k[d] === ANY);
        if (black.length > 1 || black.length + open.length < 1) return false;
        if (black.length === 1 && open.length) emit({ kind: "domino-done", level: 0, vars: open, keep: W, because: [c, black[0]!] });
        else if (!black.length && open.length === 1) emit({ kind: "domino-forced", level: 0, vars: open, keep: B, because: [c] });
        return true;
      },
    });
  }
  /** An undecided cell stays unshaded when no neighbor could join it in a domino without overfilling a region. */
  const noPartner: Rule = {
    level: 1,
    kinds: ["no-partner"],
    run(k, emit) {
      for (let c = 0; c < g.n; c++) {
        if (k[c] !== ANY) continue;
        const ok = g.nbrs[c]!.some((d) => {
          if (k[d] === W) return false;
          const rc = p.regions[c]!, rd = p.regions[d]!;
          const room = (r: number, extra: number) => g.cells[r]!.filter((x) => k[x] === B).length + extra <= 2;
          return rc === rd ? room(rc, 2 - +(k[d] === B)) : room(rc, 1) && room(rd, 1 - +(k[d] === B));
        });
        if (!ok && emit({ kind: "no-partner", level: 1, vars: [c], keep: W, because: g.nbrs[c]! })) return true;
      }
      return true;
    },
  };
  const m: Model = { n: g.n, constraints, rules: [noPartner], countLevel: 0 };
  m.rules.push(trialRule(m, 2, 1));
  modelCache.set(p, m);
  return m;
}

export const initialDoms = (p: NorinoriPuzzle): Doms => new Int32Array(p.w * p.h).fill(ANY);

const analyses = new WeakMap<NorinoriPuzzle, Analysis>();

export function analyze(p: NorinoriPuzzle): Analysis {
  let a = analyses.get(p);
  if (!a) analyses.set(p, a = analyzeModel(model(p), initialDoms(p), 2));
  return a;
}

const never = () => false;
export const readMarks = (p: NorinoriPuzzle, s: ShadeState): Doms => readShade(initialDoms(p), analyze(p), s, never);

// --- rules check ---

export interface NorinoriConflicts extends Record<string, number[]> {
  /** Regions with more than two shaded cells (their cells). */
  regions: number[];
  /** Shaded cells in a group of three or more. */
  clumps: number[];
}

export function findConflicts(p: NorinoriPuzzle, marks: readonly number[]): NorinoriConflicts {
  const g = geometry(p);
  const black = (c: number) => marks[c] === 1;
  const regions = g.cells.filter((cells) => cells.filter(black).length > 2).flat();
  const pc = pieces(g.nbrs, black);
  const size = Array.from({ length: pc.count }, () => 0);
  for (let c = 0; c < g.n; c++) if (pc.id[c]! >= 0) size[pc.id[c]!]!++;
  const clumps = Array.from({ length: g.n }, (_, c) => c).filter((c) => pc.id[c]! >= 0 && size[pc.id[c]!]! > 2);
  return { regions, clumps };
}

export function isSolved(p: NorinoriPuzzle, s: ShadeState): boolean {
  const g = geometry(p);
  const black = (c: number) => s.marks[c] === 1;
  if (!g.cells.every((cells) => cells.filter(black).length === 2)) return false;
  for (let c = 0; c < g.n; c++) if (black(c) && g.nbrs[c]!.filter(black).length !== 1) return false;
  return true;
}

// --- formats ---

const URL_RE = /(?:^|[?/])norinori\/(\d+)\/(\d+)\/([0-9a-v]+)\/?$/;

/** puzz.link / pzv.jp URLs: `…?norinori/W/H/<borders>`. */
export const pzprFormat: Format<NorinoriPuzzle> = {
  id: "pzpr",
  label: "puzz.link URL",
  detect: (t) => URL_RE.test(t.trim()),
  parse(t) {
    const m = URL_RE.exec(t.trim());
    if (!m) throw new Error("expected a puzz.link norinori URL, e.g. https://puzz.link/p?norinori/6/6/…");
    const w = Number(m[1]), h = Number(m[2]);
    if (!(w >= 2 && h >= 2 && w <= 40 && h <= 40)) throw new Error("size must be between 2×2 and 40×40");
    return { w, h, regions: decodeBorders(w, h, m[3]!).regions };
  },
  serialize: (p) => `https://puzz.link/p?norinori/${p.w}/${p.h}/${encodeBorders(p.w, p.h, p.regions)}`,
};

/** One row per line, one character per cell; each connected group of equal characters is one region. */
export const textFormat: Format<NorinoriPuzzle> = {
  id: "text",
  label: "region letters, one row per line",
  detect: (t) => /^[^\s]+(\n[^\s]+)+$/.test(t.trim()),
  parse: (t) => parseRegionLetters(t),
  serialize: (p) => regionLetters(p.w, p.h, p.regions),
};

// --- hints ---

export const wrongMarksHint = (p: NorinoriPuzzle, s: ShadeState): Hint<ShadeAction> | null => wrongShadeHint(p, analyze(p), s);

export function hint(p: NorinoriPuzzle, s: ShadeState): Hint<ShadeAction> | null {
  const c = findConflicts(p, s.marks);
  if (c.regions.length) return { message: `a region has more than two shaded cells`, focus: { cells: c.regions, because: [] } satisfies Focus };
  if (c.clumps.length) return { message: `${cellList(p, c.clumps)} join more than two shaded cells together`, focus: { cells: c.clumps, because: [] } satisfies Focus };
  const a = analyze(p);
  if (a.count === 0) return { message: "this puzzle has no solution" };
  if (a.count === 2) return { message: "this puzzle has more than one solution, so it can need a guess" };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: NorinoriPuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 3 };
  return { label: LEVEL_NAMES[a.level]!, score: a.level };
}

// --- generation ---

/** Dominoes as cell pairs; no two touch side by side. */
type Dominoes = [number, number][];

/** Adds dominoes in random order wherever one fits without touching another. */
function packDominoes(nbrs: readonly number[][], black: Uint8Array, doms: Dominoes, rng: Rng): void {
  const free = (c: number, except = -1) => !black[c] && nbrs[c]!.every((e) => e === except || !black[e]);
  for (const c of rng.shuffle(Array.from({ length: black.length }, (_, i) => i))) {
    if (!free(c)) continue;
    const partners = rng.shuffle(nbrs[c]!.filter((d) => free(d, c) && nbrs[c]!.every((e) => e === d || !black[e])));
    if (!partners.length) continue;
    const d = partners[0]!;
    black[c] = black[d] = 1;
    doms.push([c, d]);
  }
}

/**
 * A dense domino shading: a random packing, then rounds of taking one domino out and packing
 * again, kept whenever the count doesn't drop. Denser shadings leave far fewer rival solutions.
 */
function denseDominoes(n: number, nbrs: readonly number[][], rng: Rng): { black: Uint8Array; doms: Dominoes } {
  let black = new Uint8Array(n), doms: Dominoes = [];
  packDominoes(nbrs, black, doms, rng);
  for (let round = 0; round < 4 * n; round++) {
    const b2 = black.slice(), d2 = doms.slice();
    const [x, y] = d2.splice(rng.int(d2.length), 1)[0]!;
    b2[x] = b2[y] = 0;
    packDominoes(nbrs, b2, d2, rng);
    if (d2.length >= doms.length) { black = b2; doms = d2; }
  }
  return { black, doms };
}

/** Regions grown from each domino until every cell belongs to one. Null when some cell can't be reached. */
export function layout(w: number, h: number, rng: Rng): { regions: number[]; black: Uint8Array } | null {
  const n = w * h;
  const nbrs = neighbours(w, h);
  const { black, doms } = denseDominoes(n, nbrs, rng);
  const region = new Int32Array(n).fill(-1);
  doms.forEach(([a, b], r) => (region[a] = region[b] = r));
  const size = doms.map(() => 2);
  for (;;) {
    const open: number[] = [];
    for (let c = 0; c < n; c++) if (region[c] === -1 && nbrs[c]!.some((d) => region[d]! >= 0)) open.push(c);
    if (!open.length) break;
    const c = rng.pick(open);
    const choices = [...new Set(nbrs[c]!.map((d) => region[d]!).filter((r) => r >= 0))];
    const r = choices.reduce((best, x) => (size[x]! < size[best]! ? x : best));
    region[c] = r;
    size[r]!++;
  }
  if (region.some((r) => r === -1)) return null;
  return { regions: Array.from(region), black };
}

/** Regions reshaped around the layout's own shading until it needs exactly `level`; null if that doesn't settle. */
export function shapeRegions(w: number, h: number, start: { regions: number[]; black: Uint8Array }, level: Level, rng: Rng, ctx: GenerateContext): Promise<number[] | null> {
  return shapeToLevel({
    nbrs: neighbours(w, h), regions: start.regions, intended: Array.from(start.black), counts: (v) => v === 1, level, rng, ctx,
    setup: (regions) => { const p: NorinoriPuzzle = { w, h, regions: regions.slice() }; return { model: model(p), start: initialDoms(p) }; },
  });
}

/** Deterministic in (params, rng): a puzzle that needs exactly `level`, or the hardest found below it. */
export function generatePuzzle(w: number, h: number, level: Level, rng: Rng, ctx: GenerateContext): Promise<NorinoriPuzzle> {
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

export const norinori: PuzzleDef<NorinoriPuzzle, ShadeState, ShadeAction, ShadeInteraction, typeof params> = {
  id: "norinori",
  name: "norinori",
  aliases: ["dominion"],
  tags: ["logic", "grid", "regions", "shading", "nikoli"],
  description: "shade exactly two cells in every region so that every shaded cell is part of a domino: it touches exactly one other shaded cell.",
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
    "shade exactly two cells in every region outlined by thick lines.",
    "every shaded cell touches exactly one other shaded cell side by side, so shaded cells come in dominoes.",
    "a domino may cross from one region into another.",
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
