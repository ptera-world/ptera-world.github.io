import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import {
  analyzeModel, bit, isUnique, solveLevel, trialRule,
  type Analysis, type Constraint, type Doms, type Model, type Rule,
} from "../../lib/grid-kit/csp";
import { cellList, type Focus } from "../../lib/grid-kit/names";

export interface SinglesPuzzle {
  w: number;
  h: number;
  /** Row-major numbers, 1..max(w, h). */
  nums: number[];
}

/** Per-cell mark. CIRCLE is the player's "this stays white" note. */
export const NONE = 0, BLACK = 1, CIRCLE = 2;
export type Mark = typeof NONE | typeof BLACK | typeof CIRCLE;

export interface SinglesState {
  marks: number[];
}

/** Setting NONE is the only way marks are removed, so it alone is a retraction. */
export type SinglesAction = { type: "set"; cells: number[]; value: Mark };

export interface SinglesInteraction {
  cursor: number;
}

/** Variable values in the model: one variable per cell. */
export const WHITE = 0, SHADED = 1;
const W = bit(WHITE), B = bit(SHADED), ANY = W | B;

export const LEVEL_NAMES = ["easy", "tricky", "hard"] as const;
export type Level = 0 | 1 | 2;

export const params = defineSchema({
  width: { type: "int", label: "width", default: 8, min: 3, max: 20 },
  height: { type: "int", label: "height", default: 8, min: 3, max: 20 },
  difficulty: {
    type: "enum", label: "difficulty", default: "easy",
    options: [
      { value: "easy", label: "easy", description: "repeats, neighbors of blacks, and cells with one way out" },
      { value: "tricky", label: "tricky", description: "also blacks that would cut the white area in two" },
      { value: "hard", label: "hard", description: "also trying a cell both ways" },
    ],
  },
});

// --- geometry ---

export interface Geometry {
  w: number;
  h: number;
  n: number;
  nbrs: number[][];
  /** Rows then columns, each as its cells in order. */
  lines: number[][];
}

const geoCache = new WeakMap<SinglesPuzzle, Geometry>();

export function geometry(p: SinglesPuzzle): Geometry {
  const hit = geoCache.get(p);
  if (hit) return hit;
  const { w, h } = p;
  const n = w * h;
  const nbrs = Array.from({ length: n }, (_, i) => {
    const x = i % w, y = Math.floor(i / w);
    const out: number[] = [];
    if (y > 0) out.push(i - w);
    if (x > 0) out.push(i - 1);
    if (x < w - 1) out.push(i + 1);
    if (y < h - 1) out.push(i + w);
    return out;
  });
  const lines: number[][] = [];
  for (let y = 0; y < h; y++) lines.push(Array.from({ length: w }, (_, x) => y * w + x));
  for (let x = 0; x < w; x++) lines.push(Array.from({ length: h }, (_, y) => y * w + x));
  const g = { w, h, n, nbrs, lines };
  geoCache.set(p, g);
  return g;
}

/**
 * Cells not known to be black split into pieces by the known blacks. Returns, per cell, its
 * piece id (-1 for black) and the piece count.
 */
export function pieces(g: Geometry, black: (c: number) => boolean): { id: Int32Array; count: number } {
  const id = new Int32Array(g.n).fill(-1);
  let count = 0;
  for (let s = 0; s < g.n; s++) {
    if (id[s] !== -1 || black(s)) continue;
    const stack = [s];
    id[s] = count;
    while (stack.length) {
      const c = stack.pop()!;
      for (const d of g.nbrs[c]!) {
        if (id[d] === -1 && !black(d)) {
          id[d] = count;
          stack.push(d);
        }
      }
    }
    count++;
  }
  return { id, count };
}

