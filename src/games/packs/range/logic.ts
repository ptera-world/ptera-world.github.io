import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import {
  analyzeModel, bit, decides, solveLevel, trialRule,
  type Analysis, type Constraint, type Doms, type Model, type Rule,
} from "../../lib/grid-kit/csp";
import { cutVertices, gridLines, neighbours, pieces } from "../../lib/grid-kit/grid";
import { cellList, type Focus } from "../../lib/grid-kit/names";

export interface RangePuzzle {
  w: number;
  h: number;
  /** Row-major: 0 open, else the number (how many white cells the cell sees, itself included). */
  nums: number[];
}

/** Model values: one variable per cell. */
export const WHITE = 0, SHADED = 1;
const W = bit(WHITE), B = bit(SHADED), ANY = W | B;

/** Per-cell mark. DOT is the player's "this stays white" note. */
export const NONE = 0, BLACK = 1, DOT = 2;
export type Mark = typeof NONE | typeof BLACK | typeof DOT;

export interface RangeState {
  marks: number[];
}

/** Setting NONE is the only way marks are removed, so it alone is a retraction. */
export type RangeAction = { type: "set"; cells: number[]; value: Mark };

export interface RangeInteraction {
  cursor: number;
}

export const LEVEL_NAMES = ["easy", "normal", "hard"] as const;
export type Level = 0 | 1 | 2;

export const params = defineSchema({
  width: { type: "int", label: "width", default: 9, min: 3, max: 20 },
  height: { type: "int", label: "height", default: 6, min: 3, max: 20 },
  difficulty: {
    type: "enum", label: "difficulty", default: "normal",
    options: [
      { value: "easy", label: "easy", description: "neighbours of blacks, and what each number can and can't see" },
      { value: "normal", label: "normal", description: "also blacks that would cut the white area in two" },
      { value: "hard", label: "hard", description: "also trying a cell both ways" },
    ],
  },
});

// --- geometry ---

/** Directions as (dx, dy): up, left, right, down. */
export const DIRS = [[0, -1], [-1, 0], [1, 0], [0, 1]] as const;

export interface Geometry {
  w: number;
  h: number;
  n: number;
  nbrs: number[][];
  lines: number[][];
  clues: number[];
  /** Per cell and direction, the cells in that direction, nearest first. */
  rays: number[][][];
}

const geoCache = new WeakMap<RangePuzzle, Geometry>();

export function geometry(p: RangePuzzle): Geometry {
  const hit = geoCache.get(p);
  if (hit) return hit;
  const { w, h } = p;
  const n = w * h;
  const rays = Array.from({ length: n }, (_, i) => DIRS.map(([dx, dy]) => {
    const out: number[] = [];
    let x = (i % w) + dx, y = Math.floor(i / w) + dy;
    while (x >= 0 && y >= 0 && x < w && y < h) {
      out.push(y * w + x);
      x += dx;
      y += dy;
    }
    return out;
  }));
  const g = { w, h, n, nbrs: neighbours(w, h), lines: gridLines(w, h), clues: p.nums.flatMap((v, i) => (v > 0 ? [i] : [])), rays };
  geoCache.set(p, g);
  return g;
}

// --- model ---

const modelCache = new WeakMap<RangePuzzle, Model>();

/** Cells a number at q sees with `k`: count of the white run, and of the not-black run, per direction. */
function sight(g: Geometry, k: Doms, q: number) {
  const white: number[] = [], room: number[] = [];
  for (const ray of g.rays[q]!) {
    let a = 0;
    while (a < ray.length && k[ray[a]!] === W) a++;
    let b = a;
    while (b < ray.length && k[ray[b]!] !== B) b++;
    white.push(a);
    room.push(b);
  }
  return { white, room };
}

