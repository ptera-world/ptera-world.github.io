import type { Rng } from "../../core/rng";
import { colName, rowName } from "../../core/names";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import {
  analyzeModel, bit, isDecided, propagate, solveLevel, trialRule,
  type Analysis, type Constraint, type Doms, type Model, type Rule,
} from "../../lib/grid-kit/csp";
import { cellList, type Focus } from "../../lib/grid-kit/names";

/** Cell contents in the puzzle. TENT_HINT / GRASS_HINT are setter-provided starting marks. */
export const OPEN = 0, TREE = 1, TENT_HINT = 2, GRASS_HINT = 3;

/** Model values: one variable per cell; trees are fixed to NO. */
export const NO = 0, YES = 1;
const N = bit(NO), Y = bit(YES), ANY = N | Y;

export interface TentsPuzzle {
  w: number;
  h: number;
  cells: number[];
  /** Tents per column. */
  cols: number[];
  /** Tents per row. */
  rows: number[];
}

/** Per-cell mark on non-tree cells. GRASS is the player's "no tent here" note. */
export const NONE = 0, TENT = 1, GRASS = 2;
export type Mark = typeof NONE | typeof TENT | typeof GRASS;

export interface TentsState {
  marks: number[];
}

/** Setting NONE is the only way marks are removed, so it alone is a retraction. */
export type TentsAction = { type: "set"; cells: number[]; value: Mark };

export interface TentsInteraction {
  cursor: number;
}

export const LEVEL_NAMES = ["easy", "tricky", "hard"] as const;
export type Level = 0 | 1 | 2;

export const params = defineSchema({
  width: { type: "int", label: "width", default: 8, min: 4, max: 20 },
  height: { type: "int", label: "height", default: 8, min: 4, max: 20 },
  difficulty: {
    type: "enum", label: "difficulty", default: "easy",
    options: [
      { value: "easy", label: "easy", description: "touching tents, counts, and trees with one spot left" },
      { value: "tricky", label: "tricky", description: "also trying out a line's spots, cells next to all a tree's spots, and which tree a tent would belong to" },
      { value: "hard", label: "hard", description: "also trying a cell both ways" },
    ],
  },
});

// --- geometry ---

export interface Geometry {
  w: number;
  h: number;
  n: number;
  trees: number[];
  /** Orthogonal neighbors. */
  nbrs: number[][];
  /** All eight neighbors. */
  ring: number[][];
  /** Rows then columns. */
  lines: number[][];
  /** Per cell, the trees orthogonally next to it. */
  treesNear: number[][];
}

const geoCache = new WeakMap<TentsPuzzle, Geometry>();

export function geometry(p: TentsPuzzle): Geometry {
  const hit = geoCache.get(p);
  if (hit) return hit;
  const { w, h } = p;
  const n = w * h;
  const nbrs: number[][] = [], ring: number[][] = [];
  for (let i = 0; i < n; i++) {
    const x = i % w, y = Math.floor(i / w);
    const o: number[] = [], r: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        r.push(ny * w + nx);
        if (!dx || !dy) o.push(ny * w + nx);
      }
    }
    nbrs.push(o);
    ring.push(r);
  }
  const lines: number[][] = [];
  for (let y = 0; y < h; y++) lines.push(Array.from({ length: w }, (_, x) => y * w + x));
  for (let x = 0; x < w; x++) lines.push(Array.from({ length: h }, (_, y) => y * w + x));
  const trees = p.cells.flatMap((v, i) => (v === TREE ? [i] : []));
  const treesNear = nbrs.map((list) => list.filter((j) => p.cells[j] === TREE));
  const g = { w, h, n, trees, nbrs, ring, lines, treesNear };
  geoCache.set(p, g);
  return g;
}

export const lineTarget = (p: TentsPuzzle, li: number): number => (li < p.h ? p.rows[li]! : p.cols[li - p.h]!);
export const lineName = (p: TentsPuzzle, li: number): string => (li < p.h ? `row ${rowName(li)}` : `column ${colName(li - p.h)}`);