/** Undecided cells whose blackening would split the not-black area (articulation points). */
function cutCells(g: Geometry, k: Doms): number[] {
  const disc = new Int32Array(g.n).fill(-1), low = new Int32Array(g.n);
  const cut = new Uint8Array(g.n);
  let time = 0;
  const open = (c: number) => k[c] !== B;
  for (let root = 0; root < g.n; root++) {
    if (disc[root] !== -1 || !open(root)) continue;
    // iterative DFS: stack of [cell, parent, next neighbor index]
    const stack: [number, number, number][] = [[root, -1, 0]];
    disc[root] = low[root] = time++;
    let rootKids = 0;
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const [c, parent] = top;
      if (top[2] < g.nbrs[c]!.length) {
        const d = g.nbrs[c]![top[2]++]!;
        if (!open(d) || d === parent) continue;
        if (disc[d] === -1) {
          disc[d] = low[d] = time++;
          if (c === root) rootKids++;
          stack.push([d, c, 0]);
        } else low[c] = Math.min(low[c]!, disc[d]!);
        continue;
      }
      stack.pop();
      if (parent >= 0) {
        low[parent] = Math.min(low[parent]!, low[c]!);
        if (parent !== root && low[c]! >= disc[parent]!) cut[parent] = 1;
      }
    }
    if (rootKids > 1) cut[root] = 1;
  }
  const out: number[] = [];
  for (let c = 0; c < g.n; c++) if (cut[c] && k[c] === ANY) out.push(c);
  return out;
}

// --- model ---

const modelCache = new WeakMap<SinglesPuzzle, Model>();

/** Same numbers in one row or column, with the line they share. */
interface Group {
  cells: number[];
  line: number;
}

function groups(p: SinglesPuzzle, g: Geometry): Group[] {
  const out: Group[] = [];
  g.lines.forEach((line, li) => {
    const by = new Map<number, number[]>();
    for (const c of line) {
      const v = p.nums[c]!;
      by.set(v, [...(by.get(v) ?? []), c]);
    }
    for (const cells of by.values()) if (cells.length > 1) out.push({ cells, line: li });
  });
  return out;
}

const adjacent = (g: Geometry, a: number, b: number) => g.nbrs[a]!.includes(b);

export function model(p: SinglesPuzzle): Model {
  const hit = modelCache.get(p);
  if (hit) return hit;
  const g = geometry(p);
  const constraints: Constraint[] = [];
  const dups = groups(p, g);
  for (const grp of dups) {
    const { cells } = grp;
    // at most one white among equal numbers in a line
    constraints.push({
      vars: cells,
      run(k, emit) {
        const whites = cells.filter((c) => k[c] === W);
        if (whites.length > 1) return false;
        if (whites.length === 1) {
          const rest = cells.filter((c) => k[c] !== B);
          if (rest.length > 1 && emit({ kind: "duplicate", level: 0, vars: rest.filter((c) => c !== whites[0]), keep: B, because: whites })) return true;
        }
        for (let i = 0; i < cells.length; i++) {
          for (let j = i + 1; j < cells.length; j++) {
            const a = cells[i]!, b = cells[j]!;
            if (adjacent(g, a, b)) {
              const rest = cells.filter((c) => c !== a && c !== b && k[c] !== B);
              if (rest.length && emit({ kind: "pair", level: 0, vars: rest, keep: B, because: [a, b] })) return true;
            }
          }
        }
        return true;
      },
    });
    // a cell between two equal numbers is white
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i]!, b = cells[j]!;
        const step = (b - a) / 2;
        if (b - a !== 2 && b - a !== 2 * g.w) continue;
        if (step === 1 && Math.floor(a / g.w) !== Math.floor(b / g.w)) continue;
        const mid = a + step;
        constraints.push({
          vars: [mid],
          run(k, emit) {
            if (k[mid] !== W) emit({ kind: "sandwich", level: 0, vars: [mid], keep: W, because: [a, b] });
            return true;
          },
        });
      }
    }
  }
  for (let c = 0; c < g.n; c++) {
    const around = g.nbrs[c]!;
    // no two blacks side by side
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
    // a white cell joins the others through a not-black neighbor (every solution has two or more whites)
    constraints.push({
      vars: [c, ...around],
      run(k, emit) {
        if (k[c] !== W) return true;
        const free = around.filter((d) => k[d] !== B);
        if (!free.length) return false;
        if (free.length === 1 && k[free[0]!] !== W) emit({ kind: "way-out", level: 0, vars: free, keep: W, because: [c] });
        return true;
      },
    });
  }
  const split: Rule = {
    level: 1,
    kinds: ["split"],
    run(k, emit) {
      if (pieces(g, (c) => k[c] === B).count > 1) return false;
      for (const c of cutCells(g, k)) if (emit({ kind: "split", level: 1, vars: [c], keep: W, because: [] })) return true;
      return true;
    },
  };
  const m: Model = {
    n: g.n,
    constraints,
    rules: [split],
    countLevel: 1,
    complete: (k) => pieces(g, (c) => k[c] === B).count <= 1,
    // every repeat resolved: with a unique solution the known blacks are then all of them
    done: (k) => dups.every((grp) => grp.cells.filter((c) => k[c] !== B).length <= 1),
  };
  m.rules.push(trialRule(m, 2, 1));
  modelCache.set(p, m);
  return m;
}

