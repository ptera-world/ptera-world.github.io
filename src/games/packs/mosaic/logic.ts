import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import {
  analyzeModel, bit, decides, solveLevel, trialRule,
  type Analysis, type Constraint, type Doms, type Model, type Rule,
} from "../../lib/grid-kit/csp";
import { cellList, type Focus } from "../../lib/grid-kit/names";

export interface MosaicPuzzle {
  w: number;
  h: number;
  /** Row-major: -1 no number, else how many black cells are in the 3×3 block around it (itself included). */
  clues: number[];
}

/** Model values: one variable per cell. */
export const WHITE = 0, SHADED = 1;
const W = bit(WHITE), B = bit(SHADED), ANY = W | B;

/** Per-cell mark. DOT is the player's "stays white" note. */
export const NONE = 0, BLACK = 1, DOT = 2;
export type Mark = typeof NONE | typeof BLACK | typeof DOT;

export interface MosaicState {
  marks: number[];
}

/** Setting NONE is the only way marks are removed, so it alone is a retraction. */
export type MosaicAction = { type: "set"; cells: number[]; value: Mark };

export interface MosaicInteraction {
  cursor: number;
}

export const LEVEL_NAMES = ["easy", "medium", "hard"] as const;
export type Level = 0 | 1 | 2;

export const params = defineSchema({
  width: { type: "int", label: "width", default: 10, min: 3, max: 30 },
  height: { type: "int", label: "height", default: 10, min: 3, max: 30 },
  difficulty: {
    type: "enum", label: "difficulty", default: "easy",
    options: [
      { value: "easy", label: "easy", description: "one number at a time" },
      { value: "medium", label: "medium", description: "also two overlapping numbers together" },
      { value: "hard", label: "hard", description: "also trying a cell both ways" },
    ],
  },
});

// --- geometry ---

export interface Geometry {
  w: number;
  h: number;
  n: number;
  /** The 3×3 block around each cell, inside the grid, itself included. */
  block: number[][];
  shown: number[];
}

const geoCache = new WeakMap<MosaicPuzzle, Geometry>();

export function blocks(w: number, h: number): number[][] {
  return Array.from({ length: w * h }, (_, i) => {
    const x = i % w, y = Math.floor(i / w);
    const out: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) out.push(ny * w + nx);
      }
    }
    return out;
  });
}

export function geometry(p: MosaicPuzzle): Geometry {
  const hit = geoCache.get(p);
  if (hit) return hit;
  const g = { w: p.w, h: p.h, n: p.w * p.h, block: blocks(p.w, p.h), shown: p.clues.flatMap((v, i) => (v >= 0 ? [i] : [])) };
  geoCache.set(p, g);
  return g;
}

// --- model ---

const modelCache = new WeakMap<MosaicPuzzle, Model>();

export function model(p: MosaicPuzzle): Model {
  const hit = modelCache.get(p);
  if (hit) return hit;
  const g = geometry(p);
  const constraints: Constraint[] = g.shown.map((q) => {
    const cells = g.block[q]!, n = p.clues[q]!;
    return {
      vars: cells,
      run(k, emit) {
        const black = cells.filter((c) => k[c] === B).length;
        const open = cells.filter((c) => k[c] === ANY);
        if (black > n || black + open.length < n) return false;
        if (!open.length) return true;
        if (black === n) emit({ kind: "clue-done", level: 0, vars: open, keep: W, because: [q] });
        else if (black + open.length === n) emit({ kind: "clue-full", level: 0, vars: open, keep: B, because: [q] });
        return true;
      },
    };
  });
  // two numbers whose blocks overlap: how many blacks the shared part can hold bounds the rest
  type Pair = { a: number; b: number; onlyA: number[]; onlyB: number[]; both: number[] };
  let pairList: Pair[] | null = null;
  const pairs = (): Pair[] => {
    if (pairList) return pairList;
    pairList = [];
    for (const a of g.shown) {
      const ax = a % g.w, ay = Math.floor(a / g.w);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const bx = ax + dx, by = ay + dy, b = by * g.w + bx;
          if ((!dx && !dy) || bx < 0 || by < 0 || bx >= g.w || by >= g.h || p.clues[b]! < 0) continue;
          const A = g.block[a]!, Bc = g.block[b]!;
          pairList.push({ a, b, onlyA: A.filter((c) => !Bc.includes(c)), onlyB: Bc.filter((c) => !A.includes(c)), both: A.filter((c) => Bc.includes(c)) });
        }
      }
    }
    return pairList;
  };
  const tally = (k: Doms, cells: number[]) => {
    let black = 0, open = 0;
    for (const c of cells) {
      if (k[c] === B) black++;
      else if (k[c] === ANY) open++;
    }
    return [black, open] as const;
  };
  const pair: Rule = {
    level: 1,
    kinds: ["pair"],
    run(k, emit) {
      for (const { a, b, onlyA, onlyB, both } of pairs()) {
        const [bothBlack, bothOpen] = tally(k, both);
        if (!bothOpen) continue;
        const [aBlack, aOpen] = tally(k, onlyA), [bBlack, bOpen] = tally(k, onlyB);
        const needA = p.clues[a]! - aBlack - bothBlack, needB = p.clues[b]! - bBlack - bothBlack;
        // the shared open cells hold at least lo and at most hi blacks
        const hi = Math.min(bothOpen, needA, needB);
        const lo = Math.max(0, needA - aOpen, needB - bOpen);
        if (lo > hi) return false;
        const openOf = (cells: number[]) => cells.filter((c) => k[c] === ANY);
        const why = { because: [a, b] };
        if (aOpen && needA - lo === 0 && emit({ kind: "pair", level: 1, vars: openOf(onlyA), keep: W, ...why, related: openOf(both) })) return true;
        if (aOpen && needA - hi === aOpen && emit({ kind: "pair", level: 1, vars: openOf(onlyA), keep: B, ...why, related: openOf(both) })) return true;
        if (hi === 0 && emit({ kind: "pair", level: 1, vars: openOf(both), keep: W, ...why })) return true;
        if (lo === bothOpen && emit({ kind: "pair", level: 1, vars: openOf(both), keep: B, ...why })) return true;
      }
      return true;
    },
  };
  const m: Model = {
    n: g.n,
    constraints,
    rules: [pair],
    done: (k) => g.shown.every((q) => g.block[q]!.filter((c) => k[c] === B).length === p.clues[q]),
  };
  m.rules.push(trialRule(m, 2, 1));
  modelCache.set(p, m);
  return m;
}

