import type { Rng } from "../../core/rng";
import { colName, rowName } from "../../core/names";
import type { Ids } from "../../core/commands";
import { featureTests } from "../../core/define";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import {
  analyzeModel, bit, decides, solveLevel, trialRule,
  type Analysis, type Constraint, type Doms, type Model, type Rule,
} from "../../lib/grid-kit/csp";
import { cellList, type Focus } from "../../lib/grid-kit/names";

/** Cell colors as model values: ZERO is the light color, ONE the dark one. */
export const ZERO = 0, ONE = 1;
const Z = bit(ZERO), O = bit(ONE), ANY = Z | O;

export interface UnrulyPuzzle {
  w: number;
  h: number;
  /** Row-major givens: -1 open, ZERO or ONE. */
  cells: number[];
  /** No two rows, and no two columns, may be the same. */
  unique: boolean;
}

/** Per-cell mark on open cells: NONE, or the color + 1. */
export const NONE = 0, LIGHT = 1, DARK = 2;
export type Mark = typeof NONE | typeof LIGHT | typeof DARK;
export const markOf = (colour: number): Mark => (colour === ONE ? DARK : LIGHT);
export const colourOf = (mark: number): number => mark - 1;

export interface UnrulyState {
  marks: number[];
}

/** Setting NONE is the only way marks are removed, so it alone is a retraction. */
export type UnrulyAction = { type: "set"; cells: number[]; value: Mark };

export interface UnrulyInteraction {
  cursor: number;
}

export const LEVEL_NAMES = ["trivial", "easy", "normal", "hard"] as const;
export type Level = 0 | 1 | 2 | 3;

export const params = defineSchema({
  width: { type: "int", label: "width (even)", default: 8, min: 4, max: 20, step: 2 },
  height: { type: "int", label: "height (even)", default: 8, min: 4, max: 20, step: 2 },
  unique: { type: "bool", label: "rows and columns all different", default: false },
  difficulty: {
    type: "enum", label: "difficulty", default: "easy",
    options: [
      { value: "trivial", label: "trivial", description: "no three in a row, and lines with one cell left" },
      { value: "easy", label: "easy", description: "also lines that have all of one color" },
      { value: "normal", label: "normal", description: "also where a line's last cell of a color has to go" },
      { value: "hard", label: "hard", description: "also trying a cell both ways" },
    ],
  },
});

// --- geometry ---

export interface Geometry {
  w: number;
  h: number;
  n: number;
  /** Rows then columns, each as its cells in order. */
  lines: number[][];
}

const geoCache = new WeakMap<UnrulyPuzzle, Geometry>();

export function geometry(p: UnrulyPuzzle): Geometry {
  const hit = geoCache.get(p);
  if (hit) return hit;
  const { w, h } = p;
  const lines: number[][] = [];
  for (let y = 0; y < h; y++) lines.push(Array.from({ length: w }, (_, x) => y * w + x));
  for (let x = 0; x < w; x++) lines.push(Array.from({ length: h }, (_, y) => y * w + x));
  const g = { w, h, n: w * h, lines };
  geoCache.set(p, g);
  return g;
}

/** "row 3" or "column C". */
export function lineName(p: UnrulyPuzzle, li: number): string {
  return li < p.h ? `row ${rowName(li)}` : `column ${colName(li - p.h)}`;
}

// --- model ---

const modelCache = new WeakMap<UnrulyPuzzle, Model>();

export const colourWord = (c: number): string => (c === ONE ? "dark" : "light");

