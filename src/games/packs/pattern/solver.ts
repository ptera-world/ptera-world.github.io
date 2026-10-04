import type { Rng } from "../../core/rng";
import { colName, rowName } from "../../core/names";

export const UNKNOWN = 0;
export const FILLED = 1;
export const EMPTY = 2;

export type Cell = typeof UNKNOWN | typeof FILLED | typeof EMPTY;
export type Clue = readonly number[];

export interface Clues {
  w: number;
  h: number;
  /** Row clues top to bottom; an empty array means an empty row. */
  rows: readonly Clue[];
  /** Column clues left to right. */
  cols: readonly Clue[];
}

/** Lengths of the filled runs in a line (UNKNOWN counts as not filled). */
export function runs(line: ArrayLike<number>): number[] {
  const out: number[] = [];
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === FILLED) n++;
    else if (n) { out.push(n); n = 0; }
  }
  if (n) out.push(n);
  return out;
}

export const CAN_FILL = 1;
export const CAN_EMPTY = 2;

/**
 * For each cell, which values (CAN_FILL | CAN_EMPTY bits) appear in at least one arrangement of
 * `clue` consistent with the known cells of `line`. Null if no arrangement exists.
 * Complete for a single line: a cell left with one bit is forced.
 */
export function solveLine(clue: Clue, line: ArrayLike<number>): Uint8Array | null {
  const n = line.length;
  const k = clue.length;
  const N = n + 1;
  const canEmpty = (i: number) => i >= n || line[i] !== FILLED;
  const blocked = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) blocked[i + 1] = blocked[i]! + (line[i] === EMPTY ? 1 : 0);
  const fillable = (s: number, e: number) => e <= n && blocked[e]! - blocked[s]! === 0;
  const stride = N + 1;
  const fwd = new Uint8Array((k + 1) * stride);
  const bwd = new Uint8Array((k + 1) * stride);
  fwd[0] = 1;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j <= k; j++) {
      if (!fwd[j * stride + i]) continue;
      if (canEmpty(i)) fwd[j * stride + i + 1] = 1;
      if (j < k) {
        const e = i + clue[j]!;
        if (fillable(i, e) && canEmpty(e)) fwd[(j + 1) * stride + e + 1] = 1;
      }
    }
  }
  if (!fwd[k * stride + N]) return null;
  bwd[k * stride + N] = 1;
  for (let i = N - 1; i >= 0; i--) {
    for (let j = k; j >= 0; j--) {
      let ok = canEmpty(i) && bwd[j * stride + i + 1] === 1;
      if (!ok && j < k) {
        const e = i + clue[j]!;
        ok = fillable(i, e) && canEmpty(e) && bwd[(j + 1) * stride + e + 1] === 1;
      }
      if (ok) bwd[j * stride + i] = 1;
    }
  }
  const out = new Uint8Array(n);
  const diff = new Int32Array(n + 1);
  for (let j = 0; j <= k; j++) {
    for (let i = 0; i < n; i++) {
      if (!fwd[j * stride + i]) continue;
      if (canEmpty(i) && bwd[j * stride + i + 1]) out[i] = out[i]! | CAN_EMPTY;
      if (j < k) {
        const e = i + clue[j]!;
        if (fillable(i, e) && canEmpty(e) && bwd[(j + 1) * stride + e + 1]) {
          diff[i] = diff[i]! + 1;
          diff[e] = diff[e]! - 1;
          if (e < n) out[e] = out[e]! | CAN_EMPTY;
        }
      }
    }
  }
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += diff[i]!;
    if (acc > 0) out[i] = out[i]! | CAN_FILL;
  }
  return out;
}

/**
 * suffix[j][i] (flattened, stride n + 2): blocks j..k-1 fit into cells i..n-1 with every FILLED
 * cell covered. Position n + 1 stands for "past the end".
 */
