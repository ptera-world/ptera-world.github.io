import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import { neighbours } from "../../lib/grid-kit/grid";
import { cellList, cellName, type Focus } from "../../lib/grid-kit/names";
import {
  chosen, countSolutions, decided, freshAlive, layout, levelNeeded, saturate,
  type Alive, type Layout,
} from "./solver";
import { listOf } from "../../lib/edge-names";

export interface RectPuzzle {
  w: number;
  h: number;
  /** Row-major: 0 empty, else the area of the rectangle holding that cell. */
  nums: number[];
}

export interface RectState {
  /** Per inner edge (see Geometry.edges): 1 a wall is drawn, 0 not. */
  walls: number[];
}

/** Edges switched on and off in one move. A move that only switches edges off is a retraction. */
export type RectAction = { type: "edges"; on: number[]; off: number[] };

export interface RectInteraction {
  cursor: number;
  /** Corner cell of a rectangle being drawn from the keyboard, or -1. */
  anchor: number;
}

export const LEVEL_NAMES = ["normal", "hard"] as const;
export type Level = 0 | 1;

export const params = defineSchema({
  width: { type: "int", label: "width", default: 7, min: 2, max: 25 },
  height: { type: "int", label: "height", default: 7, min: 2, max: 25 },
  difficulty: {
    type: "enum", label: "difficulty", default: "normal",
    options: [
      { value: "normal", label: "normal", description: "cells a number always covers, and cells only one number can reach" },
      { value: "hard", label: "hard", description: "also trying a rectangle out" },
    ],
  },
});

// --- geometry ---

export interface Geometry {
  w: number;
  h: number;
  n: number;
  /** Inner edges as the two cells they separate: left-right pairs by row, then up-down pairs. */
  edges: [number, number][];
  /** Edge between two neighboring cells. */
  edgeOf: Map<number, number>;
  nbrs: number[][];
}

const geoCache = new WeakMap<RectPuzzle, Geometry>();
const pairKey = (a: number, b: number) => Math.min(a, b) * 65536 + Math.max(a, b);

export function geometry(p: RectPuzzle): Geometry {
  const hit = geoCache.get(p);
  if (hit) return hit;
  const { w, h } = p;
  const edges: [number, number][] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x + 1 < w; x++) edges.push([y * w + x, y * w + x + 1]);
  for (let y = 0; y + 1 < h; y++) for (let x = 0; x < w; x++) edges.push([y * w + x, (y + 1) * w + x]);
  const edgeOf = new Map(edges.map(([a, b], e) => [pairKey(a, b), e]));
  const g = { w, h, n: w * h, edges, edgeOf, nbrs: neighbours(w, h) };
  geoCache.set(p, g);
  return g;
}

export const edgeBetween = (g: Geometry, a: number, b: number): number => g.edgeOf.get(pairKey(a, b)) ?? -1;

/** Inner edges inside a box, and on its border (between it and the rest of the grid). */
export function boxEdges(g: Geometry, x: number, y: number, bw: number, bh: number): { inside: number[]; border: number[] } {
  const inside: number[] = [], border: number[] = [];
  for (let yy = y; yy < y + bh; yy++) {
    for (let xx = x; xx < x + bw; xx++) {
      const c = yy * g.w + xx;
      if (xx + 1 < g.w) (xx + 1 < x + bw ? inside : border).push(edgeBetween(g, c, c + 1));
      if (yy + 1 < g.h) (yy + 1 < y + bh ? inside : border).push(edgeBetween(g, c, c + g.w));
      if (xx === x && xx > 0) border.push(edgeBetween(g, c - 1, c));
      if (yy === y && yy > 0) border.push(edgeBetween(g, c - g.w, c));
    }
  }
  return { inside, border };
}

// --- solving ---

const layoutCache = new WeakMap<RectPuzzle, Layout>();
export function puzzleLayout(p: RectPuzzle): Layout {
  let l = layoutCache.get(p);
  if (!l) layoutCache.set(p, l = layout(p.w, p.h, p.nums));
  return l;
}

export interface Analysis {
  count: 0 | 1 | 2;
  level: number | null;
  /** Per clue, the chosen box index; null without a solution. */
  boxes: number[] | null;
  /** Walls of the (first) solution. */
  walls: number[] | null;
}

const analyses = new WeakMap<RectPuzzle, Analysis>();

/** Walls of a full choice of boxes. */
export function wallsOf(p: RectPuzzle, choice: readonly number[]): number[] {
  const g = geometry(p), l = puzzleLayout(p);
  const owner = new Int32Array(g.n).fill(-1);
  choice.forEach((bi, ci) => {
    for (const c of l.cells[ci]![bi]!) owner[c] = ci;
  });
  return g.edges.map(([a, b]) => (owner[a] !== owner[b] ? 1 : 0));
}