export function model(p: UnrulyPuzzle): Model {
  const hit = modelCache.get(p);
  if (hit) return hit;
  const g = geometry(p);
  const constraints: Constraint[] = [];
  g.lines.forEach((line, li) => {
    // no three the same in a row
    for (let i = 0; i + 2 < line.length; i++) {
      const win = line.slice(i, i + 3);
      constraints.push({
        vars: win,
        run(k, emit) {
          for (const c of [ZERO, ONE]) {
            const m = bit(c);
            const same = win.filter((v) => k[v] === m);
            if (same.length === 3) return false;
            if (same.length !== 2) continue;
            const rest = win.find((v) => k[v] !== m)!;
            if (k[rest] !== ANY) continue;
            emit({ kind: "three", level: 0, vars: [rest], keep: ANY & ~m, because: same, data: { colour: c } });
          }
          return true;
        },
      });
    }
    // half of each color
    const half = line.length / 2;
    constraints.push({
      vars: line,
      run(k, emit) {
        for (const c of [ZERO, ONE]) {
          const open = line.filter((v) => k[v] === ANY);
          const have = line.filter((v) => k[v] === bit(c)).length;
          if (have > half) return false;
          if (have < half || !open.length) continue;
          const other = 1 - c;
          emit({ kind: open.length === 1 ? "last-cell" : "count-full", level: open.length === 1 ? 0 : 1, vars: open, keep: bit(other), because: [], data: { line: li, colour: c } });
        }
        // one short of a color: a window of three with none of it and two open cells must take the last one
        for (const c of [ZERO, ONE]) {
          const open = line.filter((v) => k[v] === ANY);
          const have = line.filter((v) => k[v] === bit(c)).length;
          if (have !== half - 1 || open.length < 3) continue;
          for (let i = 0; i + 2 < line.length; i++) {
            const win = line.slice(i, i + 3);
            if (win.some((v) => k[v] === bit(c)) || win.filter((v) => k[v] === ANY).length < 2) continue;
            const outside = open.filter((v) => !win.includes(v));
            if (!outside.length) continue;
            emit({ kind: "last-one", level: 2, vars: outside, keep: bit(1 - c), because: [], related: win.filter((v) => k[v] === ANY), data: { line: li, colour: c } });
            break;
          }
        }
        return true;
      },
    });
  });
  const rules: Rule[] = [];
  if (p.unique) {
    rules.push({
      level: 1,
      kinds: ["unique"],
      run(k, emit) {
        for (const group of [g.lines.slice(0, g.h), g.lines.slice(g.h)]) {
          for (const full of group) {
            if (!full.every((v) => k[v] !== ANY)) continue;
            for (const other of group) {
              if (other === full) continue;
              for (const c of [ZERO, ONE]) {
                const m = bit(c);
                const want = full.filter((v) => k[v] === m).length;
                const idx = full.flatMap((v, i) => (k[v] === m ? [i] : []));
                const otherHas = other.flatMap((v, i) => (k[v] === m ? [i] : []));
                if (otherHas.length !== want - 1 || !otherHas.every((i) => idx.includes(i))) continue;
                const miss = idx.find((i) => !otherHas.includes(i))!;
                const v = other[miss]!;
                if (k[v] !== ANY) continue;
                if (emit({ kind: "unique", level: 1, vars: [v], keep: bit(1 - c), because: full, related: other.filter((x) => x !== v), data: { colour: c } })) return true;
              }
            }
          }
        }
        return true;
      },
    });
  }
  const sameLine = (k: Doms, a: number[], b: number[]) => a.every((v, i) => k[v] === k[b[i]!]);
  const m: Model = {
    n: g.n,
    constraints,
    rules,
    countLevel: 1,
    complete: p.unique
      ? (k) => [g.lines.slice(0, g.h), g.lines.slice(g.h)].every((grp) => grp.every((a, i) => grp.every((b, j) => j <= i || !sameLine(k, a, b))))
      : undefined,
  };
  m.rules.push(trialRule(m, 3, 2));
  modelCache.set(p, m);
  return m;
}

export function initialDoms(p: UnrulyPuzzle): Doms {
  return Int32Array.from(p.cells, (v) => (v < 0 ? ANY : bit(v)));
}

const analyses = new WeakMap<UnrulyPuzzle, Analysis>();

/** Unique-solution analysis, memoized per puzzle. `solution` holds ZERO / ONE per cell. */
export function analyze(p: UnrulyPuzzle): Analysis {
  let a = analyses.get(p);
  if (!a) analyses.set(p, a = analyzeModel(model(p), initialDoms(p), 3));
  return a;
}

/** Givens plus board marks as domains. */
export function readMarks(p: UnrulyPuzzle, s: UnrulyState): Doms {
  const k = initialDoms(p);
  s.marks.forEach((mk, c) => {
    if (mk === NONE || p.cells[c]! >= 0) return;
    const col = colourOf(mk);
    k[c] = bit(col);
  });
  return k;
}

// --- state ---

/** Color per cell, givens included; -1 where nothing is placed. */
export function colours(p: UnrulyPuzzle, marks: readonly number[]): number[] {
  return p.cells.map((v, c) => (v >= 0 ? v : marks[c] ? colourOf(marks[c]!) : -1));
}

export function reduce(p: UnrulyPuzzle, s: UnrulyState, a: UnrulyAction): UnrulyState {
  if (a.type !== "set" || ![NONE, LIGHT, DARK].includes(a.value)) return s;
  let next: number[] | null = null;
  for (const c of a.cells) {
    if (p.cells[c] !== -1 || s.marks[c] === a.value) continue;
    next ??= s.marks.slice();
    next[c] = a.value;
  }
  return next ? { marks: next } : s;
}

