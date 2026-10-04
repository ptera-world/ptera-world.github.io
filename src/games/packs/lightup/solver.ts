import type { Rng } from "../../core/rng";
import type { GenerateContext } from "../../core/types";
import { BLACK, EMPTY, geometry, withWalls, type Geometry, type LightupPuzzle } from "./grid";

/** Knowledge per cell. Walls stay UNK and are never consulted. */
export const UNK = 0, LIGHT = 1, DARK = 2;
export type Knowledge = Int8Array;

export const LEVEL_NAMES = ["easy", "medium", "hard"] as const;
/** 0 easy: clue counting + single sources. 1 medium: + "a light here would starve something". 2 hard: + one-cell trials refuted by easy rules. */
export type Level = 0 | 1 | 2;

export type StepKind =
  | "clue-full" | "clue-needs-all" | "only-source"
  | "starves-cell" | "starves-clue"
  | "probe-light" | "probe-dark";

export interface Step {
  kind: StepKind;
  level: Level;
  cells: number[];
  value: typeof LIGHT | typeof DARK;
  /** The cells whose constraint forced this step (clue or unlit cell); empty for probes. */
  because: number[];
}

/** Emit result: 0 keep scanning, 1 stop (step recorded), -1 contradiction while applying. */
type Emit = (s: Step) => -1 | 0 | 1;
const CONTRA = -1, NONE = 0, MORE = 1;
type RuleResult = typeof CONTRA | typeof NONE | typeof MORE;
type Rule = (g: Geometry, k: Knowledge, emit: Emit) => RuleResult;

/** Sets one cell; a light also darkens everything it sees. False on contradiction. */
export function assign(g: Geometry, k: Knowledge, c: number, v: number): boolean {
  if (k[c] === v) return true;
  if (k[c] !== UNK) return false;
  k[c] = v;
  if (v === LIGHT) {
    for (const j of g.sees[c]!) {
      if (k[j] === LIGHT) return false;
      k[j] = DARK;
    }
  }
  return true;
}

export function applyStep(g: Geometry, k: Knowledge, s: Step): boolean {
  for (const c of s.cells) if (!assign(g, k, c, s.value)) return false;
  return true;
}

export function isLit(g: Geometry, k: Knowledge, i: number): boolean {
  if (k[i] === LIGHT) return true;
  for (const j of g.sees[i]!) if (k[j] === LIGHT) return true;
  return false;
}

/** Cells that could still light open cell `x` (itself included). */
function sources(g: Geometry, k: Knowledge, x: number): number[] {
  const out: number[] = [];
  if (k[x] === UNK) out.push(x);
  for (const j of g.sees[x]!) if (k[j] === UNK) out.push(j);
  return out;
}

function settle(r: -1 | 0 | 1): RuleResult | null {
  return r === 0 ? null : r < 0 ? CONTRA : MORE;
}

const clueRule: Rule = (g, k, emit) => {
  let res: RuleResult = NONE;
  for (const q of g.clues) {
    let lights = 0;
    const unk: number[] = [];
    for (const a of g.adj[q]!) {
      if (k[a] === LIGHT) lights++;
      else if (k[a] === UNK) unk.push(a);
    }
    const need = g.cells[q]! - lights;
    if (need < 0 || need > unk.length) return CONTRA;
    if (unk.length === 0) continue;
    let step: Step | null = null;
    if (need === 0) step = { kind: "clue-full", level: 0, cells: unk, value: DARK, because: [q] };
    else if (need === unk.length) step = { kind: "clue-needs-all", level: 0, cells: unk, value: LIGHT, because: [q] };
    if (!step) continue;
    res = MORE;
    const r = settle(emit(step));
    if (r !== null) return r;
  }
  return res;
};

const onlySourceRule: Rule = (g, k, emit) => {
  let res: RuleResult = NONE;
  for (const x of g.empties) {
    if (isLit(g, k, x)) continue;
    const src = sources(g, k, x);
    if (src.length === 0) return CONTRA;
    if (src.length !== 1) continue;
    res = MORE;
    const r = settle(emit({ kind: "only-source", level: 0, cells: src, value: LIGHT, because: [x] }));
    if (r !== null) return r;
  }
  return res;
};

const starvesCellRule: Rule = (g, k, emit) => {
  let res: RuleResult = NONE;
  for (const x of g.empties) {
    if (isLit(g, k, x)) continue;
    const src = sources(g, k, x);
    if (src.length < 2) continue;
    for (const y of g.sees[src[0]!]!) {
      if (k[y] !== UNK || src.includes(y)) continue;
      if (!src.every((c) => g.seeMask[y * g.n + c])) continue;
      res = MORE;
      const r = settle(emit({ kind: "starves-cell", level: 1, cells: [y], value: DARK, because: [x] }));
      if (r !== null) return r;
    }
  }
  return res;
};