export function analyze(p: RectPuzzle): Analysis {
  const hit = analyses.get(p);
  if (hit) return hit;
  const l = puzzleLayout(p);
  const area = p.nums.reduce((s, v) => s + v, 0);
  let out: Analysis;
  if (area !== p.w * p.h) out = { count: 0, level: null, boxes: null, walls: null };
  else {
    const a = freshAlive(l);
    const ok = saturate(l, a, 1);
    if (ok && decided(a)) out = { count: 1, level: levelNeeded(l, freshAlive(l), 1), boxes: chosen(a), walls: null };
    else if (!ok) out = { count: 0, level: null, boxes: null, walls: null };
    else {
      const c = countSolutions(l, a, 2);
      out = { count: c.count as 0 | 1 | 2, level: null, boxes: c.first ? chosen(c.first) : null, walls: null };
    }
    if (out.boxes) out.walls = wallsOf(p, out.boxes);
  }
  analyses.set(p, out);
  return out;
}

/**
 * What the board establishes, as alive boxes: a box is out when a counted wall runs through it.
 * Every wall counts.
 */
export function readBoard(p: RectPuzzle, s: RectState): Alive {
  const l = puzzleLayout(p), g = geometry(p);
  const a = freshAlive(l);
  l.boxes.forEach((list, ci) => list.forEach((b, bi) => {
    if (boxEdges(g, b.x, b.y, b.w, b.h).inside.some((e) => s.walls[e])) a[ci]![bi] = 0;
  }));
  return a;
}

/** Edges no alive box spans: they must be walls. */
export function wallFacts(p: RectPuzzle, a: Alive): Uint8Array {
  const g = geometry(p), l = puzzleLayout(p);
  const spanned = new Uint8Array(g.edges.length);
  l.boxes.forEach((list, ci) => list.forEach((b, bi) => {
    if (!a[ci]![bi]) return;
    for (const e of boxEdges(g, b.x, b.y, b.w, b.h).inside) spanned[e] = 1;
  }));
  return Uint8Array.from(spanned, (v) => 1 - v);
}

// --- state ---

export function reduce(p: RectPuzzle, s: RectState, a: RectAction): RectState {
  if (a.type !== "edges") return s;
  let next: number[] | null = null;
  const put = (e: number, v: number) => {
    if (!(e >= 0 && e < s.walls.length) || (next ?? s.walls)[e] === v) return;
    next ??= s.walls.slice();
    next[e] = v;
  };
  for (const e of a.off) put(e, 0);
  for (const e of a.on) put(e, 1);
  return next ? { walls: next } : s;
}

/** Pieces of the board split by drawn walls (the rim counts), each with its cells. */
export function pieces(p: RectPuzzle, walls: readonly number[]): number[][] {
  const g = geometry(p);
  const id = new Int32Array(g.n).fill(-1);
  const out: number[][] = [];
  for (let s0 = 0; s0 < g.n; s0++) {
    if (id[s0] !== -1) continue;
    const cells = [s0];
    id[s0] = out.length;
    for (let i = 0; i < cells.length; i++) {
      for (const d of g.nbrs[cells[i]!]!) {
        if (id[d] !== -1 || walls[edgeBetween(g, cells[i]!, d)]) continue;
        id[d] = out.length;
        cells.push(d);
      }
    }
    out.push(cells);
  }
  return out;
}

/** A piece is a finished rectangle: box-shaped, no walls inside, one number equal to its size. */
export function pieceRight(p: RectPuzzle, walls: readonly number[], cells: readonly number[]): boolean {
  const g = geometry(p);
  const xs = cells.map((c) => c % p.w), ys = cells.map((c) => Math.floor(c / p.w));
  const bw = Math.max(...xs) - Math.min(...xs) + 1, bh = Math.max(...ys) - Math.min(...ys) + 1;
  if (bw * bh !== cells.length) return false;
  if (boxEdges(g, Math.min(...xs), Math.min(...ys), bw, bh).inside.some((e) => walls[e])) return false;
  const numbers = cells.filter((c) => p.nums[c]! > 0);
  return numbers.length === 1 && p.nums[numbers[0]!] === cells.length;
}

export interface RectConflicts extends Record<string, number[]> {
  /** Cells of walled-off box-shaped pieces that are wrong (no number, two, or the wrong area). */
  wrong: number[];
}

export function findConflicts(p: RectPuzzle, walls: readonly number[]): RectConflicts {
  const g = geometry(p);
  const wrong: number[] = [];
  for (const cells of pieces(p, walls)) {
    const xs = cells.map((c) => c % p.w), ys = cells.map((c) => Math.floor(c / p.w));
    const bw = Math.max(...xs) - Math.min(...xs) + 1, bh = Math.max(...ys) - Math.min(...ys) + 1;
    const boxy = bw * bh === cells.length && !boxEdges(g, Math.min(...xs), Math.min(...ys), bw, bh).inside.some((e) => walls[e]);
    if (boxy && !pieceRight(p, walls, cells)) wrong.push(...cells);
  }
  return { wrong };
}