export interface UnrulyConflicts extends Record<string, number[]> {
  /** Cells in a run of three or more of one color. */
  runs: number[];
  /** Cells of a color that a line has more than half of. */
  counts: number[];
  /** Filled lines identical to another (unique mode). */
  repeats: number[];
}

export function findConflicts(p: UnrulyPuzzle, marks: readonly number[]): UnrulyConflicts {
  const g = geometry(p);
  const col = colours(p, marks);
  const runs = new Set<number>(), counts = new Set<number>(), repeats = new Set<number>();
  for (const line of g.lines) {
    for (let i = 0; i + 2 < line.length; i++) {
      const [a, b, c] = [line[i]!, line[i + 1]!, line[i + 2]!];
      if (col[a]! >= 0 && col[a] === col[b] && col[b] === col[c]) [a, b, c].forEach((x) => runs.add(x));
    }
    for (const colour of [ZERO, ONE]) {
      const cells = line.filter((v) => col[v] === colour);
      if (cells.length > line.length / 2) cells.forEach((x) => counts.add(x));
    }
  }
  if (p.unique) {
    for (const grp of [g.lines.slice(0, g.h), g.lines.slice(g.h)]) {
      grp.forEach((a, i) => {
        if (a.some((v) => col[v]! < 0)) return;
        for (const b of grp.slice(i + 1)) {
          if (b.every((v, j) => col[v] === col[a[j]!])) [...a, ...b].forEach((x) => repeats.add(x));
        }
      });
    }
  }
  return { runs: [...runs], counts: [...counts], repeats: [...repeats] };
}

export function isSolved(p: UnrulyPuzzle, s: UnrulyState): boolean {
  const col = colours(p, s.marks);
  if (col.some((v) => v < 0)) return false;
  const c = findConflicts(p, s.marks);
  return !c.runs.length && !c.counts.length && !c.repeats.length;
}

// --- formats ---

const SGT_RE = /^(\d+)x(\d+)(u?)(?:d.)?:([a-zA-Z]+)$/;

function checkPuzzle(w: number, h: number, cells: number[], unique: boolean): UnrulyPuzzle {
  if (w % 2 || h % 2) throw new Error("width and height must both be even");
  if (!(w >= 2 && h >= 2 && w <= 60 && h <= 60)) throw new Error("size must be between 2×2 and 60×60");
  if (cells.length !== w * h) throw new Error(`expected ${w * h} cells, got ${cells.length}`);
  return { w, h, cells, unique };
}

/**
 * Simon Tatham's Unruly game id: `WxH[u][dX]:desc`. In desc, a lowercase letter skips
 * (letter − a) open cells then places a light cell, uppercase the same with a dark one, and z / Z
 * skip 25. The description runs one cell past the end.
 */
export const sgtFormat: Format<UnrulyPuzzle> = {
  id: "sgt",
  label: "game id (WxH:…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(t) {
    const m = SGT_RE.exec(t.trim());
    if (!m) throw new Error("expected WxH:desc, e.g. 8x8:bBdA…");
    const w = Number(m[1]), h = Number(m[2]), s = w * h;
    const cells = Array.from({ length: s }, () => -1);
    let pos = 0;
    for (const ch of m[4]!) {
      if (ch === "z" || ch === "Z") {
        pos += 25;
        continue;
      }
      const lower = ch >= "a" && ch <= "z";
      pos += ch.charCodeAt(0) - (lower ? 97 : 65);
      if (pos < s) cells[pos] = lower ? ZERO : ONE;
      pos++;
    }
    if (pos !== s + 1) throw new Error(pos < s + 1 ? "description too short" : "description too long");
    return checkPuzzle(w, h, cells, m[3] === "u");
  },
  serialize(p) {
    const s = p.w * p.h;
    let out = "", run = 0;
    for (let i = 0; i <= s; i++) {
      const v = i < s ? p.cells[i]! : ZERO;
      if (v < 0) {
        run++;
        continue;
      }
      const z = v === ONE ? "Z" : "z";
      while (run > 24) {
        out += z;
        run -= 25;
      }
      out += String.fromCharCode((v === ONE ? 65 : 97) + run);
      run = 0;
    }
    return `${p.w}x${p.h}${p.unique ? "u" : ""}:${out}`;
  },
};

const GRID_CHARS: Record<string, number> = { ".": -1, "_": -1, "-": -1, "0": ZERO, "1": ONE };

