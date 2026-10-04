import { colName, rowName } from "../../core/names";
import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import {
  analyzeModel, decides, solveLevel, trialRule,
  type Analysis, type Constraint, type Doms, type Model, type Rule,
} from "../../lib/grid-kit/csp";
import { neighbours } from "../../lib/grid-kit/grid";
import { cellList, type Focus } from "../../lib/grid-kit/names";
import { decodeBorders, encodeBorders } from "../../lib/pzpr";
import { parseRegionLetters, regionLetters } from "../../lib/shade-kit/letters";
import { attemptLevel, canonicalRegions, shapeToLevel } from "../../lib/shade-kit/repair";
import {
  ANY, B, W, describeShade, initShade, readShade, reduceShade, solvedShade, wrongShadeHint,
  type ShadeAction, type ShadeInteraction, type ShadeState,
} from "../../lib/shade-kit/state";

export interface StarBattlePuzzle {
  /** Square: w === h, with as many regions. */
  w: number;
  h: number;
  /** Stars in every row, column and region. */
  k: number;
  /** Row-major region id per cell, 0-based and contiguous. */
  regions: number[];
}

export const LEVEL_NAMES = ["easy", "normal", "hard"] as const;
export type Level = 0 | 1 | 2;

export const params = defineSchema({
  size: { type: "int", label: "size", default: 8, min: 5, max: 10 },
  stars: {
    type: "enum", label: "stars", default: "1",
    options: [
      { value: "1", label: "1 star", description: "one star per row, column and region (also known as queens)" },
      { value: "2", label: "2 stars", description: "needs a size of at least 8, and normal or hard" },
    ],
  },
  difficulty: {
    type: "enum", label: "difficulty", default: "normal",
    options: [
      { value: "easy", label: "easy", description: "full rows, columns and regions, and cells around stars" },
      { value: "normal", label: "normal", description: "also regions stuck in one row or column, and cells that would block a region" },
      { value: "hard", label: "hard", description: "also trying a cell both ways" },
    ],
  },
});

/** A row, a column or a region: every one holds exactly k stars. */
export interface Unit {
  kind: "row" | "column" | "region";
  index: number;
  cells: number[];
}

export interface Geometry {
  n: number;
  nbrs: number[][];
  /** The eight cells around each cell. */
  around: number[][];
  /** Rows, then columns, then regions. */
  units: Unit[];
  /** Units each cell is in: its row, column and region. */
  unitsOf: number[][];
}

const geoCache = new WeakMap<StarBattlePuzzle, Geometry>();

export function geometry(p: StarBattlePuzzle): Geometry {
  const hit = geoCache.get(p);
  if (hit) return hit;
  const { w, h } = p, n = w * h;
  const around = Array.from({ length: n }, (_, c) => {
    const x = c % w, y = Math.floor(c / w), out: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < h) out.push((y + dy) * w + x + dx);
    }
    return out;
  });
  const units: Unit[] = [];
  for (let y = 0; y < h; y++) units.push({ kind: "row", index: y, cells: Array.from({ length: w }, (_, x) => y * w + x) });
  for (let x = 0; x < w; x++) units.push({ kind: "column", index: x, cells: Array.from({ length: h }, (_, y) => y * w + x) });
  const count = p.regions.reduce((a, r) => Math.max(a, r + 1), 0);
  for (let r = 0; r < count; r++) units.push({ kind: "region", index: r, cells: [] });
  for (let c = 0; c < n; c++) units[w + h + p.regions[c]!]!.cells.push(c);
  const unitsOf = Array.from({ length: n }, (_, c) => [Math.floor(c / w), h + (c % w), w + h + p.regions[c]!]);
  const g = { n, nbrs: neighbours(w, h), around, units, unitsOf };
  geoCache.set(p, g);
  return g;
}

