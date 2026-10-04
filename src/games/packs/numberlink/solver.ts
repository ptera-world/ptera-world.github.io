import type { Rng } from "../../core/rng";
import type { GenerateContext } from "../../core/types";
import { LINE, NO, UNK, edgeAt, edgeGrid, otherEnd, pieces, type EdgeGrid } from "../../lib/edges";
import { randomHamiltonPath } from "../../lib/hamilton";

export interface NumberlinkPuzzle {
  w: number;
  h: number;
  /** Per cell: 0, or the pair id 1…pairs of the dot on it. Every pair id appears exactly twice. */
  dots: number[];
  /** Every cell must be on a line (Flow Free); false lets cells stay empty (Nikoli). */
  fill: boolean;
}

export const MAX_PAIRS = 30;
/** Colour-domain bit for "this cell stays empty" (only when !fill). */
export const EMPTY_BIT = 1 << 30;

/**
 * What is known: per edge UNK / LINE / NO, and per cell the pairs whose line may pass through it
 * (bit i-1 for pair i, plus EMPTY_BIT where the cell may stay empty).
 */
export interface Knowledge {
  e: Int8Array;
  col: Int32Array;
}

export const bit = (pair: number): number => 1 << (pair - 1);
const single = (m: number): boolean => m !== 0 && (m & (m - 1)) === 0;
export const pairOf = (m: number): number => 31 - Math.clz32(m) + 1;

const pairCache = new WeakMap<NumberlinkPuzzle, number[][]>();

/** The two dot cells of each pair, indexed by pair id (index 0 unused). */
export function dotCells(p: NumberlinkPuzzle): number[][] {
  const hit = pairCache.get(p);
  if (hit) return hit;
  const out: number[][] = [[]];
  p.dots.forEach((d, c) => {
    if (!d) return;
    while (out.length <= d) out.push([]);
    out[d]!.push(c);
  });
  pairCache.set(p, out);
  return out;
}

export const pairCount = (p: NumberlinkPuzzle): number => dotCells(p).length - 1;

export function freshKnowledge(p: NumberlinkPuzzle): Knowledge {
  const g = edgeGrid(p.w, p.h);
  const all = (1 << pairCount(p)) - 1 | (p.fill ? 0 : EMPTY_BIT);
  return { e: new Int8Array(g.ne), col: Int32Array.from(p.dots, (d) => (d ? bit(d) : all)) };
}

export const copyK = (k: Knowledge): Knowledge => ({ e: k.e.slice(), col: k.col.slice() });

export function sides(g: EdgeGrid, k: Knowledge, c: number): { lines: number; unk: number[] } {
  let lines = 0;
  const unk: number[] = [];
  for (let d = 0; d < 4; d++) {
    const e = edgeAt(g, c, d);
    if (e < 0) continue;
    if (k.e[e] === LINE) lines++;
    else if (k.e[e] === UNK) unk.push(e);
  }
  return { lines, unk };
}

/**
 * What the board shows at a glance, closed under itself: a cell with all its lines has no others,
 * and a line carries its colour along. False if that already breaks a rule (too many lines, a
 * line that can't go on, a loop, two colours joined).
 */
export function closeObvious(p: NumberlinkPuzzle, g: EdgeGrid, k: Knowledge): boolean {
  for (let changed = true; changed;) {
    changed = false;
    for (let c = 0; c < g.n; c++) {
      const { lines, unk } = sides(g, k, c);
      const max = p.dots[c] ? 1 : 2;
      if (lines > max) return false;
      if (lines > 0 && k.col[c]! & EMPTY_BIT) {
        k.col[c]! &= ~EMPTY_BIT;
        if (!k.col[c]) return false;
        changed = true;
      }
      if (lines === max && unk.length) {
        for (const e of unk) k.e[e] = NO;
        changed = true;
      }
      if (lines + unk.length < (p.dots[c] ? 1 : p.fill ? 2 : lines > 0 ? 2 : 0)) return false;
    }
    for (let e = 0; e < g.ne; e++) {
      if (k.e[e] !== LINE) continue;
      const a = g.ea[e]!, b = g.eb[e]!;
      const m = k.col[a]! & k.col[b]! & ~EMPTY_BIT;
      if (!m) return false;
      if (m !== k.col[a] || m !== k.col[b]) {
        k.col[a] = m;
        k.col[b] = m;
        changed = true;
      }
    }
  }
  const pc = pieces(g, k.e);
  for (let i = 0; i < pc.cells.length; i++) if (pc.ends[i]!.length === 0) return false;
  return true;
}