const starvesClueRule: Rule = (g, k, emit) => {
  let res: RuleResult = NONE;
  for (const q of g.clues) {
    let lights = 0;
    const unk: number[] = [];
    for (const a of g.adj[q]!) {
      if (k[a] === LIGHT) lights++;
      else if (k[a] === UNK) unk.push(a);
    }
    const need = g.cells[q]! - lights;
    if (need <= 0 || need >= unk.length) continue;
    const tried = new Set<number>();
    for (const u of unk) {
      for (const y of g.sees[u]!) {
        if (k[y] !== UNK || tried.has(y) || unk.includes(y)) continue;
        tried.add(y);
        let blocked = 0;
        for (const v of unk) if (g.seeMask[y * g.n + v]) blocked++;
        if (unk.length - blocked >= need) continue;
        res = MORE;
        const r = settle(emit({ kind: "starves-clue", level: 1, cells: [y], value: DARK, because: [q] }));
        if (r !== null) return r;
      }
    }
  }
  return res;
};

/** Sets c to v on k (a scratch copy) and closes the easy rules; false on contradiction. */
function tryEasy(g: Geometry, k: Knowledge, c: number, v: number): boolean {
  const changed: number[] = [];
  return assignTracked(g, k, c, v, changed) && closeEasy(g, k, changed);
}

const probeRule: Rule = (g, k, emit) => {
  let res: RuleResult = NONE;
  for (const y of g.empties) {
    if (k[y] !== UNK) continue;
    const a = k.slice();
    if (!tryEasy(g, a, y, LIGHT)) {
      res = MORE;
      const r = settle(emit({ kind: "probe-light", level: 2, cells: [y], value: DARK, because: [] }));
      if (r !== null) return r;
      continue;
    }
    const b = k.slice();
    if (!tryEasy(g, b, y, DARK)) {
      res = MORE;
      const r = settle(emit({ kind: "probe-dark", level: 2, cells: [y], value: LIGHT, because: [] }));
      if (r !== null) return r;
    }
  }
  return res;
};

const RULES: readonly (readonly [Level, Rule])[] = [
  [0, clueRule],
  [0, onlySourceRule],
  [1, starvesCellRule],
  [1, starvesClueRule],
  [2, probeRule],
];

export interface PropagateResult {
  /** False iff a contradiction was found (so `k` has no completion). */
  ok: boolean;
  /** Highest level any applied step needed. Minimal: easier rules are always exhausted first. */
  used: Level;
}

/** assign() that appends every cell it changes to `changed`. */
function assignTracked(g: Geometry, k: Knowledge, c: number, v: number, changed: number[]): boolean {
  if (k[c] === v) return true;
  if (k[c] !== UNK) return false;
  k[c] = v;
  changed.push(c);
  if (v === LIGHT) {
    for (const j of g.sees[c]!) {
      if (k[j] === LIGHT) return false;
      if (k[j] === UNK) {
        k[j] = DARK;
        changed.push(j);
      }
    }
  }
  return true;
}

/**
 * Closure of the level-0 rules, driven by a worklist. `dirty` lists cells changed since k was
 * last closed; null rechecks everything. Same deductions as clueRule + onlySourceRule.
 */
function closeEasy(g: Geometry, k: Knowledge, dirty: readonly number[] | null): boolean {
  const queued = new Uint8Array(g.n);
  const queue: number[] = [];
  const push = (i: number) => {
    if (!queued[i]) {
      queued[i] = 1;
      queue.push(i);
    }
  };
  const touch = (c: number) => {
    for (const q of g.nbrs[c]!) if (g.cells[q]! >= 0) push(q);
    push(c);
    for (const j of g.sees[c]!) push(j);
  };
  if (dirty) dirty.forEach(touch);
  else {
    g.clues.forEach(push);
    g.empties.forEach(push);
  }
  const changed: number[] = [];
  while (queue.length) {
    const i = queue.pop()!;
    queued[i] = 0;
    changed.length = 0;
    if (g.cells[i] === EMPTY) {
      if (isLit(g, k, i)) continue;
      const src = sources(g, k, i);
      if (src.length === 0) return false;
      if (src.length === 1 && !assignTracked(g, k, src[0]!, LIGHT, changed)) return false;
    } else {
      let lights = 0;
      const unk: number[] = [];
      for (const a of g.adj[i]!) {
        if (k[a] === LIGHT) lights++;
        else if (k[a] === UNK) unk.push(a);
      }
      const need = g.cells[i]! - lights;
      if (need < 0 || need > unk.length) return false;
      if (unk.length && (need === 0 || need === unk.length)) {
        for (const a of unk) if (!assignTracked(g, k, a, need === 0 ? DARK : LIGHT, changed)) return false;
      }
    }
    changed.forEach(touch);
  }
  return true;
}

