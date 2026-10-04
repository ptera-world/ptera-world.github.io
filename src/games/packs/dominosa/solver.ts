import type { Rng } from "../../core/rng";
import type { GenerateContext } from "../../core/types";
import { geometry, overlaps, tri, type DominosaPuzzle, type Geometry } from "./grid";

/** Knowledge per placement. A YES implies NO on every placement sharing a cell or a domino with it. */
export const UNK = 0, YES = 1, NO = 2;
export type Knowledge = Int8Array;

export const LEVEL_NAMES = ["easy", "medium", "hard"] as const;
/** 0 easy: only places. 1 medium: + one domino per cell, shared cells, odd areas. 2 hard: + one-placement trials refuted by easy rules. */
export type Level = 0 | 1 | 2;

export type StepKind = "domino-one" | "cell-one" | "cell-domino" | "overlap" | "parity" | "probe";

export interface Step {
  kind: StepKind;
  level: Level;
  placements: number[];
  value: typeof YES | typeof NO;
  /** Cells whose constraint forced this step. */
  because: number[];
  /** The domino the step is about, if any. */
  domino?: number;
}

type Emit = (s: Step) => -1 | 0 | 1;
const CONTRA = -1, NONE = 0, MORE = 1;
type RuleResult = typeof CONTRA | typeof NONE | typeof MORE;
type Rule = (g: Geometry, k: Knowledge, emit: Emit) => RuleResult;

export function freshKnowledge(g: Geometry): Knowledge {
  return new Int8Array(g.np);
}

/** Sets one placement, applying what a YES implies. False on contradiction. */
export function assign(g: Geometry, k: Knowledge, p: number, v: number): boolean {
  if (k[p] === v) return true;
  if (k[p] !== UNK) return false;
  k[p] = v;
  if (v === YES) {
    for (const list of [g.byCell[g.pa[p]!]!, g.byCell[g.pb[p]!]!, g.byDomino[g.pd[p]!]!]) {
      for (const q of list) {
        if (q === p) continue;
        if (k[q] === YES) return false;
        k[q] = NO;
      }
    }
  }
  return true;
}

export function covered(g: Geometry, k: Knowledge, c: number): boolean {
  return g.byCell[c]!.some((p) => k[p] === YES);
}

export function placed(g: Geometry, k: Knowledge, d: number): boolean {
  return g.byDomino[d]!.some((p) => k[p] === YES);
}

const open = (g: Geometry, k: Knowledge, list: readonly number[]) => list.filter((p) => k[p] === UNK);

function settle(r: -1 | 0 | 1): RuleResult | null {
  return r === 0 ? null : r < 0 ? CONTRA : MORE;
}

const dominoOneRule: Rule = (g, k, emit) => {
  let res: RuleResult = NONE;
  for (let d = 0; d < g.nd; d++) {
    if (placed(g, k, d)) continue;
    const c = open(g, k, g.byDomino[d]!);
    if (c.length === 0) return CONTRA;
    if (c.length !== 1) continue;
    res = MORE;
    const r = settle(emit({ kind: "domino-one", level: 0, placements: c, value: YES, because: [g.pa[c[0]!]!, g.pb[c[0]!]!], domino: d }));
    if (r !== null) return r;
  }
  return res;
};

const cellOneRule: Rule = (g, k, emit) => {
  let res: RuleResult = NONE;
  for (let x = 0; x < g.wh; x++) {
    if (covered(g, k, x)) continue;
    const c = open(g, k, g.byCell[x]!);
    if (c.length === 0) return CONTRA;
    if (c.length !== 1) continue;
    res = MORE;
    const r = settle(emit({ kind: "cell-one", level: 0, placements: c, value: YES, because: [x] }));
    if (r !== null) return r;
  }
  return res;
};