function suffixTable(clue: Clue, line: ArrayLike<number>): Uint8Array {
  const n = line.length;
  const k = clue.length;
  const stride = n + 2;
  const canEmpty = (i: number) => i >= n || line[i] !== FILLED;
  const emptyBefore = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) emptyBefore[i + 1] = emptyBefore[i]! + (line[i] === EMPTY ? 1 : 0);
  const fits = (s: number, e: number) => e <= n && emptyBefore[e]! - emptyBefore[s]! === 0;
  const t = new Uint8Array((k + 1) * stride);
  t[k * stride + n + 1] = 1;
  for (let i = n; i >= 0; i--) {
    for (let j = k; j >= 0; j--) {
      let ok = canEmpty(i) && t[j * stride + i + 1] === 1;
      if (!ok && j < k) {
        const e = i + clue[j]!;
        ok = fits(i, e) && canEmpty(e) && t[(j + 1) * stride + e + 1] === 1;
      }
      if (ok) t[j * stride + i] = 1;
    }
  }
  return t;
}

/** Start of every block in the leftmost arrangement consistent with `line`, or null if none fits. */
function leftmost(clue: Clue, line: ArrayLike<number>): Int32Array | null {
  const n = line.length;
  const k = clue.length;
  const stride = n + 2;
  const t = suffixTable(clue, line);
  if (!t[0]) return null;
  const out = new Int32Array(k);
  let i = 0;
  for (let j = 0; j < k; j++) {
    const len = clue[j]!;
    let s = i;
    for (;; s++) {
      if (s + len > n) return null;
      let fits = s + len >= n || line[s + len] !== FILLED;
      for (let c = s; fits && c < s + len; c++) if (line[c] === EMPTY) fits = false;
      if (fits && t[(j + 1) * stride + s + len + 1]) break;
      if (line[s] === FILLED) return null;
    }
    out[j] = s;
    i = s + len + 1;
  }
  return out;
}

export interface Extremes {
  /** Start of each block when every block is pushed as far left (top) as the marks allow. */
  left: Int32Array;
  /** Start of each block when pushed as far right (bottom). */
  right: Int32Array;
}

/**
 * Leftmost and rightmost start of every block over all arrangements consistent with `line`, or
 * null if the clue can't fit. Any arrangement places block j within [left[j], right[j] + clue[j]).
 */
export function extremes(clue: Clue, line: ArrayLike<number>): Extremes | null {
  const left = leftmost(clue, line);
  if (!left) return null;
  const n = line.length;
  const k = clue.length;
  const rev = Array.from({ length: n }, (_, i) => line[n - 1 - i]!);
  const r = leftmost([...clue].reverse(), rev)!;
  const right = new Int32Array(k);
  for (let j = 0; j < k; j++) right[j] = n - r[k - 1 - j]! - clue[j]!;
  return { left, right };
}

/** Number of arrangements of `clue` consistent with `line`, saturating at `cap`. */
export function countArrangements(clue: Clue, line: ArrayLike<number>, cap = 1e9): number {
  const n = line.length;
  const k = clue.length;
  const canEmpty = (i: number) => i >= n || line[i] !== FILLED;
  const emptyBefore = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) emptyBefore[i + 1] = emptyBefore[i]! + (line[i] === EMPTY ? 1 : 0);
  const fits = (s: number, e: number) => e <= n && emptyBefore[e]! - emptyBefore[s]! === 0;
  const stride = n + 2;
  const ways = new Float64Array((k + 1) * stride);
  ways[k * stride + n + 1] = 1;
  for (let i = n; i >= 0; i--) {
    for (let j = k; j >= 0; j--) {
      let w = canEmpty(i) ? ways[j * stride + i + 1]! : 0;
      if (j < k) {
        const e = i + clue[j]!;
        if (fits(i, e) && canEmpty(e)) w += ways[(j + 1) * stride + e + 1]!;
      }
      ways[j * stride + i] = Math.min(cap, w);
    }
  }
  return ways[0]!;
}

/** Line index space: rows are 0..h-1, columns are h..h+w-1. */
export function lineCells(p: Clues, line: number): number[] {
  const out: number[] = [];
  if (line < p.h) for (let x = 0; x < p.w; x++) out.push(line * p.w + x);
  else for (let y = 0; y < p.h; y++) out.push(y * p.w + (line - p.h));
  return out;
}