/** One text row per board row: `.` open, `0` light, `1` dark; an optional first line `unique`. */
export const gridFormat: Format<UnrulyPuzzle> = {
  id: "grid",
  label: "grid (. 0 1)",
  detect: (t) => /^(unique\s*\n)?[.01_\-\s]+$/.test(t.trim()) && t.trim().includes("\n"),
  parse(t) {
    let rows = t.trim().split(/\r?\n/).map((r) => r.replace(/\s+/g, "")).filter((r) => r.length > 0);
    const unique = rows[0] === "unique";
    if (unique) rows = rows.slice(1);
    const h = rows.length, w = rows[0]?.length ?? 0;
    const cells: number[] = [];
    rows.forEach((r, y) => {
      if (r.length !== w) throw new Error(`row ${y + 1} has ${r.length} cells, expected ${w}`);
      for (const ch of r) {
        const v = GRID_CHARS[ch];
        if (v === undefined) throw new Error(`unexpected "${ch}" in row ${y + 1}`);
        cells.push(v);
      }
    });
    return checkPuzzle(w, h, cells, unique);
  },
  serialize(p) {
    const rows: string[] = p.unique ? ["unique"] : [];
    for (let y = 0; y < p.h; y++) rows.push(p.cells.slice(y * p.w, (y + 1) * p.w).map((v) => (v < 0 ? "." : String(v))).join(""));
    return rows.join("\n");
  },
};

// --- hints ---

export function wrongMarksHint(p: UnrulyPuzzle, s: UnrulyState): Hint<UnrulyAction> | null {
  const a = analyze(p);
  if (a.count !== 1 || !a.solution) return null;
  const sol = a.solution;
  const wrong = s.marks.flatMap((m, c) => (m !== NONE && p.cells[c] === -1 && colourOf(m) !== sol[c] ? [c] : []));
  if (!wrong.length) return null;
  return {
    message: `${wrong.length === 1 ? "the color on" : "the colors on"} ${cellList(p, wrong)} ${wrong.length === 1 ? "is" : "are"} wrong`,
    focus: { cells: wrong, because: [] } satisfies Focus,
    actions: [{ type: "set", cells: wrong, value: NONE }],
  };
}

export function hint(p: UnrulyPuzzle, s: UnrulyState): Hint<UnrulyAction> | null {
  const c = findConflicts(p, s.marks);
  if (c.runs.length) return { message: `${cellList(p, c.runs)} make three of a color in a row`, focus: { cells: c.runs, because: [] } satisfies Focus };
  if (c.counts.length) return { message: `${cellList(p, c.counts)} give a line more than half of one color`, focus: { cells: c.counts, because: [] } satisfies Focus };
  if (c.repeats.length) return { message: `two lines are the same`, focus: { cells: c.repeats, because: [] } satisfies Focus };
  const a = analyze(p);
  if (a.count === 0) return { message: "this puzzle has no solution" };
  if (a.count === 2) return { message: "this puzzle has more than one solution, so it can need a guess" };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: UnrulyPuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 4 };
  return { label: LEVEL_NAMES[a.level]!, score: a.level };
}

// --- generation ---

/** Every row of width w with half of each color and no three the same in a row. */
function validRows(w: number): number[][] {
  const out: number[][] = [];
  const row: number[] = [];
  const go = (ones: number) => {
    const i = row.length;
    if (i === w) {
      out.push(row.slice());
      return;
    }
    for (const v of [ZERO, ONE]) {
      if (i >= 2 && row[i - 1] === v && row[i - 2] === v) continue;
      const n1 = ones + v, n0 = i + 1 - n1;
      if (n1 > w / 2 || n0 > w / 2) continue;
      row.push(v);
      go(n1);
      row.pop();
    }
  };
  go(0);
  return out;
}

/**
 * A random filled grid, row by row: each row is a random valid row that keeps every column free
 * of three in a row and within half of each color. Null if a dead end is hit (callers retry).
 */
function randomGrid(w: number, h: number, unique: boolean, rows: number[][], rng: Rng): number[] | null {
  const grid: number[][] = [];
  const ones = new Int32Array(w);
  const fits = (r: number[]) => {
    const y = grid.length;
    for (let x = 0; x < w; x++) {
      const v = r[x]!;
      if (y >= 2 && grid[y - 1]![x] === v && grid[y - 2]![x] === v) return false;
      const n1 = ones[x]! + v, n0 = y + 1 - n1;
      if (n1 > h / 2 || n0 > h / 2) return false;
    }
    return !unique || !grid.some((g) => g.every((v, x) => v === r[x]));
  };
  for (let y = 0; y < h; y++) {
    const options = rows.filter(fits);
    if (!options.length) return null;
    const r = options[rng.int(options.length)]!;
    grid.push(r);
    r.forEach((v, x) => (ones[x] = ones[x]! + v));
  }
  if (unique) {
    const cols = Array.from({ length: w }, (_, x) => grid.map((r) => r[x]).join(""));
    if (new Set(cols).size !== w) return null;
  }
  return grid.flat();
}