export const isSolved = (p: RectPuzzle, s: RectState): boolean => pieces(p, s.walls).every((cells) => pieceRight(p, s.walls, cells));

// --- formats ---

const SGT_RE = /^(\d+)(?:x(\d+))?(?:e[\d.]+)?a?:([a-z_0-9]+)$/;

/** Simon Tatham's Rectangles game id: `WxH:` then `a`–`z` for 1–26 cells without a number, decimal numbers, and `_` between two numbers. */
export const sgtFormat: Format<RectPuzzle> = {
  id: "sgt",
  label: "game id (WxH:…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(t) {
    const m = SGT_RE.exec(t.trim());
    if (!m) throw new Error("expected WxH:desc, e.g. 7x7:a3b4_2…");
    const w = Number(m[1]), h = Number(m[2] ?? m[1]);
    if (!(w >= 1 && h >= 1 && w <= 60 && h <= 60)) throw new Error("size must be between 1×1 and 60×60");
    const nums: number[] = [];
    for (const tok of m[3]!.match(/[a-z]|_|\d+/g) ?? []) {
      if (tok === "_") continue;
      if (/\d/.test(tok)) nums.push(Number(tok));
      else for (let i = 0; i <= tok.charCodeAt(0) - 97; i++) nums.push(0);
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

export const edgeCells = (p: RectPuzzle, edges: readonly number[]): number[] => [...new Set(edges.flatMap((e) => geometry(p).edges[e]!))];

export function wrongHint(p: RectPuzzle, s: RectState): Hint<RectAction> | null {
  const a = analyze(p);
  if (a.count !== 1 || !a.walls) return null;
  const sol = a.walls;
  const wrong = s.walls.flatMap((v, e) => (v && !sol[e] ? [e] : []));
  if (!wrong.length) return null;
  const cells = edgeCells(p, wrong);
  return {
    message: `${wrong.length === 1 ? "the wall between" : "the walls between"} ${cellList(p, cells)} ${wrong.length === 1 ? "is" : "are"} wrong`,
    focus: { cells, because: [] } satisfies Focus,
    actions: [{ type: "edges", on: [], off: wrong }],
  };
}

export function hint(p: RectPuzzle, s: RectState): Hint<RectAction> | null {
  const c = findConflicts(p, s.walls);
  if (c.wrong.length) return { message: `${cellList(p, c.wrong)} ${c.wrong.length === 1 ? "is" : "are"} walled into a rectangle that doesn't hold one matching number`, focus: { cells: c.wrong, because: [] } satisfies Focus };
  const a = analyze(p);
  if (a.count === 0) return { message: "this puzzle has no solution" };
  if (a.count === 2) return { message: "this puzzle has more than one solution, so it can need a guess" };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: RectPuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 2 };
  return { label: LEVEL_NAMES[a.level]!, score: a.level };
}

// --- generation ---

/**
 * A random split into rectangles after tatham's: an uncovered cell at random gets a random
 * rectangle of area 2 up to a sixth of the grid that fits the uncovered space (never the full
 * width or height unless the grid is tiny). A leftover single cell joins a neighboring strip
 * when that keeps it a rectangle, and is a 1 otherwise. Returns per cell its rectangle id.
 */
export function split(w: number, h: number, rng: Rng): Int32Array {
  const n = w * h;
  const id = new Int32Array(n).fill(-1);
  const maxArea = Math.max(2, Math.floor(n / 6));
  const mw = w - 1 < 3 ? w : w - 1, mh = h - 1 < 3 ? h : h - 1;
  let next = 0;
  const free = (x: number, y: number, bw: number, bh: number) => {
    for (let yy = y; yy < y + bh; yy++) for (let xx = x; xx < x + bw; xx++) if (id[yy * w + xx] !== -1) return false;
    return true;
  };
  for (;;) {
    const open = Array.from({ length: n }, (_, c) => c).filter((c) => id[c] === -1);
    if (!open.length) break;
    const c = rng.pick(open), cx = c % w, cy = Math.floor(c / w);
    const options: [number, number, number, number][] = [];
    for (let bw = 1; bw <= mw; bw++) {
      for (let bh = 1; bh <= mh; bh++) {
        if (bw * bh < 2 || bw * bh > maxArea) continue;
        for (let x = Math.max(0, cx - bw + 1); x <= Math.min(cx, w - bw); x++) {
          for (let y = Math.max(0, cy - bh + 1); y <= Math.min(cy, h - bh); y++) if (free(x, y, bw, bh)) options.push([x, y, bw, bh]);
        }
      }
    }
    const [x, y, bw, bh] = options.length ? rng.pick(options) : [cx, cy, 1, 1];
    for (let yy = y; yy < y + bh; yy++) for (let xx = x; xx < x + bw; xx++) id[yy * w + xx] = next;
    next++;
  }
  // single cells join a 1-wide neighboring strip that lines up with them
  const cellsOf = (r: number) => Array.from({ length: n }, (_, c) => c).filter((c) => id[c] === r);
  for (let c = 0; c < n; c++) {
    const r = id[c]!;
    if (cellsOf(r).length !== 1) continue;
    for (const d of rng.shuffle(neighbours(w, h)[c]!.slice())) {
      const other = cellsOf(id[d]!);
      const merged = [...other, c];
      const xs = merged.map((q) => q % w), ys = merged.map((q) => Math.floor(q / w));
      const bw = Math.max(...xs) - Math.min(...xs) + 1, bh = Math.max(...ys) - Math.min(...ys) + 1;
      if (bw * bh !== merged.length || merged.length > maxArea + 1) continue;
      id[c] = id[d]!;
      break;
    }
  }
  return id;
}

const NUMBER_TRIES = 20;
const EXACT_ATTEMPTS = 150;
const MAX_ATTEMPTS = 400;

/**
 * Deterministic in (params, rng): a random split, then a number on a random cell of each
 * rectangle, re-drawn until logic at the requested level decides every rectangle. Needs exactly
 * the level when one turns up within EXACT_ATTEMPTS splits, else the hardest found.
 */
export async function generatePuzzle(w: number, h: number, level: Level, rng: Rng, ctx: GenerateContext): Promise<RectPuzzle> {
  let best: { p: RectPuzzle; level: number } | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (best && attempt >= EXACT_ATTEMPTS) break;
    await ctx.yield();
    const r = rng.fork(`attempt ${attempt}`);
    const id = split(w, h, r);
    const groups = new Map<number, number[]>();
    id.forEach((g, c) => groups.set(g, [...(groups.get(g) ?? []), c]));
    for (let t = 0; t < NUMBER_TRIES; t++) {
      await ctx.yield();
      const nums = Array.from({ length: w * h }, () => 0);
      for (const cells of groups.values()) nums[r.pick(cells)] = cells.length;
      const p: RectPuzzle = { w, h, nums };
      const l = puzzleLayout(p);
      const got = levelNeeded(l, freshAlive(l), level);
      if (got === null) continue;
      if (got === level) return p;
      if (!best || got > best.level) best = { p, level: got };
    }
  }
  if (best) return best.p;
  throw new Error("couldn't make a puzzle with these settings; try a different size");
}

