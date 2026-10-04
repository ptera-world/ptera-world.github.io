import type { Rng } from "../../core/rng";
import type { GenerateContext } from "../../core/types";
import { DX, DY, chains, directionTo, geometry, type Chains, type Geometry, type SignpostPuzzle } from "./grid";

/** Known links: next/prev per cell, -1 where unknown. */
export interface Knowledge {
  next: Int32Array;
  prev: Int32Array;
}

export const LEVEL_NAMES = ["easy", "medium", "hard"] as const;
/** 0 easy: consecutive numbers, only successor/predecessor by simple checks. 1 medium: + numbers that would clash further along. 2 hard: + trying each option. */
export type Level = 0 | 1 | 2;

export type StepKind = "consecutive" | "only-next" | "only-prev" | "fit-next" | "fit-prev" | "trial-next" | "trial-prev";

export interface Step {
  kind: StepKind;
  level: Level;
  from: number;
  to: number;
  /** Cells the step reasons about: the other options it rules out. */
  ruled: number[];
}

type Emit = (s: Step) => -1 | 0 | 1;
const CONTRA = -1, NONE = 0, MORE = 1;
type RuleResult = typeof CONTRA | typeof NONE | typeof MORE;
type Rule = (g: Geometry, k: Knowledge, emit: Emit) => RuleResult;

export function freshKnowledge(g: Geometry): Knowledge {
  return { next: new Int32Array(g.n).fill(-1), prev: new Int32Array(g.n).fill(-1) };
}

export const copyKnowledge = (k: Knowledge): Knowledge => ({ next: k.next.slice(), prev: k.prev.slice() });

/** Links a→b. False if either end already links elsewhere or it closes a loop. */
export function link(k: Knowledge, a: number, b: number): boolean {
  if (k.next[a] === b && k.prev[b] === a) return true;
  if (k.next[a] !== -1 || k.prev[b] !== -1) return false;
  for (let x = b; x !== -1; x = k.next[x]!) if (x === a) return false;
  k.next[a] = b;
  k.prev[b] = a;
  return true;
}

interface View {
  ch: Chains;
  /** Cell holding each number (from givens or numbered chains), -1 if none. */
  holder: Int32Array;
  ok: boolean;
}

/** Chains, numbers and whether the numbering is consistent (no clashing or out-of-range numbers). */
export function look(g: Geometry, k: Knowledge): View {
  const ch = chains(g, k.next, k.prev);
  const holder = new Int32Array(g.n + 2).fill(-1);
  let ok = true;
  for (let c = 0; c < g.n; c++) {
    if (ch.head[c] === -1) { ok = false; continue; }
    const v = ch.num[c]!;
    if (!v) continue;
    if (v < 1 || v > g.n || (g.nums[c]! > 0 && g.nums[c] !== v)) { ok = false; continue; }
    if (holder[v] !== -1) ok = false;
    holder[v] = c;
  }
  return { ch, holder, ok };
}

/** Whether a→b is still possible, by the simple checks (level 0) or also checking numbers further along (level 1). */
export function valid(g: Geometry, k: Knowledge, v: View, a: number, b: number, level: Level): boolean {
  if (k.next[a] !== -1 || k.prev[b] !== -1 || a === g.last || b === g.first) return false;
  const { ch } = v;
  if (ch.head[a] === ch.head[b]) return false;
  const na = ch.num[a]!, nb = ch.num[b]!;
  const lenB = ch.length[b]!, lenA = ch.length[ch.head[a]!]!;
  if (na && nb) return nb === na + 1;
  if (na) {
    if (na + lenB > g.n) return false;
    if (level >= 1) for (let i = 1; i <= lenB; i++) if (v.holder[na + i] !== -1) return false;
    return true;
  }
  if (nb) {
    if (nb - lenA < 1) return false;
    if (level >= 1) for (let i = 1; i <= lenA; i++) if (v.holder[nb - i] !== -1) return false;
    return true;
  }
  return true;
}

function settle(r: -1 | 0 | 1): RuleResult | null {
  return r === 0 ? null : r < 0 ? CONTRA : MORE;
}

