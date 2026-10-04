import type { Rng } from "../../core/rng";
import type { GenerateContext } from "../../core/types";
import { edgeAt, edgeGrid, step as stepTo } from "../../lib/edges";
import { randomHamiltonPath } from "../../lib/hamilton";

export interface ZipPuzzle {
  w: number;
  h: number;
  /** Per cell: 0, or its number 1…k. Each number appears once; the path starts on 1 and ends on k. */
  nums: number[];
  /** Edges (see lib/edges) the path may not cross, ascending. */
  walls: number[];
}

/** Precomputed board facts for a puzzle. */
export interface Board {
  n: number;
  /** Open neighbours per cell (no wall between). */
  nbrs: number[][];
  /** Cell of each number, index 1…k (index 0 unused). */
  numCell: number[];
  last: number;
}

const boardCache = new WeakMap<ZipPuzzle, Board>();

export function board(p: ZipPuzzle): Board {
  const hit = boardCache.get(p);
  if (hit) return hit;
  const g = edgeGrid(p.w, p.h);
  const walled = new Set(p.walls);
  const nbrs: number[][] = [];
  for (let c = 0; c < g.n; c++) {
    const out: number[] = [];
    for (let d = 0; d < 4; d++) {
      const e = edgeAt(g, c, d);
      if (e >= 0 && !walled.has(e)) out.push(stepTo(g, c, d));
    }
    nbrs.push(out);
  }
  const numCell = [-1];
  p.nums.forEach((v, c) => { if (v) numCell[v] = c; });
  const b = { n: g.n, nbrs, numCell, last: numCell.length - 1 };
  boardCache.set(p, b);
  return b;
}

/**
 * A partial path and its derived facts. `seen` marks cells on the path; `next` is the number the
 * path must reach next (last + 1 once every number is reached).
 */
export interface Walk {
  path: number[];
  seen: Uint8Array;
  next: number;
}

export function walkOf(p: ZipPuzzle, path: readonly number[]): Walk {
  const b = board(p);
  const seen = new Uint8Array(b.n);
  let next = 1;
  for (const c of path) {
    seen[c] = 1;
    if (p.nums[c] === next) next++;
  }
  return { path: path.slice(), seen, next };
}

export const headOf = (w: Walk): number => w.path[w.path.length - 1]!;
export const isDone = (p: ZipPuzzle, w: Walk): boolean => w.path.length === board(p).n && w.next === board(p).last + 1;

/** Cells the head may step into: open, unvisited, and not a number out of turn. Nothing after the last number. */
export function moves(p: ZipPuzzle, w: Walk): number[] {
  const b = board(p);
  const head = headOf(w);
  if (p.nums[head] === b.last) return [];
  return b.nbrs[head]!.filter((c) => !w.seen[c] && (!p.nums[c] || p.nums[c] === w.next));
}

export function advance(p: ZipPuzzle, w: Walk, c: number): Walk {
  const seen = w.seen.slice();
  seen[c] = 1;
  return { path: [...w.path, c], seen, next: p.nums[c] === w.next ? w.next + 1 : w.next };
}

/** Ways cell c (unvisited) can still be entered or left: unvisited open neighbours, plus the head. */
function access(p: ZipPuzzle, w: Walk, c: number): number {
  const b = board(p);
  const head = headOf(w);
  let n = 0;
  for (const o of b.nbrs[c]!) if (!w.seen[o] || o === head) n++;
  return n;
}

export type Trouble =
  | { kind: "stuck" }
  | { kind: "early-end" }
  | { kind: "dead"; cell: number }
  | { kind: "cut"; cells: number[] }
  | { kind: "order"; num: number };

/**
 * A reason the walk can't be finished, from what is visible: the head has nowhere to go, the path
 * ended on the last number too early, an unvisited cell with too few ways in, unvisited cells
 * cut off from the head, or the next number cut off without passing a later one. Null if none.
 */