export const initialDoms = (p: MosaicPuzzle): Doms => new Int32Array(p.w * p.h).fill(ANY);

const analyses = new WeakMap<MosaicPuzzle, Analysis>();

/** Unique-solution analysis, memoized per puzzle. `solution` holds WHITE / SHADED per cell. */
export function analyze(p: MosaicPuzzle): Analysis {
  let a = analyses.get(p);
  if (!a) analyses.set(p, a = analyzeModel(model(p), initialDoms(p), 2));
  return a;
}

/** Board marks as domains. */
export function readMarks(p: MosaicPuzzle, s: MosaicState): Doms {
  const k = initialDoms(p);
  s.marks.forEach((m, c) => {
    if (m === BLACK) k[c] = B;
    else if (m === DOT) k[c] = W;
  });
  return k;
}

// --- state ---

export function reduce(p: MosaicPuzzle, s: MosaicState, a: MosaicAction): MosaicState {
  if (a.type !== "set" || ![NONE, BLACK, DOT].includes(a.value)) return s;
  let next: number[] | null = null;
  for (const c of a.cells) {
    if (!(c >= 0 && c < p.clues.length) || s.marks[c] === a.value) continue;
    next ??= s.marks.slice();
    next[c] = a.value;
  }
  return next ? { marks: next } : s;
}

export interface MosaicConflicts extends Record<string, number[]> {
  /** Numbers with too many blacks around them, or too few cells left to reach theirs. */
  clues: number[];
}

export function findConflicts(p: MosaicPuzzle, marks: readonly number[]): MosaicConflicts {
  const g = geometry(p);
  return {
    clues: g.shown.filter((q) => {
      const cells = g.block[q]!;
      const black = cells.filter((c) => marks[c] === BLACK).length;
      const open = cells.filter((c) => marks[c] === NONE).length;
      return black > p.clues[q]! || black + open < p.clues[q]!;
    }),
  };
}

export function isSolved(p: MosaicPuzzle, s: MosaicState): boolean {
  const g = geometry(p);
  return g.shown.every((q) => g.block[q]!.filter((c) => s.marks[c] === BLACK).length === p.clues[q]);
}

/** Numbers whose block is fully decided on the board and right. */
export function finishedClues(p: MosaicPuzzle, marks: readonly number[]): number[] {
  const g = geometry(p);
  return g.shown.filter((q) => {
    const cells = g.block[q]!;
    return cells.every((c) => marks[c] !== NONE) && cells.filter((c) => marks[c] === BLACK).length === p.clues[q];
  });
}

// --- formats ---

const SGT_RE = /^(\d+)(?:x(\d+))?(?:h\d+)?:([a-z0-9 ]+)$/;