/** Apply every deduction up to maxLevel to k in place, easiest rules first. */
export function propagate(g: Geometry, k: Knowledge, maxLevel: Level): PropagateResult {
  let used: Level = 0;
  if (!closeEasy(g, k, null)) return { ok: false, used };
  const emit: Emit = (s) => {
    const changed: number[] = [];
    for (const c of s.cells) if (!assignTracked(g, k, c, s.value, changed)) return -1;
    return closeEasy(g, k, changed) ? 0 : -1;
  };
  outer: for (;;) {
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

/** The easiest single deduction available from k, "contradiction" if k is inconsistent, or null. */
export function nextStep(g: Geometry, k: Knowledge, maxLevel: Level = 2): Step | "contradiction" | null {
  let found: Step | null = null;
  const emit: Emit = (s) => {
    found = s;
    return 1;
  };
  for (const [level, rule] of RULES) {
    if (level > maxLevel) break;
    const r = rule(g, k, emit);
    if (found) return found;
    if (r === CONTRA) return "contradiction";
  }
  return null;
}

export function isComplete(g: Geometry, k: Knowledge): boolean {
  return g.empties.every((c) => k[c] !== UNK);
}

export function freshKnowledge(g: Geometry): Knowledge {
  return new Int8Array(g.n);
}

/** Logic-only solve. `level` is null when stuck or contradictory at maxLevel. */
export function logicSolve(p: LightupPuzzle, maxLevel: Level = 2): { level: Level | null; k: Knowledge; ok: boolean } {
  const g = geometry(p);
  const k = freshKnowledge(g);
  const r = propagate(g, k, maxLevel);
  return { level: r.ok && isComplete(g, k) ? r.used : null, k, ok: r.ok };
}

/** Exhaustive search from k. Counts solutions up to `limit`; `first` is the first one found. */
export function countSolutions(g: Geometry, start: Knowledge, limit = 2): { count: number; first: Knowledge | null } {
  const out = { count: 0, first: null as Knowledge | null };
  const search = (k: Knowledge): void => {
    if (!propagate(g, k, 0).ok) return;
    let pick: number[] | null = null;
    for (const x of g.empties) {
      if (isLit(g, k, x)) continue;
      const src = sources(g, k, x);
      if (!pick || src.length < pick.length) pick = src;
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
      for (let j = 0; j < i && ok; j++) ok = assign(g, t, pick[j]!, DARK);
      if (ok && assign(g, t, pick[i]!, LIGHT)) search(t);
    }
  };
  search(start.slice());
  return out;
}

export interface Analysis {
  /** 0 = none, 1 = unique, 2 = several (counting stops at 2). */
  count: 0 | 1 | 2;
  /** Logic level that solves it, or null if logic alone can't. */
  level: Level | null;
  /** 1 = light per cell for the (first) solution, or null if none. */
  solution: number[] | null;
}

const analyses = new WeakMap<LightupPuzzle, Analysis>();

export function analyze(p: LightupPuzzle): Analysis {
  const hit = analyses.get(p);
  if (hit) return hit;
  const g = geometry(p);
  const toLights = (k: Knowledge) => Array.from(k, (v, i) => (v === LIGHT && p.cells[i] === EMPTY ? 1 : 0));
  const r = logicSolve(p, 2);
  let a: Analysis;
  if (r.level !== null) a = { count: 1, level: r.level, solution: toLights(r.k) };
  else if (!r.ok) a = { count: 0, level: null, solution: null };
  else {
    const c = countSolutions(g, r.k, 2);
    a = { count: c.count as 0 | 1 | 2, level: null, solution: c.first ? toLights(c.first) : null };
  }
  analyses.set(p, a);
  return a;
}

// --- generation ---

export type Symmetry = "none" | "mirror" | "rot2" | "rot4";

export interface GenOptions {
  w: number;
  h: number;
  /** Target wall percentage. */
  blackPct: number;
  symmetry: Symmetry;
  level: Level;
}

/** Cell orbits under the symmetry; rot4 on a non-square board degrades to rot2. */
function orbits(w: number, h: number, sym: Symmetry): number[][] {
  const n = w * h;
  const seen = new Uint8Array(n);
  const out: number[][] = [];
  const s = sym === "rot4" && w !== h ? "rot2" : sym;
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    const x = i % w, y = Math.floor(i / w);
    const pts: [number, number][] = [[x, y]];
    if (s === "mirror") pts.push([w - 1 - x, y]);
    if (s === "rot2" || s === "rot4") pts.push([w - 1 - x, h - 1 - y]);
    if (s === "rot4") pts.push([w - 1 - y, x], [y, h - 1 - x]);
    const orbit = [...new Set(pts.map(([a, b]) => b * w + a))];
    for (const c of orbit) seen[c] = 1;
    out.push(orbit);
  }
  return out;
}

function randomWalls(o: GenOptions, orbitList: number[][], rng: Rng): number[] {
  const n = o.w * o.h;
  const target = Math.round((n * o.blackPct) / 100);
  const cells = Array.from({ length: n }, () => EMPTY);
  let count = 0;
  for (const orbit of rng.shuffle(orbitList.slice())) {
    if (count >= target) break;
    for (const c of orbit) cells[c] = BLACK;
    count += orbit.length;
  }
  return cells;
}

/**
 * Adds lights at random until every open cell is lit; existing lights in `light` are kept and
 * must not see each other. Mutates and returns `light`.
 */
function fillLights(g: Geometry, rng: Rng, light: Uint8Array): Uint8Array {
  const lit = new Uint8Array(g.n);
  for (const c of g.empties) {
    if (!light[c]) continue;
    lit[c] = 1;
    for (const j of g.sees[c]!) lit[j] = 1;
  }
  for (const x of rng.shuffle(g.empties.slice())) {
    if (lit[x]) continue;
    const c = rng.pick([x, ...g.sees[x]!].filter((j) => !lit[j]));
    light[c] = 1;
    lit[c] = 1;
    for (const j of g.sees[c]!) lit[j] = 1;
  }
  return light;
}

function solveLevel(g: Geometry, maxLevel: Level): { level: Level | null; k: Knowledge } {
  const k = freshKnowledge(g);
  const r = propagate(g, k, maxLevel);
  return { level: r.ok && isComplete(g, k) ? r.used : null, k };
}

function numberWalls(g: Geometry, cells: number[], light: Uint8Array): void {
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== EMPTY) cells[i] = g.adj[i]!.reduce((s, a) => s + light[a]!, 0);
  }
}