// --- matching ---

/**
 * True if every tree can be given its own orthogonally adjacent tent cell, using every cell in
 * `must` and any of `may`.
 */
export function matchable(g: Geometry, must: readonly number[], may: readonly number[]): boolean {
  const cand = new Set([...must, ...may]);
  const tentOf = new Map<number, number>(), treeOf = new Map<number, number>();
  const augmentFromTree = (t: number, seen: Set<number>): boolean => {
    for (const c of g.nbrs[t]!) {
      if (!cand.has(c) || seen.has(c)) continue;
      seen.add(c);
      const o = treeOf.get(c);
      if (o === undefined || augmentFromTree(o, seen)) {
        treeOf.set(c, t);
        tentOf.set(t, c);
        return true;
      }
    }
    return false;
  };
  const augmentFromCell = (c: number, seen: Set<number>): boolean => {
    for (const t of g.treesNear[c]!) {
      if (seen.has(t)) continue;
      seen.add(t);
      const o = tentOf.get(t);
      if (o === undefined || augmentFromCell(o, seen)) {
        tentOf.set(t, c);
        treeOf.set(c, t);
        return true;
      }
    }
    return false;
  };
  // cover the required cells first; augmenting from trees afterward never uncovers them
  for (const c of must) if (!augmentFromCell(c, new Set())) return false;
  for (const t of g.trees) if (!tentOf.has(t) && !augmentFromTree(t, new Set())) return false;
  return true;
}

/** Number of ways (stopping at 2) to pair every tree with one of `tents`, orthogonally adjacent. */
export function matchings(g: Geometry, tents: readonly number[], limit = 2): number {
  const set = new Set(tents);
  let count = 0;
  const used = new Set<number>();
  const go = (i: number) => {
    if (count >= limit) return;
    if (i === g.trees.length) {
      count++;
      return;
    }
    for (const c of g.nbrs[g.trees[i]!]!) {
      if (!set.has(c) || used.has(c)) continue;
      used.add(c);
      go(i + 1);
      used.delete(c);
    }
  };
  if (tents.length === g.trees.length) go(0);
  return count;
}

// --- model ---

const modelCache = new WeakMap<TentsPuzzle, Model>();

