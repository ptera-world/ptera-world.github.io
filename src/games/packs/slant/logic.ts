import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import {
  analyzeModel, bit, decides, solveLevel, trialRule,
  type Analysis, type Constraint, type Doms, type Model, type Rule,
} from "../../lib/grid-kit/csp";
import { cellList, type Focus } from "../../lib/grid-kit/names";

/** Model values per cell: BACK is \ (top-left to bottom-right), FWD is / (bottom-left to top-right). */
export const BACK = 0, FWD = 1;
const Bk = bit(BACK), Fw = bit(FWD), ANY = Bk | Fw;

export interface SlantPuzzle {
  w: number;
  h: number;
  /** Per grid point, (w + 1) × (h + 1) row-major: -1 no number, else how many lines meet there. */
  clues: number[];
}

/** Per-cell mark: NONE, or the slash. */
export const NONE = 0, SLASH_BACK = 1, SLASH_FWD = 2;
export type Mark = typeof NONE | typeof SLASH_BACK | typeof SLASH_FWD;
export const markOf = (v: number): Mark => (v === FWD ? SLASH_FWD : SLASH_BACK);
export const valueOfMark = (m: number): number => (m === SLASH_FWD ? FWD : BACK);

export interface SlantState {
  marks: number[];
}

/** Setting NONE is the only way marks are removed, so it alone is a retraction. */
export type SlantAction = { type: "set"; cells: number[]; value: Mark };

export interface SlantInteraction {
  cursor: number;
}

export const LEVEL_NAMES = ["easy", "hard"] as const;
export type Level = 0 | 1;

export const params = defineSchema({
  width: { type: "int", label: "width", default: 8, min: 2, max: 20 },
  height: { type: "int", label: "height", default: 8, min: 2, max: 20 },
  difficulty: {
    type: "enum", label: "difficulty", default: "easy",
    options: [
      { value: "easy", label: "easy", description: "numbers that are full or need every line, and lines that would close a loop" },
      { value: "hard", label: "hard", description: "also trying a cell both ways" },
    ],
  },
});

// --- geometry ---

export interface Geometry {
  w: number;
  h: number;
  /** Cell count. */
  n: number;
  /** Points across (w + 1). */
  W: number;
  /** Per point: the cells around it and the value that makes each one's line reach the point. */
  around: { cell: number; value: number }[][];
  /** Per cell and value: the two points the line joins. */
  ends: [number, number][][];
  shown: number[];
}

const geoCache = new WeakMap<SlantPuzzle, Geometry>();

export function geometry(p: SlantPuzzle): Geometry {
  const hit = geoCache.get(p);
  if (hit) return hit;
  const { w, h } = p;
  const W = w + 1, H = h + 1;
  const around = Array.from({ length: W * H }, (_, v) => {
    const x = v % W, y = Math.floor(v / W);
    const out: { cell: number; value: number }[] = [];
    if (x > 0 && y > 0) out.push({ cell: (y - 1) * w + x - 1, value: BACK });
    if (x < w && y > 0) out.push({ cell: (y - 1) * w + x, value: FWD });
    if (x > 0 && y < h) out.push({ cell: y * w + x - 1, value: FWD });
    if (x < w && y < h) out.push({ cell: y * w + x, value: BACK });
    return out;
  });
  const ends = Array.from({ length: w * h }, (_, c) => {
    const x = c % w, y = Math.floor(c / w);
    return [[y * W + x, (y + 1) * W + x + 1], [y * W + x + 1, (y + 1) * W + x]] as [number, number][];
  });
  const g = { w, h, n: w * h, W, around, ends, shown: p.clues.flatMap((v, i) => (v >= 0 ? [i] : [])) };
  geoCache.set(p, g);
  return g;
}

/** "the point above-left of C3" style name for a grid point: the cell whose top-left corner it is, or the nearest. */
export function pointName(p: SlantPuzzle, v: number): string {
  const W = p.w + 1;
  const x = v % W, y = Math.floor(v / W);
  const cx = Math.min(x, p.w - 1), cy = Math.min(y, p.h - 1);
  const side = `${y > cy ? "bottom" : "top"}-${x > cx ? "right" : "left"}`;
  return `the ${side} corner of ${cellList(p, [cy * p.w + cx])}`;
}

/** The cell a point name refers to (see pointName). */
export function pointCell(p: SlantPuzzle, v: number): number {
  const W = p.w + 1;
  return Math.min(Math.floor(v / W), p.h - 1) * p.w + Math.min(v % W, p.w - 1);
}

// --- union-find over points ---

function find(parent: Int32Array, a: number): number {
  while (parent[a] !== a) {
    parent[a] = parent[parent[a]!]!;
    a = parent[a]!;
  }
  return a;
}