/**
 * Turns whole symmetry orbits of undetermined, light-free open cells into walls (adding lights
 * where that leaves cells dark) until the fully clued board is solvable at maxLevel.
 * Mutates `cells` (all walls end up numbered) and `light`. Returns the final geometry, or null.
 */
function repair(o: GenOptions, cells: number[], light: Uint8Array, orbitList: number[][], maxLevel: Level, rng: Rng): Geometry | null {
  const limit = Math.max(16, Math.ceil((o.w * o.h) / 8));
  for (let round = 0; ; round++) {
    const g = geometry({ w: o.w, h: o.h, cells: cells.slice() });
    fillLights(g, rng, light);
    numberWalls(g, cells, light);
    const gc = withWalls(g, cells.slice());
    const { level, k } = solveLevel(gc, maxLevel);
    if (level !== null) return gc;
    if (round === limit) return null;
    const candidates = orbitList.filter((orbit) =>
      orbit.some((c) => k[c] === UNK) && orbit.every((c) => cells[c] === EMPTY && !light[c]));
    if (candidates.length === 0) return null;
    for (const c of rng.pick(candidates)) cells[c] = BLACK;
  }
}

const EXACT_ATTEMPTS = 40;
const MAX_ATTEMPTS = 200;

/**
 * Deterministic in (o, rng). The result is solvable by logic at o.level, which proves its
 * solution unique. It needs exactly o.level when such a board turns up within EXACT_ATTEMPTS
 * layouts; otherwise the hardest board found is returned.
 */
export async function generatePuzzle(o: GenOptions, rng: Rng, ctx: GenerateContext): Promise<LightupPuzzle> {
  const orbitList = orbits(o.w, o.h, o.symmetry);
  let best: { p: LightupPuzzle; level: Level } | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (best && attempt >= EXACT_ATTEMPTS) break;
    await ctx.yield();
    const r = rng.fork(`attempt ${attempt}`);
    const cells = randomWalls(o, orbitList, r);
    const g0 = geometry({ w: o.w, h: o.h, cells: cells.slice() });
    if (g0.empties.length === 0) continue;
    const light = new Uint8Array(g0.n);
    const g = repair(o, cells, light, orbitList, o.level, r);
    if (!g) continue;
    for (const q of r.shuffle(g.clues.slice())) {
      await ctx.yield();
      const keep = cells[q]!;
      cells[q] = BLACK;
      if (solveLevel(withWalls(g, cells.slice()), o.level).level === null) cells[q] = keep;
    }
    const p: LightupPuzzle = { w: o.w, h: o.h, cells: cells.slice() };
    const level = solveLevel(geometry(p), o.level).level!;
    if (level === o.level) return p;
    if (!best || level > best.level) best = { p, level };
  }
  if (best) return best.p;
  throw new Error("couldn't make a puzzle with these settings; try a different size or wall density");
}