export function solved(p: NumberlinkPuzzle, k: Knowledge): boolean {
  return k.e.every((v) => v !== UNK);
}

// --- steps ---

export type StepKind = "one-way" | "corridor" | "dead-end" | "colors" | "loop" | "reach" | "trial";

/** Technique level of each kind; equal levels are alternatives for filled and open boards. */
export const KIND_LEVEL: Record<StepKind, number> = { "one-way": 1, corridor: 2, "dead-end": 2, colors: 3, loop: 4, reach: 5, trial: 6 };

export interface Step {
  kind: StepKind;
  lines: number[];
  nos: number[];
  /** Cells explaining why. */
  because: number[];
  /** For "reach": the pairs that can still pass through each `because` cell. */
  domains?: number[];
}

/** Return true to stop scanning. */
type Emit = (st: Step) => boolean;
/** False: the knowledge breaks a rule. */
type Rule = (p: NumberlinkPuzzle, g: EdgeGrid, k: Knowledge, emit: Emit) => boolean;

const oneWay: Rule = (p, g, k, emit) => {
  for (let c = 0; c < g.n; c++) {
    const { lines, unk } = sides(g, k, c);
    const loose = p.dots[c] ? lines === 0 : lines === 1;
    if (!loose) continue;
    if (unk.length === 0) return false;
    if (unk.length === 1 && emit({ kind: "one-way", lines: unk, nos: [], because: [c] })) return true;
  }
  return true;
};

const corridor: Rule = (p, g, k, emit) => {
  if (!p.fill) return true;
  for (let c = 0; c < g.n; c++) {
    if (p.dots[c]) continue;
    const { lines, unk } = sides(g, k, c);
    if (lines !== 0) continue;
    if (unk.length < 2) return false;
    if (unk.length === 2 && emit({ kind: "corridor", lines: unk, nos: [], because: [c] })) return true;
  }
  return true;
};

const deadEnd: Rule = (p, g, k, emit) => {
  if (p.fill) return true;
  for (let c = 0; c < g.n; c++) {
    if (p.dots[c]) continue;
    const { lines, unk } = sides(g, k, c);
    if (lines === 0 && unk.length === 1 && emit({ kind: "dead-end", lines: [], nos: unk, because: [c] })) return true;
  }
  return true;
};

const colors: Rule = (_p, g, k, emit) => {
  for (let e = 0; e < g.ne; e++) {
    if (k.e[e] !== UNK) continue;
    const a = g.ea[e]!, b = g.eb[e]!;
    const ca = k.col[a]! & ~EMPTY_BIT, cb = k.col[b]! & ~EMPTY_BIT;
    if (single(ca) && single(cb) && ca !== cb && !(k.col[a]! & EMPTY_BIT) && !(k.col[b]! & EMPTY_BIT)
      && emit({ kind: "colors", lines: [], nos: [e], because: [a, b] })) return true;
  }
  return true;
};

const loop: Rule = (_p, g, k, emit) => {
  const pc = pieces(g, k.e);
  for (let e = 0; e < g.ne; e++) {
    if (k.e[e] !== UNK) continue;
    const a = g.ea[e]!, b = g.eb[e]!;
    if (pc.id[a] !== -1 && pc.id[a] === pc.id[b] && emit({ kind: "loop", lines: [], nos: [e], because: pc.ends[pc.id[a]!]! })) return true;
  }
  return true;
};