export const initialDoms = (p: SinglesPuzzle): Doms => new Int32Array(p.w * p.h).fill(ANY);

const analyses = new WeakMap<SinglesPuzzle, Analysis>();

/** Unique-solution analysis, memoized per puzzle. `solution` holds WHITE / SHADED per cell. */
export function analyze(p: SinglesPuzzle): Analysis {
  let a = analyses.get(p);
  if (!a) analyses.set(p, a = analyzeModel(model(p), initialDoms(p), 2));
  return a;
}

/** Board marks as domains. Null if they contradict. */
export function readMarks(p: SinglesPuzzle, s: SinglesState): Doms | null {
  const k = initialDoms(p);
  for (let c = 0; c < k.length; c++) {
    const m = s.marks[c];
    if (m === BLACK) k[c] = B;
    else if (m === CIRCLE) k[c] = W;
  }
  return k;
}

// --- state ---

export function reduce(p: SinglesPuzzle, s: SinglesState, a: SinglesAction): SinglesState {
  if (a.type !== "set" || ![NONE, BLACK, CIRCLE].includes(a.value)) return s;
  let next: number[] | null = null;
  for (const c of a.cells) {
    if (!(c >= 0 && c < p.nums.length) || s.marks[c] === a.value) continue;
    next ??= s.marks.slice();
    next[c] = a.value;
  }
  return next ? { marks: next } : s;
}

/** Rule breaks visible on the board. */
export interface SinglesConflicts extends Record<string, number[]> {
  /** Blacks side by side. */
  touching: number[];
  /** Circled cells repeating a number in their row or column. */
  repeats: number[];
  /** Not-black cells walled off from the rest by blacks. */
  cut: number[];
}

export function findConflicts(p: SinglesPuzzle, marks: readonly number[]): SinglesConflicts {
  const g = geometry(p);
  const touching = new Set<number>(), repeats = new Set<number>();
  for (let c = 0; c < g.n; c++) {
    if (marks[c] !== BLACK) continue;
    for (const d of g.nbrs[c]!) if (marks[d] === BLACK) touching.add(c);
  }
  for (const grp of groups(p, g)) {
    const circled = grp.cells.filter((c) => marks[c] === CIRCLE);
    if (circled.length > 1) circled.forEach((c) => repeats.add(c));
  }
  const pc = pieces(g, (c) => marks[c] === BLACK);
  const cut: number[] = [];
  if (pc.count > 1) {
    const size = Array.from({ length: pc.count }, () => 0);
    for (let c = 0; c < g.n; c++) if (pc.id[c]! >= 0) size[pc.id[c]!]!++;
    const main = size.indexOf(Math.max(...size));
    for (let c = 0; c < g.n; c++) if (pc.id[c]! >= 0 && pc.id[c] !== main) cut.push(c);
  }
  return { touching: [...touching], repeats: [...repeats], cut };
}

