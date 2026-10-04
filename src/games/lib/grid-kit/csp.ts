/**
 * Finite-domain deduction engine shared by grid puzzles. Every variable holds a bitmask of the
 * values it can still take (bit v set = value v possible); deductions only ever narrow masks.
 *
 * Deductions carry a level. Solving exhausts level 0 before any level-1 deduction is used, and so
 * on, so the highest level a solve needed is the least that solves the puzzle with these rules.
 */
export type Doms = Int32Array;

export const bit = (v: number): number => 1 << v;
export const isSingle = (m: number): boolean => m !== 0 && (m & (m - 1)) === 0;
/** The value of a single-value mask. */
export const valueOf = (m: number): number => 31 - Math.clz32(m);
export function popcount(m: number): number {
  let c = 0;
  for (; m; m &= m - 1) c++;
  return c;
}
/** Values in a mask, ascending. */
export function valuesOf(m: number): number[] {
  const out: number[] = [];
  for (let v = 0; m >> v; v++) if ((m >> v) & 1) out.push(v);
  return out;
}

export interface Deduction {
  /** Which rule found it; techniques select deductions by kind. */
  kind: string;
  level: number;
  /** Variables narrowed. */
  vars: number[];
  /** Each of `vars` keeps only these values. */
  keep: number;
  /** Puzzle-specific places (cells, clues, lines) that force the deduction. */
  because: number[];
  /** Puzzle-specific places the explanation also mentions. */
  related?: number[];
  /** Rule-specific detail for explanations. */
  data?: Record<string, unknown>;
}

/** Receives each deduction a rule finds. Returning true stops the rule's scan. */
export type Emit = (d: Deduction) => boolean;

/**
 * Local check over a fixed set of variables, re-run whenever one of them narrows. Reads `k`
 * only; reports through `emit`. Returns false iff `k` already breaks it. An emit may narrow `k`
 * at once, so each deduction must come from one consistent view: `k` as it is when emitted, or
 * a copy taken before the first emit. Mixing values read before and after an emit is unsound.
 */
export interface Constraint {
  vars: readonly number[];
  run(k: Doms, emit: Emit): boolean;
}

/** Whole-board scan, run once local constraints settle. Same contract as Constraint.run. */
export interface Rule {
  level: number;
  /** Deduction kinds it can emit; scans for other kinds skip it. */
  kinds?: readonly string[];
  run(k: Doms, emit: Emit): boolean;
}

export interface Model {
  /** Variable count. */
  n: number;
  constraints: Constraint[];
  rules: Rule[];
  /** Accepts a fully decided assignment; for conditions the propagators only partly enforce. */
  complete?(k: Doms): boolean;
  /** Highest level used while counting solutions. */
  countLevel?: number;
  /**
   * True once what's known finishes the puzzle for a player (e.g. every black found, even if
   * some whites are still unproven). Difficulty is the level needed to get here. Default: every
   * variable decided.
   */
  done?(k: Doms): boolean;
}

const watchCache = new WeakMap<Model, number[][]>();

function watchers(m: Model): number[][] {
  let w = watchCache.get(m);
  if (w) return w;
  w = Array.from({ length: m.n }, () => []);
  m.constraints.forEach((c, i) => {
    for (const v of c.vars) w![v]!.push(i);
  });
  watchCache.set(m, w);
  return w;
}

/** Narrows `k` by `d`, appending changed variables. False if a variable runs out of values. */
export function narrow(k: Doms, d: Deduction, changed?: number[]): boolean {
  for (const v of d.vars) {
    const next = k[v]! & d.keep;
    if (next === k[v]) continue;
    k[v] = next;
    changed?.push(v);
    if (next === 0) return false;
  }
  return true;
}

/** Local constraints' deductions up to `level` to a fixpoint, starting from those watching `dirty` (null: all). */
function closure(m: Model, k: Doms, dirty: readonly number[] | null, level = 0): boolean {
  const w = watchers(m);
  const queued = new Uint8Array(m.constraints.length);
  const queue: number[] = [];
  const push = (ci: number) => {
    if (!queued[ci]) {
      queued[ci] = 1;
      queue.push(ci);
    }
  };
  const touch = (v: number) => {
    for (const ci of w[v]!) push(ci);
  };
  if (dirty) dirty.forEach(touch);
  else for (let i = 0; i < m.constraints.length; i++) push(i);
  const changed: number[] = [];
  let bad = false;
  const emit: Emit = (d) => {
    if (d.level > level) return false;
    if (!narrow(k, d, changed)) bad = true;
    return bad;
  };
  while (queue.length) {
    const ci = queue.pop()!;
    queued[ci] = 0;
    changed.length = 0;
    if (!m.constraints[ci]!.run(k, emit) || bad) return false;
    changed.forEach(touch);
  }
  return true;
}