/** Cells colour `pair` can reach from its first dot over cells allowing it, avoiding `skip`. */
function reachable(p: NumberlinkPuzzle, g: EdgeGrid, k: Knowledge, dom: Int32Array, pair: number, skip: number): Uint8Array {
  const b = bit(pair);
  const seen = new Uint8Array(g.n);
  const start = dotCells(p)[pair]![0]!;
  seen[start] = 1;
  const stack = [start];
  while (stack.length) {
    const c = stack.pop()!;
    for (let d = 0; d < 4; d++) {
      const e = edgeAt(g, c, d);
      if (e < 0 || k.e[e] === NO) continue;
      const o = otherEnd(g, e, c);
      if (seen[o] || o === skip || !(dom[o]! & b)) continue;
      seen[o] = 1;
      stack.push(o);
    }
  }
  return seen;
}

/** Cells of one shortest route from a to b over cells allowing colour bit b (a and b included). */
function route(g: EdgeGrid, k: Knowledge, dom: Int32Array, colour: number, a: number, b: number): number[] {
  const prev = new Int32Array(g.n).fill(-1);
  prev[a] = a;
  const queue = [a];
  for (let i = 0; i < queue.length && prev[b] === -1; i++) {
    const c = queue[i]!;
    for (let d = 0; d < 4; d++) {
      const e = edgeAt(g, c, d);
      if (e < 0 || k.e[e] === NO) continue;
      const o = otherEnd(g, e, c);
      if (prev[o] !== -1 || !(dom[o]! & colour)) continue;
      prev[o] = c;
      queue.push(o);
    }
  }
  const out: number[] = [];
  if (prev[b] === -1) return out;
  for (let c = b; c !== a; c = prev[c]!) out.push(c);
  out.push(a);
  return out;
}

/**
 * Narrow every cell's colours to those whose line can still reach it, and (with `cuts`) fix a cell
 * to a colour when every route between that colour's dots passes through it. Null on a clash.
 */
export function domains(p: NumberlinkPuzzle, g: EdgeGrid, k: Knowledge, cuts: boolean): Int32Array | null {
  const dom = k.col.slice();
  const pairs = pairCount(p);
  const ends = dotCells(p);
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 1; i <= pairs; i++) {
      const b = bit(i);
      const seen = reachable(p, g, k, dom, i, -1);
      if (!seen[ends[i]![1]!]) return null;
      for (let c = 0; c < g.n; c++) {
        if (!seen[c] && dom[c]! & b) {
          dom[c]! &= ~b;
          if (!dom[c]) return null;
          changed = true;
        }
      }
      if (!cuts) continue;
      for (const c of route(g, k, dom, b, ends[i]![0]!, ends[i]![1]!)) {
        if (dom[c] === b || p.dots[c]) continue;
        if (!reachable(p, g, k, dom, i, c)[ends[i]![1]!]) {
          dom[c] = b;
          changed = true;
        }
      }
    }
  }
  return dom;
}

const shares = (dom: Int32Array, a: number, b: number) => (dom[a]! & dom[b]! & ~EMPTY_BIT) !== 0;

function reachRule(cuts: boolean): Rule {
  return (p, g, k, emit) => {
    const dom = domains(p, g, k, cuts);
    if (!dom) return false;
    for (let e = 0; e < g.ne; e++) {
      if (k.e[e] !== UNK) continue;
      const a = g.ea[e]!, b = g.eb[e]!;
      if (!shares(dom, a, b) && emit({ kind: "reach", lines: [], nos: [e], because: [a, b], domains: [dom[a]!, dom[b]!] })) return true;
    }
    for (let c = 0; c < g.n; c++) {
      const { lines, unk } = sides(g, k, c);
      const want = p.dots[c] || p.fill || lines > 0 || !(dom[c]! & EMPTY_BIT) ? (p.dots[c] ? 1 : 2) - lines : 0;
      if (want <= 0) continue;
      if (unk.filter((e) => shares(dom, c, otherEnd(g, e, c))).length < want) return false;
    }
    return true;
  };
}

const reach = reachRule(true);
const reachCheap = reachRule(false);

/** Apply a step's facts. */
export function applyFacts(k: Knowledge, st: Step): void {
  for (const e of st.lines) k.e[e] = LINE;
  for (const e of st.nos) k.e[e] = NO;
}