const cellDominoRule: Rule = (g, k, emit) => {
  let res: RuleResult = NONE;
  for (let x = 0; x < g.wh; x++) {
    if (covered(g, k, x)) continue;
    const c = open(g, k, g.byCell[x]!);
    if (c.length < 2) continue;
    const d = g.pd[c[0]!]!;
    if (!c.every((p) => g.pd[p] === d)) continue;
    const out = open(g, k, g.byDomino[d]!).filter((p) => !c.includes(p));
    if (!out.length) continue;
    res = MORE;
    const r = settle(emit({ kind: "cell-domino", level: 1, placements: out, value: NO, because: [x], domino: d }));
    if (r !== null) return r;
  }
  return res;
};

const overlapRule: Rule = (g, k, emit) => {
  let res: RuleResult = NONE;
  for (let d = 0; d < g.nd; d++) {
    if (placed(g, k, d)) continue;
    const c = open(g, k, g.byDomino[d]!);
    if (c.length < 2) continue;
    const first = c[0]!;
    const hits: number[] = [];
    for (const cell of [g.pa[first]!, g.pb[first]!]) {
      for (const q of g.byCell[cell]!) {
        if (k[q] !== UNK || g.pd[q] === d || hits.includes(q)) continue;
        if (c.every((p) => overlaps(g, p, q))) hits.push(q);
      }
    }
    if (!hits.length) continue;
    res = MORE;
    const because = [...new Set(c.flatMap((p) => [g.pa[p]!, g.pb[p]!]))];
    const r = settle(emit({ kind: "overlap", level: 1, placements: hits, value: NO, because, domino: d }));
    if (r !== null) return r;
  }
  return res;
};

/**
 * Component sizes of the uncovered cells joined by open placements, skipping cells in `skip`.
 * Returns the component id per cell (-1 for covered or skipped) and each component's size.
 */