const consecutiveRule: Rule = (g, k, emit) => {
  const v = look(g, k);
  if (!v.ok) return CONTRA;
  let res: RuleResult = NONE;
  for (let n = 1; n < g.n; n++) {
    const a = v.holder[n]!, b = v.holder[n + 1]!;
    if (a < 0 || b < 0 || k.next[a] === b) continue;
    if (k.next[a] !== -1 || !g.ray[a]!.includes(b) || !valid(g, k, v, a, b, 0)) return CONTRA;
    res = MORE;
    const r = settle(emit({ kind: "consecutive", level: 0, from: a, to: b, ruled: [] }));
    if (r !== null) return r;
  }
  return res;
};

function onlyRule(level: 0 | 1, dir: "next" | "prev"): Rule {
  const kind: StepKind = level === 0 ? (dir === "next" ? "only-next" : "only-prev") : (dir === "next" ? "fit-next" : "fit-prev");
  return (g, k, emit) => {
    const v = look(g, k);
    if (!v.ok) return CONTRA;
    let res: RuleResult = NONE;
    for (let c = 0; c < g.n; c++) {
      if (dir === "next" ? k.next[c] !== -1 || c === g.last : k.prev[c] !== -1 || c === g.first) continue;
      const opts = dir === "next" ? g.ray[c]! : g.from[c]!;
      const ok = opts.filter((o) => (dir === "next" ? valid(g, k, v, c, o, level) : valid(g, k, v, o, c, level)));
      if (ok.length === 0) return CONTRA;
      if (ok.length !== 1) continue;
      if (level === 1) {
        const easy = opts.filter((o) => (dir === "next" ? valid(g, k, v, c, o, 0) : valid(g, k, v, o, c, 0)));
        if (easy.length === 1) continue;
      }
      const o = ok[0]!;
      res = MORE;
      const ruled = opts.filter((x) => x !== o);
      const r = settle(emit(dir === "next" ? { kind, level, from: c, to: o, ruled } : { kind, level, from: o, to: c, ruled }));
      if (r !== null) return r;
    }
    return res;
  };
}

const onlyNext = onlyRule(0, "next"), onlyPrev = onlyRule(0, "prev");
const fitNext = onlyRule(1, "next"), fitPrev = onlyRule(1, "prev");

/** Repeats the level ≤ 1 rules until nothing changes; false on contradiction. */
function closeTo(g: Geometry, k: Knowledge, level: 0 | 1): boolean {
  const rules = level === 0 ? [consecutiveRule, onlyNext, onlyPrev] : [consecutiveRule, onlyNext, onlyPrev, fitNext, fitPrev];
  for (;;) {
    let changed = false;
    for (const rule of rules) {
      const r = rule(g, k, (s) => {
        if (!link(k, s.from, s.to)) return -1;
        changed = true;
        return 1;
      });
      if (r === CONTRA) return false;
      if (changed) break;
    }
    if (!changed) return true;
  }
}

function trialRule(dir: "next" | "prev"): Rule {
  const kind: StepKind = dir === "next" ? "trial-next" : "trial-prev";
  return (g, k, emit) => {
    const v = look(g, k);
    if (!v.ok) return CONTRA;
    let res: RuleResult = NONE;
    for (let c = 0; c < g.n; c++) {
      if (dir === "next" ? k.next[c] !== -1 || c === g.last : k.prev[c] !== -1 || c === g.first) continue;
      const opts = (dir === "next" ? g.ray[c]! : g.from[c]!).filter((o) => (dir === "next" ? valid(g, k, v, c, o, 1) : valid(g, k, v, o, c, 1)));
      if (opts.length < 2) continue;
      const alive = opts.filter((o) => {
        const t = copyKnowledge(k);
        return (dir === "next" ? link(t, c, o) : link(t, o, c)) && closeTo(g, t, 1);
      });
      if (alive.length === 0) return CONTRA;
      if (alive.length !== 1) continue;
      const o = alive[0]!;
      res = MORE;
      const ruled = opts.filter((x) => x !== o);
      const r = settle(emit(dir === "next" ? { kind, level: 2, from: c, to: o, ruled } : { kind, level: 2, from: o, to: c, ruled }));
      if (r !== null) return r;
    }
    return res;
  };
}