/** Points joined by decided lines; null if the decided lines already close a loop. */
function joined(g: Geometry, value: (c: number) => number): Int32Array | null {
  const parent = Int32Array.from({ length: g.W * (g.h + 1) }, (_, i) => i);
  for (let c = 0; c < g.n; c++) {
    const v = value(c);
    if (v < 0) continue;
    const [a, b] = g.ends[c]![v]!;
    const ra = find(parent, a), rb = find(parent, b);
    if (ra === rb) return null;
    parent[ra] = rb;
  }
  return parent;
}

// --- model ---

const modelCache = new WeakMap<SlantPuzzle, Model>();
const decided = (k: Doms, c: number) => (k[c] === Bk ? BACK : k[c] === Fw ? FWD : -1);

export function model(p: SlantPuzzle): Model {
  const hit = modelCache.get(p);
  if (hit) return hit;
  const g = geometry(p);
  const constraints: Constraint[] = g.shown.map((pt) => {
    const cells = g.around[pt]!, n = p.clues[pt]!;
    return {
      vars: cells.map((a) => a.cell),
      run(k, emit) {
        let have = 0;
        const open: { cell: number; value: number }[] = [];
        for (const a of cells) {
          if (k[a.cell] === bit(a.value)) have++;
          else if (k[a.cell] === ANY) open.push(a);
        }
        if (have > n || have + open.length < n) return false;
        if (!open.length) return true;
        if (have === n) {
          for (const a of open) if (emit({ kind: "clue-full", level: 0, vars: [a.cell], keep: ANY & ~bit(a.value), because: [pt] })) return true;
        } else if (have + open.length === n) {
          for (const a of open) if (emit({ kind: "clue-all", level: 0, vars: [a.cell], keep: bit(a.value), because: [pt] })) return true;
        }
        return true;
      },
    };
  });
  const loop: Rule = {
    level: 0,
    kinds: ["loop"],
    run(k, emit) {
      const parent = joined(g, (c) => decided(k, c));
      if (!parent) return false;
      for (let c = 0; c < g.n; c++) {
        if (k[c] !== ANY) continue;
        for (const v of [BACK, FWD]) {
          const [a, b] = g.ends[c]![v]!;
          if (find(parent, a) !== find(parent, b)) continue;
          if (emit({ kind: "loop", level: 0, vars: [c], keep: ANY & ~bit(v), because: [], data: { value: v } })) return true;
          break;
        }
      }
      return true;
    },
  };
  const m: Model = { n: g.n, constraints, rules: [loop], complete: (k) => joined(g, (c) => decided(k, c)) !== null };
  m.rules.push(trialRule(m, 1, 0));
  modelCache.set(p, m);
  return m;
}

export const initialDoms = (p: SlantPuzzle): Doms => new Int32Array(p.w * p.h).fill(ANY);

const analyses = new WeakMap<SlantPuzzle, Analysis>();

/** Unique-solution analysis, memoized per puzzle. `solution` holds BACK / FWD per cell. */
export function analyze(p: SlantPuzzle): Analysis {
  let a = analyses.get(p);
  if (!a) analyses.set(p, a = analyzeModel(model(p), initialDoms(p), 1));
  return a;
}

/** Board slashes as domains; with a unique solution only slashes that agree with it count. */
export function readMarks(p: SlantPuzzle, s: SlantState): Doms {
  const a = analyze(p);
  const sol = a.count === 1 ? a.solution : null;
  const k = initialDoms(p);
  s.marks.forEach((m, c) => {
    if (m === NONE) return;
    const v = valueOfMark(m);
    if (!sol || sol[c] === v) k[c] = bit(v);
  });
  return k;
}

// --- state ---

export function reduce(p: SlantPuzzle, s: SlantState, a: SlantAction): SlantState {
  if (a.type !== "set" || ![NONE, SLASH_BACK, SLASH_FWD].includes(a.value)) return s;
  let next: number[] | null = null;
  for (const c of a.cells) {
    if (!(c >= 0 && c < p.w * p.h) || s.marks[c] === a.value) continue;
    next ??= s.marks.slice();
    next[c] = a.value;
  }
  return next ? { marks: next } : s;
}

export interface SlantConflicts extends Record<string, number[]> {
  /** Cells whose lines form a closed loop. */
  loops: number[];
  /** Points (not cells) whose number is passed or out of reach. */
  clues: number[];
}

