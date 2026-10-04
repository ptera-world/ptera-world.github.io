import { colName, rowName } from "../../core/names";
import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, PuzzleDef, Rating } from "../../core/types";
import { nextStep, solveAll, type PermMove, type PermSpec, type PermStep } from "./perm";

export const params = defineSchema({
  width: { type: "int", label: "width", default: 4, min: 2, max: 8 },
  height: { type: "int", label: "height", default: 4, min: 2, max: 8 },
  shuffle: {
    type: "int", label: "scramble moves (0 = fully random)", default: 0, min: 0, max: 1000,
    description: "fully random boards are any reachable arrangement; a few random shifts give an easier board",
  },
});

export interface SixteenPuzzle {
  w: number;
  h: number;
  /** Row-major, tiles 1…n. Solved: 1…n in reading order. */
  tiles: number[];
}

export interface SixteenState {
  tiles: number[];
  moves: number;
}

/** Shift a whole row (positive = right) or column (positive = down), wrapping round. */
export type SixteenAction = { type: "shift"; line: "row" | "col"; index: number; by: number };

export interface SixteenFocus {
  /** Cells the hinted step moves. */
  moving?: number[];
  /** Cell being filled. */
  home?: number;
  /** Where its tile is now. */
  tile?: number;
}

export interface SixteenInteraction {
  cursor: number;
}

export function shift(w: number, h: number, tiles: readonly number[], a: SixteenAction): number[] {
  const out = tiles.slice();
  if (a.line === "row") {
    if (a.index < 0 || a.index >= h) return out;
    for (let x = 0; x < w; x++) out[a.index * w + ((((x + a.by) % w) + w) % w)] = tiles[a.index * w + x]!;
  } else {
    if (a.index < 0 || a.index >= w) return out;
    for (let y = 0; y < h; y++) out[((((y + a.by) % h) + h) % h) * w + a.index] = tiles[y * w + a.index]!;
  }
  return out;
}

const specs = new Map<string, PermSpec<SixteenAction>>();

export function spec(w: number, h: number): PermSpec<SixteenAction> {
  const key = `sixteen:${w}x${h}`;
  let s = specs.get(key);
  if (s) return s;
  const n = w * h;
  const ids = Array.from({ length: n }, (_, i) => i);
  const moves: PermMove<SixteenAction>[] = [];
  const add = (a: SixteenAction) => {
    const after = shift(w, h, ids, a);
    const to = new Int32Array(n);
    after.forEach((from, cell) => { to[from] = cell; });
    moves.push({ action: a, to, turn: null });
  };
  for (let y = 0; y < h; y++) for (const by of [1, -1]) if (w > 2 || by === 1) add({ type: "shift", line: "row", index: y, by });
  for (let x = 0; x < w; x++) for (const by of [1, -1]) if (h > 2 || by === 1) add({ type: "shift", line: "col", index: x, by });
  s = { key, n, turns: 1, moves, order: ids, distinct: true };
  specs.set(key, s);
  return s;
}

const goals = new Map<number, number[]>();
export function goal(n: number): number[] {
  let g = goals.get(n);
  if (!g) goals.set(n, (g = Array.from({ length: n }, (_, i) => i + 1)));
  return g;
}

const stepCache = new WeakMap<readonly number[], PermStep<SixteenAction> | null>();
export function hintStep(p: SixteenPuzzle, tiles: readonly number[]): PermStep<SixteenAction> | null {
  if (stepCache.has(tiles)) return stepCache.get(tiles)!;
  const st = nextStep(spec(p.w, p.h), goal(p.w * p.h), { values: tiles });
  stepCache.set(tiles, st);
  return st;
}

function parity(tiles: readonly number[]): number {
  const seen = new Uint8Array(tiles.length);
  let par = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (seen[i]) continue;
    let len = 0;
    for (let j = i; !seen[j]; j = tiles[j]! - 1) { seen[j] = 1; len++; }
    par ^= (len - 1) & 1;
  }
  return par;
}

/** With both sides odd every shift is an even permutation, so only even arrangements can be reached. */
export const isReachable = (w: number, h: number, tiles: readonly number[]): boolean => !(w & h & 1) || parity(tiles) === 0;

export const isSolvedTiles = (tiles: readonly number[]): boolean => tiles.every((t, i) => t === i + 1);

function generate(v: Values<typeof params>, rng: Rng): SixteenPuzzle {
  const w = v.width, h = v.height, n = w * h;
  let tiles = goal(n).slice();
  if (v.shuffle > 0) {
    let last: SixteenAction | null = null;
    for (let i = 0; i < v.shuffle; i++) {
      let a: SixteenAction;
      do {
        const row = rng.bool(h / (w + h));
        a = { type: "shift", line: row ? "row" : "col", index: rng.int(row ? h : w), by: rng.bool() ? 1 : -1 };
      } while (last && last.line === a.line && last.index === a.index && last.by === -a.by);
      tiles = shift(w, h, tiles, a);
      last = a;
    }
  } else {
    rng.shuffle(tiles);
    if (!isReachable(w, h, tiles)) [tiles[0], tiles[1]] = [tiles[1]!, tiles[0]!];
  }
  if (isSolvedTiles(tiles)) tiles = shift(w, h, tiles, { type: "shift", line: "row", index: 0, by: 1 });
  return { w, h, tiles };
}

