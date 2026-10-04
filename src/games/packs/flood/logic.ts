import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, PuzzleDef, Rating } from "../../core/types";

export const MAX_COLOURS = 10;

export const params = defineSchema({
  width: { type: "int", label: "width", default: 12, min: 2, max: 30 },
  height: { type: "int", label: "height", default: 12, min: 2, max: 30 },
  colours: { type: "int", label: "colours", default: 6, min: 3, max: MAX_COLOURS },
  leniency: { type: "int", label: "spare moves", default: 5, min: 0, max: 30, description: "moves allowed beyond what the built-in solver needs" },
});

export interface FloodPuzzle {
  w: number;
  h: number;
  colours: number;
  /** Colour per cell, row-major, 0-based. The flood starts from the top-left cell. */
  grid: number[];
  /** Most moves allowed. */
  limit: number;
}

export interface FloodState {
  grid: number[];
  moves: number;
}

/** Flood the top-left area with a colour. */
export type FloodAction = { type: "fill"; colour: number };

export interface FloodFocus {
  /** Cells the hinted fill would join to the flooded area. */
  gained?: number[];
  /** Cells of the colour the hint is about. */
  cells?: number[];
}

export function fill(w: number, h: number, grid: readonly number[], colour: number): number[] {
  const out = grid.slice();
  const old = out[0]!;
  if (old === colour) return out;
  out[0] = colour;
  const stack = [0];
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w, y = Math.floor(p / w);
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (q >= 0 && out[q] === old) { out[q] = colour; stack.push(q); }
    }
  }
  return out;
}

/** Cells joined to the top-left cell through its own colour. */
export function region(w: number, h: number, grid: readonly number[]): Uint8Array {
  const on = new Uint8Array(grid.length);
  on[0] = 1;
  const stack = [0];
  const c = grid[0]!;
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w, y = Math.floor(p / w);
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (q >= 0 && !on[q] && grid[q] === c) { on[q] = 1; stack.push(q); }
    }
  }
  return on;
}

export const isComplete = (grid: readonly number[]): boolean => grid.every((c) => c === grid[0]);

interface Score { dist: number; number: number; control: number }

/**
 * Fills needed to reach every cell, measured from the flooded area: crossing into a different
 * colour costs one step. Returns the farthest distance, how many cells lie at it, and the
 * flooded area's size.
 */