/** "row 3", "column C", "the region with C5". */
export function unitName(p: StarBattlePuzzle, u: Unit): string {
  if (u.kind === "row") return `row ${rowName(u.index)}`;
  if (u.kind === "column") return `column ${colName(u.index)}`;
  return `the region with ${cellList(p, u.cells.slice(0, 1))}`;
}

// --- model ---

const modelCache = new WeakMap<StarBattlePuzzle, Model>();

/** k stars in every unit; stars never touch, not even at a corner. */
export function model(p: StarBattlePuzzle): Model {
  const hit = modelCache.get(p);
  if (hit) return hit;
  const g = geometry(p), k = p.k;
  const constraints: Constraint[] = [];
  g.units.forEach((u, ui) => {
    constraints.push({
      vars: u.cells,
      run(d, emit) {
        const stars = u.cells.filter((c) => d[c] === B), open = u.cells.filter((c) => d[c] === ANY);
        if (stars.length > k || stars.length + open.length < k) return false;
        if (!open.length) return true;
        if (stars.length === k) emit({ kind: "unit-full", level: 0, vars: open, keep: W, because: stars, data: { unit: ui } });
        else if (stars.length + open.length === k) emit({ kind: "unit-fill", level: 0, vars: open, keep: B, because: u.cells.filter((c) => d[c] === W), data: { unit: ui } });
        return true;
      },
    });
  });
  for (let c = 0; c < g.n; c++) {
    const around = g.around[c]!;
    constraints.push({
      vars: [c, ...around],
      run(d, emit) {
        if (d[c] !== B) return true;
        if (around.some((x) => d[x] === B)) return false;
        const open = around.filter((x) => d[x] === ANY);
        if (open.length) emit({ kind: "touch", level: 0, vars: open, keep: W, because: [c] });
        return true;
      },
    });
  }
  const need = (d: Doms, u: Unit) => k - u.cells.filter((c) => d[c] === B).length;
  /** A unit whose open cells all sit in another unit, both needing the same number of stars: the other unit's remaining open cells have none. */
  const confined: Rule = {
    level: 1,
    kinds: ["confined"],
    run(d, emit) {
      for (let a = 0; a < g.units.length; a++) {
        const ua = g.units[a]!;
        const open = ua.cells.filter((c) => d[c] === ANY);
        if (!open.length) continue;
        for (const b of g.unitsOf[open[0]!]!) {
          const ub = g.units[b]!;
          if (b === a || (ua.kind === "region") === (ub.kind === "region")) continue;
          if (!open.every((c) => g.unitsOf[c]!.includes(b)) || need(d, ua) !== need(d, ub)) continue;
          const rest = ub.cells.filter((c) => d[c] === ANY && !open.includes(c));
          if (rest.length && emit({ kind: "confined", level: 1, vars: rest, keep: W, because: open, data: { unit: a, other: b } })) return true;
        }
      }
      return true;
    },
  };
  /** A cell whose star would rule out so much around it that some unit could no longer reach its stars. */
  const blocks: Rule = {
    level: 1,
    kinds: ["blocks"],
    run(d, emit) {
      for (let c = 0; c < g.n; c++) {
        if (d[c] !== ANY) continue;
        const gone = new Set([c, ...g.around[c]!]);
        for (let ui = 0; ui < g.units.length; ui++) {
          const u = g.units[ui]!;
          if (g.unitsOf[c]!.includes(ui)) continue;
          const left = u.cells.filter((x) => d[x] === B || (d[x] === ANY && !gone.has(x))).length;
          if (left >= k) continue;
          if (emit({ kind: "blocks", level: 1, vars: [c], keep: W, because: [], related: u.cells, data: { unit: ui } })) return true;
          break;
        }
      }
      return true;
    },
  };
  const m: Model = { n: g.n, constraints, rules: [confined, blocks], countLevel: 0 };
  m.rules.push(trialRule(m, 2, 1));
  modelCache.set(p, m);
  return m;
}

export const initialDoms = (p: StarBattlePuzzle): Doms => new Int32Array(p.w * p.h).fill(ANY);

