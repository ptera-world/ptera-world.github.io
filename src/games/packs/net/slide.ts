/**
 * Net with sliding rows and columns instead of turning tiles (Simon Tatham's Netslide): the pieces
 * keep their shape, whole lines slide round, and the middle row and column never move.
 */

import type { Rng } from "../../core/rng";
import { nextStep, solveAll, type PermMove, type PermSpec, type PermStep } from "../../lib/perm";
import { describeShift } from "../../lib/shift-names";
import { D, DIRS, R, centre, connectedFrom, degree, neighbour, normalizeBarriers, opp, type Geometry, type NetPuzzle } from "./grid";

/** Slide a row (positive = right) or column (positive = down) round. */
export type ShiftAction = { type: "shift"; line: "row" | "col"; index: number; by: number };

export interface SlideFocus {
  moving?: number[];
  home?: number;
  tile?: number;
}

export function shift(w: number, h: number, tiles: readonly number[], a: ShiftAction): number[] {
  const out = tiles.slice();
  if (a.line === "row") {
    for (let x = 0; x < w; x++) out[a.index * w + ((((x + a.by) % w) + w) % w)] = tiles[a.index * w + x]!;
  } else {
    for (let y = 0; y < h; y++) out[((((y + a.by) % h) + h) % h) * w + a.index] = tiles[y * w + a.index]!;
  }
  return out;
}

/** The line is on the board and isn't the middle row or column. */
export function movable(p: Pick<NetPuzzle, "w" | "h">, a: Pick<ShiftAction, "line" | "index">): boolean {
  const c = centre({ ...p, wrap: false });
  return a.line === "row" ? a.index >= 0 && a.index < p.h && a.index !== Math.floor(c / p.w) : a.index >= 0 && a.index < p.w && a.index !== c % p.w;
}

export function shiftOk(p: NetPuzzle, a: ShiftAction): boolean {
  if (!Number.isInteger(a.by) || !movable(p, a)) return false;
  return a.by % (a.line === "row" ? p.w : p.h) !== 0;
}

/** Everything joins the middle tile through matching ends that no barrier blocks. */
export const allJoined = (p: NetPuzzle, tiles: readonly number[]): boolean => connectedFrom(p, tiles, centre(p)).count === p.w * p.h;

// --- generation ---

/** A random spanning tree grown from the middle with no four-way crossings. */
function growTree(g: Geometry, rng: Rng): number[] {
  const n = g.w * g.h;
  const tiles = Array.from({ length: n }, () => 0);
  type Poss = { i: number; d: number };
  let poss: Poss[] = [];
  const start = centre(g);
  for (const d of DIRS) if (neighbour({ ...g, wrap: false }, start, d) >= 0) poss.push({ i: start, d });
  while (poss.length) {
    const { i, d } = poss.splice(rng.int(poss.length), 1)[0]!;
    const j = neighbour(g, i, d);
    tiles[i]! |= d;
    tiles[j]! |= opp(d);
    if (degree(tiles[i]!) === 3) poss = poss.filter((q) => !(q.i === i && q.d === (15 ^ tiles[i]!)));
    poss = poss.filter((q) => neighbour(g, q.i, q.d) !== j);
    for (const e of DIRS) {
      if (e === opp(d)) continue;
      const k = neighbour(g, j, e);
      if (k < 0 || k === j || tiles[k]) continue;
      poss.push({ i: j, d: e });
    }
  }
  return tiles;
}

export interface SlideSetup {
  width: number;
  height: number;
  wrap: boolean;
  /** Percent of the edges the solution doesn't use that get a wall. */
  barriers: number;
  /** Random slides; 0 for (w-1)(h-1)·2. */
  shuffle: number;
}

export function generateSlide(v: SlideSetup, rng: Rng): NetPuzzle {
  const g: Geometry = { w: v.width, h: v.height, wrap: v.wrap };
  if (g.w < 3 || g.h < 3) throw new Error("sliding needs at least 3 tiles each way: the middle row and column never move");
  const solution = growTree(g, rng.fork("tree"));
  const c = centre(g), cx = c % g.w, cy = Math.floor(c / g.w);
  const total = v.shuffle || (g.w - 1) * (g.h - 1) * 2;
  const mix = rng.fork("shuffle");
  const open: NetPuzzle = { ...g, tiles: solution, barriers: solution.map(() => 0), source: c };
  let tiles = solution;
  for (let attempt = 0; attempt < 20; attempt++) {
    tiles = solution;
    let prev: ShiftAction | null = null, repeats = 0;
    for (let i = 0; i < total;) {
      const col = mix.bool();
      let index = mix.int(col ? g.w - 1 : g.h - 1);
      if (index >= (col ? cx : cy)) index++;
      const a: ShiftAction = { type: "shift", line: col ? "col" : "row", index, by: mix.bool() ? 1 : -1 };
      const len = col ? g.h : g.w;
      if (prev && prev.line === a.line && prev.index === a.index) {
        if (prev.by === -a.by) continue;
        if ((repeats + 1) * 2 > len) continue;
      }
      repeats = prev && prev.line === a.line && prev.index === a.index ? repeats + 1 : 1;
      tiles = shift(g.w, g.h, tiles, a);
      prev = a;
      i++;
    }
    if (!allJoined(open, tiles)) break;
  }
  const edges: { i: number; d: number }[] = [];
  for (let i = 0; i < g.w * g.h; i++) {
    for (const d of [R, D]) {
      if (solution[i]! & d) continue;
      if (neighbour(g, i, d) < 0) continue;
      edges.push({ i, d });
    }
  }
  const bar = rng.fork("barriers");
  bar.shuffle(edges);
  const raw = Array.from({ length: g.w * g.h }, () => 0);
  for (const { i, d } of edges.slice(0, Math.floor((v.barriers / 100) * edges.length))) raw[i]! |= d;
  const p: NetPuzzle = { ...g, tiles, barriers: normalizeBarriers(g, raw), source: c, slide: true, solution };
  if (allJoined(p, tiles)) p.tiles = shift(g.w, g.h, tiles, { type: "shift", line: "row", index: cy === 0 ? 1 : 0, by: 1 });
  return p;
}

