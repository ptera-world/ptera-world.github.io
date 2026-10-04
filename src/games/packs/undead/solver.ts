import type { Rng } from "../../core/rng";
import type { GenerateContext } from "../../core/types";
import { ALL, EMPTY, GHOST, MIRROR_L, MIRROR_R, VAMPIRE, ZOMBIE, bit, geometry, seen, sightCounts, type Geometry, type UndeadPuzzle, type Visit } from "./grid";

/** Candidate mask per cell (bits from `bit`); 0 on mirrors. */
export type Knowledge = Uint8Array;

export const LEVEL_NAMES = ["easy", "medium", "hard"] as const;
/** 0 easy: sight-count limits and monster totals. 1 medium: + every way to fill one sight line. 2 hard: + one-monster trials. */
export type Level = 0 | 1 | 2;

export type StepKind = "bounds" | "count-full" | "count-needs-all" | "line" | "trial";

export interface Step {
  kind: StepKind;
  level: Level;
  cells: number[];
  /** Candidate bits removed from each of `cells`, in the same order. */
  remove: number[];
  /** The clue whose line forced it (bounds, line). */
  clue?: number;
  /** The monster whose total forced it (count rules) or that was tried (trial). */
  monster?: number;
}

type Emit = (s: Step) => -1 | 0 | 1;
const CONTRA = -1, NONE = 0, MORE = 1;
type RuleResult = typeof CONTRA | typeof NONE | typeof MORE;
type Rule = (p: UndeadPuzzle, g: Geometry, k: Knowledge, emit: Emit) => RuleResult;

const MONSTERS = [GHOST, VAMPIRE, ZOMBIE] as const;
const single = (mask: number): number => (mask === 1 ? GHOST : mask === 2 ? VAMPIRE : mask === 4 ? ZOMBIE : 0);
const popcount = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1);

export function freshKnowledge(p: UndeadPuzzle): Knowledge {
  const k = new Uint8Array(p.w * p.h);
  for (let c = 0; c < k.length; c++) if (p.cells[c] === EMPTY) k[c] = p.given[c] ? bit(p.given[c]!) : ALL;
  return k;
}

/** Removes candidates; false if a cell is left with none. */
export function apply(k: Knowledge, cells: readonly number[], remove: readonly number[]): boolean {
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!;
    k[c] = k[c]! & ~remove[i]!;
    if (k[c] === 0) return false;
  }
  return true;
}

function settle(r: -1 | 0 | 1): RuleResult | null {
  return r === 0 ? null : r < 0 ? CONTRA : MORE;
}

/** Fewest and most sightings a cell can still add to a path. */
function range(vis: Visit, mask: number): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const m of MONSTERS) {
    if (!(mask & bit(m))) continue;
    const s = seen(vis, m);
    if (s < lo) lo = s;
    if (s > hi) hi = s;
  }
  return [lo, hi];
}

const boundsRule: Rule = (p, g, k, emit) => {
  let res: RuleResult = NONE;
  for (let i = 0; i < g.paths.length; i++) {
    const path = g.paths[i]!;
    const clue = p.clues[i]!;
    let lo = 0, hi = 0;
    const r = path.map((vis) => range(vis, k[vis.cell]!));
    for (const [a, b] of r) { lo += a; hi += b; }
    if (clue < lo || clue > hi) return CONTRA;
    const cells: number[] = [], remove: number[] = [];
    for (let j = 0; j < path.length; j++) {
      const vis = path[j]!;
      const mask = k[vis.cell]!;
      if (popcount(mask) < 2) continue;
      const otherLo = lo - r[j]![0], otherHi = hi - r[j]![1];
      for (const m of MONSTERS) {
        if (!(mask & bit(m))) continue;
        const s = seen(vis, m);
        if (s + otherLo <= clue && s + otherHi >= clue) continue;
        if (cells[cells.length - 1] !== vis.cell) { cells.push(vis.cell); remove.push(0); }
        remove[remove.length - 1] = remove[remove.length - 1]! | bit(m);
      }
    }
    if (!cells.length) continue;
    res = MORE;
    const out = settle(emit({ kind: "bounds", level: 0, cells, remove, clue: i }));
    if (out !== null) return out;
  }
  return res;
};