export function findConflicts(p: SlantPuzzle, marks: readonly number[]): SlantConflicts {
  const g = geometry(p);
  const value = (c: number) => (marks[c] === NONE ? -1 : valueOfMark(marks[c]!));
  const loops: number[] = [];
  for (let c = 0; c < g.n; c++) {
    if (value(c) < 0) continue;
    // a line is on a loop iff its ends stay joined without it
    const parent = joined(g, (d) => (d === c ? -1 : value(d)));
    const [a, b] = g.ends[c]![value(c)]!;
    if (!parent || find(parent, a) === find(parent, b)) loops.push(c);
  }
  const clues = g.shown.filter((pt) => {
    const cells = g.around[pt]!;
    const have = cells.filter((a) => value(a.cell) === a.value).length;
    const open = cells.filter((a) => value(a.cell) < 0).length;
    return have > p.clues[pt]! || have + open < p.clues[pt]!;
  });
  return { loops, clues };
}

export function isSolved(p: SlantPuzzle, s: SlantState): boolean {
  if (s.marks.some((m) => m === NONE)) return false;
  const c = findConflicts(p, s.marks);
  return !c.loops.length && !c.clues.length;
}

// --- formats ---

const SGT_RE = /^(\d+)(?:x(\d+))?(?:d.)?:([a-z0-4]+)$/;

/** Simon Tatham's Slant game id: `WxH[dX]:` then, per grid point, a digit 0–4 or `a`–`z` for 1–26 points without one. */
export const sgtFormat: Format<SlantPuzzle> = {
  id: "sgt",
  label: "game id (WxH:…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(t) {
    const m = SGT_RE.exec(t.trim());
    if (!m) throw new Error("expected WxH:desc, e.g. 5x5:a1b2…");
    const w = Number(m[1]), h = Number(m[2] ?? m[1]);
    if (!(w >= 1 && h >= 1 && w <= 60 && h <= 60)) throw new Error("size must be between 1×1 and 60×60");
    const clues: number[] = [];
    for (const ch of m[3]!) {
      if (ch >= "0" && ch <= "4") clues.push(Number(ch));
      else for (let i = 0; i < ch.charCodeAt(0) - 96; i++) clues.push(-1);
    }
    const want = (w + 1) * (h + 1);
    if (clues.length !== want) throw new Error(clues.length < want ? "not enough data to fill the grid" : "too much data for the grid");
    return { w, h, clues };
  },
  serialize(p) {
    let out = "", run = 0;
    const flush = () => {
      while (run > 0) {
        const step = Math.min(run, 26);
        out += String.fromCharCode(96 + step);
        run -= step;
      }
    };
    for (const v of p.clues) {
      if (v < 0) {
        run++;
        continue;
      }
      flush();
      out += String(v);
    }
    flush();
    return `${p.w}x${p.h}:${out}`;
  },
};

// --- hints ---

export function wrongMarksHint(p: SlantPuzzle, s: SlantState): Hint<SlantAction> | null {
  const a = analyze(p);
  if (a.count !== 1 || !a.solution) return null;
  const sol = a.solution;
  const wrong = s.marks.flatMap((m, c) => (m !== NONE && valueOfMark(m) !== sol[c] ? [c] : []));
  if (!wrong.length) return null;
  return {
    message: `${wrong.length === 1 ? "the line in" : "the lines in"} ${cellList(p, wrong)} ${wrong.length === 1 ? "is" : "are"} the wrong way`,
    focus: { cells: wrong, because: [] } satisfies Focus,
    actions: [{ type: "set", cells: wrong, value: NONE }],
  };
}

export function hint(p: SlantPuzzle, s: SlantState): Hint<SlantAction> | null {
  const c = findConflicts(p, s.marks);
  if (c.loops.length) return { message: `the lines in ${cellList(p, c.loops)} close a loop`, focus: { cells: c.loops, because: [] } satisfies Focus };
  if (c.clues.length) return { message: `the number at ${pointName(p, c.clues[0]!)} can't be met any more`, focus: { cells: [], because: [pointCell(p, c.clues[0]!)], points: [c.clues[0]!] } satisfies Focus };
  const a = analyze(p);
  if (a.count === 0) return { message: "this puzzle has no solution" };
  if (a.count === 2) return { message: "this puzzle has more than one solution, so it can need a guess" };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: SlantPuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 2 };
  return { label: LEVEL_NAMES[a.level]!, score: a.level };
}

// --- generation ---

/** A random loop-free filling: cells in random order, a random slash unless one would close a loop. */
function randomFill(g: Geometry, rng: Rng): number[] {
  const parent = Int32Array.from({ length: g.W * (g.h + 1) }, (_, i) => i);
  const out = Array.from({ length: g.n }, () => BACK);
  for (const c of rng.shuffle(Array.from({ length: g.n }, (_, i) => i))) {
    const closes = (v: number) => {
      const [a, b] = g.ends[c]![v]!;
      return find(parent, a) === find(parent, b);
    };
    const v = closes(BACK) ? FWD : closes(FWD) ? BACK : rng.int(2);
    out[c] = v;
    const [a, b] = g.ends[c]![v]!;
    parent[find(parent, a)] = find(parent, b);
  }
  return out;
}