export function trouble(p: ZipPuzzle, w: Walk): Trouble | null {
  const b = board(p);
  if (isDone(p, w)) return null;
  const head = headOf(w);
  if (p.nums[head] === b.last) return { kind: "early-end" };
  if (!moves(p, w).length) return { kind: "stuck" };
  for (let c = 0; c < b.n; c++) {
    if (w.seen[c]) continue;
    if (access(p, w, c) < (p.nums[c] === b.last ? 1 : 2)) return { kind: "dead", cell: c };
  }
  const reach = new Uint8Array(b.n);
  reach[head] = 1;
  const stack = [head];
  while (stack.length) {
    const c = stack.pop()!;
    for (const o of b.nbrs[c]!) if (!w.seen[o] && !reach[o]) { reach[o] = 1; stack.push(o); }
  }
  const off: number[] = [];
  for (let c = 0; c < b.n; c++) if (!w.seen[c] && !reach[c]) off.push(c);
  if (off.length) return { kind: "cut", cells: off };
  if (w.next <= b.last && !reachesNext(p, w)) return { kind: "order", num: w.next };
  return null;
}

/** The next number can be reached from the head over unvisited cells without passing a later number. */
function reachesNext(p: ZipPuzzle, w: Walk): boolean {
  const b = board(p);
  const goal = b.numCell[w.next]!;
  const seen = new Uint8Array(b.n);
  const head = headOf(w);
  seen[head] = 1;
  const stack = [head];
  while (stack.length) {
    const c = stack.pop()!;
    for (const o of b.nbrs[c]!) {
      if (o === goal) return true;
      if (seen[o] || w.seen[o] || p.nums[o]) continue;
      seen[o] = 1;
      stack.push(o);
    }
  }
  return false;
}
/**
 * Every unvisited cell needs two path edges (the last number one; the head one more), so a cell
 * with only that many open edges uses all of them, and a cell that has its edges takes no
 * others. Following that to the end: the cells whose edges are forced, or null if it breaks
 * (a cell short of edges or with too many, a closed loop, or the head joined to the last number
 * while other cells are left).
 */
export function chains(p: ZipPuzzle, w: Walk): { forced: number[] } | null {
  const b = board(p);
  const g = edgeGrid(p.w, p.h);
  const head = headOf(w);
  const kCell = b.numCell[b.last]!;
  const left = b.n - w.path.length;
  const node = (c: number) => !w.seen[c] || c === head;
  const need = (c: number) => (c === head || c === kCell ? 1 : 2);
  /** 0 open, 1 forced, 2 ruled out. */
  const st = new Int8Array(g.ne).fill(2);
  const walled = new Set(p.walls);
  for (let e = 0; e < g.ne; e++) {
    const a = g.ea[e]!, c = g.eb[e]!;
    if (walled.has(e) || !node(a) || !node(c)) continue;
    if (left > 1 && ((a === head && c === kCell) || (c === head && a === kCell))) continue;
    st[e] = 0;
  }
  const edgesOf = (c: number) => [0, 1, 2, 3].map((d) => edgeAt(g, c, d)).filter((e) => e >= 0);
  const parent = new Int32Array(b.n).map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  const size = new Int32Array(b.n).fill(1);
  const nodes = left + 1;
  const force = (e: number): boolean => {
    st[e] = 1;
    const ra = find(g.ea[e]!), rb = find(g.eb[e]!);
    if (ra === rb) return false;
    parent[ra] = rb;
    size[rb] = size[rb]! + size[ra]!;
    return !(find(head) === find(kCell) && size[find(head)]! < nodes);
  };
  for (let changed = true; changed;) {
    changed = false;
    for (let c = 0; c < b.n; c++) {
      if (!node(c)) continue;
      const es = edgesOf(c);
      const forced = es.filter((e) => st[e] === 1).length;
      const open = es.filter((e) => st[e] === 0);
      const k = need(c);
      if (forced > k || forced + open.length < k) return null;
      if (!open.length) continue;
      if (forced === k) for (const e of open) st[e] = 2;
      else if (forced + open.length === k) { for (const e of open) if (!force(e)) return null; }
      else continue;
      changed = true;
    }
  }
  const forced: number[] = [];
  for (let e = 0; e < g.ne; e++) if (st[e] === 1) forced.push(e);
  return { forced };
}