function countRule(kind: "count-full" | "count-needs-all"): Rule {
  return (p, g, k, emit) => {
    let res: RuleResult = NONE;
    for (const m of MONSTERS) {
      const b = bit(m);
      const want = p.counts[m - 1]!;
      let fixed = 0;
      const open: number[] = [];
      for (const c of g.empties) {
        if (k[c] === b) fixed++;
        else if (k[c]! & b) open.push(c);
      }
      if (fixed > want || fixed + open.length < want) return CONTRA;
      if (!open.length) continue;
      if (kind === "count-full" && fixed === want) {
        res = MORE;
        const r = settle(emit({ kind, level: 0, cells: open, remove: open.map(() => b), monster: m }));
        if (r !== null) return r;
      } else if (kind === "count-needs-all" && fixed + open.length === want) {
        res = MORE;
        const r = settle(emit({ kind, level: 0, cells: open, remove: open.map(() => ALL & ~b), monster: m }));
        if (r !== null) return r;
      }
    }
    return res;
  };
}

const countFull = countRule("count-full"), countNeedsAll = countRule("count-needs-all");

/** Largest number of open cells on one line that the line rule will enumerate (3^n fillings). */
const LINE_LIMIT = 9;

const lineRule: Rule = (p, g, k, emit) => {
  let res: RuleResult = NONE;
  const left = [0, 0, 0];
  for (const m of MONSTERS) {
    let fixed = 0;
    for (const c of g.empties) if (k[c] === bit(m)) fixed++;
    left[m - 1] = p.counts[m - 1]! - fixed;
  }
  const used = [0, 0, 0];
  for (let i = 0; i < g.paths.length; i++) {
    const path = g.paths[i]!;
    const open = path.filter((vis) => popcount(k[vis.cell]!) > 1);
    if (open.length < 2 || open.length > LINE_LIMIT) continue;
    let base = 0;
    for (const vis of path) if (popcount(k[vis.cell]!) === 1) base += seen(vis, single(k[vis.cell]!));
    const need = p.clues[i]! - base;
    const support = new Uint8Array(open.length);
    const pick = new Int8Array(open.length);
    const walk = (j: number, sum: number) => {
      if (sum > need) return;
      if (j === open.length) {
        if (sum === need) for (let t = 0; t < open.length; t++) support[t] = support[t]! | bit(pick[t]!);
        return;
      }
      const vis = open[j]!;
      for (const m of MONSTERS) {
        if (!(k[vis.cell]! & bit(m)) || used[m - 1]! >= left[m - 1]!) continue;
        pick[j] = m;
        used[m - 1]!++;
        walk(j + 1, sum + seen(vis, m));
        used[m - 1]!--;
      }
    };
    walk(0, 0);
    const cells: number[] = [], remove: number[] = [];
    for (let t = 0; t < open.length; t++) {
      const vis = open[t]!;
      if (!support[t]) return CONTRA;
      const gone = k[vis.cell]! & ~support[t]!;
      if (!gone) continue;
      cells.push(vis.cell);
      remove.push(gone);
    }
    if (!cells.length) continue;
    res = MORE;
    const r = settle(emit({ kind: "line", level: 1, cells, remove, clue: i }));
    if (r !== null) return r;
  }
  return res;
};

/** Repeats the level-0 (and, if asked, level-1) rules until nothing changes; false on contradiction. */
function close(p: UndeadPuzzle, g: Geometry, k: Knowledge, level: 0 | 1): boolean {
  const rules = level === 0 ? [countFull, countNeedsAll, boundsRule] : [countFull, countNeedsAll, boundsRule, lineRule];
  for (;;) {
    let changed = false;
    for (const rule of rules) {
      const r = rule(p, g, k, (s) => {
        changed = true;
        return apply(k, s.cells, s.remove) ? 0 : -1;
      });
      if (r === CONTRA) return false;
    }
    if (!changed) return true;
  }
}