export function isSolved(p: SinglesPuzzle, s: SinglesState): boolean {
  const g = geometry(p);
  const black = (c: number) => s.marks[c] === BLACK;
  for (let c = 0; c < g.n; c++) if (black(c) && g.nbrs[c]!.some(black)) return false;
  for (const line of g.lines) {
    const seen = new Set<number>();
    for (const c of line) {
      if (black(c)) continue;
      if (seen.has(p.nums[c]!)) return false;
      seen.add(p.nums[c]!);
    }
  }
  return pieces(g, black).count === 1;
}

// --- formats ---

const n2c = (n: number) => (n < 10 ? String(n) : n < 36 ? String.fromCharCode(87 + n) : String.fromCharCode(29 + n));
function c2n(ch: string): number {
  if (ch >= "0" && ch <= "9") return Number(ch);
  if (ch >= "a" && ch <= "z") return ch.charCodeAt(0) - 87;
  if (ch >= "A" && ch <= "Z") return ch.charCodeAt(0) - 29;
  return -1;
}

const SGT_RE = /^(\d+)(?:x(\d+))?(?:d.)?:([0-9a-zA-Z]+)$/;

function checkPuzzle(w: number, h: number, nums: number[]): SinglesPuzzle {
  if (!(w >= 2 && h >= 2 && w <= 36 && h <= 36)) throw new Error("size must be between 2×2 and 36×36");
  if (nums.length !== w * h) throw new Error(`expected ${w * h} numbers, got ${nums.length}`);
  const o = Math.max(w, h);
  if (nums.some((v) => !(v >= 1 && v <= o))) throw new Error(`numbers must be between 1 and ${o}`);
  return { w, h, nums };
}

/** Simon Tatham's Singles game id: `WxH[dX]:` then one character per cell (1–9, then a–z, then A–Z). */
export const sgtFormat: Format<SinglesPuzzle> = {
  id: "sgt",
  label: "game id (WxH:…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(t) {
    const m = SGT_RE.exec(t.trim());
    if (!m) throw new Error("expected WxH:numbers, e.g. 5x5:1234523451…");
    const w = Number(m[1]), h = Number(m[2] ?? m[1]);
    return checkPuzzle(w, h, [...m[3]!].map(c2n));
  },
  serialize: (p) => `${p.w}x${p.h}:${p.nums.map(n2c).join("")}`,
};

/** One text row per board row, numbers separated by spaces. */
export const gridFormat: Format<SinglesPuzzle> = {
  id: "grid",
  label: "grid (numbers)",
  detect: (t) => /^[\d\s]+$/.test(t.trim()) && t.trim().includes("\n"),
  parse(t) {
    const rows = t.trim().split(/\r?\n/).map((r) => r.trim().split(/\s+/).map(Number)).filter((r) => r.length && !Number.isNaN(r[0]));
    const h = rows.length, w = rows[0]?.length ?? 0;
    rows.forEach((r, y) => {
      if (r.length !== w) throw new Error(`row ${y + 1} has ${r.length} numbers, expected ${w}`);
    });
    return checkPuzzle(w, h, rows.flat());
  },
  serialize(p) {
    const rows: string[] = [];
    for (let y = 0; y < p.h; y++) rows.push(p.nums.slice(y * p.w, (y + 1) * p.w).join(" "));
    return rows.join("\n");
  },
};

// --- hints ---

/** Marks that disagree with the unique solution, as a hint that clears them; null if none or no unique solution. */
export function wrongMarksHint(p: SinglesPuzzle, s: SinglesState): Hint<SinglesAction> | null {
  const a = analyze(p);
  if (a.count !== 1 || !a.solution) return null;
  const sol = a.solution;
  const wrong = s.marks.flatMap((m, c) => ((m === BLACK && sol[c] !== SHADED) || (m === CIRCLE && sol[c] !== WHITE) ? [c] : []));
  if (!wrong.length) return null;
  return {
    message: `${wrong.length === 1 ? "the mark on" : "the marks on"} ${cellList(p, wrong)} ${wrong.length === 1 ? "is" : "are"} wrong`,
    focus: { cells: wrong, because: [] } satisfies Focus,
    actions: [{ type: "set", cells: wrong, value: NONE }],
  };
}