export function model(p: TentsPuzzle): Model {
  const hit = modelCache.get(p);
  if (hit) return hit;
  const g = geometry(p);
  const constraints: Constraint[] = [];
  const open = (c: number) => p.cells[c] !== TREE;
  const far = Array.from({ length: g.n }, (_, c) => c).filter((c) => open(c) && !g.treesNear[c]!.length);
  constraints.push({
    vars: far,
    run(k, emit) {
      const left = far.filter((c) => k[c] === ANY);
      if (left.length) emit({ kind: "no-tree", level: 0, vars: left, keep: N, because: [] });
      return true;
    },
  });
  for (let c = 0; c < g.n; c++) {
    if (!open(c)) continue;
    const ring = g.ring[c]!.filter(open);
    constraints.push({
      vars: [c, ...ring],
      run(k, emit) {
        if (k[c] !== Y) return true;
        if (ring.some((d) => k[d] === Y)) return false;
        const rest = ring.filter((d) => k[d] === ANY);
        if (rest.length) emit({ kind: "touch", level: 0, vars: rest, keep: N, because: [c] });
        return true;
      },
    });
  }
  for (const t of g.trees) {
    const spots = g.nbrs[t]!.filter(open);
    constraints.push({
      vars: spots,
      run(k, emit) {
        const left = spots.filter((c) => k[c] !== N);
        if (!left.length) return false;
        if (left.length === 1 && k[left[0]!] === ANY) emit({ kind: "tree-spot", level: 0, vars: left, keep: Y, because: [t] });
        return true;
      },
    });
  }
  g.lines.forEach((line, li) => {
    const target = lineTarget(p, li);
    const cells = line.filter(open);
    constraints.push({
      vars: cells,
      run(k, emit) {
        const have = cells.filter((c) => k[c] === Y).length;
        const free = cells.filter((c) => k[c] === ANY);
        if (have > target || have + free.length < target) return false;
        if (!free.length) return true;
        if (have === target) emit({ kind: "count-full", level: 0, vars: free, keep: N, because: [], related: line, data: { line: li } });
        else if (have + free.length === target) emit({ kind: "count-all", level: 0, vars: free, keep: Y, because: [], related: line, data: { line: li } });
        return true;
      },
    });
  });

  const rules: Rule[] = [];
  // every placement of a line's remaining tents, with no two touching
  rules.push({
    level: 1,
    kinds: ["line-combos"],
    run(k, emit) {
      for (let li = 0; li < g.lines.length; li++) {
        const line = g.lines[li]!;
        const need = lineTarget(p, li) - line.filter((c) => k[c] === Y).length;
        const free = line.filter((c) => open(c) && k[c] === ANY);
        if (!free.length || need < 0 || need > free.length) continue;
        const always = new Map<number, number>(), touched = new Map<number, number>();
        let combos = 0;
        const pick: number[] = [];
        const ok = (c: number) => !pick.some((q) => g.ring[q]!.includes(c));
        const side = (c: number) => g.ring[c]!.filter((d) => !line.includes(d) && open(d) && k[d] === ANY);
        const go = (i: number) => {
          if (pick.length === need) {
            combos++;
            for (const c of free) always.set(c, (always.get(c) ?? 0) + (pick.includes(c) ? 1 : 0));
            const near = new Set(pick.flatMap(side));
            for (const d of near) touched.set(d, (touched.get(d) ?? 0) + 1);
            return;
          }
          if (free.length - i < need - pick.length) return;
          const c = free[i]!;
          if (ok(c)) {
            pick.push(c);
            go(i + 1);
            pick.pop();
          }
          go(i + 1);
        };
        go(0);
        if (!combos) return false;
        const yes = free.filter((c) => always.get(c) === combos);
        const no = free.filter((c) => always.get(c) === 0);
        const nearNo = [...touched].filter(([, n]) => n === combos).map(([d]) => d);
        if (yes.length && emit({ kind: "line-combos", level: 1, vars: yes, keep: Y, because: [], related: line, data: { line: li } })) return true;
        if (no.length && emit({ kind: "line-combos", level: 1, vars: no, keep: N, because: [], related: line, data: { line: li } })) return true;
        if (nearNo.length && emit({ kind: "line-combos", level: 1, vars: nearNo, keep: N, because: [], related: line, data: { line: li } })) return true;
      }
      return true;
    },
  });
  // a cell touching every spot a tree could use touches that tree's tent
  rules.push({
    level: 1,
    kinds: ["shared-touch"],
    run(k, emit) {
      for (const t of g.trees) {
        const spots = g.nbrs[t]!.filter((c) => open(c) && k[c] !== N);
        if (spots.length < 2) continue;
        const common = g.ring[spots[0]!]!.filter((d) => open(d) && k[d] === ANY && !spots.includes(d) && spots.every((s) => g.ring[s]!.includes(d)));
        if (common.length && emit({ kind: "shared-touch", level: 1, vars: common, keep: N, because: [t], related: spots })) return true;
      }
      return true;
    },
  });
  // which tree each tent would belong to
  rules.push({
    level: 1,
    kinds: ["matching"],
    run(k, emit) {
      const tents: number[] = [], free: number[] = [];
      for (let c = 0; c < g.n; c++) {
        if (!open(c)) continue;
        if (k[c] === Y) tents.push(c);
        else if (k[c] === ANY) free.push(c);
      }
      if (!matchable(g, tents, free)) return false;
      for (const c of free) {
        const rest = free.filter((d) => d !== c);
        if (!matchable(g, [...tents, c], rest)) {
          if (emit({ kind: "matching", level: 1, vars: [c], keep: N, because: g.treesNear[c]!, data: { tent: false } })) return true;
        } else if (!matchable(g, tents, rest)) {
          if (emit({ kind: "matching", level: 1, vars: [c], keep: Y, because: g.treesNear[c]!, data: { tent: true } })) return true;
        }
      }
      return true;
    },
  });
  const m: Model = {
    n: g.n,
    constraints,
    rules,
    countLevel: 1,
    complete: (k) => matchable(g, Array.from({ length: g.n }, (_, c) => c).filter((c) => open(c) && k[c] === Y), []),
    done: (k) => g.lines.every((line, li) => line.filter((c) => k[c] === Y).length === lineTarget(p, li)),
  };
  m.rules.push(trialRule(m, 2, 1));
  modelCache.set(p, m);
  return m;
}