export function model(p: RangePuzzle): Model {
  const hit = modelCache.get(p);
  if (hit) return hit;
  const g = geometry(p);
  const constraints: Constraint[] = [];
  for (let c = 0; c < g.n; c++) {
    const around = g.nbrs[c]!;
    constraints.push({
      vars: [c, ...around],
      run(k, emit) {
        if (k[c] !== B) return true;
        if (around.some((d) => k[d] === B)) return false;
        const open = around.filter((d) => k[d] !== W);
        if (open.length) emit({ kind: "black-neighbour", level: 0, vars: open, keep: W, because: [c] });
        return true;
      },
    });
  }
  for (const q of g.clues) {
    const n = p.nums[q]!;
    const rays = g.rays[q]!;
    constraints.push({
      vars: [q, ...rays.flat()],
      run(k, emit) {
        const look = () => {
          const { white, room } = sight(g, k, q);
          return { white, room, seen: 1 + white.reduce((a, b) => a + b, 0), most: 1 + room.reduce((a, b) => a + b, 0) };
        };
        const first = look();
        if (first.seen > n || first.most < n) return false;
        // each direction: the first cell past the white run
        for (let d = 0; d < 4; d++) {
          const { white, seen } = look();
          const ray = rays[d]!, e = ray[white[d]!];
          if (e === undefined || k[e] !== ANY) continue;
          if (seen === n) {
            if (emit({ kind: "clue-closed", level: 0, vars: [e], keep: B, because: [q] })) return true;
            continue;
          }
          let beyond = 0;
          for (let i = white[d]! + 1; i < ray.length && k[ray[i]!] === W; i++) beyond++;
          if (seen + 1 + beyond > n && emit({ kind: "clue-overflow", level: 0, vars: [e], keep: B, because: [q], related: ray.slice(white[d]! + 1, white[d]! + 1 + beyond) })) return true;
        }
        // each direction: what the others can't supply has to come from this one
        for (let d = 0; d < 4; d++) {
          const { white, room, most } = look();
          const others = most - room[d]!;
          const need = n - others;
          if (need <= white[d]!) continue;
          const cells = rays[d]!.slice(0, need).filter((c) => k[c] === ANY);
          if (cells.length && emit({ kind: "clue-reach", level: 0, vars: cells, keep: W, because: [q] })) return true;
        }
        return true;
      },
    });
  }
  const split: Rule = {
    level: 1,
    kinds: ["split"],
    run(k, emit) {
      if (pieces(g.nbrs, (c) => k[c] !== B).count > 1) return false;
      const cut = cutVertices(g.nbrs, (c) => k[c] !== B);
      for (let c = 0; c < g.n; c++) if (cut[c] && k[c] === ANY && emit({ kind: "split", level: 1, vars: [c], keep: W, because: [] })) return true;
      return true;
    },
  };
  const m: Model = {
    n: g.n,
    constraints,
    rules: [split],
    countLevel: 1,
    complete: (k) => pieces(g.nbrs, (c) => k[c] !== B).count <= 1,
    done: (k) => isDone(p, g, (c) => k[c] === B),
  };
  m.rules.push(trialRule(m, 2, 1));
  modelCache.set(p, m);
  return m;
}

/** True if the given blacks (everything else white) obey every rule. */
function isDone(p: RangePuzzle, g: Geometry, black: (c: number) => boolean): boolean {
  for (let c = 0; c < g.n; c++) {
    if (!black(c)) continue;
    if (p.nums[c]! > 0 || g.nbrs[c]!.some(black)) return false;
  }
  if (pieces(g.nbrs, (c) => !black(c)).count !== 1) return false;
  return g.clues.every((q) => 1 + g.rays[q]!.reduce((s, ray) => {
    let a = 0;
    while (a < ray.length && !black(ray[a]!)) a++;
    return s + a;
  }, 0) === p.nums[q]);
}

export const initialDoms = (p: RangePuzzle): Doms => Int32Array.from(p.nums, (v) => (v > 0 ? W : ANY));

const analyses = new WeakMap<RangePuzzle, Analysis>();