/** Simon Tatham's Mosaic game id: `WxH[hN]:` then a digit per numbered cell and `a`–`z` for 1–26 cells without one. */
export const sgtFormat: Format<MosaicPuzzle> = {
  id: "sgt",
  label: "game id (WxH:…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(t) {
    const m = SGT_RE.exec(t.trim());
    if (!m) throw new Error("expected WxH:desc, e.g. 5x5:a3b4…");
    const w = Number(m[1]), h = Number(m[2] ?? m[1]);
    if (!(w >= 1 && h >= 1 && w <= 100 && h <= 100)) throw new Error("size must be between 1×1 and 100×100");
    const clues: number[] = [];
    for (const ch of m[3]!) {
      if (ch >= "0" && ch <= "9") clues.push(Number(ch));
      else for (let i = 0; i < (ch === " " ? 1 : ch.charCodeAt(0) - 96); i++) clues.push(-1);
    }
    if (clues.length !== w * h) throw new Error(`expected ${w * h} cells, got ${clues.length}`);
    return { w, h, clues };
  },
  serialize(p) {
    let out = "", run = 0;
    const flush = () => {
      if (run) out += String.fromCharCode(96 + run);
      run = 0;
    };
    for (const v of p.clues) {
      if (v < 0) {
        if (run === 26) flush();
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

export function wrongMarksHint(p: MosaicPuzzle, s: MosaicState): Hint<MosaicAction> | null {
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

export function hint(p: MosaicPuzzle, s: MosaicState): Hint<MosaicAction> | null {
  const c = findConflicts(p, s.marks);
  if (c.clues.length) return { message: `the number on ${cellList(p, c.clues)} can't be met any more`, focus: { cells: [], because: c.clues } satisfies Focus };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: MosaicPuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 3 };
  return { label: LEVEL_NAMES[a.level]!, score: a.level };
}

// --- generation ---

/** Logic up to `level` decides every cell, so the picture is unique. */
function decidedBy(p: MosaicPuzzle, level: number): boolean {
  return decides(model(p), initialDoms(p), level);
}

const EXACT_ATTEMPTS = 40;
const MAX_ATTEMPTS = 400;

/**
 * Deterministic in (params, rng): a random picture, every cell numbered, then numbers removed in
 * random order while logic at the requested level still decides every cell. Needs exactly the
 * level when one turns up within EXACT_ATTEMPTS pictures, else the hardest found.
 */
export async function generatePuzzle(w: number, h: number, level: Level, rng: Rng, ctx: GenerateContext): Promise<MosaicPuzzle> {
  const block = blocks(w, h);
  let best: { p: MosaicPuzzle; level: number } | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (best && attempt >= EXACT_ATTEMPTS) break;
    await ctx.yield();
    const r = rng.fork(`attempt ${attempt}`);
    const image = Array.from({ length: w * h }, () => (r.bool() ? 1 : 0));
    const clues = block.map((cells) => cells.reduce((s, c) => s + image[c]!, 0));
    if (!decidedBy({ w, h, clues }, level)) continue;
    const order = r.shuffle(Array.from({ length: w * h }, (_, i) => i));
    // a cheap pass one level down; then at the costly level, once the cheap level suffices, only
    // until a removal makes the requested level needed
    for (const pass of level > 0 ? [level - 1, level] : [level]) {
      const easier = pass > 0 && decidedBy({ w, h, clues: clues.slice() }, pass - 1);
      for (const c of order) {
        if (clues[c]! < 0) continue;
        await ctx.yield();
        const keep = clues[c]!;
        clues[c] = -1;
        if (!decidedBy({ w, h, clues: clues.slice() }, pass)) clues[c] = keep;
        else if (pass === level && easier && !decidedBy({ w, h, clues: clues.slice() }, pass - 1)) break;
      }
    }
    const p: MosaicPuzzle = { w, h, clues };
    const got = solveLevel(model(p), initialDoms(p), level)!;
    if (got === level) return p;
    if (!best || got > best.level) best = { p, level: got };
  }
  if (best) return best.p;
  throw new Error("couldn't make a puzzle with these settings; try a different size");
}

export const mosaic: PuzzleDef<MosaicPuzzle, MosaicState, MosaicAction, MosaicInteraction, typeof params> = {
  id: "mosaic",
  name: "mosaic",
  aliases: ["fill-a-pix", "fill-in", "artmosaico", "count and darken", "magipic", "nurie"],
  tags: ["logic", "grid", "numbers", "shading", "picture"],
  description: "black out cells to reveal a picture. each number says how many black cells are in the 3×3 block around it, itself included.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "5×5 easy", params: { width: 5, height: 5, difficulty: "easy" } },
    { label: "10×10 easy", params: { width: 10, height: 10, difficulty: "easy" } },
    { label: "10×10 medium", params: { width: 10, height: 10, difficulty: "medium" } },
    { label: "10×10 hard", params: { width: 10, height: 10, difficulty: "hard" } },
    { label: "15×15 medium", params: { width: 15, height: 15, difficulty: "medium" } },
    { label: "25×25 easy", params: { width: 25, height: 25, difficulty: "easy" } },
  ],
  generate: (v: Values<typeof params>, rng, ctx) => generatePuzzle(v.width, v.height, LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) as Level, rng, ctx),
  formats: [sgtFormat],
  init: (p) => ({ marks: p.clues.map(() => NONE) }),
  initInteraction: () => ({ cursor: 0 }),
  reduce,
  isRetraction: (a) => a.value === NONE,
  rules: () => [
    "black out some of the cells, numbered or not.",
    "each number is how many black cells there are in the 3×3 block centerd on it, counting its own cell. at the edges the block is smaller.",
    "a dot is your own note that a cell stays white. it doesn't count for anything.",
  ],
  describeAction: (p, a) => `${["clear", "black out", "dot"][a.value] ?? "mark"} ${cellList(p, a.cells)}`,
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? { board: { marks: a.solution.map((v) => (v === SHADED ? BLACK : DOT)) } } : null;
  },
  hint,
  rate,
  describe: (p) => `${p.w}×${p.h}`,
};