function search(w: number, h: number, grid: readonly number[]): Score {
  const dist = new Int32Array(w * h).fill(-1);
  dist[0] = 0;
  let current = [0], d = 0, control = 0;
  const around = (p: number): number[] => {
    const x = p % w, y = Math.floor(p / w);
    return [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
  };
  for (;;) {
    for (let i = 0; i < current.length; i++) {
      const p = current[i]!;
      for (const q of around(p)) if (q >= 0 && dist[q] === -1 && grid[q] === grid[p]) { dist[q] = d; current.push(q); }
    }
    if (d === 0) control = current.length;
    const next: number[] = [];
    for (const p of current) for (const q of around(p)) if (q >= 0 && dist[q] === -1) { dist[q] = d + 1; next.push(q); }
    if (!next.length) return { dist: d, number: current.length, control };
    d++;
    current = next;
  }
}

const DEPTH = 3;

function better(a: Score, b: Score): boolean {
  return a.dist < b.dist || (a.dist === b.dist && (a.number < b.number || (a.number === b.number && a.control > b.control)));
}

/** The fill a three-move lookahead likes best: soonest win, else the nearest farthest cell. */
function choose(w: number, h: number, grid: readonly number[], colours: number, depth: number): { colour: number; score: Score } {
  let best: { colour: number; score: Score } = { colour: -1, score: { dist: w * h + 1, number: 0, control: 0 } };
  for (let c = 0; c < colours; c++) {
    if (grid[0] === c) continue;
    const next = fill(w, h, grid, c);
    if (isComplete(next)) return { colour: c, score: { dist: -1, number: depth, control: w * h } };
    const score = depth < DEPTH - 1 ? choose(w, h, next, colours, depth + 1).score : search(w, h, next);
    if (best.colour < 0 || better(score, best.score)) best = { colour: c, score };
  }
  return best;
}

export function bestFill(p: Pick<FloodPuzzle, "w" | "h" | "colours">, grid: readonly number[]): number {
  return choose(p.w, p.h, grid, p.colours, 0).colour;
}

/** The lookahead's fills from `grid` to a finished board. */
export function solverRun(p: Pick<FloodPuzzle, "w" | "h" | "colours">, grid: readonly number[]): number[] {
  let g = grid.slice();
  const out: number[] = [];
  while (!isComplete(g) && out.length < p.w * p.h) {
    const c = bestFill(p, g);
    out.push(c);
    g = fill(p.w, p.h, g, c);
  }
  return out;
}

const runCache = new WeakMap<readonly number[], number[]>();
/** Cached solverRun keyed by the grid array. */
export function solverMoves(p: FloodPuzzle, grid: readonly number[]): number[] {
  let r = runCache.get(grid);
  if (!r) runCache.set(grid, (r = solverRun(p, grid)));
  return r;
}

async function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<FloodPuzzle> {
  const w = v.width, h = v.height;
  let grid: number[];
  do grid = Array.from({ length: w * h }, () => rng.int(v.colours));
  while (isComplete(grid));
  const p = { w, h, colours: v.colours };
  let g = grid, moves = 0;
  while (!isComplete(g)) {
    g = fill(w, h, g, bestFill(p, g));
    moves++;
    await ctx.yield();
  }
  return { ...p, grid, limit: moves + v.leniency };
}

// --- formats ---

const SGT_RE = /^(\d+)(?:x(\d+))?(?:c(\d+))?(?:m\d+)?:([0-9A-Z]+),(\d+)$/;

/** Simon Tatham's Flood game id: `WxH[cNmN]:` a digit per cell, then `,` and the move limit. */
export const sgtFormat: Format<FloodPuzzle> = {
  id: "sgt",
  label: "sgt game id (WxH:cells,limit)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(text) {
    const m = SGT_RE.exec(text.trim());
    if (!m) throw new Error("expected WxH:cells,limit, e.g. 3x3:012120201,4");
    const w = Number(m[1]), h = Number(m[2] ?? m[1]);
    if (!(w >= 1 && h >= 1 && w * h >= 2 && w <= 60 && h <= 60)) throw new Error("size out of range");
    const body = m[4]!;
    if (body.length !== w * h) throw new Error(`expected ${w * h} cells, got ${body.length}`);
    if (/[A-Z]/.test(body)) throw new Error(`colours run from 0 to ${MAX_COLOURS - 1}`);
    const grid = [...body].map(Number);
    const colours = Math.max(m[3] ? Number(m[3]) : 0, Math.max(...grid) + 1, 3);
    if (colours > MAX_COLOURS) throw new Error(`at most ${MAX_COLOURS} colours`);
    return { w, h, colours, grid, limit: Number(m[5]) };
  },
  serialize: (p) => `${p.w}x${p.h}c${p.colours}:${p.grid.join("")},${p.limit}`,
};

/**
 * ```
 * flood limit=20 colours=6
 * 012345
 * 543210
 * ```
 * One row per line, a digit per cell.
 */