const trialRule: Rule = (p, g, k, emit) => {
  let res: RuleResult = NONE;
  for (const c of g.empties) {
    if (popcount(k[c]!) < 2) continue;
    for (const m of MONSTERS) {
      if (!(k[c]! & bit(m))) continue;
      const t = k.slice();
      t[c] = bit(m);
      if (close(p, g, t, 1)) continue;
      res = MORE;
      const r = settle(emit({ kind: "trial", level: 2, cells: [c], remove: [bit(m)], monster: m }));
      if (r !== null) return r;
    }
  }
  return res;
};

const RULES: readonly (readonly [Level, Rule])[] = [
  [0, countFull], [0, countNeedsAll], [0, boundsRule],
  [1, lineRule],
  [2, trialRule],
];

const RULE_OF: Record<StepKind, Rule> = {
  bounds: boundsRule,
  "count-full": countFull,
  "count-needs-all": countNeedsAll,
  line: lineRule,
  trial: trialRule,
};

export function propagate(p: UndeadPuzzle, g: Geometry, k: Knowledge, maxLevel: Level): { ok: boolean; used: Level } {
  let used: Level = 0;
  const emit: Emit = (s) => (apply(k, s.cells, s.remove) ? 1 : -1);
  outer: for (;;) {
    for (const [level, rule] of RULES) {
      if (level > maxLevel) break;
      const r = rule(p, g, k, emit);
      if (r === CONTRA) return { ok: false, used };
      if (r === MORE) {
        if (level > used) used = level;
        continue outer;
      }
    }
    return { ok: true, used };
  }
}

export function scanSteps(p: UndeadPuzzle, k: Knowledge, kinds: readonly StepKind[], accept: (s: Step) => boolean): Step | null {
  const g = geometry(p);
  let found: Step | null = null;
  const emit: Emit = (s) => {
    if (!kinds.includes(s.kind) || !accept(s)) return 0;
    found = s;
    return 1;
  };
  for (const rule of new Set(kinds.map((kd) => RULE_OF[kd]))) {
    rule(p, g, k, emit);
    if (found) return found;
  }
  return null;
}

export const isComplete = (g: Geometry, k: Knowledge): boolean => g.empties.every((c) => popcount(k[c]!) === 1);

/** Monster per cell from a complete knowledge (0 on mirrors). */
export const toMonsters = (k: Knowledge): number[] => Array.from(k, single);

export function logicSolve(p: UndeadPuzzle, maxLevel: Level = 2): { level: Level | null; k: Knowledge; ok: boolean } {
  const g = geometry(p);
  const k = freshKnowledge(p);
  const r = propagate(p, g, k, maxLevel);
  return { level: r.ok && isComplete(g, k) ? r.used : null, k, ok: r.ok };
}

export function countSolutions(p: UndeadPuzzle, start: Knowledge, limit = 2): { count: number; first: Knowledge | null } {
  const g = geometry(p);
  const out = { count: 0, first: null as Knowledge | null };
  const search = (k: Knowledge): void => {
    if (!close(p, g, k, 0)) return;
    let pick = -1;
    for (const c of g.empties) {
      const n = popcount(k[c]!);
      if (n > 1 && (pick < 0 || n < popcount(k[pick]!))) pick = c;
    }
    if (pick < 0) {
      out.count++;
      if (!out.first) out.first = k.slice();
      return;
    }
    for (const m of MONSTERS) {
      if (out.count >= limit) return;
      if (!(k[pick]! & bit(m))) continue;
      const t = k.slice();
      t[pick] = bit(m);
      search(t);
    }
  };
  search(start.slice());
  return out;
}

export interface Analysis {
  count: 0 | 1 | 2;
  level: Level | null;
  /** Monster per cell in the (first) solution, 0 on mirrors. */
  solution: number[] | null;
}