/** Ways to finish the walk (up to `limit`), with the first one found. Count -1 if `budget` steps ran out. */
export function countSolutions(p: ZipPuzzle, from: Walk, limit: number, budget = 2_000_000): { count: number; first: number[] | null } {
  let count = 0, nodes = 0;
  let first: number[] | null = null;
  const go = (w: Walk): boolean => {
    if (++nodes > budget) return true;
    if (isDone(p, w)) {
      count++;
      first ??= w.path;
      return count >= limit;
    }
    if (trouble(p, w) || !chains(p, w)) return false;
    for (const c of moves(p, w)) if (go(advance(p, w, c))) return true;
    return false;
  };
  go(from);
  return { count: nodes > budget ? -1 : count, first };
}

// --- deductions from the head ---

export type StepKind = "only-way" | "dead-end" | "no-split" | "order" | "chains" | "trial";
export const KIND_LEVEL: Record<StepKind, number> = { "only-way": 1, "dead-end": 2, "no-split": 3, order: 4, chains: 5, trial: 6 };
const KIND_AT: StepKind[] = ["only-way", "only-way", "dead-end", "no-split", "order", "chains", "trial"];

export type Why = Trouble | { kind: "chains" } | { kind: "fails" };

export interface Elimination {
  cell: number;
  why: Why;
}

export interface ZipStep {
  kind: StepKind;
  /** Cells to add to the path, in order. */
  cells: number[];
  /** Cells explaining why. */
  because: number[];
  /** Moves ruled out, and why. */
  ruled: Elimination[];
}

const TRIAL_BUDGET = 20_000;

/** What a move into c would break, by the check of exactly `level` (3…6). */
function verdict(p: ZipPuzzle, w: Walk, c: number, level: number): Why | null {
  const after = advance(p, w, c);
  if (isDone(p, after)) return null;
  const t = trouble(p, after);
  if (t && t.kind !== "order" && level >= 3) return t;
  if (t && level >= 4) return t;
  if (level >= 5 && !chains(p, after)) return { kind: "chains" };
  if (level >= 6 && countSolutions(p, after, 1, TRIAL_BUDGET).count === 0) return { kind: "fails" };
  return null;
}

/** The step from the walk using deductions up to `level` (null if they don't settle the next move). */
export function nextStep(p: ZipPuzzle, w: Walk, level: number): ZipStep | null {
  const opts = moves(p, w);
  if (!opts.length || trouble(p, w)) return null;
  if (opts.length === 1) {
    const cells: number[] = [];
    let cur = w;
    while (!isDone(p, cur)) {
      const m = moves(p, cur);
      if (m.length !== 1) break;
      cells.push(m[0]!);
      cur = advance(p, cur, m[0]!);
    }
    return { kind: "only-way", cells, because: [headOf(w)], ruled: [] };
  }
  if (level >= 2) {
    const b = board(p);
    const forced = opts.filter((c) => p.nums[c] !== b.last && access(p, w, c) <= 2);
    if (forced.length === 1) return { kind: "dead-end", cells: forced, because: forced, ruled: [] };
  }
  for (let l = 3; l <= Math.min(level, 6); l++) {
    const ruled: Elimination[] = [];
    for (const c of opts) {
      const why = verdict(p, w, c, l);
      if (why) ruled.push({ cell: c, why });
    }
    if (ruled.length === opts.length - 1) {
      const keep = opts.find((c) => !ruled.some((r) => r.cell === c))!;
      return { kind: KIND_AT[l]!, cells: [keep], because: ruled.map((r) => r.cell), ruled };
    }
  }
  return null;
}

/**
 * Follow deductions up to `maxLevel` from the start. `level` is the hardest used, or null if they
 * stall. Every deduction is forced, so finishing proves the solution unique.
 */