/** Unique-solution analysis, memoized per puzzle. `solution` holds WHITE / SHADED per cell. */
export function analyze(p: RangePuzzle): Analysis {
  let a = analyses.get(p);
  if (!a) analyses.set(p, a = analyzeModel(model(p), initialDoms(p), 2));
  return a;
}

/** Numbers plus board marks as domains; with a unique solution only marks that agree with it count. */
export function readMarks(p: RangePuzzle, s: RangeState): Doms {
  const a = analyze(p);
  const sol = a.count === 1 ? a.solution : null;
  const k = initialDoms(p);
  s.marks.forEach((m, c) => {
    if (p.nums[c]! > 0) return;
    if (m === BLACK && (!sol || sol[c] === SHADED)) k[c] = B;
    else if (m === DOT && (!sol || sol[c] === WHITE)) k[c] = W;
  });
  return k;
}

// --- state ---

export function reduce(p: RangePuzzle, s: RangeState, a: RangeAction): RangeState {
  if (a.type !== "set" || ![NONE, BLACK, DOT].includes(a.value)) return s;
  let next: number[] | null = null;
  for (const c of a.cells) {
    if (!(c >= 0 && c < p.nums.length) || p.nums[c]! > 0 || s.marks[c] === a.value) continue;
    next ??= s.marks.slice();
    next[c] = a.value;
  }
  return next ? { marks: next } : s;
}

export interface RangeConflicts extends Record<string, number[]> {
  /** Blacks side by side. */
  touching: number[];
  /** Numbers that see too many cells, or can't see enough any more. */
  clues: number[];
  /** Cells walled off from the rest by blacks. */
  cut: number[];
}

export function findConflicts(p: RangePuzzle, marks: readonly number[]): RangeConflicts {
  const g = geometry(p);
  const black = (c: number) => marks[c] === BLACK;
  const touching = Array.from({ length: g.n }, (_, c) => c).filter((c) => black(c) && g.nbrs[c]!.some(black));
  const k = Int32Array.from(marks, (m, c) => (p.nums[c]! > 0 || m === DOT ? W : m === BLACK ? B : ANY));
  const clues = g.clues.filter((q) => {
    const { white, room } = sight(g, k, q);
    return 1 + white.reduce((a, b) => a + b, 0) > p.nums[q]! || 1 + room.reduce((a, b) => a + b, 0) < p.nums[q]!;
  });
  const pc = pieces(g.nbrs, (c) => !black(c));
  const cut: number[] = [];
  if (pc.count > 1) {
    const size = Array.from({ length: pc.count }, () => 0);
    for (let c = 0; c < g.n; c++) if (pc.id[c]! >= 0) size[pc.id[c]!]!++;
    const main = size.indexOf(Math.max(...size));
    for (let c = 0; c < g.n; c++) if (pc.id[c]! >= 0 && pc.id[c] !== main) cut.push(c);
  }
  return { touching, clues, cut };
}

export const isSolved = (p: RangePuzzle, s: RangeState): boolean => isDone(p, geometry(p), (c) => s.marks[c] === BLACK);

// --- formats ---

const SGT_RE = /^(\d+)(?:x(\d+))?:([a-z_0-9]+)$/;

/**
 * Simon Tatham's Range game id: `WxH:` then `a`–`z` for 1–26 open cells, decimal numbers, and
 * `_` between two numbers that would otherwise run together.
 */