const GRID_TRIES = 500;
const EXACT_ATTEMPTS = 40;
const MAX_ATTEMPTS = 200;

/**
 * Deterministic in (params, rng): a random filled grid, then givens removed in random order
 * while logic at the requested level still solves it (which proves the solution unique). Needs
 * exactly that level when one turns up within EXACT_ATTEMPTS grids, else the hardest found.
 */
export async function generatePuzzle(w: number, h: number, unique: boolean, level: Level, rng: Rng, ctx: GenerateContext): Promise<UnrulyPuzzle> {
  const rows = validRows(w);
  let best: { p: UnrulyPuzzle; level: number } | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (best && attempt >= EXACT_ATTEMPTS) break;
    await ctx.yield();
    const r = rng.fork(`attempt ${attempt}`);
    let cells: number[] | null = null;
    for (let t = 0; t < GRID_TRIES && !cells; t++) cells = randomGrid(w, h, unique, rows, r);
    if (!cells) continue;
    const order = r.shuffle(Array.from({ length: w * h }, (_, i) => i));
    // a cheap pass one level down first leaves fewer givens for the costly one
    for (const pass of level > 0 ? [level - 1, level] : [level]) {
      for (const c of order) {
        if (cells[c]! < 0) continue;
        await ctx.yield();
        const keep = cells[c]!;
        cells[c] = -1;
        const p = { w, h, unique, cells: cells.slice() };
        if (!decides(model(p), initialDoms(p), pass)) cells[c] = keep;
      }
    }
    const p: UnrulyPuzzle = { w, h, unique, cells };
    const got = solveLevel(model(p), initialDoms(p), level)!;
    if (got === level) return p;
    if (!best || got > best.level) best = { p, level: got };
  }
  if (best) return best.p;
  throw new Error("couldn't make a puzzle with these settings; try a different size");
}

const even = (n: number) => Math.max(2, n - (n % 2));

const FEATURES = {
  /** No two rows, and no two columns, may be the same. */
  "unique-lines": (p: UnrulyPuzzle) => p.unique,
};

export const unruly: PuzzleDef<UnrulyPuzzle, UnrulyState, UnrulyAction, UnrulyInteraction, typeof params> = {
  id: "unruly",
  name: "unruly",
  aliases: ["takuzu", "binairo", "binary puzzle", "tohu wa vohu", "0hh1", "zernike"],
  tags: ["logic", "grid", "shading"],
  description: "fill every cell light or dark. no three of the same color in a row or column, and every row and column is half light, half dark.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "6×6 trivial", params: { width: 6, height: 6, difficulty: "trivial" } },
    { label: "8×8 easy", params: { width: 8, height: 8, difficulty: "easy" } },
    { label: "8×8 normal", params: { width: 8, height: 8, difficulty: "normal" } },
    { label: "10×10 normal", params: { width: 10, height: 10, difficulty: "normal" } },
    { label: "10×10 hard", params: { width: 10, height: 10, difficulty: "hard" } },
    { label: "10×10 all different", params: { width: 10, height: 10, difficulty: "normal", unique: true } },
    { label: "14×14 normal", params: { width: 14, height: 14, difficulty: "normal" } },
  ],
  generate: (v: Values<typeof params>, rng, ctx) =>
    generatePuzzle(even(v.width), even(v.height), v.unique, LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) as Level, rng, ctx),
  formats: [sgtFormat, gridFormat],
  init: (p) => ({ marks: p.cells.map(() => NONE) }),
  initInteraction: (p) => ({ cursor: Math.max(0, p.cells.indexOf(-1)) }),
  reduce,
  isRetraction: (a) => a.value === NONE,
  rules: (p) => [
    "fill every empty cell with a light or a dark piece. the pieces already on the board stay as they are.",
    "no row or column may have three of the same color next to each other.",
    "every row and every column has as many light pieces as dark ones.",
    ...(p.unique ? ["no two rows may be the same, and no two columns may be the same."] : []),
  ],
  features: featureTests(FEATURES),
  describeAction: (p, a) => `${["clear", "light", "dark"][a.value] ?? "mark"} ${cellList(p, a.cells)}`,
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? { board: { marks: a.solution.map((v, c) => (p.cells[c]! >= 0 ? NONE : markOf(v))) } } : null;
  },
  hint,
  rate,
  describe: (p) => `${p.w}×${p.h}${p.unique ? " all different" : ""}`,
};


declare module "../../core/types" {
  interface FeatureNames extends Ids<typeof FEATURES> {}
}