const EXACT_ATTEMPTS = 40;
const MAX_ATTEMPTS = 400;

/**
 * Deterministic in (params, rng): a random loop-free filling, every point numbered, then numbers
 * removed in random order while logic at the requested level still decides every cell (for hard,
 * the giveaway numbers — 0s, 4s, 2s on the edge, 1s in corners — go last). Needs exactly the
 * level when one turns up within EXACT_ATTEMPTS fillings, else the hardest found.
 */
export async function generatePuzzle(w: number, h: number, level: Level, rng: Rng, ctx: GenerateContext): Promise<SlantPuzzle> {
  const g = geometry({ w, h, clues: [] });
  const W = w + 1, H = h + 1;
  let best: { p: SlantPuzzle; level: number } | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (best && attempt >= EXACT_ATTEMPTS) break;
    await ctx.yield();
    const r = rng.fork(`attempt ${attempt}`);
    const fill = randomFill(g, r);
    const clues = g.around.map((cells) => cells.filter((a) => fill[a.cell] === a.value).length);
    const giveaway = (pt: number) => {
      const v = clues[pt]!, x = pt % W, y = Math.floor(pt / W);
      const xb = x === 0 || x === W - 1, yb = y === 0 || y === H - 1;
      return v === 0 || v === 4 || (v === 2 && (xb || yb)) || (v === 1 && xb && yb);
    };
    const order = r.shuffle(Array.from({ length: W * H }, (_, i) => i));
    // easy removes in random order; hard first strips what easy logic allows except the
    // giveaways, then lets the trial take giveaways first and the rest after
    const passes: [number, number[]][] = level === 0
      ? [[0, order]]
      : [[0, order.filter((pt) => !giveaway(pt))], [1, [...order.filter(giveaway), ...order.filter((pt) => !giveaway(pt))]]];
    for (const [pass, list] of passes) {
      for (const pt of list) {
        if (clues[pt]! < 0) continue;
        await ctx.yield();
        const keep = clues[pt]!;
        clues[pt] = -1;
        const q = { w, h, clues: clues.slice() };
        if (!decides(model(q), initialDoms(q), pass)) clues[pt] = keep;
      }
    }
    const p: SlantPuzzle = { w, h, clues };
    const got = solveLevel(model(p), initialDoms(p), level)!;
    if (got === level) return p;
    if (!best || got > best.level) best = { p, level: got };
  }
  if (best) return best.p;
  throw new Error("couldn't make a puzzle with these settings; try a different size");
}

export const slant: PuzzleDef<SlantPuzzle, SlantState, SlantAction, SlantInteraction, typeof params> = {
  id: "slant",
  name: "slant",
  aliases: ["gokigen", "gokigen naname"],
  tags: ["logic", "grid", "numbers", "loops", "nikoli"],
  description: "draw a diagonal line in every cell. each number says how many lines meet at its corner point, and the lines may never form a closed loop.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "5×5 easy", params: { width: 5, height: 5, difficulty: "easy" } },
    { label: "5×5 hard", params: { width: 5, height: 5, difficulty: "hard" } },
    { label: "8×8 easy", params: { width: 8, height: 8, difficulty: "easy" } },
    { label: "8×8 hard", params: { width: 8, height: 8, difficulty: "hard" } },
    { label: "12×10 easy", params: { width: 12, height: 10, difficulty: "easy" } },
    { label: "12×10 hard", params: { width: 12, height: 10, difficulty: "hard" } },
  ],
  generate: (v: Values<typeof params>, rng, ctx) => generatePuzzle(v.width, v.height, LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) as Level, rng, ctx),
  formats: [sgtFormat],
  init: (p) => ({ marks: Array.from({ length: p.w * p.h }, () => NONE) }),
  initInteraction: () => ({ cursor: 0 }),
  reduce,
  isRetraction: (a) => a.value === NONE,
  rules: () => [
    "draw a diagonal line, \\ or /, in every cell.",
    "a number on a corner point is how many lines touch that point.",
    "the lines may never form a closed loop.",
  ],
  describeAction: (p, a) => (a.value === NONE ? `clear ${cellList(p, a.cells)}` : `${cellList(p, a.cells)}: ${a.value === SLASH_BACK ? "\\" : "/"}`),
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? { board: { marks: a.solution.map(markOf) } } : null;
  },
  hint,
  rate,
  describe: (p) => `${p.w}×${p.h}`,
};