function checkTiles(w: number, h: number, tiles: number[]): SixteenPuzzle {
  if (!(w >= 2 && h >= 2 && w <= 16 && h <= 16)) throw new Error("each side must be between 2 and 16");
  const n = w * h;
  if (tiles.length !== n) throw new Error(`expected ${n} numbers, got ${tiles.length}`);
  const seen = new Set<number>();
  for (const t of tiles) {
    if (!Number.isInteger(t) || t < 1 || t > n) throw new Error(`numbers must run from 1 to ${n}`);
    if (seen.has(t)) throw new Error(`${t} appears twice`);
    seen.add(t);
  }
  if (!isReachable(w, h, tiles)) throw new Error("with both sides odd, this arrangement can't be reached (two tiles would have to swap)");
  return { w, h, tiles };
}

const SGT_RE = /^(\d+)(?:x(\d+))?(?:m\d+)?:([\d,\s]+)$/;

/** Simon Tatham's Sixteen game id: `WxH[mN]:` then every tile, comma-separated (the move limit is ignored). */
export const sgtFormat: Format<SixteenPuzzle> = {
  id: "sgt",
  label: "sgt game id (WxH:n,n,…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(text) {
    const m = SGT_RE.exec(text.trim());
    if (!m) throw new Error("expected WxH:n,n,…, e.g. 3x3:1,2,3,…");
    return checkTiles(Number(m[1]), Number(m[2] ?? m[1]), m[3]!.split(",").map((x) => Number(x.trim())));
  },
  serialize: (p) => `${p.w}x${p.h}:${p.tiles.join(",")}`,
};

/** One row per line, numbers separated by spaces. */
export const gridFormat: Format<SixteenPuzzle> = {
  id: "grid",
  label: "grid (rows of numbers)",
  detect: (t) => t.trim().includes("\n") && /^[\d\s,]+$/.test(t.trim()),
  parse(text) {
    const rows = text.trim().split(/\r?\n/).map((r) => r.trim()).filter(Boolean).map((r) => r.split(/[\s,]+/));
    const h = rows.length, w = rows[0]?.length ?? 0;
    if (rows.some((r) => r.length !== w)) throw new Error("rows have different lengths");
    return checkTiles(w, h, rows.flat().map(Number));
  },
  serialize(p) {
    const width = String(p.w * p.h).length;
    const rows: string[] = [];
    for (let y = 0; y < p.h; y++) rows.push(p.tiles.slice(y * p.w, y * p.w + p.w).map((t) => String(t).padStart(width)).join(" "));
    return rows.join("\n");
  },
};

/** "row 3 right" / "column B up" (twice). */
export function describeShift(a: SixteenAction): string {
  const dir = a.line === "row" ? (a.by > 0 ? "right" : "left") : (a.by > 0 ? "down" : "up");
  const times = Math.abs(a.by) === 1 ? "" : ` ${Math.abs(a.by)} places`;
  return `${a.line === "row" ? `row ${rowName(a.index)}` : `column ${colName(a.index)}`} ${dir}${times}`;
}

const ratingCache = new WeakMap<SixteenPuzzle, Rating | null>();

function rate(p: SixteenPuzzle): Rating | null {
  if (ratingCache.has(p)) return ratingCache.get(p)!;
  const moves = solveAll(spec(p.w, p.h), goal(p.w * p.h), { values: p.tiles });
  const r = moves ? { label: `${moves.length} moves`, score: moves.length } : null;
  ratingCache.set(p, r);
  return r;
}

export const sixteen: PuzzleDef<SixteenPuzzle, SixteenState, SixteenAction, SixteenInteraction, typeof params> = {
  id: "sixteen",
  name: "sixteen",
  aliases: ["sixteen", "row and column shifting", "loopover"],
  tags: ["sliding", "moves", "permutation"],
  description: "slide whole rows and columns round (what falls off one end comes back on the other) until the numbers are in order.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "3×3", params: { width: 3, height: 3 } },
    { label: "4×4", params: { width: 4, height: 4 } },
    { label: "5×5", params: { width: 5, height: 5 } },
    { label: "4×4 · 10 moves", params: { width: 4, height: 4, shuffle: 10 } },
  ],
  generate,
  formats: [sgtFormat, gridFormat],
  init: (p) => ({ tiles: p.tiles.slice(), moves: 0 }),
  initInteraction: () => ({ cursor: 0 }),
  reduce(p, s, a) {
    if (a.type !== "shift" || !Number.isInteger(a.by) || a.by === 0) return s;
    const len = a.line === "row" ? p.w : p.h;
    if (a.by % len === 0 || a.index < 0 || a.index >= (a.line === "row" ? p.h : p.w)) return s;
    return { tiles: shift(p.w, p.h, s.tiles, a), moves: s.moves + 1 };
  },
  isSolved: (_p, s) => isSolvedTiles(s.tiles),
  solve: (p) => ({ tiles: goal(p.w * p.h).slice(), moves: 0 }),
  rate,
  rules: (p) => [
    `the numbers 1 to ${p.w * p.h} fill a ${p.w}×${p.h} grid.`,
    "a move slides one whole row or column along by one; the tile pushed off one end comes back on at the other.",
    "get the numbers in order, reading left to right and top to bottom.",
  ],
  describe: (p) => `${p.w}×${p.h}`,
};

export const hintFor = (p: SixteenPuzzle, s: SixteenState) => hintStep(p, s.tiles);