/** Everything up to `level` to a fixpoint: local constraints, then rules, until nothing changes. */
function settle(m: Model, k: Doms, dirty: readonly number[] | null, level = 0): boolean {
  if (!closure(m, k, dirty, level)) return false;
  for (;;) {
    const changed: number[] = [];
    let bad = false;
    const emit: Emit = (d) => {
      if (d.level > level) return false;
      if (!narrow(k, d, changed)) bad = true;
      return bad;
    };
    for (const r of m.rules) {
      if (r.level > level) continue;
      if (!r.run(k, emit) || bad) return false;
      if (changed.length) break;
    }
    if (!changed.length) return true;
    if (!closure(m, k, changed, level)) return false;
  }
}

/**
 * Applies every deduction up to `level` to `k` in place, in no particular order (no difficulty
 * accounting). `dirty` names the variables changed since `k` was last saturated at this level;
 * null rechecks everything. False iff a contradiction was found.
 */
export const saturate = (m: Model, k: Doms, level: number, dirty: readonly number[] | null = null): boolean => settle(m, k, dirty, level);

/** Applies the first deduction of level ≤ `level` anywhere; null if none, else what changed. */
function stepAt(m: Model, k: Doms, level: number): { ok: boolean; changed: number[] } | null {
  const changed: number[] = [];
  let found = false, ok = true;
  const emit: Emit = (d) => {
    if (d.level > level) return false;
    const before = changed.length;
    ok = narrow(k, d, changed);
    if (changed.length === before && ok) return false;
    found = true;
    return true;
  };
  for (const c of m.constraints) {
    if (!c.run(k, emit)) return { ok: false, changed };
    if (found) return { ok, changed };
  }
  for (const r of m.rules) {
    if (r.level === 0 || r.level > level) continue;
    if (!r.run(k, emit)) return { ok: false, changed };
    if (found) return { ok, changed };
  }
  return null;
}

export interface Propagated {
  /** False iff a contradiction was found, so `k` has no completion. */
  ok: boolean;
  /** Highest level any applied deduction needed. */
  used: number;
}

/**
 * Applies every deduction up to `maxLevel` to `k` in place, easiest first. With `until`, stops
 * reaching for harder deductions once it holds (level-0 ones still run to a fixpoint).
 */
export function propagate(m: Model, k: Doms, maxLevel: number, until?: (k: Doms) => boolean): Propagated {
  let used = 0;
  if (!settle(m, k, null)) return { ok: false, used };
  outer: for (;;) {
    if (until?.(k)) return { ok: true, used };
    for (let level = 1; level <= maxLevel; level++) {
      const r = stepAt(m, k, level);
      if (!r) continue;
      if (!r.ok) return { ok: false, used };
      if (level > used) used = level;
      if (!settle(m, k, r.changed)) return { ok: false, used };
      continue outer;
    }
    return { ok: true, used };
  }
}

export const isDecided = (k: Doms): boolean => k.every(isSingle);

/**
 * "Try it": a value that leads to a contradiction under rules up to `base` is ruled out.
 * Variables are tried in index order, values ascending.
 */
export function trialRule(m: Model, level: number, base: number, kind = "trial"): Rule {
  return {
    level,
    kinds: [kind],
    run(k, emit) {
      const s = k.slice();
      if (!saturate(m, s, base)) return false;
      for (let v = 0; v < m.n; v++) {
        if (isSingle(s[v]!)) continue;
        for (const x of valuesOf(s[v]!)) {
          const t = s.slice();
          t[v] = bit(x);
          if (saturate(m, t, base, [v])) continue;
          if (emit({ kind, level, vars: [v], keep: k[v]! & ~bit(x), because: [], data: { var: v, value: x } })) return true;
        }
      }
      return true;
    },
  };
}

/**
 * First deduction `accept` takes, scanning constraints then rules in order. Never changes `k`.
 * Rules declaring kinds none of which are in `kinds` are skipped.
 */
