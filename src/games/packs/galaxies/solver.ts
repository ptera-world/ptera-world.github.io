import type { Rng } from "../../core/rng";
import type { GenerateContext } from "../../core/types";

export interface Dot {
  /** Position in doubled coordinates: tile (x, y) has its center at (2x+1, 2y+1); 1 ≤ x ≤ 2w-1, 1 ≤ y ≤ 2h-1. */
  x: number;
  y: number;
  /** Shown black; its galaxy is shaded once finished. */
  black: boolean;
}

export interface GalaxiesPuzzle {
  w: number;
  h: number;
  dots: Dot[];
}

export interface Geometry {
  w: number;
  h: number;
  n: number;
  nd: number;
  /** Tiles each dot sits on (1, 2 or 4). */
  core: number[][];
  /** coreOf[t]: the dot sitting on tile t, or -1. */
  coreOf: Int32Array;
  /** mirror[d*n + t]: tile t reflected through dot d, or -1 off the board. */
  mirror: Int32Array;
  nbrs: number[][];
}

const cache = new WeakMap<GalaxiesPuzzle, Geometry>();

export function geometry(p: GalaxiesPuzzle): Geometry {
  const hit = cache.get(p);
  if (hit) return hit;
  const { w, h, dots } = p;
  const n = w * h, nd = dots.length;
  const core: number[][] = [];
  const coreOf = new Int32Array(n).fill(-1);
  const mirror = new Int32Array(n * nd);
  dots.forEach((dot, d) => {
    const list: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (Math.abs(2 * x + 1 - dot.x) <= 1 && Math.abs(2 * y + 1 - dot.y) <= 1) list.push(y * w + x);
    }
    core.push(list);
    for (const t of list) coreOf[t] = d;
    for (let t = 0; t < n; t++) {
      const mx = dot.x - (t % w) - 1, my = dot.y - Math.floor(t / w) - 1;
      mirror[d * n + t] = mx < 0 || my < 0 || mx >= w || my >= h ? -1 : my * w + mx;
    }
  });
  const nbrs = Array.from({ length: n }, (_, t) => {
    const x = t % w, y = Math.floor(t / w);
    return [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]].filter(([a, b]) => a! >= 0 && b! >= 0 && a! < w && b! < h).map(([a, b]) => b! * w + a!);
  });
  const g: Geometry = { w, h, n, nd, core, coreOf, mirror, nbrs };
  cache.set(p, g);
  return g;
}

/** Owner per tile: a dot index, or -1 where unknown. */
export type Owners = Int32Array;

export const LEVEL_NAMES = ["easy", "medium", "hard"] as const;
/** 0 easy: mirror images and tiles only one dot can reach. 1 medium: + tiles a galaxy can't do without. 2 hard: + one-tile trials. */
export type Level = 0 | 1 | 2;

export type StepKind = "mirror" | "only-dot" | "cut" | "trial";

export interface Step {
  kind: StepKind;
  level: Level;
  tiles: number[];
  dot: number;
  /** Tiles explaining why. */
  because: number[];
}

type Emit = (s: Step) => -1 | 0 | 1;
const CONTRA = -1, NONE = 0, MORE = 1;
type RuleResult = typeof CONTRA | typeof NONE | typeof MORE;
type Rule = (g: Geometry, own: Owners, emit: Emit) => RuleResult;

export function freshOwners(g: Geometry): Owners {
  return Int32Array.from(g.coreOf);
}

/**
 * Which dots each tile could still belong to, given the owners: poss[d*n + t]. A tile can belong
 * to d only if its mirror image through d is on the board and could belong to d too, nobody else
 * owns it, and d's galaxy can reach it through tiles that could belong to d.
 */