export const initialDoms = (p: TentsPuzzle): Doms => Int32Array.from(p.cells, (v) => (v === TREE ? N : ANY));

const analyses = new WeakMap<TentsPuzzle, Analysis>();

/** Unique-placement analysis, memoized per puzzle. `solution` holds YES where a tent goes. */
export function analyze(p: TentsPuzzle): Analysis {
  let a = analyses.get(p);
  if (!a) analyses.set(p, a = analyzeModel(model(p), initialDoms(p), 2));
  return a;
}

/** Board marks as domains; with a unique solution only marks that agree with it count. */
export function readMarks(p: TentsPuzzle, s: TentsState): Doms {
  const a = analyze(p);
  const sol = a.count === 1 ? a.solution : null;
  const k = initialDoms(p);
  s.marks.forEach((m, c) => {
    if (p.cells[c] === TREE) return;
    if (m === TENT && (!sol || sol[c] === YES)) k[c] = Y;
    else if (m === GRASS && (!sol || sol[c] === NO)) k[c] = N;
  });
  return k;
}

// --- state ---

export function reduce(p: TentsPuzzle, s: TentsState, a: TentsAction): TentsState {
  if (a.type !== "set" || ![NONE, TENT, GRASS].includes(a.value)) return s;
  let next: number[] | null = null;
  for (const c of a.cells) {
    if (!(c >= 0 && c < p.cells.length) || p.cells[c] === TREE || s.marks[c] === a.value) continue;
    next ??= s.marks.slice();
    next[c] = a.value;
  }
  return next ? { marks: next } : s;
}

export interface TentsConflicts extends Record<string, number[]> {
  /** Tents touching another tent, even at a corner. */
  touching: number[];
  /** Lines (rows then columns) with too many tents, or too little room left. */
  counts: number[];
  /** Tents with no tree of their own, and trees with no spot left for a tent. */
  lonely: number[];
}

export function findConflicts(p: TentsPuzzle, marks: readonly number[]): TentsConflicts {
  const g = geometry(p);
  const tent = (c: number) => marks[c] === TENT;
  const touching = Array.from({ length: g.n }, (_, c) => c).filter((c) => tent(c) && g.ring[c]!.some(tent));
  const counts = g.lines.flatMap((line, li) => {
    const have = line.filter(tent).length;
    const room = line.filter((c) => p.cells[c] !== TREE && marks[c] === NONE).length;
    const t = lineTarget(p, li);
    return have > t || have + room < t ? [li] : [];
  });
  const lonely: number[] = [];
  for (let c = 0; c < g.n; c++) if (tent(c) && !g.treesNear[c]!.length) lonely.push(c);
  for (const t of g.trees) if (g.nbrs[t]!.every((c) => p.cells[c] === TREE || marks[c] === GRASS)) lonely.push(t);
  return { touching, counts, lonely };
}