export function lineClue(p: Clues, line: number): Clue {
  return line < p.h ? p.rows[line]! : p.cols[line - p.h]!;
}

/** "row 5" / "column C", matching the shared board labels. */
export function lineName(p: Clues, line: number): string {
  return line < p.h ? `row ${rowName(line)}` : `column ${colName(line - p.h)}`;
}

/** Precomputed line → cells table, shared by every solver call on one puzzle. */
export class Lines {
  readonly cells: Int32Array[];
  readonly count: number;
  constructor(readonly p: Clues) {
    this.count = p.w + p.h;
    this.cells = Array.from({ length: this.count }, (_, l) => Int32Array.from(lineCells(p, l)));
  }
  linesOf(cell: number): [number, number] {
    return [Math.floor(cell / this.p.w), this.p.h + (cell % this.p.w)];
  }
}

export interface LineDeduction {
  line: number;
  fill: number[];
  empty: number[];
}

/** Forced cells of one line given `cells`; null on contradiction. */
export function deduceLine(L: Lines, cells: ArrayLike<number>, line: number): LineDeduction | null {
  const idx = L.cells[line]!;
  const vals = new Uint8Array(idx.length);
  for (let i = 0; i < idx.length; i++) vals[i] = cells[idx[i]!]!;
  const poss = solveLine(lineClue(L.p, line), vals);
  if (!poss) return null;
  const fill: number[] = [], empty: number[] = [];
  for (let i = 0; i < idx.length; i++) {
    if (vals[i] !== UNKNOWN) continue;
    if (poss[i] === CAN_FILL) fill.push(idx[i]!);
    else if (poss[i] === CAN_EMPTY) empty.push(idx[i]!);
  }
  return { line, fill, empty };
}

/**
 * Line-solve to a fixpoint, mutating `cells`. Only lines in `start` (default: all) are queued
 * initially; lines crossing a newly decided cell are queued as they change.
 * Returns false on contradiction (cells are then partially updated and must be discarded).
 */
export function propagate(L: Lines, cells: Uint8Array, start?: readonly number[]): boolean {
  const queued = new Uint8Array(L.count);
  const queue: number[] = [];
  const push = (l: number) => { if (!queued[l]) { queued[l] = 1; queue.push(l); } };
  if (start) start.forEach(push);
  else for (let l = 0; l < L.count; l++) push(l);
  for (let qi = 0; qi < queue.length; qi++) {
    const line = queue[qi]!;
    queued[line] = 0;
    const d = deduceLine(L, cells, line);
    if (!d) return false;
    for (const c of d.fill) { cells[c] = FILLED; L.linesOf(c).forEach(push); }
    for (const c of d.empty) { cells[c] = EMPTY; L.linesOf(c).forEach(push); }
  }
  return true;
}

export interface ProbeDeduction {
  cell: number;
  /** The value that was tried and led to a contradiction. */
  tried: Cell;
  /** Line found impossible after trying. */
  failedLine: number;
  /** Knowledge line logic reached from the assumption before failedLine broke (includes the assumed cell). */
  after: Uint8Array;
}

/**
 * Propagate like `propagate` but report which line failed first, or -1 if none did.
 */
function propagateWhy(L: Lines, cells: Uint8Array, start: readonly number[]): number {
  const queued = new Uint8Array(L.count);
  const queue: number[] = [];
  const push = (l: number) => { if (!queued[l]) { queued[l] = 1; queue.push(l); } };
  start.forEach(push);
  for (let qi = 0; qi < queue.length; qi++) {
    const line = queue[qi]!;
    queued[line] = 0;
    const d = deduceLine(L, cells, line);
    if (!d) return line;
    for (const c of d.fill) { cells[c] = FILLED; L.linesOf(c).forEach(push); }
    for (const c of d.empty) { cells[c] = EMPTY; L.linesOf(c).forEach(push); }
  }
  return -1;
}

/**
 * First cell (scanning `count` cells from `from`, wrapping) where assuming one value and
 * line-solving leads to a contradiction, so the other value is forced. `cells` must already be
 * line-solved.
 */