export const rect: PuzzleDef<RectPuzzle, RectState, RectAction, RectInteraction, typeof params> = {
  id: "rect",
  name: "rectangles",
  aliases: ["shikaku", "rect", "divide by box"],
  tags: ["logic", "grid", "numbers", "regions", "nikoli"],
  description: "split the grid into rectangles so that each holds exactly one number, and that number is its area.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "7×7", params: { width: 7, height: 7, difficulty: "normal" } },
    { label: "9×9", params: { width: 9, height: 9, difficulty: "normal" } },
    { label: "9×9 hard", params: { width: 9, height: 9, difficulty: "hard" } },
    { label: "11×11", params: { width: 11, height: 11, difficulty: "normal" } },
    { label: "15×15", params: { width: 15, height: 15, difficulty: "normal" } },
  ],
  generate: (v: Values<typeof params>, rng, ctx) => generatePuzzle(v.width, v.height, LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) as Level, rng, ctx),
  formats: [sgtFormat],
  init: (p) => ({ walls: geometry(p).edges.map(() => 0) }),
  initInteraction: () => ({ cursor: 0, anchor: -1 }),
  reduce,
  isRetraction: (a) => a.on.length === 0,
  rules: () => [
    "draw walls along the grid lines to split the grid into rectangles (squares count).",
    "every rectangle holds exactly one number, and that number is how many cells the rectangle has.",
  ],
  describeAction: (p, a) => {
    const g = geometry(p);
    const name = (e: number) => `${cellName(p, g.edges[e]![0])}-${cellName(p, g.edges[e]![1])}`;
    const parts = [a.on.length ? `wall ${listOf(a.on, name)}` : "", a.off.length ? `rub out ${listOf(a.off, name)}` : ""];
    return parts.filter(Boolean).join(", ");
  },
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.walls ? { board: { walls: a.walls.slice() } } : null;
  },
  hint,
  rate,
  describe: (p) => `${p.w}×${p.h}`,
};