export function isSolved(p: TentsPuzzle, s: TentsState): boolean {
  const g = geometry(p);
  const tents = s.marks.flatMap((m, c) => (m === TENT && p.cells[c] !== TREE ? [c] : []));
  if (tents.length !== g.trees.length) return false;
  if (tents.some((c) => g.ring[c]!.some((d) => s.marks[d] === TENT))) return false;
  if (!g.lines.every((line, li) => line.filter((c) => s.marks[c] === TENT).length === lineTarget(p, li))) return false;
  return matchable(g, tents, []);
}

// --- formats ---

const SGT_RE = /^(\d+)(?:x(\d+))?(?:d.)?:([_a-z!-]+)((?:,\d+)+)$/;

function checkPuzzle(p: TentsPuzzle): TentsPuzzle {
  if (!(p.w >= 1 && p.h >= 1 && p.w <= 60 && p.h <= 60)) throw new Error("size must be between 1×1 and 60×60");
  if (p.cells.length !== p.w * p.h) throw new Error(`expected ${p.w * p.h} cells, got ${p.cells.length}`);
  if (p.cols.length !== p.w || p.rows.length !== p.h) throw new Error(`expected ${p.w + p.h} numbers`);
  return p;
}

/**
 * Simon Tatham's Tents game id: `WxH[dX]:` then the trees (`_` a tree, `a`–`y` 1–25 open cells
 * then a tree, `z` 25 open cells, `!` / `-` mark the previous cell tent / no tent), ending with a
 * tree one past the grid, then `,n` per column then per row.
 */
export const sgtFormat: Format<TentsPuzzle> = {
  id: "sgt",
  label: "game id (WxH:…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(t) {
    const m = SGT_RE.exec(t.trim());
    if (!m) throw new Error("expected WxH:trees,numbers, e.g. 8x8:…,1,2,…");
    const w = Number(m[1]), h = Number(m[2] ?? m[1]), n = w * h;
    const cells = Array.from({ length: n }, () => OPEN);
    let i = 0, ended = false;
    for (const ch of m[3]!) {
      if (ended) throw new Error("too much data to fill the grid");
      if (ch === "!" || ch === "-") {
        if (i === 0 || i > n) throw new Error("tent or no-tent mark off the grid");
        cells[i - 1] = ch === "!" ? TENT_HINT : GRASS_HINT;
        continue;
      }
      if (ch === "z") {
        i += 25;
        continue;
      }
      i += ch === "_" ? 0 : ch.charCodeAt(0) - 96;
      if (i === n) ended = true;
      else if (i < n) cells[i++] = TREE;
      else throw new Error("too much data to fill the grid");
    }
    if (!ended) throw new Error("not enough data to fill the grid");
    const nums = m[4]!.slice(1).split(",").map(Number);
    if (nums.length !== w + h) throw new Error(`expected ${w + h} numbers, got ${nums.length}`);
    return checkPuzzle({ w, h, cells, cols: nums.slice(0, w), rows: nums.slice(w) });
  },
  serialize(p) {
    // a starting mark is written as a tree on its cell, then ! or - to turn that cell into the mark
    let out = "", run = 0;
    const n = p.w * p.h;
    for (let i = 0; i <= n; i++) {
      const v = i < n ? p.cells[i]! : TREE;
      if (v === OPEN) {
        run++;
        continue;
      }
      while (run > 25) {
        out += "z";
        run -= 25;
      }
      out += run === 0 ? "_" : String.fromCharCode(96 + run);
      run = 0;
      if (v === TENT_HINT) out += "!";
      else if (v === GRASS_HINT) out += "-";
    }
    return `${p.w}x${p.h}:${out}${[...p.cols, ...p.rows].map((v) => `,${v}`).join("")}`;
  },
};

// --- hints ---