const analyses = new WeakMap<StarBattlePuzzle, Analysis>();

export function analyze(p: StarBattlePuzzle): Analysis {
  let a = analyses.get(p);
  if (!a) analyses.set(p, a = analyzeModel(model(p), initialDoms(p), 2));
  return a;
}

const never = () => false;
export const readMarks = (p: StarBattlePuzzle, s: ShadeState): Doms => readShade(initialDoms(p), analyze(p), s, never);

// --- rules check ---

export interface StarBattleConflicts extends Record<string, number[]> {
  /** Stars in a row, column or region with more than k. */
  crowded: number[];
  /** Stars touching another star. */
  touching: number[];
}

export function findConflicts(p: StarBattlePuzzle, marks: readonly number[]): StarBattleConflicts {
  const g = geometry(p);
  const star = (c: number) => marks[c] === 1;
  const crowded = [...new Set(g.units.flatMap((u) => (u.cells.filter(star).length > p.k ? u.cells.filter(star) : [])))];
  const touching = Array.from({ length: g.n }, (_, c) => c).filter((c) => star(c) && g.around[c]!.some(star));
  return { crowded, touching };
}

export function isSolved(p: StarBattlePuzzle, s: ShadeState): boolean {
  const g = geometry(p);
  const star = (c: number) => s.marks[c] === 1;
  if (!g.units.every((u) => u.cells.filter(star).length === p.k)) return false;
  for (let c = 0; c < g.n; c++) if (star(c) && g.around[c]!.some(star)) return false;
  return true;
}

// --- formats ---

const URL_RE = /(?:^|[?/])starbattle\/(\d+)\/(\d+)\/(\d+)\/([0-9a-v]+)\/?$/;

function checked(w: number, h: number, k: number, regions: number[]): StarBattlePuzzle {
  if (w !== h) throw new Error("star battle grids are square");
  if (!(w >= 4 && w <= 30)) throw new Error("size must be between 4 and 30");
  if (!(k >= 1)) throw new Error("there must be at least one star per region");
  const count = regions.reduce((a, r) => Math.max(a, r + 1), 0);
  if (count !== w) throw new Error(`a ${w}×${w} grid needs ${w} regions, not ${count}`);
  return { w, h, k, regions };
}

/** puzz.link / pzv.jp URLs: `…?starbattle/W/H/K/<borders>`. */
export const pzprFormat: Format<StarBattlePuzzle> = {
  id: "pzpr",
  label: "puzz.link URL",
  detect: (t) => URL_RE.test(t.trim()),
  parse(t) {
    const m = URL_RE.exec(t.trim());
    if (!m) throw new Error("expected a puzz.link star battle URL, e.g. https://puzz.link/p?starbattle/8/8/1/…");
    const w = Number(m[1]), h = Number(m[2]), k = Number(m[3]);
    return checked(w, h, k, decodeBorders(w, h, m[4]!).regions);
  },
  serialize: (p) => `https://puzz.link/p?starbattle/${p.w}/${p.h}/${p.k}/${encodeBorders(p.w, p.h, p.regions)}`,
};

/** The star count on its own first line, then one row of region letters per line. */
export const textFormat: Format<StarBattlePuzzle> = {
  id: "text",
  label: "star count, then region letters, one row per line",
  detect: (t) => /^\d+\s*\n[^\s]+(\n[^\s]+)+$/.test(t.trim()),
  parse(t) {
    const [first, ...rest] = t.trim().split(/\r?\n/);
    const r = parseRegionLetters(rest.join("\n"));
    return checked(r.w, r.h, Number(first), r.regions);
  },
  serialize: (p) => `${p.k}\n${regionLetters(p.w, p.h, p.regions)}`,
};

// --- hints ---

export const wrongMarksHint = (p: StarBattlePuzzle, s: ShadeState): Hint<ShadeAction> | null => wrongShadeHint(p, analyze(p), s);