export function findProbe(L: Lines, cells: Uint8Array, from = 0, count = cells.length): ProbeDeduction | null {
  const n = cells.length;
  for (let k = 0; k < Math.min(n, count); k++) {
    const i = (from + k) % n;
    if (cells[i] !== UNKNOWN) continue;
    for (const v of [FILLED, EMPTY] as const) {
      const copy = cells.slice();
      copy[i] = v;
      const failed = propagateWhy(L, copy, L.linesOf(i));
      if (failed >= 0) return { cell: i, tried: v, failedLine: failed, after: copy };
    }
  }
  return null;
}

export type Level = "line" | "probe";
export const LEVELS: readonly Level[] = ["line", "probe"];

export interface Analysis {
  /** "contradiction": no solution. "stuck": logic up to probing can't finish (ambiguous or deeper). */
  status: "solved" | "stuck" | "contradiction";
  /** Hardest technique that was needed (only meaningful when solved). */
  level: Level;
  probes: number;
  /** Final knowledge; complete when solved. */
  cells: Uint8Array;
}

/** Deduce from scratch with techniques up to `maxLevel`. Sound, so "solved" implies a unique solution. */
export function analyze(p: Clues, maxLevel: Level = "probe", L = new Lines(p)): Analysis {
  const cells = new Uint8Array(p.w * p.h);
  if (!propagate(L, cells)) return { status: "contradiction", level: "line", probes: 0, cells };
  let probes = 0;
  let from = 0;
  if (maxLevel === "probe") {
    for (;;) {
      if (!cells.includes(UNKNOWN)) break;
      const d = findProbe(L, cells, from);
      if (!d) break;
      probes++;
      cells[d.cell] = d.tried === FILLED ? EMPTY : FILLED;
      if (!propagate(L, cells, L.linesOf(d.cell))) return { status: "contradiction", level: "probe", probes, cells };
      from = d.cell;
    }
  }
  const solved = !cells.includes(UNKNOWN);
  return { status: solved ? "solved" : "stuck", level: probes > 0 ? "probe" : "line", probes, cells };
}

export interface Count {
  /** Number of solutions found, capped at the requested limit. */
  count: number;
  /** Up to `limit` solutions, cells as FILLED/EMPTY. */
  solutions: Uint8Array[];
  /** True if the node budget ran out before the search finished. */
  exhausted: boolean;
}

/** Backtracking search with line propagation at every node. */
export function countSolutions(p: Clues, limit = 2, nodeBudget = 200_000, L = new Lines(p)): Count {
  const solutions: Uint8Array[] = [];
  let nodes = 0;
  let exhausted = false;
  const rec = (cells: Uint8Array, start?: readonly number[]): void => {
    if (solutions.length >= limit || exhausted) return;
    if (++nodes > nodeBudget) { exhausted = true; return; }
    if (!propagate(L, cells, start)) return;
    const i = cells.indexOf(UNKNOWN);
    if (i < 0) { solutions.push(cells); return; }
    for (const v of [FILLED, EMPTY]) {
      const copy = cells.slice();
      copy[i] = v;
      rec(copy, L.linesOf(i));
    }
  };
  rec(new Uint8Array(p.w * p.h));
  return { count: solutions.length, solutions, exhausted };
}

export function cluesOf(w: number, h: number, grid: ArrayLike<number>): Clues {
  const rows: number[][] = [], cols: number[][] = [];
  for (let y = 0; y < h; y++) rows.push(runs(Array.from({ length: w }, (_, x) => grid[y * w + x]!)));
  for (let x = 0; x < w; x++) cols.push(runs(Array.from({ length: h }, (_, y) => grid[y * w + x]!)));
  return { w, h, rows, cols };
}

export interface GenOptions {
  w: number;
  h: number;
  level: Level;
  /** Target share of filled cells, 0..1. */
  density: number;
  /** Box-blur passes over the noise before thresholding; more = blobbier pictures. */
  smoothing: number;
}