export function wrongMarksHint(p: TentsPuzzle, s: TentsState): Hint<TentsAction> | null {
  const a = analyze(p);
  if (a.count !== 1 || !a.solution) return null;
  const sol = a.solution;
  const wrong = s.marks.flatMap((m, c) => ((m === TENT && sol[c] !== YES) || (m === GRASS && sol[c] !== NO) ? [c] : []));
  if (!wrong.length) return null;
  return {
    message: `${wrong.length === 1 ? "the mark on" : "the marks on"} ${cellList(p, wrong)} ${wrong.length === 1 ? "is" : "are"} wrong`,
    focus: { cells: wrong, because: [] } satisfies Focus,
    actions: [{ type: "set", cells: wrong, value: NONE }],
  };
}

export function hint(p: TentsPuzzle, s: TentsState): Hint<TentsAction> | null {
  const c = findConflicts(p, s.marks);
  const g = geometry(p);
  if (c.touching.length) return { message: `the tents on ${cellList(p, c.touching)} touch`, focus: { cells: c.touching, because: [] } satisfies Focus };
  if (c.counts.length) return { message: `${lineName(p, c.counts[0]!)} can't get the right number of tents any more`, focus: { cells: [], because: [], related: g.lines[c.counts[0]!]! } satisfies Focus };
  if (c.lonely.length) return { message: `${cellList(p, c.lonely)} can't be paired with a tree or tent`, focus: { cells: c.lonely, because: [] } satisfies Focus };
  const a = analyze(p);
  if (a.count === 0) return { message: "this puzzle has no solution" };
  if (a.count === 2) return { message: "this puzzle has more than one solution, so it can need a guess" };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: TentsPuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 3 };
  return { label: LEVEL_NAMES[a.level]!, score: a.level };
}

// --- generation ---

/** Tents placed in random order wherever they touch no other tent, until `count` are down; null if they don't fit. */
function placeTents(g: Geometry, count: number, rng: Rng): number[] | null {
  const tent = new Uint8Array(g.n);
  const out: number[] = [];
  for (const c of rng.shuffle(Array.from({ length: g.n }, (_, i) => i))) {
    if (out.length === count) break;
    if (g.ring[c]!.some((d) => tent[d])) continue;
    tent[c] = 1;
    out.push(c);
  }
  return out.length === count ? out : null;
}

/** A tree for every tent: a random matching of tents to distinct orthogonal neighbors; null if there's none. */
function placeTrees(w: number, h: number, tents: number[], rng: Rng): number[] | null {
  const isTent = new Set(tents);
  const treeOf = new Map<number, number>(), tentOf = new Map<number, number>();
  const nb = (c: number) => {
    const x = c % w, y = Math.floor(c / w);
    const out: number[] = [];
    if (y > 0) out.push(c - w);
    if (x > 0) out.push(c - 1);
    if (x < w - 1) out.push(c + 1);
    if (y < h - 1) out.push(c + w);
    return rng.shuffle(out.filter((d) => !isTent.has(d)));
  };
  const aug = (t: number, seen: Set<number>): boolean => {
    for (const c of nb(t)) {
      if (seen.has(c)) continue;
      seen.add(c);
      const o = tentOf.get(c);
      if (o === undefined || aug(o, seen)) {
        tentOf.set(c, t);
        treeOf.set(t, c);
        return true;
      }
    }
    return false;
  };
  for (const t of rng.shuffle(tents.slice())) if (!aug(t, new Set())) return null;
  return [...treeOf.values()];
}

const EXACT_ATTEMPTS = 400;
const MAX_ATTEMPTS = 3000;

/**
 * Deterministic in (params, rng), after tatham's: a fifth as many tents as cells placed at
 * random, a tree matched to each, every row and column holding something. Kept when logic at the
 * requested level places every tent (so the placement is unique) and the tree-tent pairing is
 * unique too. Needs exactly the level when one turns up within EXACT_ATTEMPTS layouts, else the
 * hardest found.
 */