export function possibilities(g: Geometry, own: Owners): Uint8Array {
  const { n, nd, mirror } = g;
  const poss = new Uint8Array(n * nd);
  for (let d = 0; d < nd; d++) {
    for (let t = 0; t < n; t++) {
      const m = mirror[d * n + t]!;
      if (m < 0) continue;
      if ((own[t] !== -1 && own[t] !== d) || (own[m] !== -1 && own[m] !== d)) continue;
      poss[d * n + t] = 1;
    }
  }
  for (let d = 0; d < nd; d++) {
    for (let changed = true; changed;) {
      changed = false;
      const seen = new Uint8Array(n);
      const stack = g.core[d]!.filter((t) => poss[d * n + t]);
      for (const t of stack) seen[t] = 1;
      while (stack.length) {
        const t = stack.pop()!;
        for (const u of g.nbrs[t]!) if (!seen[u] && poss[d * n + u]) { seen[u] = 1; stack.push(u); }
      }
      for (let t = 0; t < n; t++) {
        if (!poss[d * n + t]) continue;
        if (!seen[t] || !poss[d * n + mirror[d * n + t]!]) { poss[d * n + t] = 0; changed = true; }
      }
    }
  }
  return poss;
}

const candidates = (g: Geometry, poss: Uint8Array, t: number): number[] => {
  const out: number[] = [];
  for (let d = 0; d < g.nd; d++) if (poss[d * g.n + t]) out.push(d);
  return out;
};

/** False if an owned tile has lost its own dot, or a tile has nowhere to go. */
function consistent(g: Geometry, own: Owners, poss: Uint8Array): boolean {
  for (let t = 0; t < g.n; t++) {
    if (own[t] !== -1 ? !poss[own[t]! * g.n + t] : !candidates(g, poss, t).length) return false;
  }
  return true;
}

function settle(r: -1 | 0 | 1): RuleResult | null {
  return r === 0 ? null : r < 0 ? CONTRA : MORE;
}

const mirrorRule: Rule = (g, own, emit) => {
  let res: RuleResult = NONE;
  for (let t = 0; t < g.n; t++) {
    const d = own[t]!;
    if (d < 0) continue;
    const m = g.mirror[d * g.n + t]!;
    if (m < 0 || (own[m] !== -1 && own[m] !== d)) return CONTRA;
    if (own[m] === d) continue;
    res = MORE;
    const r = settle(emit({ kind: "mirror", level: 0, tiles: [m], dot: d, because: [t] }));
    if (r !== null) return r;
  }
  return res;
};

const onlyDotRule: Rule = (g, own, emit) => {
  const poss = possibilities(g, own);
  if (!consistent(g, own, poss)) return CONTRA;
  let res: RuleResult = NONE;
  for (let t = 0; t < g.n; t++) {
    if (own[t] !== -1) continue;
    const c = candidates(g, poss, t);
    if (c.length !== 1) continue;
    res = MORE;
    const r = settle(emit({ kind: "only-dot", level: 0, tiles: [t], dot: c[0]!, because: [] }));
    if (r !== null) return r;
  }
  return res;
};

/** Tiles of d's galaxy that d can't reach without passing u. */
function cutOff(g: Geometry, own: Owners, poss: Uint8Array, d: number, u: number): number[] {
  const seen = new Uint8Array(g.n);
  const stack = g.core[d]!.filter((t) => t !== u);
  for (const t of stack) seen[t] = 1;
  while (stack.length) {
    const t = stack.pop()!;
    for (const v of g.nbrs[t]!) if (v !== u && !seen[v] && poss[d * g.n + v]) { seen[v] = 1; stack.push(v); }
  }
  const out: number[] = [];
  for (let t = 0; t < g.n; t++) if (own[t] === d && !seen[t]) out.push(t);
  return out;
}

const cutRule: Rule = (g, own, emit) => {
  const poss = possibilities(g, own);
  if (!consistent(g, own, poss)) return CONTRA;
  let res: RuleResult = NONE;
  for (let d = 0; d < g.nd; d++) {
    for (let u = 0; u < g.n; u++) {
      if (own[u] !== -1 || !poss[d * g.n + u]) continue;
      const lost = cutOff(g, own, poss, d, u);
      if (!lost.length) continue;
      res = MORE;
      const r = settle(emit({ kind: "cut", level: 1, tiles: [u], dot: d, because: lost }));
      if (r !== null) return r;
    }
  }
  return res;
};

function applyStep(g: Geometry, own: Owners, s: Pick<Step, "tiles" | "dot">): boolean {
  for (const t of s.tiles) {
    if (own[t] !== -1 && own[t] !== s.dot) return false;
    own[t] = s.dot;
  }
  return true;
}

