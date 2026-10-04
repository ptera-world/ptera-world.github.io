import type { Rng } from "../../core/rng";
import type { GenerateContext } from "../../core/types";
import { ALL, geometry, randomColouring, randomMap, renumber, type Geometry, type MapPuzzle } from "./grid";

/**
 * What is known per region: the color it has been given (-1 if none) and the colors still
 * possible. Giving a region a color takes that color away from its neighbors.
 */
export interface Knowledge {
  col: Int8Array;
  dom: Uint8Array;
}

export const LEVEL_NAMES = ["easy", "medium", "hard"] as const;
/** 0 easy: regions with one color left. 1 medium: + neighboring pairs sharing two colors. 2 hard: + one-color trials. */
export type Level = 0 | 1 | 2;

export type StepKind = "only-colour" | "pair" | "trial";

export interface Step {
  kind: StepKind;
  level: Level;
  regions: number[];
  /** Color bits removed from each of `regions`. */
  remove: number;
  /** Regions whose colors forced the step (the pair, or the trialed region). */
  because: number[];
  /** Color placed (only-color) or tried (trial). */
  colour?: number;
}

type Emit = (s: Step) => -1 | 0 | 1;
const CONTRA = -1, NONE = 0, MORE = 1;
type RuleResult = typeof CONTRA | typeof NONE | typeof MORE;
type Rule = (g: Geometry, k: Knowledge, emit: Emit) => RuleResult;

const popcount = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
const colourOf = (m: number) => (m === 1 ? 0 : m === 2 ? 1 : m === 4 ? 2 : m === 8 ? 3 : -1);

export function freshKnowledge(g: Geometry): Knowledge {
  return { col: new Int8Array(g.n).fill(-1), dom: new Uint8Array(g.n).fill(ALL) };
}

export const copyKnowledge = (k: Knowledge): Knowledge => ({ col: k.col.slice(), dom: k.dom.slice() });

/** Gives region r color c. False on contradiction. */
export function assign(g: Geometry, k: Knowledge, r: number, c: number): boolean {
  if (k.col[r] === c) return true;
  if (k.col[r] !== -1 || !(k.dom[r]! & (1 << c))) return false;
  k.col[r] = c;
  k.dom[r] = 1 << c;
  for (const o of g.adj[r]!) {
    if (k.col[o] === c) return false;
    k.dom[o] = k.dom[o]! & ~(1 << c);
    if (!k.dom[o]) return false;
  }
  return true;
}

export function remove(k: Knowledge, regions: readonly number[], bits: number): boolean {
  for (const r of regions) {
    k.dom[r] = k.dom[r]! & ~bits;
    if (!k.dom[r]) return false;
  }
  return true;
}

function apply(g: Geometry, k: Knowledge, s: Step): boolean {
  if (s.kind === "only-colour") return assign(g, k, s.regions[0]!, s.colour!);
  return remove(k, s.regions, s.remove);
}

function settle(r: -1 | 0 | 1): RuleResult | null {
  return r === 0 ? null : r < 0 ? CONTRA : MORE;
}

const onlyRule: Rule = (g, k, emit) => {
  let res: RuleResult = NONE;
  for (let r = 0; r < g.n; r++) {
    if (!k.dom[r]) return CONTRA;
    if (k.col[r] !== -1 || popcount(k.dom[r]!) !== 1) continue;
    res = MORE;
    const c = colourOf(k.dom[r]!);
    const out = settle(emit({ kind: "only-colour", level: 0, regions: [r], remove: ALL & ~k.dom[r]!, because: g.adj[r]!.filter((o) => k.col[o] !== -1), colour: c }));
    if (out !== null) return out;
  }
  return res;
};

const pairRule: Rule = (g, k, emit) => {
  let res: RuleResult = NONE;
  for (let a = 0; a < g.n; a++) {
    if (k.col[a] !== -1 || popcount(k.dom[a]!) !== 2) continue;
    for (const b of g.adj[a]!) {
      if (b < a || k.col[b] !== -1 || k.dom[b] !== k.dom[a]) continue;
      const pair = k.dom[a]!;
      const hits = g.adj[a]!.filter((x) => x !== b && k.col[x] === -1 && g.adj[b]!.includes(x) && k.dom[x]! & pair);
      if (!hits.length) continue;
      res = MORE;
      const out = settle(emit({ kind: "pair", level: 1, regions: hits, remove: pair, because: [a, b] }));
      if (out !== null) return out;
    }
  }
  return res;
};

function close(g: Geometry, k: Knowledge, level: 0 | 1): boolean {
  const rules = level === 0 ? [onlyRule] : [onlyRule, pairRule];
  for (;;) {
    let changed = false;
    for (const rule of rules) {
      const r = rule(g, k, (s) => {
        changed = true;
        return apply(g, k, s) ? 0 : -1;
      });
      if (r === CONTRA) return false;
    }
    if (!changed) return true;
  }
}

const trialRule: Rule = (g, k, emit) => {
  let res: RuleResult = NONE;
  for (let r = 0; r < g.n; r++) {
    if (k.col[r] !== -1 || popcount(k.dom[r]!) < 2) continue;
    for (let c = 0; c < 4; c++) {
      if (!(k.dom[r]! & (1 << c))) continue;
      const t = copyKnowledge(k);
      if (assign(g, t, r, c) && close(g, t, 1)) continue;
      res = MORE;
      const out = settle(emit({ kind: "trial", level: 2, regions: [r], remove: 1 << c, because: [r], colour: c }));
      if (out !== null) return out;
    }
  }
  return res;
};