export function hint(p: StarBattlePuzzle, s: ShadeState): Hint<ShadeAction> | null {
  const c = findConflicts(p, s.marks);
  if (c.touching.length) return { message: `the stars on ${cellList(p, c.touching)} touch`, focus: { cells: c.touching, because: [] } satisfies Focus };
  if (c.crowded.length) return { message: `${cellList(p, c.crowded)} put more than ${p.k} ${p.k === 1 ? "star" : "stars"} in a row, column or region`, focus: { cells: c.crowded, because: [] } satisfies Focus };
  const a = analyze(p);
  if (a.count === 0) return { message: "this puzzle has no solution" };
  if (a.count === 2) return { message: "this puzzle has more than one solution, so it can need a guess" };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: StarBattlePuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 3 };
  return { label: LEVEL_NAMES[a.level]!, score: a.level };
}

// --- generation ---

/** k stars per row and column, none touching, placed row by row with random backtracking. Null if the size can't hold them. */
export function plantStars(n: number, k: number, rng: Rng): Uint8Array | null {
  const subsets: number[][] = [];
  const pick = (from: number, cur: number[]) => {
    if (cur.length === k) { subsets.push(cur.slice()); return; }
    for (let x = from; x < n; x++) if (!cur.length || x - cur[cur.length - 1]! > 1) pick(x + 1, [...cur, x]);
  };
  pick(0, []);
  const cols = new Int32Array(n), rows: number[][] = [];
  let budget = 20000;
  const place = (y: number): boolean => {
    if (y === n) return cols.every((c) => c === k);
    if (budget-- <= 0) return false;
    const prev = rows[y - 1] ?? [];
    for (const s of rng.shuffle(subsets.slice())) {
      if (s.some((x) => cols[x]! >= k || prev.some((px) => Math.abs(px - x) <= 1))) continue;
      // every column must still be able to reach k in the rows left
      s.forEach((x) => cols[x]!++);
      if (cols.every((c) => k - c <= Math.ceil((n - y - 1) / 2))) {
        rows[y] = s;
        if (place(y + 1)) return true;
      }
      s.forEach((x) => cols[x]!--);
    }
    return false;
  };
  if (!place(0)) return null;
  const star = new Uint8Array(n * n);
  rows.forEach((s, y) => s.forEach((x) => (star[y * n + x] = 1)));
  return star;
}

/** Stars grouped k to a region (nearest first) and regions grown from them. Null when the layout can't be completed. */
export function layout(n: number, k: number, rng: Rng): { regions: number[]; star: Uint8Array } | null {
  const star = plantStars(n, k, rng);
  if (!star) return null;
  const cells = n * n, nbrs = neighbours(n, n);
  const stars = rng.shuffle(Array.from(star.keys()).filter((c) => star[c]));
  const region = new Int32Array(cells).fill(-1);
  const dist = (a: number, b: number) => Math.abs((a % n) - (b % n)) + Math.abs(Math.floor(a / n) - Math.floor(b / n));
  const free = new Set(stars);
  let id = 0;
  for (const s of stars) {
    if (!free.has(s)) continue;
    free.delete(s);
    region[s] = id;
    for (let j = 1; j < k; j++) {
      const t = [...free].reduce((best, x) => (dist(s, x) < dist(s, best) ? x : best));
      free.delete(t);
      region[t] = id;
      // the region starts as one piece: its stars joined by a shortest path of starless cells
      let c = s;
      while (c !== t) {
        const steps = nbrs[c]!.filter((x) => dist(x, t) < dist(c, t));
        const next = steps.find((x) => region[x] === -1 && !star[x]) ?? steps.find((x) => x === t);
        if (next === undefined) return null;
        if (next !== t) region[next] = id;
        c = next;
      }
    }
    id++;
  }
  const size = Array.from({ length: id }, (_, r) => region.filter((x) => x === r).length);
  for (;;) {
    const open: number[] = [];
    for (let c = 0; c < cells; c++) if (region[c] === -1 && nbrs[c]!.some((d) => region[d]! >= 0)) open.push(c);
    if (!open.length) break;
    const c = rng.pick(open);
    const r = [...new Set(nbrs[c]!.map((d) => region[d]!).filter((x) => x >= 0))].reduce((best, x) => (size[x]! < size[best]! ? x : best));
    region[c] = r;
    size[r]!++;
  }
  if (region.some((r) => r === -1)) return null;
  return { regions: Array.from(region), star };
}