const analyses = new WeakMap<UndeadPuzzle, Analysis>();

export function analyze(p: UndeadPuzzle): Analysis {
  const hit = analyses.get(p);
  if (hit) return hit;
  const r = logicSolve(p, 2);
  let a: Analysis;
  if (r.level !== null) a = { count: 1, level: r.level, solution: toMonsters(r.k) };
  else if (!r.ok) a = { count: 0, level: null, solution: null };
  else {
    const c = countSolutions(p, r.k, 2);
    a = { count: c.count as 0 | 1 | 2, level: null, solution: c.first ? toMonsters(c.first) : null };
  }
  analyses.set(p, a);
  return a;
}

// --- generation ---

const EXACT_ATTEMPTS = 40;
const MAX_ATTEMPTS = 6000;

/** A puzzle with clues and counts filled in from a full assignment. */
export function puzzleFrom(w: number, h: number, cells: number[], monsters: number[]): UndeadPuzzle {
  const g = geometry({ w, h, cells });
  const counts: [number, number, number] = [0, 0, 0];
  for (const c of g.empties) counts[monsters[c]! - 1]!++;
  return { w, h, cells, given: cells.map(() => 0), counts, clues: sightCounts(g, monsters) };
}

/**
 * Deterministic in (w, h, level, rng). Mirrors fill about 40% of the board, and monsters are shown only where needed; the result is
 * solvable by logic at `level` (so unique) and needs exactly `level` when one turns up within
 * EXACT_ATTEMPTS solvable boards, otherwise the hardest found is returned.
 */
/**
 * The puzzle with as few monsters shown as it takes to be solvable at `level`: shown at random
 * until it is solvable, then each dropped again if it can be. Null if even showing all fails.
 */
async function withGivens(p: UndeadPuzzle, monsters: readonly number[], level: Level, rng: Rng, ctx: GenerateContext): Promise<UndeadPuzzle | null> {
  const given = p.cells.map(() => 0);
  const at = (lv: Level) => logicSolve({ ...p, given: given.slice() }, lv).level !== null;
  const addLevel = Math.min(level, 1) as Level;
  if (at(level)) return p;
  const order = rng.shuffle(geometry(p).empties.slice());
  let i = 0;
  while (!at(addLevel)) {
    if (i === order.length) return null;
    const c = order[i++]!;
    given[c] = monsters[c]!;
    if (i % 4 === 0) await ctx.yield();
  }
  for (const c of order.slice(0, i)) {
    given[c] = 0;
    if (!at(level)) given[c] = monsters[c]!;
    await ctx.yield();
  }
  return { ...p, given };
}

export async function generatePuzzle(w: number, h: number, level: Level, rng: Rng, ctx: GenerateContext): Promise<UndeadPuzzle> {
  const n = w * h;
  let best: { p: UndeadPuzzle; level: Level } | null = null;
  let solvable = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (best && solvable >= EXACT_ATTEMPTS) break;
    if (attempt % 8 === 0) await ctx.yield();
    const r = rng.fork(`attempt ${attempt}`);
    const cells = Array.from({ length: n }, () => {
      const v = r.int(5);
      return v >= 2 ? EMPTY : v === 0 ? MIRROR_L : MIRROR_R;
    });
    const monsters = cells.filter((v) => v === EMPTY).length;
    if (monsters < Math.min(5, n) || monsters < n * 0.48 || monsters > n * 0.78) continue;
    const mons = cells.map((v) => (v === EMPTY ? r.pick(MONSTERS) : 0));
    const full = puzzleFrom(w, h, cells, mons);
    if (full.counts.filter((x) => x > 0).length < 2) continue;
    const p = await withGivens(full, mons, level, r, ctx);
    if (!p) continue;
    const got = logicSolve(p, level).level;
    if (got === null) continue;
    solvable++;
    if (got === level) return p;
    if (!best || got > best.level) best = { p, level: got };
  }
  if (best) return best.p;
  throw new Error("couldn't make a puzzle with these settings; try a different size");
}