const RULES: readonly (readonly [Level, Rule])[] = [[0, onlyRule], [1, pairRule], [2, trialRule]];
const RULE_OF: Record<StepKind, Rule> = { "only-colour": onlyRule, pair: pairRule, trial: trialRule };

export function propagate(g: Geometry, k: Knowledge, maxLevel: Level): { ok: boolean; used: Level } {
  let used: Level = 0;
  const emit: Emit = (s) => (apply(g, k, s) ? 1 : -1);
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
    return { ok: true, used };
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

/** Knowledge with the puzzle's given colors placed; null if they clash. */
export function startKnowledge(p: MapPuzzle): Knowledge | null {
  const g = geometry(p);
  const k = freshKnowledge(g);
  for (let r = 0; r < g.n; r++) if (p.given[r]! >= 0 && !assign(g, k, r, p.given[r]!)) return null;
  return k;
}

export const isComplete = (k: Knowledge): boolean => k.col.every((c) => c !== -1);

export function logicSolve(p: MapPuzzle, maxLevel: Level = 2): { level: Level | null; k: Knowledge | null; ok: boolean } {
  const g = geometry(p);
  const k = startKnowledge(p);
  if (!k) return { level: null, k: null, ok: false };
  const r = propagate(g, k, maxLevel);
  return { level: r.ok && isComplete(k) ? r.used : null, k, ok: r.ok };
}

export function countSolutions(g: Geometry, start: Knowledge, limit = 2): { count: number; first: Knowledge | null } {
  const out = { count: 0, first: null as Knowledge | null };
  const search = (k: Knowledge): void => {
    if (!close(g, k, 0)) return;
    let pick = -1;
    for (let r = 0; r < g.n; r++) {
      if (k.col[r] !== -1) continue;
      if (pick < 0 || popcount(k.dom[r]!) < popcount(k.dom[pick]!)) pick = r;
    }
    if (pick < 0) {
      out.count++;
      if (!out.first) out.first = copyKnowledge(k);
      return;
    }
    for (let c = 0; c < 4 && out.count < limit; c++) {
      if (!(k.dom[pick]! & (1 << c))) continue;
      const t = copyKnowledge(k);
      if (assign(g, t, pick, c)) search(t);
    }
  };
  search(copyKnowledge(start));
  return out;
}

export interface Analysis {
  count: 0 | 1 | 2;
  level: Level | null;
  /** Color per region in the (first) solution. */
  solution: number[] | null;
}

const analyses = new WeakMap<MapPuzzle, Analysis>();

export function analyze(p: MapPuzzle): Analysis {
  const hit = analyses.get(p);
  if (hit) return hit;
  const g = geometry(p);
  const r = logicSolve(p, 2);
  let a: Analysis;
  if (r.level !== null) a = { count: 1, level: r.level, solution: Array.from(r.k!.col) };
  else if (!r.ok || !r.k) a = { count: 0, level: null, solution: null };
  else {
    const c = countSolutions(g, r.k, 2);
    a = { count: c.count as 0 | 1 | 2, level: null, solution: c.first ? Array.from(c.first.col) : null };
  }
  analyses.set(p, a);
  return a;
}

// --- generation ---

export interface GenOptions {
  w: number;
  h: number;
  n: number;
  level: Level;
}

const EXACT_ATTEMPTS = 400;
const MAX_ATTEMPTS = 1000;

/**
 * Deterministic in (o, rng). Colors are removed from a full coloring while the map stays
 * solvable at o.level (so the solution is unique); it needs exactly o.level when such a map turns
 * up within EXACT_ATTEMPTS maps, otherwise the hardest found is returned.
 */
export async function generatePuzzle(o: GenOptions, rng: Rng, ctx: GenerateContext): Promise<MapPuzzle> {
  const n = Math.max(2, Math.min(o.n, o.w * o.h));
  let best: { p: MapPuzzle; level: Level } | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (best && attempt >= EXACT_ATTEMPTS) break;
    await ctx.yield();
    const r = rng.fork(`attempt ${attempt}`);
    const { map } = renumber(randomMap(o.w, o.h, n, r));
    const g = geometry({ w: o.w, h: o.h, n, map });
    const colours = randomColouring(g, r);
    if (!colours) continue;
    const given = colours.slice();
    for (const reg of r.shuffle(Array.from({ length: n }, (_, i) => i))) {
      given[reg] = -1;
      if (logicSolve({ w: o.w, h: o.h, n, map, given }, o.level).level === null) given[reg] = colours[reg]!;
      if (reg % 4 === 0) await ctx.yield();
    }
    const p: MapPuzzle = { w: o.w, h: o.h, n, map, given };
    const level = logicSolve(p, o.level).level;
    if (level === null) continue;
    if (level === o.level) return p;
    if (!best || level > best.level) best = { p, level };
  }
  if (best) return best.p;
  throw new Error("couldn't make a map with these settings; try fewer regions or a bigger board");
}