export const gridFormat: Format<FloodPuzzle> = {
  id: "grid",
  label: "grid (flood limit=N header, then rows of digits)",
  detect: (t) => /^\s*flood\b/.test(t),
  parse(text) {
    const lines = text.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const head = lines[0] ?? "";
    const limit = /\blimit=(\d+)/.exec(head);
    if (!/^flood\b/.test(head) || !limit) throw new Error("first line should look like: flood limit=20 [colours=6]");
    const rows = lines.slice(1);
    const h = rows.length, w = rows[0]?.length ?? 0;
    if (rows.some((r) => r.length !== w || !/^\d+$/.test(r))) throw new Error("rows must be digits, all the same length");
    if (w * h < 2) throw new Error("need at least two cells");
    const grid = rows.join("").split("").map(Number);
    const given = /\bcolours=(\d+)/.exec(head);
    const colours = Math.max(given ? Number(given[1]) : 0, Math.max(...grid) + 1, 3);
    if (colours > MAX_COLOURS) throw new Error(`at most ${MAX_COLOURS} colours`);
    return { w, h, colours, grid, limit: Number(limit[1]) };
  },
  serialize(p) {
    const rows: string[] = [];
    for (let y = 0; y < p.h; y++) rows.push(p.grid.slice(y * p.w, y * p.w + p.w).join(""));
    return [`flood limit=${p.limit} colours=${p.colours}`, ...rows].join("\n");
  },
};

export const COLOUR_NAMES = ["red", "yellow", "green", "blue", "orange", "purple", "brown", "sky", "lime", "pink"] as const;

const ratingCache = new WeakMap<FloodPuzzle, Rating>();
function rate(p: FloodPuzzle): Rating {
  let r = ratingCache.get(p);
  if (!r) {
    const need = solverMoves(p, p.grid).length;
    const spare = p.limit - need;
    r = { label: spare <= 0 ? "no spare moves" : `${spare} spare ${spare === 1 ? "move" : "moves"}`, score: need * 10 - spare };
    ratingCache.set(p, r);
  }
  return r;
}

export const flood: PuzzleDef<FloodPuzzle, FloodState, FloodAction, null, typeof params> = {
  id: "flood",
  name: "flood",
  aliases: ["flood it", "flood-it", "floodit"],
  tags: ["colours", "moves", "flood fill"],
  description: "turn the whole grid one colour. each move repaints the area grown from the top-left corner, which then swallows every touching cell of that colour.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "12×12 easy", params: { width: 12, height: 12, colours: 6, leniency: 5 } },
    { label: "12×12 medium", params: { width: 12, height: 12, colours: 6, leniency: 2 } },
    { label: "12×12 hard", params: { width: 12, height: 12, colours: 6, leniency: 0 } },
    { label: "16×16 medium", params: { width: 16, height: 16, colours: 6, leniency: 2 } },
    { label: "12×12, 3 colours", params: { width: 12, height: 12, colours: 3, leniency: 0 } },
    { label: "12×12, 4 colours", params: { width: 12, height: 12, colours: 4, leniency: 0 } },
  ],
  generate,
  formats: [sgtFormat, gridFormat],
  init: (p) => ({ grid: p.grid.slice(), moves: 0 }),
  reduce(p, s, a) {
    if (a.type !== "fill" || !Number.isInteger(a.colour) || a.colour < 0 || a.colour >= p.colours) return s;
    if (a.colour === s.grid[0] || isComplete(s.grid) || s.moves >= p.limit) return s;
    return { grid: fill(p.w, p.h, s.grid, a.colour), moves: s.moves + 1 };
  },
  isSolved: (_p, s) => isComplete(s.grid),
  isLost: (p, s) => s.moves >= p.limit && !isComplete(s.grid),
  solve(p) {
    const moves = solverMoves(p, p.grid);
    let g = p.grid;
    for (const c of moves) g = fill(p.w, p.h, g, c);
    return { grid: g, moves: moves.length };
  },
  rate,
  rules: (p) => [
    "the flooded area is the top-left cell plus every cell joined to it (across edges) through the same colour.",
    "a move picks a colour: the whole flooded area becomes that colour, so it grows into every touching cell of it.",
    `make the whole grid one colour within ${p.limit} moves.`,
  ],
  describe: (p) => `${p.w}×${p.h} · ${p.colours} colours · ${p.limit} moves`,
};