const trialNext = trialRule("next"), trialPrev = trialRule("prev");

const RULES: readonly (readonly [Level, Rule])[] = [
  [0, consecutiveRule], [0, onlyNext], [0, onlyPrev],
  [1, fitNext], [1, fitPrev],
  [2, trialNext], [2, trialPrev],
];

const RULE_OF: Record<StepKind, Rule> = {
  consecutive: consecutiveRule,
  "only-next": onlyNext,
  "only-prev": onlyPrev,
  "fit-next": fitNext,
  "fit-prev": fitPrev,
  "trial-next": trialNext,
  "trial-prev": trialPrev,
};

export function propagate(g: Geometry, k: Knowledge, maxLevel: Level): { ok: boolean; used: Level } {
  let used: Level = 0;
  const emit: Emit = (s) => (link(k, s.from, s.to) ? 1 : -1);
  outer: for (;;) {
    for (const [level, rule] of RULES) {
      if (level > maxLevel) break;
      const r = rule(g, k, emit);
      if (r === CONTRA) return { ok: false, used };
      if (r === MORE) {
        if (level > used) used = level;
        continue outer;
      }
    }
    return { ok: look(g, k).ok, used };
  }
}

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
  for (let c = 0; c < g.n; c++) if (c !== g.last && k.next[c] === -1) return false;
  return true;
}

export function logicSolve(p: SignpostPuzzle, maxLevel: Level = 2): { level: Level | null; k: Knowledge; ok: boolean } {
  const g = geometry(p);
  const k = freshKnowledge(g);
  const r = propagate(g, k, maxLevel);
  return { level: r.ok && isComplete(g, k) ? r.used : null, k, ok: r.ok };
}

/** Exhaustive search from `start`, counting up to `limit` complete paths. */
export function countSolutions(g: Geometry, start: Knowledge, limit = 2): { count: number; first: Knowledge | null } {
  const out = { count: 0, first: null as Knowledge | null };
  const search = (k: Knowledge): void => {
    if (!closeTo(g, k, 0) || !look(g, k).ok) return;
    const v = look(g, k);
    let pickCell = -1;
    let pick: number[] | null = null;
    for (let c = 0; c < g.n; c++) {
      if (c === g.last || k.next[c] !== -1) continue;
      const opts = g.ray[c]!.filter((o) => valid(g, k, v, c, o, 0));
      if (!pick || opts.length < pick.length) { pick = opts; pickCell = c; }
      if (pick.length <= 1) break;
    }
    if (!pick) {
      out.count++;
      if (!out.first) out.first = copyKnowledge(k);
      return;
    }
    for (const o of pick) {
      if (out.count >= limit) return;
      const t = copyKnowledge(k);
      if (link(t, pickCell, o)) search(t);
    }
  };
  search(copyKnowledge(start));
  return out;
}

export interface Analysis {
  count: 0 | 1 | 2;
  level: Level | null;
  /** Successor per cell in the (first) solution, -1 for the last cell. */
  solution: number[] | null;
}

const analyses = new WeakMap<SignpostPuzzle, Analysis>();

export function analyze(p: SignpostPuzzle): Analysis {
  const hit = analyses.get(p);
  if (hit) return hit;
  const g = geometry(p);
  const r = logicSolve(p, 2);
  let a: Analysis;
  if (r.level !== null) a = { count: 1, level: r.level, solution: Array.from(r.k.next) };
  else if (!r.ok) a = { count: 0, level: null, solution: null };
  else {
    const c = countSolutions(g, r.k, 2);
    a = { count: c.count as 0 | 1 | 2, level: null, solution: c.first ? Array.from(c.first.next) : null };
  }
  analyses.set(p, a);
  return a;
}

// --- generation ---

/** Cells on a's eight lines that `free` allows. */
function lineCells(w: number, h: number, a: number, free: (c: number) => boolean): number[] {
  const out: number[] = [];
  for (let d = 0; d < 8; d++) {
    let x = (a % w) + DX[d]!, y = Math.floor(a / w) + DY[d]!;
    while (x >= 0 && y >= 0 && x < w && y < h) {
      if (free(y * w + x)) out.push(y * w + x);
      x += DX[d]!;
      y += DY[d]!;
    }
  }
  return out;
}