const CHEAP: Rule[] = [oneWay, corridor, deadEnd, colors, loop];

/** Everything the techniques below "try it" can see, applied until nothing changes. False on a clash. */
export function propagate(p: NumberlinkPuzzle, g: EdgeGrid, k: Knowledge): boolean {
  if (!closeObvious(p, g, k)) return false;
  for (;;) {
    let hit = false;
    for (const rule of [...CHEAP, reachCheap]) {
      const found: Step[] = [];
      if (!rule(p, g, k, (st) => { found.push(st); return false; })) return false;
      for (const st of found) {
        for (const e of st.lines) if (k.e[e] === NO) return false;
        for (const e of st.nos) if (k.e[e] === LINE) return false;
        applyFacts(k, st);
      }
      if (found.length) {
        hit = true;
        if (!closeObvious(p, g, k)) return false;
        break;
      }
    }
    if (!hit) return true;
  }
}

const trial: Rule = (p, g, k, emit) => {
  for (let e = 0; e < g.ne; e++) {
    if (k.e[e] !== UNK) continue;
    for (const v of [LINE, NO]) {
      const t = copyK(k);
      t.e[e] = v;
      if (propagate(p, g, t)) continue;
      const st: Step = v === LINE ? { kind: "trial", lines: [], nos: [e], because: [g.ea[e]!, g.eb[e]!] } : { kind: "trial", lines: [e], nos: [], because: [g.ea[e]!, g.eb[e]!] };
      if (emit(st)) return true;
      break;
    }
  }
  return true;
};

const RULES: Record<StepKind, Rule> = { "one-way": oneWay, corridor, "dead-end": deadEnd, colors, loop, reach, trial };

/** First step of the given kinds (in that order) that `accept` takes. */
export function scanSteps(p: NumberlinkPuzzle, k: Knowledge, kinds: readonly StepKind[], accept: (st: Step) => boolean = () => true): Step | null {
  const g = edgeGrid(p.w, p.h);
  for (const kind of kinds) {
    let found: Step | null = null;
    RULES[kind](p, g, k, (st) => {
      if (!accept(st)) return false;
      found = st;
      return true;
    });
    if (found) return found;
  }
  return null;
}

export const ALL_KINDS: readonly StepKind[] = ["one-way", "corridor", "dead-end", "colors", "loop", "reach", "trial"];
export const kindsUpTo = (level: number): StepKind[] => ALL_KINDS.filter((k) => KIND_LEVEL[k] <= level);

export const LEVEL_NAMES = ["easy", "medium", "hard"] as const;
/** Hardest technique level each difficulty may need. */
export const DIFFICULTY_LEVEL = [4, 5, 6] as const;

/** Solve with techniques up to `maxLevel`. `level` is the hardest one used, or null if they don't finish it. */
export function logicSolve(p: NumberlinkPuzzle, maxLevel: number): { k: Knowledge; level: number | null; ok: boolean } {
  const g = edgeGrid(p.w, p.h);
  const k = freshKnowledge(p);
  if (!closeObvious(p, g, k)) return { k, level: null, ok: false };
  const kinds = kindsUpTo(maxLevel);
  let hardest = 0;
  for (;;) {
    if (solved(p, k)) return { k, level: hardest, ok: true };
    const st = scanSteps(p, k, kinds);
    if (!st) return { k, level: null, ok: true };
    hardest = Math.max(hardest, KIND_LEVEL[st.kind]);
    applyFacts(k, st);
    if (!closeObvious(p, g, k)) return { k, level: null, ok: false };
  }
}