export function scan(m: Model, k: Doms, accept: (d: Deduction) => boolean, kinds?: readonly string[]): Deduction | null {
  let found: Deduction | null = null;
  const emit: Emit = (d) => {
    if (!accept(d)) return false;
    found = d;
    return true;
  };
  for (const c of m.constraints) {
    c.run(k, emit);
    if (found) return found;
  }
  for (const r of m.rules) {
    if (kinds && r.kinds && !r.kinds.some((x) => kinds.includes(x))) continue;
    r.run(k, emit);
    if (found) return found;
  }
  return null;
}

/** Exhaustive search from `start`, counting solutions up to `limit`; `first` is the first found. */
export function countSolutions(m: Model, start: Doms, limit = 2): { count: number; first: Doms | null } {
  const out = { count: 0, first: null as Doms | null };
  const level = m.countLevel ?? 0;
  const search = (k: Doms, dirty: number[] | null): void => {
    if (out.count >= limit || !saturate(m, k, level, dirty)) return;
    let pick = -1, best = 99;
    for (let v = 0; v < m.n; v++) {
      const c = popcount(k[v]!);
      if (c > 1 && c < best) {
        best = c;
        pick = v;
        if (c === 2) break;
      }
    }
    if (pick < 0) {
      if (m.complete && !m.complete(k)) return;
      out.count++;
      out.first ??= k.slice();
      return;
    }
    for (const x of valuesOf(k[pick]!)) {
      const t = k.slice();
      t[pick] = bit(x);
      search(t, [pick]);
    }
  };
  search(start.slice(), null);
  return out;
}

export interface Analysis {
  /** 0 none, 1 unique, 2 several (counting stops at 2). */
  count: 0 | 1 | 2;
  /** With a unique solution: least level at which logic alone finishes it (see Model.done), or null. */
  level: number | null;
  /** Decided value per variable for the (first) solution, or null if none. */
  solution: number[] | null;
}

/** Solution count and the first solution: logic first (proof when it decides everything), exhaustive search otherwise. */
function solutions(m: Model, start: Doms, maxLevel: number): { count: 0 | 1 | 2; first: Doms | null } {
  const k = start.slice();
  const r = propagate(m, k, maxLevel);
  if (!r.ok) return { count: 0, first: null };
  if (isDecided(k)) return !m.complete || m.complete(k) ? { count: 1, first: k } : { count: 0, first: null };
  const c = countSolutions(m, k, 2);
  return { count: c.count as 0 | 1 | 2, first: c.first };
}

export function analyzeModel(m: Model, start: Doms, maxLevel: number): Analysis {
  const s = solutions(m, start, maxLevel);
  return {
    count: s.count,
    level: s.count === 1 ? solveLevel(m, start, maxLevel) : null,
    solution: s.first ? Array.from(s.first, valueOf) : null,
  };
}

export const isUnique = (m: Model, start: Doms, maxLevel: number): boolean => solutions(m, start, maxLevel).count === 1;

/** Least level ≤ maxLevel at which logic alone finishes the puzzle (see Model.done), or null. */
export function solveLevel(m: Model, start: Doms, maxLevel: number): number | null {
  const k = start.slice();
  const finished = m.done ?? isDecided;
  const r = propagate(m, k, maxLevel, finished);
  if (!r.ok || !finished(k)) return null;
  return m.done || !m.complete || m.complete(k) ? r.used : null;
}

/** Deductions up to `level` decide every variable (so the solution is unique), in no particular order. */
export function decides(m: Model, start: Doms, level: number): boolean {
  const k = start.slice();
  return saturate(m, k, level) && isDecided(k) && (!m.complete || m.complete(k));
}

/**
 * Least level ≤ maxLevel at which logic finishes the puzzle (see Model.done), found by saturating
 * at each level in turn. Same answer as solveLevel, without step-by-step bookkeeping.
 */
export function levelNeeded(m: Model, start: Doms, maxLevel: number): number | null {
  const finished = m.done ?? isDecided;
  for (let level = 0; level <= maxLevel; level++) {
    const k = start.slice();
    if (!saturate(m, k, level)) return null;
    if (finished(k) && (m.done || !m.complete || m.complete(k))) return level;
  }
  return null;
}

/** How many variables deductions up to `level` decide from `start` (in no particular order); -1 on a contradiction. */
export function decidedBy(m: Model, start: Doms, level: number): number {
  const k = start.slice();
  if (!saturate(m, k, level)) return -1;
  let count = 0;
  for (const v of k) if (isSingle(v)) count++;
  return count;
}