function close(g: Geometry, own: Owners, level: 0 | 1): boolean {
  const rules = level === 0 ? [mirrorRule, onlyDotRule] : [mirrorRule, onlyDotRule, cutRule];
  for (;;) {
    let changed = false;
    for (const rule of rules) {
      const r = rule(g, own, (s) => {
        changed = true;
        return applyStep(g, own, s) ? 1 : -1;
      });
      if (r === CONTRA) return false;
      if (changed) break;
    }
    if (!changed) return consistent(g, own, possibilities(g, own));
  }
}

const trialRule: Rule = (g, own, emit) => {
  const poss = possibilities(g, own);
  let res: RuleResult = NONE;
  for (let t = 0; t < g.n; t++) {
    if (own[t] !== -1) continue;
    const c = candidates(g, poss, t);
    if (c.length < 2) continue;
    const alive = c.filter((d) => {
      const o = own.slice();
      o[t] = d;
      return close(g, o, 1);
    });
    if (alive.length === 0) return CONTRA;
    if (alive.length !== 1) continue;
    res = MORE;
    const r = settle(emit({ kind: "trial", level: 2, tiles: [t], dot: alive[0]!, because: [] }));
    if (r !== null) return r;
  }
  return res;
};

const RULES: readonly (readonly [Level, Rule, StepKind])[] = [
  [0, mirrorRule, "mirror"],
  [0, onlyDotRule, "only-dot"],
  [1, cutRule, "cut"],
  [2, trialRule, "trial"],
];

export function propagate(g: Geometry, own: Owners, maxLevel: Level): { ok: boolean; used: Level } {
  let used: Level = 0;
  const emit: Emit = (s) => (applyStep(g, own, s) ? 1 : -1);
  outer: for (;;) {
    for (const [level, rule] of RULES) {
      if (level > maxLevel) break;
      const r = rule(g, own, emit);
      if (r === CONTRA) return { ok: false, used };
      if (r === MORE) {
        if (level > used) used = level;
        continue outer;
      }
    }
    return { ok: consistent(g, own, possibilities(g, own)), used };
  }
}

export function scanSteps(p: GalaxiesPuzzle, own: Owners, kinds: readonly StepKind[], accept: (s: Step) => boolean): Step | null {
  const g = geometry(p);
  let found: Step | null = null;
  const emit: Emit = (s) => {
    if (!kinds.includes(s.kind) || !accept(s)) return 0;
    found = s;
    return 1;
  };
  for (const [, rule, kind] of RULES) {
    if (!kinds.includes(kind)) continue;
    rule(g, own, emit);
    if (found) return found;
  }
  return null;
}

export const isComplete = (own: Owners): boolean => own.every((d) => d !== -1);

export function logicSolve(p: GalaxiesPuzzle, maxLevel: Level = 2): { level: Level | null; own: Owners; ok: boolean } {
  const g = geometry(p);
  const own = freshOwners(g);
  const r = propagate(g, own, maxLevel);
  return { level: r.ok && isComplete(own) ? r.used : null, own, ok: r.ok };
}

export function countSolutions(p: GalaxiesPuzzle, start: Owners, limit = 2): { count: number; first: Owners | null } {
  const g = geometry(p);
  const out = { count: 0, first: null as Owners | null };
  const search = (own: Owners): void => {
    if (!close(g, own, 0)) return;
    if (isComplete(own)) {
      out.count++;
      if (!out.first) out.first = own.slice();
      return;
    }
    const poss = possibilities(g, own);
    let pick = -1, best: number[] = [];
    for (let t = 0; t < g.n; t++) {
      if (own[t] !== -1) continue;
      const c = candidates(g, poss, t);
      if (pick < 0 || c.length < best.length) { pick = t; best = c; }
    }
    for (const d of best) {
      if (out.count >= limit) return;
      const o = own.slice();
      o[pick] = d;
      search(o);
    }
  };
  search(start.slice());
  return out;
}

export interface Analysis {
  count: 0 | 1 | 2;
  level: Level | null;
  /** Dot per tile in the (first) solution. */
  solution: number[] | null;
}

const analyses = new WeakMap<GalaxiesPuzzle, Analysis>();