/** Fallback when no technique offers a hint: a visible rule break, or why there's no next step. */
export function hint(p: SinglesPuzzle, s: SinglesState): Hint<SinglesAction> | null {
  const c = findConflicts(p, s.marks);
  if (c.touching.length) return { message: `the blacks on ${cellList(p, c.touching)} touch`, focus: { cells: c.touching, because: [] } satisfies Focus };
  if (c.repeats.length) return { message: `${cellList(p, c.repeats)} repeat a number in one line`, focus: { cells: c.repeats, because: [] } satisfies Focus };
  if (c.cut.length) return { message: `${cellList(p, c.cut)} ${c.cut.length === 1 ? "is" : "are"} cut off from the other white cells`, focus: { cells: c.cut, because: [] } satisfies Focus };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: SinglesPuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 3 };
  return { label: LEVEL_NAMES[a.level]!, score: a.level };
}

// --- generation ---

/** A random latin square of order o, built row by row from random perfect matchings. */
export function latinSquare(o: number, rng: Rng): number[] {
  const sq: number[] = [];
  const used = Array.from({ length: o }, () => new Uint8Array(o + 1));
  for (let y = 0; y < o; y++) {
    const symOf = new Int32Array(o).fill(0), colOf = new Int32Array(o + 1).fill(-1);
    const tryCol = (x: number, seen: Uint8Array): boolean => {
      for (const v of rng.shuffle(Array.from({ length: o }, (_, i) => i + 1))) {
        if (used[x]![v] || seen[v]) continue;
        seen[v] = 1;
        if (colOf[v] === -1 || tryCol(colOf[v]!, seen)) {
          colOf[v] = x;
          symOf[x] = v;
          return true;
        }
      }
      return false;
    };
    for (const x of rng.shuffle(Array.from({ length: o }, (_, i) => i))) tryCol(x, new Uint8Array(o + 1));
    for (let x = 0; x < o; x++) {
      used[x]![symOf[x]!] = 1;
      sq.push(symOf[x]!);
    }
  }
  return sq;
}

/** Blacks added in random order wherever they touch no black and keep the rest connected, until none fit. */
function placeBlacks(g: Geometry, rng: Rng): Uint8Array {
  const black = new Uint8Array(g.n);
  for (const c of rng.shuffle(Array.from({ length: g.n }, (_, i) => i))) {
    if (g.nbrs[c]!.some((d) => black[d])) continue;
    black[c] = 1;
    if (pieces(g, (d) => black[d] === 1).count > 1) black[c] = 0;
  }
  return black;
}

/** Numbers under the blacks, each repeating a white number of its row or column. */
function numberBlacks(g: Geometry, latin: readonly number[], black: Uint8Array, rng: Rng): number[] {
  const o = Math.max(g.w, g.h);
  const rowN = Array.from({ length: g.h }, () => new Int32Array(o + 1));
  const colN = Array.from({ length: g.w }, () => new Int32Array(o + 1));
  for (let c = 0; c < g.n; c++) {
    if (black[c]) continue;
    rowN[Math.floor(c / g.w)]![latin[c]!]!++;
    colN[c % g.w]![latin[c]!]!++;
  }
  const nums = latin.slice();
  for (let c = 0; c < g.n; c++) {
    if (!black[c]) continue;
    const x = c % g.w, y = Math.floor(c / g.w);
    const order = rng.shuffle(Array.from({ length: o }, (_, i) => i + 1));
    const v = order.find((j) => rowN[y]![j] === 1 && colN[x]![j] === 1) ?? order.find((j) => rowN[y]![j]! > 0 || colN[x]![j]! > 0)!;
    rowN[y]![v]!++;
    colN[x]![v]!++;
    nums[c] = v;
  }
  return nums;
}