// --- an arrangement for boards that don't carry one ---

const NODE_BUDGET = 400_000;

/** Some finished arrangement of the board's own tiles (the middle stays put), or null if none is found. */
export function findArrangement(p: NetPuzzle): number[] | null {
  const n = p.w * p.h;
  const c0 = centre(p);
  const counts = new Map<number, number>();
  p.tiles.forEach((t, i) => { if (i !== c0) counts.set(t, (counts.get(t) ?? 0) + 1); });
  const types = [...counts.keys()];
  const order: number[] = [c0];
  const seen = new Uint8Array(n);
  seen[c0] = 1;
  for (let k = 0; k < order.length; k++) {
    for (const d of DIRS) {
      const j = neighbour(p, order[k]!, d);
      if (j >= 0 && !seen[j]) { seen[j] = 1; order.push(j); }
    }
  }
  const out = Array.from({ length: n }, () => -1);
  out[c0] = p.tiles[c0]!;
  let nodes = 0;
  const fits = (i: number, t: number): boolean => {
    for (const d of DIRS) {
      const has = (t & d) !== 0;
      const j = neighbour(p, i, d);
      if (j < 0 || p.barriers[i]! & d) { if (has) return false; continue; }
      const other = out[j]!;
      if (other >= 0 && has !== ((other & opp(d)) !== 0)) return false;
    }
    return true;
  };
  if (!fits(c0, out[c0]!)) return null;
  /** Every empty neighbor of i can still take some remaining tile. */
  const forward = (i: number): boolean => {
    for (const d of DIRS) {
      const j = neighbour(p, i, d);
      if (j < 0 || out[j]! >= 0) continue;
      if (!types.some((t) => counts.get(t)! > 0 && fits(j, t))) return false;
    }
    return true;
  };
  /** Joining i to the placed pieces makes no loop, and doesn't close off a network that misses cells. */
  const shapeOk = (i: number): boolean => {
    const comp = new Int32Array(n).fill(-1);
    comp[i] = 0;
    const stack = [i];
    let size = 0, open = false;
    const via = new Int32Array(n).fill(-1);
    while (stack.length) {
      const a = stack.pop()!;
      size++;
      for (const d of DIRS) {
        if (!(out[a]! & d)) continue;
        const b = neighbour(p, a, d);
        if (b < 0) continue;
        if (out[b]! < 0) { open = true; continue; }
        if (b === via[a]) continue;
        if (comp[b] === 0) return false;
        comp[b] = 0;
        via[b] = a;
        stack.push(b);
      }
    }
    return open || size === n;
  };
  const place = (k: number): boolean => {
    if (k === order.length) return allJoined(p, out);
    if (++nodes > NODE_BUDGET) return false;
    const i = order[k]!;
    for (const t of types) {
      const left = counts.get(t)!;
      if (!left || !fits(i, t)) continue;
      counts.set(t, left - 1);
      out[i] = t;
      if (shapeOk(i) && forward(i) && place(k + 1)) return true;
      out[i] = -1;
      counts.set(t, left);
    }
    return false;
  };
  return place(1) ? out : null;
}

const targets = new WeakMap<NetPuzzle, number[] | null>();
export function target(p: NetPuzzle): number[] | null {
  if (p.solution) return p.solution;
  if (!targets.has(p)) targets.set(p, findArrangement(p));
  return targets.get(p)!;
}

// --- hint engine ---

const specs = new Map<string, PermSpec<ShiftAction>>();

export function slideSpec(p: Pick<NetPuzzle, "w" | "h">): PermSpec<ShiftAction> {
  const key = `netslide:${p.w}x${p.h}`;
  let s = specs.get(key);
  if (s) return s;
  const n = p.w * p.h;
  const ids = Array.from({ length: n }, (_, i) => i);
  const moves: PermMove<ShiftAction>[] = [];
  const add = (a: ShiftAction) => {
    if (!movable(p, a)) return;
    const after = shift(p.w, p.h, ids, a);
    const to = new Int32Array(n);
    after.forEach((from, cell) => { to[from] = cell; });
    moves.push({ action: a, to, turn: null });
  };
  for (let y = 0; y < p.h; y++) for (const by of [1, -1]) add({ type: "shift", line: "row", index: y, by });
  for (let x = 0; x < p.w; x++) for (const by of [1, -1]) add({ type: "shift", line: "col", index: x, by });
  const c = centre({ ...p, wrap: false });
  s = { key, n, turns: 1, moves, order: ids.filter((i) => i !== c), distinct: false, endgame: 8 };
  specs.set(key, s);
  return s;
}

const stepCache = new WeakMap<readonly number[], PermStep<ShiftAction> | null>();
export function slideHint(p: NetPuzzle, tiles: readonly number[]): PermStep<ShiftAction> | null {
  if (stepCache.has(tiles)) return stepCache.get(tiles)!;
  const goal = target(p);
  const st = goal ? nextStep(slideSpec(p), goal, { values: tiles }) : null;
  stepCache.set(tiles, st);
  return st;
}

export function slideSolve(p: NetPuzzle, tiles: readonly number[]): ShiftAction[] | null {
  const goal = target(p);
  return goal ? solveAll(slideSpec(p), goal, { values: tiles }) : null;
}

export { describeShift };