export function analyze(p: GalaxiesPuzzle): Analysis {
  const hit = analyses.get(p);
  if (hit) return hit;
  const r = logicSolve(p, 2);
  let a: Analysis;
  if (r.level !== null) a = { count: 1, level: r.level, solution: Array.from(r.own) };
  else if (!r.ok) a = { count: 0, level: null, solution: null };
  else {
    const c = countSolutions(p, r.own, 2);
    a = { count: c.count as 0 | 1 | 2, level: null, solution: c.first ? Array.from(c.first) : null };
  }
  analyses.set(p, a);
  return a;
}

// --- generation ---

/**
 * A random partition into galaxies: each starts at a free tile with a dot placed on it, on one of
 * its edges or on one of its corners (whichever keeps every tile under the dot free), then grows by
 * pairs of mirror-image free tiles until it reaches a random size or can't grow. Dots come out in
 * reading order.
 */
export function randomPartition(w: number, h: number, maxSize: number, rng: Rng): GalaxiesPuzzle {
  const n = w * h;
  const owner = new Int32Array(n).fill(-1);
  const dots: Dot[] = [];
  const free = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && owner[y * w + x] === -1;
  for (const start of rng.shuffle(Array.from({ length: n }, (_, i) => i))) {
    if (owner[start] !== -1) continue;
    const sx = start % w, sy = Math.floor(start / w);
    const options: [number, number][] = [[2 * sx + 1, 2 * sy + 1]];
    if (free(sx + 1, sy)) options.push([2 * sx + 2, 2 * sy + 1]);
    if (free(sx, sy + 1)) options.push([2 * sx + 1, 2 * sy + 2]);
    if (free(sx + 1, sy) && free(sx, sy + 1) && free(sx + 1, sy + 1)) options.push([2 * sx + 2, 2 * sy + 2]);
    const [dx, dy] = rng.pick(options);
    const d = dots.length;
    dots.push({ x: dx, y: dy, black: false });
    const region: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (Math.abs(2 * x + 1 - dx) <= 1 && Math.abs(2 * y + 1 - dy) <= 1) { owner[y * w + x] = d; region.push(y * w + x); }
    }
    const size = Math.ceil(maxSize / 3) + rng.int(maxSize);
    while (region.length < size) {
      const opts: number[] = [];
      for (const t of region) {
        for (const [ax, ay] of [[t % w, Math.floor(t / w) - 1], [t % w + 1, Math.floor(t / w)], [t % w, Math.floor(t / w) + 1], [t % w - 1, Math.floor(t / w)]] as const) {
          if (!free(ax, ay)) continue;
          const mx = dx - ax - 1, my = dy - ay - 1;
          if (!free(mx, my)) continue;
          opts.push(ay * w + ax);
        }
      }
      if (!opts.length) break;
      const t = rng.pick(opts);
      const m = (dy - Math.floor(t / w) - 1) * w + (dx - (t % w) - 1);
      owner[t] = d;
      region.push(t);
      if (m !== t) { owner[m] = d; region.push(m); }
    }
  }
  dots.sort((a, b) => a.y - b.y || a.x - b.x);
  return { w, h, dots };
}

const EXACT_ATTEMPTS = 1500;
const MAX_ATTEMPTS = 20000;

/**
 * Deterministic in (w, h, level, rng). Random partitions are kept when their dots alone solve at
 * `level` (so the answer is unique); one needing exactly `level` is returned if one turns up within
 * EXACT_ATTEMPTS solvable partitions, otherwise the hardest found.
 */
export async function generatePuzzle(w: number, h: number, level: Level, rng: Rng, ctx: GenerateContext): Promise<GalaxiesPuzzle> {
  let best: { p: GalaxiesPuzzle; level: Level } | null = null;
  let made = 0;
  const maxSize = Math.max(4, Math.round(Math.sqrt(w * h) * 2));
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (best && made >= EXACT_ATTEMPTS) break;
    if (attempt % 4 === 0) await ctx.yield();
    const p = randomPartition(w, h, maxSize, rng.fork(`attempt ${attempt}`));
    if (p.dots.length < 2) continue;
    const got = logicSolve(p, level).level;
    if (got === null) continue;
    made++;
    if (got === level) return p;
    if (!best || got > best.level) best = { p, level: got };
  }
  if (best) return best.p;
  throw new Error("couldn't make a puzzle with these settings; try a different size");
}