function components(g: Geometry, k: Knowledge, skip: readonly number[] = []): { comp: Int32Array; sizes: number[] } {
  const comp = new Int32Array(g.wh).fill(-1);
  const sizes: number[] = [];
  const blocked = new Uint8Array(g.wh);
  for (let x = 0; x < g.wh; x++) if (covered(g, k, x)) blocked[x] = 1;
  for (const x of skip) blocked[x] = 1;
  for (let s = 0; s < g.wh; s++) {
    if (blocked[s] || comp[s] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [s];
    comp[s] = id;
    while (stack.length) {
      const x = stack.pop()!;
      size++;
      for (const p of g.byCell[x]!) {
        if (k[p] !== UNK) continue;
        const y = g.pa[p] === x ? g.pb[p]! : g.pa[p]!;
        if (blocked[y] || comp[y] !== -1) continue;
        comp[y] = id;
        stack.push(y);
      }
    }
    sizes.push(size);
  }
  return { comp, sizes };
}

const parityRule: Rule = (g, k, emit) => {
  const whole = components(g, k);
  if (whole.sizes.some((s) => s % 2 === 1)) return CONTRA;
  let res: RuleResult = NONE;
  for (let p = 0; p < g.np; p++) {
    if (k[p] !== UNK) continue;
    const a = g.pa[p]!, b = g.pb[p]!;
    const { comp, sizes } = components(g, k, [a, b]);
    let pick = -1;
    for (let x = 0; x < g.wh; x++) {
      const id = comp[x]!;
      if (whole.comp[x] !== whole.comp[a] || id < 0 || sizes[id]! % 2 === 0) continue;
      if (pick < 0 || sizes[id]! < sizes[pick]!) pick = id;
    }
    if (pick < 0) continue;
    const odd: number[] = [];
    for (let x = 0; x < g.wh; x++) if (comp[x] === pick) odd.push(x);
    res = MORE;
    const r = settle(emit({ kind: "parity", level: 1, placements: [p], value: NO, because: odd }));
    if (r !== null) return r;
  }
  return res;
};

/** Repeats the level-0 rules until nothing changes; false on contradiction. */
function closeEasy(g: Geometry, k: Knowledge): boolean {
  for (;;) {
    let changed = false;
    for (const rule of [dominoOneRule, cellOneRule]) {
      const r = rule(g, k, (s) => {
        for (const p of s.placements) if (!assign(g, k, p, s.value)) return -1;
        changed = true;
        return 0;
      });
      if (r === CONTRA) return false;
    }
    if (!changed) return true;
  }
}

const probeRule: Rule = (g, k, emit) => {
  let res: RuleResult = NONE;
  for (let p = 0; p < g.np; p++) {
    if (k[p] !== UNK) continue;
    const t = k.slice();
    if (assign(g, t, p, YES) && closeEasy(g, t)) continue;
    res = MORE;
    const r = settle(emit({ kind: "probe", level: 2, placements: [p], value: NO, because: [] }));
    if (r !== null) return r;
  }
  return res;
};

const RULES: readonly (readonly [Level, Rule])[] = [
  [0, dominoOneRule],
  [0, cellOneRule],
  [1, cellDominoRule],
  [1, overlapRule],
  [1, parityRule],
  [2, probeRule],
];

const RULE_OF: Record<StepKind, Rule> = {
  "domino-one": dominoOneRule,
  "cell-one": cellOneRule,
  "cell-domino": cellDominoRule,
  overlap: overlapRule,
  parity: parityRule,
  probe: probeRule,
};

/** Applies every deduction up to maxLevel to k in place, easiest first. `used` is the hardest level applied. */
export function propagate(g: Geometry, k: Knowledge, maxLevel: Level): { ok: boolean; used: Level } {
  let used: Level = 0;
  const emit: Emit = (s) => {
    for (const p of s.placements) if (!assign(g, k, p, s.value)) return -1;
    return 1;
  };
  outer: for (;;) {
    if (!closeEasy(g, k)) return { ok: false, used };
    for (const [level, rule] of RULES) {
      if (level === 0) continue;
      if (level > maxLevel) break;
      const r = rule(g, k, emit);
      if (r === CONTRA) return { ok: false, used };
      if (r === MORE) {
        if (level > used) used = level;
        continue outer;
      }
    }
    return { ok: true, used };
  }
}

/** First step of one of `kinds` (in rule order) that `accept` takes. Reads k without changing it. */
export function scanSteps(g: Geometry, k: Knowledge, kinds: readonly StepKind[], accept: (s: Step) => boolean): Step | null {
  let found: Step | null = null;
  const emit: Emit = (s) => {
    if (!kinds.includes(s.kind) || !accept(s)) return 0;
    found = s;
    return 1;
  };
  for (const rule of new Set(kinds.map((kd) => RULE_OF[kd]))) {
    rule(g, k, emit);
    if (found) return found;
  }
  return null;
}

export function isComplete(g: Geometry, k: Knowledge): boolean {
  for (let x = 0; x < g.wh; x++) if (!covered(g, k, x)) return false;
  return true;
}

export function logicSolve(p: DominosaPuzzle, maxLevel: Level = 2): { level: Level | null; k: Knowledge; ok: boolean } {
  const g = geometry(p);
  const k = freshKnowledge(g);
  const r = propagate(g, k, maxLevel);
  return { level: r.ok && isComplete(g, k) ? r.used : null, k, ok: r.ok };
}

/** Exhaustive search from `start`, counting up to `limit` solutions. */
export function countSolutions(g: Geometry, start: Knowledge, limit = 2): { count: number; first: Knowledge | null } {
  const out = { count: 0, first: null as Knowledge | null };
  const search = (k: Knowledge): void => {
    if (!closeEasy(g, k)) return;
    let pick: number[] | null = null;
    for (let x = 0; x < g.wh; x++) {
      if (covered(g, k, x)) continue;
      const c = open(g, k, g.byCell[x]!);
      if (!pick || c.length < pick.length) pick = c;
      if (pick.length <= 2) break;
    }
    if (!pick) {
      out.count++;
      if (!out.first) out.first = k.slice();
      return;
    }
    for (let i = 0; i < pick.length && out.count < limit; i++) {
      const t = k.slice();
      let ok = true;
      for (let j = 0; j < i && ok; j++) ok = assign(g, t, pick[j]!, NO);
      if (ok && assign(g, t, pick[i]!, YES)) search(t);
    }
  };
  search(start.slice());
  return out;
}

export interface Analysis {
  /** 0 none, 1 unique, 2 several (counting stops at 2). */
  count: 0 | 1 | 2;
  level: Level | null;
  /** 1 = domino per placement for the (first) solution. */
  solution: number[] | null;
}

const analyses = new WeakMap<DominosaPuzzle, Analysis>();

export function analyze(p: DominosaPuzzle): Analysis {
  const hit = analyses.get(p);
  if (hit) return hit;
  const g = geometry(p);
  const toList = (k: Knowledge) => Array.from(k, (v) => (v === YES ? 1 : 0));
  const r = logicSolve(p, 2);
  let a: Analysis;
  if (r.level !== null) a = { count: 1, level: r.level, solution: toList(r.k) };
  else if (!r.ok) a = { count: 0, level: null, solution: null };
  else {
    const c = countSolutions(g, r.k, 2);
    a = { count: c.count as 0 | 1 | 2, level: null, solution: c.first ? toList(c.first) : null };
  }
  analyses.set(p, a);
  return a;
}

// --- generation ---

/** A random domino tiling of w×h (w*h even): partner cell per cell. */
function randomTiling(w: number, h: number, rng: Rng): Int32Array {
  const wh = w * h;
  const partner = new Int32Array(wh).fill(-1);
  const fill = (from: number): boolean => {
    let c = from;
    while (c < wh && partner[c] !== -1) c++;
    if (c === wh) return true;
    const opts: number[] = [];
    if (c % w < w - 1 && partner[c + 1] === -1) opts.push(c + 1);
    if (c + w < wh) opts.push(c + w);
    rng.shuffle(opts);
    for (const o of opts) {
      partner[c] = o;
      partner[o] = c;
      if (fill(c + 1)) return true;
      partner[c] = -1;
      partner[o] = -1;
    }
    return false;
  };
  fill(0);
  return partner;
}

function randomNumbers(n: number, w: number, h: number, rng: Rng): number[] {
  const partner = randomTiling(w, h, rng);
  const pairs: [number, number][] = [];
  for (let a = 0; a <= n; a++) for (let b = a; b <= n; b++) pairs.push([a, b]);
  rng.shuffle(pairs);
  const numbers = Array.from({ length: w * h }, () => -1);
  let i = 0;
  for (let c = 0; c < w * h; c++) {
    if (numbers[c] !== -1) continue;
    const [a, b] = pairs[i++]!;
    const flip = rng.bool();
    numbers[c] = flip ? b : a;
    numbers[partner[c]!] = flip ? a : b;
  }
  return numbers;
}

const EXACT_ATTEMPTS = 60;
const MAX_ATTEMPTS = 4000;

/**
 * Deterministic in (n, level, rng). The result is solvable by logic at `level`, which proves its
 * solution unique; it needs exactly `level` when such a board turns up within EXACT_ATTEMPTS
 * solvable boards, otherwise the hardest found is returned.
 */
export async function generatePuzzle(n: number, level: Level, rng: Rng, ctx: GenerateContext): Promise<DominosaPuzzle> {
  const w = n + 2, h = n + 1;
  let best: { p: DominosaPuzzle; level: Level } | null = null;
  let solvable = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (best && solvable >= EXACT_ATTEMPTS) break;
    await ctx.yield();
    const r = rng.fork(`attempt ${attempt}`);
    const p: DominosaPuzzle = { n, w, h, numbers: randomNumbers(n, w, h, r) };
    const got = logicSolve(p, level).level;
    if (got === null) continue;
    solvable++;
    if (got === level) return p;
    if (!best || got > best.level) best = { p, level: got };
  }
  if (best) return best.p;
  throw new Error("couldn't make a puzzle with these settings; try a different size");
}

/** Every domino exactly once, as a check on a parsed board's number balance. */
export function balanced(p: DominosaPuzzle): boolean {
  const counts = Array.from({ length: p.n + 1 }, () => 0);
  for (const v of p.numbers) counts[v] = (counts[v] ?? 0) + 1;
  return counts.every((c) => c === p.n + 2) && p.numbers.length === p.w * p.h && tri(p.n + 1) * 2 === p.w * p.h;
}