export async function generatePuzzle(w: number, h: number, level: Level, rng: Rng, ctx: GenerateContext): Promise<TentsPuzzle> {
  const count = Math.floor((w * h) / 5);
  let best: { p: TentsPuzzle; level: number } | null = null;
  const blank: TentsPuzzle = { w, h, cells: Array.from({ length: w * h }, () => OPEN), cols: [], rows: [] };
  const g0 = geometry(blank);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (best && attempt >= EXACT_ATTEMPTS) break;
    await ctx.yield();
    const r = rng.fork(`attempt ${attempt}`);
    const tents = placeTents(g0, count, r);
    if (!tents) continue;
    const trees = placeTrees(w, h, tents, r);
    if (!trees) continue;
    const cells = Array.from({ length: w * h }, () => OPEN);
    for (const t of trees) cells[t] = TREE;
    const isTent = new Set(tents);
    const used = (c: number) => cells[c] === TREE || isTent.has(c);
    if (g0.lines.some((line) => !line.some(used))) continue;
    const p: TentsPuzzle = {
      w, h, cells,
      cols: g0.lines.slice(h).map((l) => l.filter((c) => isTent.has(c)).length),
      rows: g0.lines.slice(0, h).map((l) => l.filter((c) => isTent.has(c)).length),
    };
    const got = solveLevel(model(p), initialDoms(p), level);
    if (got === null) continue;
    const k = initialDoms(p);
    if (!propagate(model(p), k, level).ok || !isDecided(k)) continue;
    if (matchings(geometry(p), tents) !== 1) continue;
    if (got === level) return p;
    if (!best || got > best.level) best = { p, level: got };
  }
  if (best) return best.p;
  throw new Error("couldn't make a puzzle with these settings; try a different size");
}

export const tents: PuzzleDef<TentsPuzzle, TentsState, TentsAction, TentsInteraction, typeof params> = {
  id: "tents",
  name: "tents",
  aliases: ["tents and trees", "camping"],
  tags: ["logic", "grid", "numbers"],
  description: "put a tent next to every tree. tents never touch each other, not even at a corner, and the numbers say how many tents are in each row and column.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "8×8 easy", params: { width: 8, height: 8, difficulty: "easy" } },
    { label: "8×8 tricky", params: { width: 8, height: 8, difficulty: "tricky" } },
    { label: "10×10 easy", params: { width: 10, height: 10, difficulty: "easy" } },
    { label: "10×10 tricky", params: { width: 10, height: 10, difficulty: "tricky" } },
    { label: "10×10 hard", params: { width: 10, height: 10, difficulty: "hard" } },
    { label: "15×15 tricky", params: { width: 15, height: 15, difficulty: "tricky" } },
  ],
  generate: (v: Values<typeof params>, rng, ctx) => generatePuzzle(v.width, v.height, LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) as Level, rng, ctx),
  formats: [sgtFormat],
  init: (p) => ({ marks: p.cells.map((v) => (v === TENT_HINT ? TENT : v === GRASS_HINT ? GRASS : NONE)) }),
  initInteraction: () => ({ cursor: 0 }),
  reduce,
  isRetraction: (a) => a.value === NONE,
  rules: () => [
    "put tents in some of the empty cells. there are exactly as many tents as trees.",
    "each tree has its own tent right next to it (above, below, left or right). a tent may also touch other trees, as long as every tree can be paired with a different tent.",
    "tents never touch each other, not even at a corner.",
    "the numbers along the bottom and right say how many tents are in that column or row.",
    "grass is your own note that a cell has no tent. it doesn't count for anything.",
  ],
  describeAction: (p, a) => `${["clear", "tent", "grass"][a.value] ?? "mark"} ${cellList(p, a.cells)}`,
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? { board: { marks: a.solution.map((v, c) => (p.cells[c] === TREE ? NONE : v === YES ? TENT : GRASS)) } } : null;
  },
  hint,
  rate,
  describe: (p) => `${p.w}×${p.h}`,
};
