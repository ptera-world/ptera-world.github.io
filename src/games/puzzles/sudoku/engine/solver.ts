import type { Rng } from "../../../core/rng";
import { bit, digits, isSingle, lowDigit, popcount } from "./bits";
import type { Model } from "./model";

/**
 * Fast exhaustive solver: constraint propagation (peer elimination, hidden singles in full
 * houses, rule propagation to a fixpoint) plus most-constrained-cell branching.
 * Work is bounded by a node budget, never by wall time, so results are deterministic.
 */

export interface SearchState {
  masks: Uint16Array;
  /** 1 once a single-candidate cell has been eliminated from its peers. */
  done: Uint8Array;
}

export interface Budget {
  nodes: number;
  exhausted: boolean;
}

export const budget = (nodes: number): Budget => ({ nodes, exhausted: false });

export function initialState(m: Model, givens: readonly number[], masks?: readonly number[]): SearchState {
  const st: SearchState = { masks: new Uint16Array(m.size), done: new Uint8Array(m.size) };
  for (let c = 0; c < m.size; c++) {
    const g = givens[c] ?? 0;
    st.masks[c] = g > 0 ? bit(g) : (masks?.[c] ?? m.all) & m.all;
  }
  return st;
}

const clone = (st: SearchState): SearchState => ({ masks: st.masks.slice(), done: st.done.slice() });

/**
 * Narrow masks to a fixpoint. `seed` lists cells known to have changed; omit to treat every cell
 * as changed. Returns false on contradiction.
 */
export function propagate(m: Model, st: SearchState, seed?: readonly number[]): boolean {
  const { masks, done } = st;
  const x = scratchOf(m);
  const epoch = ++x.epoch;
  const cellDirty = new Uint8Array(m.size);
  const houseDirty = new Uint8Array(m.houses.length);
  const dirtyCells: number[] = [];
  const stack: number[] = [];
  const touch = (c: number) => {
    if (!cellDirty[c]) {
      cellDirty[c] = 1;
      dirtyCells.push(c);
    }
    for (const h of m.houseOf[c]!) houseDirty[h] = 1;
    if (!done[c] && isSingle(masks[c]!)) stack.push(c);
  };
  if (seed) for (const c of seed) touch(c);
  else for (let c = 0; c < m.size; c++) {
    if (masks[c] === 0) return false;
    touch(c);
  }
  let round = epoch;
  for (;;) {
    while (stack.length) {
      const c = stack.pop()!;
      if (done[c]) continue;
      done[c] = 1;
      const v = masks[c]!;
      for (const p of m.peers[c]!) {
        const pm = masks[p]!;
        if (!(pm & v)) continue;
        const nm = pm & ~v;
        if (!nm) return false;
        masks[p] = nm;
        touch(p);
      }
    }
    for (const h of m.full) {
      if (!houseDirty[h]) continue;
      houseDirty[h] = 0;
      const cells = m.houses[h]!.cells;
      let once = 0, twice = 0, fixed = 0;
      for (const c of cells) {
        const cm = masks[c]!;
        twice |= once & cm;
        once |= cm;
        if (!(cm & (cm - 1))) fixed |= cm;
      }
      if (once !== m.all) return false;
      let uniq = once & ~twice & ~fixed;
      while (uniq) {
        const b = uniq & -uniq;
        uniq ^= b;
        for (const c of cells) {
          if (masks[c]! & b) {
            masks[c] = b;
            touch(c);
            break;
          }
        }
      }
    }
    if (stack.length) continue;
    if (!dirtyCells.length) return true;
    // Rules touching any changed cell, each once per round.
    round = ++x.epoch;
    const todo: number[] = [];
    for (const c of dirtyCells) {
      cellDirty[c] = 0;
      for (const r of m.rulesOf[c]!) if (x.mark[r] !== round) {
        x.mark[r] = round;
        todo.push(r);
      }
    }
    dirtyCells.length = 0;
    const buf = x.buf;
    for (const ri of todo) {
      const r = m.rules[ri]!;
      const cells = r.cells;
      buf.length = cells.length;
      for (let i = 0; i < cells.length; i++) buf[i] = masks[cells[i]!]!;
      if (!r.propagate(buf)) return false;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]!;
        if (masks[c] !== buf[i]) {
          masks[c] = buf[i]!;
          touch(c);
        }
      }
    }
    if (!stack.length && !dirtyCells.length && !m.full.some((h) => houseDirty[h])) return true;
  }
}

interface Scratch {
  epoch: number;
  mark: Int32Array;
  buf: number[];
}

const scratches = new WeakMap<Model, Scratch>();

function scratchOf(m: Model): Scratch {
  let x = scratches.get(m);
  if (!x) {
    x = { epoch: 0, mark: new Int32Array(m.rules.length), buf: [] };
    scratches.set(m, x);
  }
  return x;
}

function pickCell(m: Model, masks: Uint16Array): number {
  let best = -1, bestCount = 99;
  for (let c = 0; c < m.size; c++) {
    const k = popcount(masks[c]!);
    if (k > 1 && k < bestCount) {
      best = c;
      bestCount = k;
      if (k === 2) break;
    }
  }
  return best;
}

function search(m: Model, st: SearchState, limit: number, b: Budget, rng: Rng | null, out: number[][]): void {
  if (b.nodes-- <= 0) {
    b.exhausted = true;
    return;
  }
  const c = pickCell(m, st.masks);
  if (c < 0) {
    out.push(Array.from(st.masks, lowDigit));
    return;
  }
  const opts = digits(st.masks[c]!);
  if (rng) rng.shuffle(opts);
  for (const d of opts) {
    const next = clone(st);
    next.masks[c] = bit(d);
    if (propagate(m, next, [c])) search(m, next, limit, b, rng, out);
    if (out.length >= limit || b.exhausted) return;
  }
}

export interface SolveResult {
  solutions: number[][];
  /** False if the budget ran out before the search finished (counts are then lower bounds). */
  complete: boolean;
}

export interface SolveOptions {
  limit?: number;
  budget?: number;
  /** Randomize branching order (for generating random solutions). */
  rng?: Rng;
  /** Starting candidate masks for empty cells (default: all digits). */
  masks?: readonly number[];
}

export function solve(m: Model, givens: readonly number[], o: SolveOptions = {}): SolveResult {
  const st = initialState(m, givens, o.masks);
  const out: number[][] = [];
  const b = budget(o.budget ?? 200_000);
  if (propagate(m, st)) search(m, st, o.limit ?? 2, b, o.rng ?? null, out);
  return { solutions: out, complete: !b.exhausted };
}

/** 1 if unique, 0 if none, 2 if several, -1 if undecided within budget. */
export function uniqueness(m: Model, givens: readonly number[], nodes = 20_000): -1 | 0 | 1 | 2 {
  const r = solve(m, givens, { limit: 2, budget: nodes });
  if (r.solutions.length >= 2) return 2;
  if (!r.complete) return -1;
  return r.solutions.length as 0 | 1;
}