const RENUMBER_TRIES = 20;
const EXACT_ATTEMPTS = 30;
const MAX_ATTEMPTS = 300;

/**
 * Deterministic in (params, rng). The result is solved by logic at the requested level, which
 * proves its solution unique; it needs exactly that level when one turns up within
 * EXACT_ATTEMPTS layouts, else the hardest found is returned.
 */
export async function generatePuzzle(w: number, h: number, level: Level, rng: Rng, ctx: GenerateContext): Promise<SinglesPuzzle> {
  const g0 = geometry({ w, h, nums: [] });
  let best: { p: SinglesPuzzle; level: number } | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (best && attempt >= EXACT_ATTEMPTS) break;
    const r = rng.fork(`attempt ${attempt}`);
    const o = Math.max(w, h);
    const sq = latinSquare(o, r);
    const latin = Array.from({ length: w * h }, (_, c) => sq[Math.floor(c / w) * o + (c % w)]!);
    const black = placeBlacks(g0, r);
    for (let t = 0; t < RENUMBER_TRIES; t++) {
      await ctx.yield();
      const p: SinglesPuzzle = { w, h, nums: numberBlacks(g0, latin, black, r) };
      const got = solveLevel(model(p), initialDoms(p), level);
      if (got === null || !isUnique(model(p), initialDoms(p), 2)) continue;
      if (got === level) return p;
      if (!best || got > best.level) best = { p, level: got };
    }
  }
  if (best) return best.p;
  throw new Error("couldn't make a puzzle with these settings; try a different size");
}

/** Least level that solves the puzzle by logic, or null. */
export const logicLevel = (p: SinglesPuzzle, maxLevel: Level = 2): number | null => solveLevel(model(p), initialDoms(p), maxLevel);

export const singles: PuzzleDef<SinglesPuzzle, SinglesState, SinglesAction, SinglesInteraction, typeof params> = {
  id: "singles",
  name: "singles",
  aliases: ["hitori", "let me alone"],
  tags: ["logic", "grid", "numbers", "shading", "nikoli"],
  description: "black out cells until no number repeats in any row or column. blacks may not touch side by side, and the white cells must stay in one connected piece.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "5×5 easy", params: { width: 5, height: 5, difficulty: "easy" } },
    { label: "8×8 easy", params: { width: 8, height: 8, difficulty: "easy" } },
    { label: "8×8 tricky", params: { width: 8, height: 8, difficulty: "tricky" } },
    { label: "10×10 tricky", params: { width: 10, height: 10, difficulty: "tricky" } },
    { label: "10×10 hard", params: { width: 10, height: 10, difficulty: "hard" } },
    { label: "12×12 tricky", params: { width: 12, height: 12, difficulty: "tricky" } },
  ],
  generate: (v: Values<typeof params>, rng, ctx) => generatePuzzle(v.width, v.height, LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) as Level, rng, ctx),
  formats: [sgtFormat, gridFormat],
  init: (p) => ({ marks: p.nums.map(() => NONE) }),
  initInteraction: () => ({ cursor: 0 }),
  reduce,
  isRetraction: (a) => a.value === NONE,
  rules: () => [
    "black out some of the cells. when you're done, no number may appear twice in any row or column among the cells that aren't black.",
    "two black cells may not touch side by side (touching at a corner is fine).",
    "all the cells that aren't black must form one connected area, joined side by side.",
    "a circle is your own note that a cell stays white. it doesn't count for anything.",
  ],
  describeAction: (p, a) => `${["clear", "black out", "circle"][a.value] ?? "mark"} ${cellList(p, a.cells)}`,
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? { board: { marks: a.solution.map((v) => (v === SHADED ? BLACK : CIRCLE)) } } : null;
  },
  hint,
  rate,
  describe: (p) => `${p.w}×${p.h}`,
};