/** Thresholded smoothed noise: a FILLED/EMPTY grid with about `density` filled. */
export function randomPicture(o: Omit<GenOptions, "level">, rng: Rng): Uint8Array {
  const { w, h } = o;
  let v = Float64Array.from({ length: w * h }, () => rng.next());
  for (let pass = 0; pass < o.smoothing; pass++) {
    const next = new Float64Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            sum += v[ny * w + nx]!;
            cnt++;
          }
        }
        next[y * w + x] = sum / cnt;
      }
    }
    v = next;
  }
  const sorted = Float64Array.from(v).sort();
  const filled = Math.max(1, Math.min(w * h - 1, Math.round(o.density * w * h)));
  const threshold = sorted[w * h - filled]!;
  return Uint8Array.from(v, (x) => (x >= threshold ? FILLED : EMPTY));
}

export interface Generated {
  grid: Uint8Array;
  clues: Clues;
  level: Level;
}

export interface GenBudget {
  /** Solver runs spent on fresh pictures and flip repairs before falling back. */
  analyses: number;
  /** Flip repairs tried on one picture before starting a new one. */
  flipsPerPicture: number;
  /** Probing is skipped (treated as stuck) while more than this share of cells is undetermined by line logic. */
  probeBelowUnknown: number;
}

export function defaultBudget(w: number, h: number): GenBudget {
  return { analyses: 2500, flipsPerPicture: Math.max(60, Math.round((w * h) / 8)), probeBelowUnknown: 0.6 };
}

function analyzeFor(clues: Clues, level: Level, budget: GenBudget): Analysis {
  const L = new Lines(clues);
  const a = analyze(clues, "line", L);
  if (level === "line" || a.status !== "stuck") return a;
  let unknown = 0;
  for (const c of a.cells) if (c === UNKNOWN) unknown++;
  if (unknown > budget.probeBelowUnknown * a.cells.length) return a;
  return analyze(clues, "probe", L);
}

function undetermined(a: Analysis): number[] {
  const out: number[] = [];
  a.cells.forEach((c, i) => { if (c === UNKNOWN) out.push(i); });
  return out;
}

/**
 * A picture whose clues are uniquely solvable using techniques up to `o.level`, needing exactly
 * `o.level` when one turns up within budget (else the returned `level` says what it needs).
 * Ambiguity is repaired by flipping still-undetermined cells. Always terminates: the last resort
 * only ever turns EMPTY cells FILLED, and a fully filled grid is line-solvable.
 */
export async function generatePicture(
  o: GenOptions, rng: Rng, tick: () => Promise<void>, budget = defaultBudget(o.w, o.h),
): Promise<Generated> {
  const want = LEVELS.indexOf(o.level);
  let fallback: Generated | null = null;
  let best: { grid: Uint8Array; unknown: number } | null = null;
  let spent = 0;
  while (spent < budget.analyses && !(fallback && spent >= budget.analyses / 2)) {
    const grid = randomPicture(o, rng);
    for (let flip = 0; flip < budget.flipsPerPicture && spent < budget.analyses; flip++) {
      await tick();
      spent++;
      const clues = cluesOf(o.w, o.h, grid);
      const a = analyzeFor(clues, o.level, budget);
      if (a.status === "solved") {
        if (LEVELS.indexOf(a.level) === want) return { grid, clues, level: a.level };
        fallback ??= { grid: grid.slice(), clues, level: a.level };
        break;
      }
      const unk = undetermined(a);
      if (!best || unk.length < best.unknown) best = { grid: grid.slice(), unknown: unk.length };
      const i = rng.pick(unk);
      grid[i] = grid[i] === FILLED ? EMPTY : FILLED;
    }
  }
  if (fallback) return fallback;
  const grid = best ? best.grid : randomPicture(o, rng);
  for (;;) {
    await tick();
    const clues = cluesOf(o.w, o.h, grid);
    const a = analyzeFor(clues, o.level, budget);
    if (a.status === "solved") return { grid, clues, level: a.level };
    let cands = undetermined(a).filter((i) => grid[i] === EMPTY);
    if (!cands.length) cands = Array.from(grid.keys()).filter((i) => grid[i] === EMPTY);
    grid[rng.pick(cands)] = FILLED;
  }
}