/** Solutions (up to `limit`) by search, with the first one found. Gives up (count -1) past `budget` branches. */
export function countSolutions(p: NumberlinkPuzzle, start: Knowledge, limit: number, budget = 200_000): { count: number; first: Knowledge | null } {
  const g = edgeGrid(p.w, p.h);
  let count = 0, first: Knowledge | null = null, nodes = 0;
  const go = (k: Knowledge): boolean => {
    if (++nodes > budget) return true;
    if (!propagate(p, g, k)) return false;
    let pick = -1;
    for (let c = 0; c < g.n && pick < 0; c++) {
      const { lines, unk } = sides(g, k, c);
      if (unk.length && (p.dots[c] ? lines === 0 : lines === 1)) pick = unk[0]!;
    }
    if (pick < 0) pick = k.e.indexOf(UNK);
    if (pick < 0) {
      count++;
      first ??= k;
      return count >= limit;
    }
    for (const v of [LINE, NO]) {
      const t = copyK(k);
      t.e[pick] = v;
      if (go(t)) return true;
    }
    return false;
  };
  go(copyK(start));
  return { count: nodes > budget ? -1 : count, first };
}

export interface Analysis {
  /** 0 none, 1 unique, 2 several, -1 unknown (search gave up). */
  count: number;
  /** Per edge 1 where the unique solution has a line. */
  solution: number[] | null;
  /** Hardest technique level needed, or null if the techniques don't finish it. */
  level: number | null;
}

const analysisCache = new WeakMap<NumberlinkPuzzle, Analysis>();

export function analyze(p: NumberlinkPuzzle): Analysis {
  const hit = analysisCache.get(p);
  if (hit) return hit;
  let out: Analysis;
  const logic = logicSolve(p, 6);
  if (logic.level !== null) out = { count: 1, solution: Array.from(logic.k.e, (v) => (v === LINE ? 1 : 0)), level: logic.level };
  else if (!logic.ok) out = { count: 0, solution: null, level: null };
  else {
    const r = countSolutions(p, freshKnowledge(p), 2);
    out = { count: r.count, solution: r.count === 1 && r.first ? Array.from(r.first.e, (v) => (v === LINE ? 1 : 0)) : null, level: null };
  }
  analysisCache.set(p, out);
  return out;
}

// --- generation ---

/** Cut a path through every cell into lines of at least 3 cells that never run alongside themselves. */
function randomCover(w: number, h: number, rng: Rng): number[][] | null {
  const path = randomHamiltonPath(w, h, rng);
  const n = w * h;
  const target = Math.max(3, Math.ceil(n / MAX_PAIRS));
  const longest = Math.max(target + 2, Math.round(Math.sqrt(n) * 1.6));
  const adjacent = (a: number, b: number) => (Math.abs(a - b) === w) || (Math.abs(a - b) === 1 && Math.floor(a / w) === Math.floor(b / w));
  const out: number[][] = [];
  let seg: number[] = [];
  let cap = rng.range(target, longest);
  for (const c of path) {
    const touches = seg.length > 1 && seg.slice(0, -1).some((x) => adjacent(x, c));
    if (seg.length && (touches || seg.length >= cap)) {
      if (seg.length < 3) return null;
      out.push(seg);
      seg = [];
      cap = rng.range(target, longest);
    }
    seg.push(c);
  }
  if (seg.length < 3) return null;
  out.push(seg);
  return out.length <= MAX_PAIRS ? out : null;
}

export async function generatePuzzle(o: { w: number; h: number; difficulty: number }, rng: Rng, ctx: GenerateContext): Promise<NumberlinkPuzzle> {
  const want = DIFFICULTY_LEVEL[o.difficulty]!;
  let fallback: NumberlinkPuzzle | null = null, best = 0;
  for (let attempt = 0; ; attempt++) {
    await ctx.yield();
    const cover = randomCover(o.w, o.h, rng);
    if (!cover) continue;
    const dots = Array.from({ length: o.w * o.h }, () => 0);
    cover.sort((a, b) => Math.min(a[0]!, a[a.length - 1]!) - Math.min(b[0]!, b[b.length - 1]!)).forEach((seg, i) => {
      dots[seg[0]!] = i + 1;
      dots[seg[seg.length - 1]!] = i + 1;
    });
    const p: NumberlinkPuzzle = { w: o.w, h: o.h, dots, fill: true };
    const r = logicSolve(p, want);
    if (r.level === null) continue;
    if (r.level === want || (want === 4 && r.level >= 3)) return p;
    if (!fallback || r.level > best) { fallback = p; best = r.level; }
    if (attempt >= 3000) return fallback;
  }
}