/** A random path visiting every cell once, each step along one of the eight lines; order[i] is the cell numbered i+1. */
function randomPath(w: number, h: number, head: number, tail: number, rng: Rng): number[] | null {
  const n = w * h;
  const pos = new Int32Array(n).fill(0);
  pos[head] = 1;
  pos[tail] = n;
  let hi = head, ti = tail, lo = 1, top = n;
  const free = (c: number) => pos[c] === 0;
  while (top - lo > 1) {
    let opts = lineCells(w, h, hi, free);
    do {
      if (!opts.length) return null;
      const c = rng.pick(opts);
      pos[c] = ++lo;
      hi = c;
      opts = lineCells(w, h, hi, free);
    } while (opts.length === 1 && top - lo > 1);
    if (top - lo <= 1) break;
    opts = lineCells(w, h, ti, free);
    do {
      if (!opts.length) return null;
      const c = rng.pick(opts);
      pos[c] = --top;
      ti = c;
      opts = lineCells(w, h, ti, free);
    } while (opts.length === 1 && top - lo > 1);
  }
  if (directionTo(w, hi, ti) < 0) return null;
  const order: number[] = Array.from({ length: n }, () => -1);
  pos.forEach((v, c) => { order[v - 1] = c; });
  return order;
}

export interface GenOptions {
  w: number;
  h: number;
  corners: boolean;
  level: Level;
}

const EXACT_ATTEMPTS = 30;
const MAX_ATTEMPTS = 2000;

/** Puzzle from a path with only the numbers in `keep` shown (1 and n always). */
function puzzleOf(w: number, h: number, order: readonly number[], keep: ReadonlySet<number>): SignpostPuzzle {
  const n = w * h;
  const dirs = Array.from({ length: n }, () => 0);
  const nums = Array.from({ length: n }, () => 0);
  for (let i = 0; i < n; i++) {
    const c = order[i]!;
    if (i < n - 1) dirs[c] = directionTo(w, c, order[i + 1]!);
    if (i === 0 || i === n - 1 || keep.has(c)) nums[c] = i + 1;
  }
  return { w, h, dirs, nums };
}

/**
 * Deterministic in (o, rng). The result is solvable by logic at o.level, which proves it unique.
 * It needs exactly o.level when such a board turns up within EXACT_ATTEMPTS complete paths; otherwise the
 * hardest found is returned.
 */
export async function generatePuzzle(o: GenOptions, rng: Rng, ctx: GenerateContext): Promise<SignpostPuzzle> {
  const n = o.w * o.h;
  let best: { p: SignpostPuzzle; level: Level } | null = null;
  let made = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (best && made >= EXACT_ATTEMPTS) break;
    await ctx.yield();
    const r = rng.fork(`attempt ${attempt}`);
    let head = 0, tail = n - 1;
    if (!o.corners) {
      head = r.int(n);
      do tail = r.int(n); while (tail === head);
    }
    const order = randomPath(o.w, o.h, head, tail, r);
    if (!order) continue;
    const keep = new Set<number>();
    const solves = (level: Level = o.level) => logicSolve(puzzleOf(o.w, o.h, order, keep), level).level !== null;
    const addLevel = Math.min(o.level, 1) as Level;
    const cells = r.shuffle(order.slice(1, -1));
    for (const c of cells) {
      if (solves(addLevel)) break;
      keep.add(c);
      await ctx.yield();
    }
    if (!solves(addLevel)) continue;
    for (const c of cells) {
      if (!keep.has(c)) continue;
      keep.delete(c);
      if (!solves()) keep.add(c);
      await ctx.yield();
    }
    const p = puzzleOf(o.w, o.h, order, keep);
    made++;
    const level = logicSolve(p, o.level).level!;
    if (level === o.level) return p;
    if (!best || level > best.level) best = { p, level };
  }
  if (best) return best.p;
  throw new Error("couldn't make a puzzle with these settings; try a different size");
}