export const sgtFormat: Format<RangePuzzle> = {
  id: "sgt",
  label: "game id (WxH:…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(t) {
    const m = SGT_RE.exec(t.trim());
    if (!m) throw new Error("expected WxH:desc, e.g. 7x7:d7b3e8…");
    const w = Number(m[1]), h = Number(m[2] ?? m[1]);
    if (!(w >= 1 && h >= 1 && w <= 60 && h <= 60)) throw new Error("size must be between 1×1 and 60×60");
    const nums: number[] = [];
    for (const tok of m[3]!.match(/[a-z]|_|\d+/g) ?? []) {
      if (tok === "_") continue;
      if (/\d/.test(tok)) {
        const v = Number(tok);
        if (v < 1 || v > w + h - 1) throw new Error(`number ${v} is out of range`);
        nums.push(v);
      } else for (let i = 0; i <= tok.charCodeAt(0) - 97; i++) nums.push(0);
    }
    if (nums.length !== w * h) throw new Error(nums.length < w * h ? "not enough data to fill the grid" : "too much data for the grid");
    return { w, h, nums };
  },
  serialize(p) {
    let out = "", run = 0;
    for (let i = 0; i <= p.nums.length; i++) {
      const v = i < p.nums.length ? p.nums[i]! : -1;
      if (v === 0) {
        run++;
        continue;
      }
      if (run) {
        while (run > 0) {
          const step = Math.min(run, 26);
          out += String.fromCharCode(96 + step);
          run -= step;
        }
      } else if (out.length && v > 0) out += "_";
      if (v > 0) out += String(v);
      run = 0;
    }
    return `${p.w}x${p.h}:${out}`;
  },
};

// --- hints ---

export function wrongMarksHint(p: RangePuzzle, s: RangeState): Hint<RangeAction> | null {
  const a = analyze(p);
  if (a.count !== 1 || !a.solution) return null;
  const sol = a.solution;
  const wrong = s.marks.flatMap((m, c) => ((m === BLACK && sol[c] !== SHADED) || (m === DOT && sol[c] !== WHITE) ? [c] : []));
  if (!wrong.length) return null;
  return {
    message: `${wrong.length === 1 ? "the mark on" : "the marks on"} ${cellList(p, wrong)} ${wrong.length === 1 ? "is" : "are"} wrong`,
    focus: { cells: wrong, because: [] } satisfies Focus,
    actions: [{ type: "set", cells: wrong, value: NONE }],
  };
}

export function hint(p: RangePuzzle, s: RangeState): Hint<RangeAction> | null {
  const c = findConflicts(p, s.marks);
  if (c.touching.length) return { message: `the blacks on ${cellList(p, c.touching)} touch`, focus: { cells: c.touching, because: [] } satisfies Focus };
  if (c.clues.length) return { message: `the number on ${cellList(p, c.clues)} can't see the right count any more`, focus: { cells: [], because: c.clues } satisfies Focus };
  if (c.cut.length) return { message: `${cellList(p, c.cut)} ${c.cut.length === 1 ? "is" : "are"} cut off from the other white cells`, focus: { cells: c.cut, because: [] } satisfies Focus };
  const a = analyze(p);
  if (a.count === 0) return { message: "this puzzle has no solution" };
  if (a.count === 2) return { message: "this puzzle has more than one solution, so it can need a guess" };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: RangePuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 3 };
  return { label: LEVEL_NAMES[a.level]!, score: a.level };
}

// --- generation ---

/** Up to a third of the cells tried as blacks in random order; kept when they touch no black and leave the whites joined. */
function chooseBlacks(g: Geometry, rng: Rng): Uint8Array {
  const black = new Uint8Array(g.n);
  const order = rng.shuffle(Array.from({ length: g.n }, (_, i) => i));
  for (const c of order.slice(0, Math.floor(g.n / 3))) {
    if (g.nbrs[c]!.some((d) => black[d])) continue;
    black[c] = 1;
    if (pieces(g.nbrs, (d) => !black[d]).count > 1) black[c] = 0;
  }
  return black;
}

/** Logic up to `level` decides every cell, so the solution is unique. */
function decidedBy(p: RangePuzzle, level: number): boolean {
  return decides(model(p), initialDoms(p), level);
}

const EXACT_ATTEMPTS = 150;
const MAX_ATTEMPTS = 1000;