/** Regions reshaped around the planted stars until the puzzle needs exactly `level`; null if that doesn't settle. */
export function shapeRegions(n: number, k: number, start: { regions: number[]; star: Uint8Array }, level: Level, rng: Rng, ctx: GenerateContext): Promise<number[] | null> {
  return shapeToLevel({
    nbrs: neighbours(n, n), regions: start.regions, intended: Array.from(start.star), counts: (v) => v === 1, level, rng, ctx,
    setup: (regions) => { const p: StarBattlePuzzle = { w: n, h: n, k, regions: regions.slice() }; return { model: model(p), start: initialDoms(p) }; },
  });
}

/** Deterministic in (params, rng): a puzzle that needs exactly `level`, or the hardest found below it. */
export function generatePuzzle(n: number, k: number, level: Level, rng: Rng, ctx: GenerateContext): Promise<StarBattlePuzzle> {
  if (k > 1 && level === 0) throw new Error("with more than one star, the easy techniques can't finish a puzzle: pick normal or hard");
  if (!plantStars(n, k, rng.fork("fits"))) throw new Error(`${k} ${k === 1 ? "star doesn't" : "stars don't"} fit in a ${n}×${n} grid without touching`);
  return attemptLevel({
    level, rng, ctx,
    async attempt(r) {
      const start = layout(n, k, r);
      const regions = start && await shapeRegions(n, k, start, level, r, ctx);
      return regions ? { w: n, h: n, k, regions: canonicalRegions(regions) } : null;
    },
    levelOf: (p) => (decides(model(p), initialDoms(p), level) ? solveLevel(model(p), initialDoms(p), level) : null),
  });
}

export const starbattle: PuzzleDef<StarBattlePuzzle, ShadeState, ShadeAction, ShadeInteraction, typeof params> = {
  id: "starbattle",
  name: "star battle",
  aliases: ["queens", "two not touch", "star"],
  tags: ["logic", "grid", "regions", "placement"],
  description: "place stars so that every row, column and outlined region has the same number of them, and no two stars touch, not even at a corner.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "queens 7×7", params: { size: 7, stars: "1", difficulty: "easy" } },
    { label: "queens 9×9", params: { size: 9, stars: "1", difficulty: "normal" } },
    { label: "1★ 10×10 hard", params: { size: 10, stars: "1", difficulty: "hard" } },
    { label: "2★ 10×10", params: { size: 10, stars: "2", difficulty: "normal" } },
    { label: "2★ 10×10 hard", params: { size: 10, stars: "2", difficulty: "hard" } },
  ],
  generate: (v: Values<typeof params>, rng, ctx) => generatePuzzle(v.size, Number(v.stars), LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) as Level, rng, ctx),
  formats: [pzprFormat, textFormat],
  init: (p) => initShade(p.w * p.h),
  initInteraction: () => ({ cursor: 0 }),
  reduce: (p, s, a) => reduceShade(p.w * p.h, never, s, a),
  isRetraction: (a) => a.value === 0,
  rules: (p) => [
    `place ${p.k === 1 ? "one star" : `${p.k} stars`} in every row, every column and every region outlined by thick lines.`,
    "stars never touch each other, not even at a corner.",
    "a dot is your own note that a cell has no star. it doesn't count for anything.",
  ],
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? solvedShade(a.solution, never) : null;
  },
  hint,
  rate,
  describeAction: (p, a, before, after) => describeShade(p, a, before, after, "star"),
  describe: (p) => `${p.w}×${p.h}, ${p.k}★`,
};