export function logicSolve(p: ZipPuzzle, maxLevel: number): { path: number[]; level: number | null } {
  let w = walkOf(p, [board(p).numCell[1]!]);
  let hardest = 0;
  for (;;) {
    if (isDone(p, w)) return { path: w.path, level: hardest };
    const st = nextStep(p, w, maxLevel);
    if (!st) return { path: w.path, level: null };
    hardest = Math.max(hardest, KIND_LEVEL[st.kind]);
    for (const c of st.cells) w = advance(p, w, c);
  }
}

export interface Analysis {
  /** 0 none, 1 unique, 2 several, -1 unknown. */
  count: number;
  solution: number[] | null;
  level: number | null;
}

const analysisCache = new WeakMap<ZipPuzzle, Analysis>();

export function analyze(p: ZipPuzzle): Analysis {
  const hit = analysisCache.get(p);
  if (hit) return hit;
  let out: Analysis;
  const logic = logicSolve(p, 6);
  if (logic.level !== null) out = { count: 1, solution: logic.path, level: logic.level };
  else {
    const r = countSolutions(p, walkOf(p, [board(p).numCell[1]!]), 2);
    out = { count: r.count, solution: r.count === 1 ? r.first : null, level: null };
  }
  analysisCache.set(p, out);
  return out;
}

// --- generation ---

export const LEVEL_NAMES = ["easy", "medium", "hard"] as const;
/** Hardest deduction each difficulty may need. */
export const DIFFICULTY_LEVEL = [4, 5, 6] as const;

function numbered(n: number, path: readonly number[], idx: Iterable<number>): number[] {
  const nums = Array.from({ length: n }, () => 0);
  [...idx].sort((a, b) => a - b).forEach((i, k) => { nums[path[i]!] = k + 1; });
  return nums;
}

function edgeBetween(w: number, h: number, a: number, b: number): number {
  const g = edgeGrid(w, h);
  for (let d = 0; d < 4; d++) if (stepTo(g, a, d) === b) return edgeAt(g, a, d);
  return -1;
}

/**
 * A random path through every cell, every cell numbered (and with walls, some walls off the path),
 * then clues taken away in random order while the deductions up to the difficulty still finish it.
 */
export async function generatePuzzle(o: { w: number; h: number; difficulty: number; walls: boolean }, rng: Rng, ctx: GenerateContext): Promise<ZipPuzzle> {
  const want = DIFFICULTY_LEVEL[o.difficulty]!;
  const n = o.w * o.h;
  const g = edgeGrid(o.w, o.h);
  let fallback: { p: ZipPuzzle; level: number } | null = null;
  for (let attempt = 0; ; attempt++) {
    await ctx.yield();
    const path = randomHamiltonPath(o.w, o.h, rng);
    const used = new Set<number>();
    for (let i = 1; i < n; i++) used.add(edgeBetween(o.w, o.h, path[i - 1]!, path[i]!));
    const idx = new Set(path.map((_, i) => i));
    const walls = new Set<number>();
    if (o.walls) {
      const off = rng.shuffle(Array.from({ length: g.ne }, (_, e) => e).filter((e) => !used.has(e)));
      for (const e of off.slice(0, Math.max(2, Math.round(n / 6)))) walls.add(e);
    }
    const make = (): ZipPuzzle => ({ w: o.w, h: o.h, nums: numbered(n, path, idx), walls: [...walls].sort((a, b) => a - b) });
    const clues = rng.shuffle([...[...idx].filter((i) => i !== 0 && i !== n - 1).map((i) => ({ num: i })), ...[...walls].map((e) => ({ wall: e }))]);
    for (const c of clues) {
      await ctx.yield();
      if ("num" in c) idx.delete(c.num); else walls.delete(c.wall);
      if (logicSolve(make(), want).level === null) {
        if ("num" in c) idx.add(c.num); else walls.add(c.wall);
      }
    }
    const p = make();
    const level = logicSolve(p, want).level!;
    if (level === want) return p;
    if (!fallback || level > fallback.level) fallback = { p, level };
    if (attempt >= 12) return fallback.p;
  }
}