/**
 * Deterministic in (params, rng), after tatham's: random blacks, every white numbered, then
 * numbers removed in pairs symmetric under a half turn while logic at the requested level still
 * decides every cell. Needs exactly the level when one turns up within EXACT_ATTEMPTS layouts,
 * else the hardest found.
 */
export async function generatePuzzle(w: number, h: number, level: Level, rng: Rng, ctx: GenerateContext): Promise<RangePuzzle> {
  const g0 = geometry({ w, h, nums: [] });
  const n = w * h;
  let best: { p: RangePuzzle; level: number } | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (best && attempt >= EXACT_ATTEMPTS) break;
    await ctx.yield();
    const r = rng.fork(`attempt ${attempt}`);
    const black = chooseBlacks(g0, r);
    const nums = Array.from({ length: n }, (_, c) => (black[c] ? 0 : 1 + g0.rays[c]!.reduce((s, ray) => {
      let a = 0;
      while (a < ray.length && !black[ray[a]!]) a++;
      return s + a;
    }, 0)));
    // numbers stay symmetric under a half turn, so none sits opposite a black
    for (let c = 0; c < n; c++) if (black[n - 1 - c]) nums[c] = 0;
    if (!decidedBy({ w, h, nums }, level)) continue;
    for (const pass of level > 0 ? [level - 1, level] : [level]) {
      for (const c of r.shuffle(Array.from({ length: n }, (_, i) => i))) {
        if (!nums[c]) continue;
        await ctx.yield();
        const keep = [nums[c]!, nums[n - 1 - c]!];
        nums[c] = nums[n - 1 - c] = 0;
        if (!decidedBy({ w, h, nums: nums.slice() }, pass)) [nums[c], nums[n - 1 - c]] = keep as [number, number];
      }
    }
    const p: RangePuzzle = { w, h, nums };
    const got = solveLevel(model(p), initialDoms(p), level)!;
    if (got === level) return p;
    if (!best || got > best.level) best = { p, level: got };
  }
  if (best) return best.p;
  throw new Error("couldn't make a puzzle with these settings; try a different size");
}

export const range: PuzzleDef<RangePuzzle, RangeState, RangeAction, RangeInteraction, typeof params> = {
  id: "range",
  name: "range",
  aliases: ["kurodoko", "kuromasu"],
  tags: ["logic", "grid", "numbers", "shading", "nikoli"],
  description: "black out cells so that each number sees exactly that many white cells along its row and column (itself included). blacks may not touch side by side, and the whites must stay in one piece.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "9×6 easy", params: { width: 9, height: 6, difficulty: "easy" } },
    { label: "9×6 normal", params: { width: 9, height: 6, difficulty: "normal" } },
    { label: "12×8 normal", params: { width: 12, height: 8, difficulty: "normal" } },
    { label: "13×9 normal", params: { width: 13, height: 9, difficulty: "normal" } },
    { label: "12×8 hard", params: { width: 12, height: 8, difficulty: "hard" } },
    { label: "16×11 normal", params: { width: 16, height: 11, difficulty: "normal" } },
  ],
  generate: (v: Values<typeof params>, rng, ctx) => generatePuzzle(v.width, v.height, LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) as Level, rng, ctx),
  formats: [sgtFormat],
  init: (p) => ({ marks: p.nums.map(() => NONE) }),
  initInteraction: () => ({ cursor: 0 }),
  reduce,
  isRetraction: (a) => a.value === NONE,
  rules: () => [
    "black out some of the empty cells. numbered cells always stay white.",
    "a number is how many white cells it sees: itself, plus the white cells in a straight line up, down, left and right of it until a black cell or the edge.",
    "two black cells may not touch side by side (corners are fine).",
    "all the white cells must form one connected area.",
    "a dot is your own note that a cell stays white. it doesn't count for anything.",
  ],
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? { marks: a.solution.map((v, c) => (p.nums[c]! > 0 ? NONE : v === SHADED ? BLACK : DOT)) } : null;
  },
  hint,
  rate,
  describe: (p) => `${p.w}×${p.h}`,
};
