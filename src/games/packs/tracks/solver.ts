import type { Rng } from "../../core/rng";
import type { GenerateContext } from "../../core/types";
import { DOWN, DX, DY, LEFT, LINE, NO, RIGHT, UNK, UP, edgeAt, edgeGrid, opposite, otherEnd, step, type EdgeGrid } from "../../lib/edges";

/** Direction bits as in the game id. */
export const BIT = [2, 1, 8, 4] as const;

export interface TracksPuzzle {
  w: number;
  h: number;
  /** Track pieces shown from the start: direction bits per cell (right 1, up 2, left 4, down 8), 0 for none. */
  given: number[];
  /** Track cells per column, left to right. */
  cols: number[];
  /** Track cells per row, top to bottom. */
  rows: number[];
  /** Row where the track enters from the left edge. */
  entry: number;
  /** Column where the track leaves through the bottom edge. */
  exit: number;
}

/** Cell knowledge. */
export const TRACK = 1, EMPTY = 2;

export interface Knowledge {
  /** Per edge: UNK, LINE or NO. */
  e: Int8Array;
  /** Per cell: UNK, TRACK or EMPTY. */
  c: Int8Array;
}

export const LEVEL_NAMES = ["easy", "medium", "hard"] as const;
/** 0 easy: each cell's two ends, row and column counts, no loops. 1 medium: + a track that would drag its neighbor in. 2 hard: + one-cell or one-edge trials. */
export type Level = 0 | 1 | 2;

export type StepKind = "no-room" | "through" | "count-full" | "count-needs" | "loop" | "neighbours" | "trial";

export interface Step {
  kind: StepKind;
  level: Level;
  lines: number[];
  nos: number[];
  tracks: number[];
  empties: number[];
  /** Cells whose constraint forced the step. */
  because: number[];
  /** The count behind it: a column index, or w + row index. */
  count?: number;
}

type Emit = (s: Step) => -1 | 0 | 1;
const CONTRA = -1, NONE = 0, MORE = 1;
type RuleResult = typeof CONTRA | typeof NONE | typeof MORE;
type Rule = (p: TracksPuzzle, g: EdgeGrid, k: Knowledge, emit: Emit) => RuleResult;

const blank = (): Omit<Step, "kind" | "level" | "because"> => ({ lines: [], nos: [], tracks: [], empties: [] });

/** The track's way in (left of the entry cell) and out (below the exit cell), as off-board lines. */
export const entryCell = (p: TracksPuzzle) => p.entry * p.w;
export const exitCell = (p: TracksPuzzle) => (p.h - 1) * p.w + p.exit;

/** State of the side of cell c in direction d: the off-board entrance and exit count as lines, other board edges as NO. */
export function side(p: TracksPuzzle, g: EdgeGrid, k: Knowledge, c: number, d: number): number {
  const e = edgeAt(g, c, d);
  if (e >= 0) return k.e[e]!;
  if ((c === entryCell(p) && d === LEFT) || (c === exitCell(p) && d === DOWN)) return LINE;
  return NO;
}

export function sides(p: TracksPuzzle, g: EdgeGrid, k: Knowledge, c: number): { lines: number; unk: number[] } {
  let lines = 0;
  const unk: number[] = [];
  for (let d = 0; d < 4; d++) {
    const v = side(p, g, k, c, d);
    if (v === LINE) lines++;
    else if (v === UNK) unk.push(edgeAt(g, c, d));
  }
  return { lines, unk };
}

export function freshKnowledge(p: TracksPuzzle): Knowledge {
  const g = edgeGrid(p.w, p.h);
  const k: Knowledge = { e: new Int8Array(g.ne), c: new Int8Array(g.n) };
  for (let c = 0; c < g.n; c++) {
    const bits = p.given[c]!;
    if (!bits) continue;
    k.c[c] = TRACK;
    for (let d = 0; d < 4; d++) {
      const e = edgeAt(g, c, d);
      if (e >= 0) k.e[e] = bits & BIT[d]! ? LINE : NO;
    }
  }
  return k;
}

export const copyKnowledge = (k: Knowledge): Knowledge => ({ e: k.e.slice(), c: k.c.slice() });

export function apply(g: EdgeGrid, k: Knowledge, s: Pick<Step, "lines" | "nos" | "tracks" | "empties">): boolean {
  for (const e of s.lines) {
    if (k.e[e] === NO) return false;
    k.e[e] = LINE;
  }
  for (const e of s.nos) {
    if (k.e[e] === LINE) return false;
    k.e[e] = NO;
  }
  for (const c of s.tracks) {
    if (k.c[c] === EMPTY) return false;
    k.c[c] = TRACK;
  }
  for (const c of s.empties) {
    if (k.c[c] === TRACK) return false;
    k.c[c] = EMPTY;
  }
  return true;
}

const changes = (k: Knowledge, s: Pick<Step, "lines" | "nos" | "tracks" | "empties">) =>
  s.lines.some((e) => k.e[e] !== LINE) || s.nos.some((e) => k.e[e] !== NO) || s.tracks.some((c) => k.c[c] !== TRACK) || s.empties.some((c) => k.c[c] !== EMPTY);

function settle(r: -1 | 0 | 1): RuleResult | null {
  return r === 0 ? null : r < 0 ? CONTRA : MORE;
}

/**
 * What the board shows without thinking: an empty cell has no track through its sides, a line
 * makes both its cells track, and a track cell with both ends drawn has no other way out. False
 * on a visible clash.
 */
export function closeObvious(p: TracksPuzzle, g: EdgeGrid, k: Knowledge): boolean {
  for (let changed = true; changed;) {
    changed = false;
    for (let c = 0; c < g.n; c++) {
      if (k.c[c] === EMPTY) {
        for (let d = 0; d < 4; d++) {
          const v = side(p, g, k, c, d);
          if (v === LINE) return false;
          const e = edgeAt(g, c, d);
          if (v === UNK) { k.e[e] = NO; changed = true; }
        }
        continue;
      }
      const { lines, unk } = sides(p, g, k, c);
      if (lines > 2) return false;
      if (lines > 0 && k.c[c] !== TRACK) { k.c[c] = TRACK; changed = true; }
      if (lines === 2 && unk.length) { for (const e of unk) k.e[e] = NO; changed = true; }
      if (k.c[c] === TRACK && lines + unk.length < 2) return false;
    }
  }
  return true;
}

const noRoomRule: Rule = (p, g, k, emit) => {
  let res: RuleResult = NONE;
  for (let c = 0; c < g.n; c++) {
    if (k.c[c] !== UNK) continue;
    const { lines, unk } = sides(p, g, k, c);
    if (lines + unk.length >= 2) continue;
    res = MORE;
    const r = settle(emit({ kind: "no-room", level: 0, ...blank(), empties: [c], because: [c] }));
    if (r !== null) return r;
  }
  return res;
};

const throughRule: Rule = (p, g, k, emit) => {
  let res: RuleResult = NONE;
  for (let c = 0; c < g.n; c++) {
    if (k.c[c] !== TRACK) continue;
    const { lines, unk } = sides(p, g, k, c);
    if (lines + unk.length < 2) return CONTRA;
    if (lines >= 2 || lines + unk.length !== 2 || !unk.length) continue;
    res = MORE;
    const r = settle(emit({ kind: "through", level: 0, ...blank(), lines: unk, because: [c] }));
    if (r !== null) return r;
  }
  return res;
};

/** Cells of count i (a column for i < w, else a row). */
export function countCells(p: Pick<TracksPuzzle, "w" | "h">, i: number): number[] {
  return i < p.w ? Array.from({ length: p.h }, (_, y) => y * p.w + i) : Array.from({ length: p.w }, (_, x) => (i - p.w) * p.w + x);
}

export const target = (p: TracksPuzzle, i: number): number => (i < p.w ? p.cols[i]! : p.rows[i - p.w]!);

function countRule(kind: "count-full" | "count-needs"): Rule {
  return (p, g, k, emit) => {
    let res: RuleResult = NONE;
    for (let i = 0; i < p.w + p.h; i++) {
      const cells = countCells(p, i);
      const t = target(p, i);
      let tracks = 0, empties = 0;
      const open: number[] = [];
      for (const c of cells) {
        if (k.c[c] === TRACK) tracks++;
        else if (k.c[c] === EMPTY) empties++;
        else open.push(c);
      }
      if (tracks > t || empties > cells.length - t) return CONTRA;
      if (!open.length) continue;
      let s: Step | null = null;
      if (kind === "count-full" && tracks === t) s = { kind, level: 0, ...blank(), empties: open, because: [], count: i };
      else if (kind === "count-needs" && empties === cells.length - t) s = { kind, level: 0, ...blank(), tracks: open, because: [], count: i };
      if (!s) continue;
      res = MORE;
      const r = settle(emit(s));
      if (r !== null) return r;
    }
    return res;
  };
}

/** Pieces of track: per cell its piece (-1 without lines), each piece's cells and loose ends (cells with one side drawn, off-board ones included). */
export function trackPieces(p: TracksPuzzle, g: EdgeGrid, k: Knowledge): { id: Int32Array; cells: number[][]; ends: number[][] } {
  const id = new Int32Array(g.n).fill(-1);
  const cells: number[][] = [], ends: number[][] = [];
  for (let s = 0; s < g.n; s++) {
    if (id[s] !== -1 || sides(p, g, k, s).lines === 0) continue;
    const pid = cells.length;
    const list: number[] = [], tips: number[] = [];
    const stack = [s];
    id[s] = pid;
    while (stack.length) {
      const c = stack.pop()!;
      list.push(c);
      if (sides(p, g, k, c).lines === 1) tips.push(c);
      for (let d = 0; d < 4; d++) {
        const e = edgeAt(g, c, d);
        if (e < 0 || k.e[e] !== LINE) continue;
        const o = otherEnd(g, e, c);
        if (id[o] === -1) {
          id[o] = pid;
          stack.push(o);
        }
      }
    }
    cells.push(list);
    ends.push(tips);
  }
  return { id, cells, ends };
}

/** Whether joining the entrance's piece and the exit's piece (cells `joined`) would be the whole answer. */
function wouldFinish(p: TracksPuzzle, g: EdgeGrid, k: Knowledge, joined: ReadonlySet<number>): boolean {
  for (let c = 0; c < g.n; c++) if (k.c[c] === TRACK && !joined.has(c)) return false;
  for (let i = 0; i < p.w + p.h; i++) {
    if (countCells(p, i).filter((c) => joined.has(c)).length !== target(p, i)) return false;
  }
  return true;
}

const loopRule: Rule = (p, g, k, emit) => {
  const pc = trackPieces(p, g, k);
  const inPiece = pc.id[entryCell(p)]!, outPiece = pc.id[exitCell(p)]!;
  if (inPiece >= 0 && inPiece === outPiece) return NONE;
  let res: RuleResult = NONE;
  for (let i = 0; i < pc.cells.length; i++) {
    if (pc.ends[i]!.length === 0 && i !== inPiece) return CONTRA;
  }
  for (let e = 0; e < g.ne; e++) {
    if (k.e[e] !== UNK) continue;
    const a = g.ea[e]!, b = g.eb[e]!;
    const pa = pc.id[a]!, pb = pc.id[b]!;
    if (pa < 0 || pb < 0 || !pc.ends[pa]!.includes(a) || !pc.ends[pb]!.includes(b)) continue;
    let bad = false;
    if (pa === pb) bad = true;
    else if ((pa === inPiece && pb === outPiece) || (pa === outPiece && pb === inPiece)) {
      bad = !wouldFinish(p, g, k, new Set([...pc.cells[pa]!, ...pc.cells[pb]!]));
    }
    if (!bad) continue;
    res = MORE;
    const r = settle(emit({ kind: "loop", level: 0, ...blank(), nos: [e], because: [a, b] }));
    if (r !== null) return r;
  }
  return res;
};

/** Ways out of c other than direction d that could still be used. */
const exitsExcept = (p: TracksPuzzle, g: EdgeGrid, k: Knowledge, c: number, d: number) => [0, 1, 2, 3].filter((x) => x !== d && side(p, g, k, c, x) !== NO).length;

const neighboursRule: Rule = (p, g, k, emit) => {
  let res: RuleResult = NONE;
  for (let i = 0; i < p.w + p.h; i++) {
    const cells = countCells(p, i);
    let fill = target(p, i), empty = cells.length - fill;
    for (const c of cells) {
      if (k.c[c] === TRACK) fill--;
      else if (k.c[c] === EMPTY) empty--;
    }
    if (fill !== 1 && empty !== 1) continue;
    const along = i < p.w ? [DOWN, UP] : [RIGHT, LEFT];
    for (const c of cells) {
      for (const d of along) {
        const n = step(g, c, d);
        if (n < 0 || k.c[c] !== UNK || k.c[n] !== UNK) continue;
        if (exitsExcept(p, g, k, c, d) >= 2) continue;
        let s: Step | null = null;
        if (fill === 1) s = { kind: "neighbours", level: 1, ...blank(), empties: [c], because: [n], count: i };
        else if (empty === 1) s = { kind: "neighbours", level: 1, ...blank(), tracks: [n], because: [c], count: i };
        if (!s) continue;
        res = MORE;
        const r = settle(emit(s));
        if (r !== null) return r;
      }
    }
  }
  return res;
};

const EASY_RULES: Rule[] = [noRoomRule, throughRule, countRule("count-full"), countRule("count-needs"), loopRule];

/** The easy rules (and, at level 1, the medium ones) plus the obvious ones, until nothing changes; false on contradiction. */
function close(p: TracksPuzzle, g: EdgeGrid, k: Knowledge, level: 0 | 1): boolean {
  const rules = level === 0 ? EASY_RULES : [...EASY_RULES, neighboursRule];
  for (;;) {
    if (!closeObvious(p, g, k)) return false;
    let changed = false;
    for (const rule of rules) {
      const r = rule(p, g, k, (s) => {
        if (!changes(k, s)) return 0;
        changed = true;
        return apply(g, k, s) ? 1 : -1;
      });
      if (r === CONTRA) return false;
      if (changed) break;
    }
    if (!changed) return true;
  }
}

const trialRule: Rule = (p, g, k, emit) => {
  let res: RuleResult = NONE;
  const tryIt = (s: Omit<Step, "kind" | "level" | "because">, other: Omit<Step, "kind" | "level" | "because">, because: number[]): RuleResult | null => {
    const t = copyKnowledge(k);
    if (apply(g, t, s) && close(p, g, t, 1)) return null;
    res = MORE;
    return settle(emit({ kind: "trial", level: 2, ...other, because }));
  };
  for (let c = 0; c < g.n; c++) {
    if (k.c[c] !== UNK) continue;
    const r = tryIt({ ...blank(), tracks: [c] }, { ...blank(), empties: [c] }, [c]) ?? tryIt({ ...blank(), empties: [c] }, { ...blank(), tracks: [c] }, [c]);
    if (r !== null) return r;
  }
  for (let e = 0; e < g.ne; e++) {
    if (k.e[e] !== UNK) continue;
    const ab = [g.ea[e]!, g.eb[e]!];
    const r = tryIt({ ...blank(), lines: [e] }, { ...blank(), nos: [e] }, ab) ?? tryIt({ ...blank(), nos: [e] }, { ...blank(), lines: [e] }, ab);
    if (r !== null) return r;
  }
  return res;
};

const RULES: readonly (readonly [Level, Rule, StepKind[]])[] = [
  [0, noRoomRule, ["no-room"]],
  [0, throughRule, ["through"]],
  [0, countRule("count-full"), ["count-full"]],
  [0, countRule("count-needs"), ["count-needs"]],
  [0, loopRule, ["loop"]],
  [1, neighboursRule, ["neighbours"]],
  [2, trialRule, ["trial"]],
];

/** The single track from the entrance to the exit, meeting every count, with nothing else marked as track. */
export function isComplete(p: TracksPuzzle, g: EdgeGrid, k: Knowledge): boolean {
  const pc = trackPieces(p, g, k);
  const i = pc.id[entryCell(p)]!;
  if (i < 0 || pc.id[exitCell(p)] !== i || pc.cells.length !== 1 || pc.ends[i]!.length) return false;
  return wouldFinish(p, g, k, new Set(pc.cells[i]));
}

export function propagate(p: TracksPuzzle, g: EdgeGrid, k: Knowledge, maxLevel: Level): { ok: boolean; used: Level } {
  let used: Level = 0;
  const emit: Emit = (s) => (apply(g, k, s) ? 1 : -1);
  outer: for (;;) {
    if (!closeObvious(p, g, k)) return { ok: false, used };
    if (isComplete(p, g, k)) return { ok: true, used };
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

/** Every step of the given kinds in rule order, until `visit` returns true. Reads k without changing it. */
export function scanSteps(p: TracksPuzzle, k: Knowledge, kinds: readonly StepKind[], visit: (s: Step) => boolean): void {
  const g = edgeGrid(p.w, p.h);
  let stop = false;
  const emit: Emit = (s) => {
    if (!kinds.includes(s.kind) || !visit(s)) return 0;
    stop = true;
    return 1;
  };
  for (const [, rule, ks] of RULES) {
    if (!ks.some((x) => kinds.includes(x))) continue;
    rule(p, g, k, emit);
    if (stop) return;
  }
}

export function logicSolve(p: TracksPuzzle, maxLevel: Level = 2): { level: Level | null; k: Knowledge; ok: boolean } {
  const g = edgeGrid(p.w, p.h);
  const k = freshKnowledge(p);
  const r = propagate(p, g, k, maxLevel);
  return { level: r.ok && isComplete(p, g, k) ? r.used : null, k, ok: r.ok };
}

/** Track edges of a knowledge state: 1 per LINE edge. */
export const trackEdges = (k: Knowledge): number[] => Array.from(k.e, (v) => (v === LINE ? 1 : 0));

export function countSolutions(p: TracksPuzzle, start: Knowledge, limit = 2): { count: number; first: Knowledge | null } {
  const g = edgeGrid(p.w, p.h);
  const out = { count: 0, first: null as Knowledge | null };
  const search = (k: Knowledge): void => {
    if (!close(p, g, k, 0)) return;
    if (isComplete(p, g, k)) {
      out.count++;
      if (!out.first) out.first = copyKnowledge(k);
      return;
    }
    const pc = trackPieces(p, g, k);
    let pick = -1;
    const end = pc.ends[pc.id[entryCell(p)]!]?.[0];
    if (end !== undefined) pick = sides(p, g, k, end).unk[0] ?? -1;
    for (let c = 0; c < g.n && pick < 0; c++) {
      if (k.c[c] === TRACK) pick = sides(p, g, k, c).unk[0] ?? -1;
    }
    if (pick < 0) return;
    for (const v of [LINE, NO]) {
      if (out.count >= limit) return;
      const t = copyKnowledge(k);
      t.e[pick] = v;
      search(t);
    }
  };
  search(copyKnowledge(start));
  return out;
}

export interface Analysis {
  count: 0 | 1 | 2;
  level: Level | null;
  /** 1 per track edge of the (first) solution. */
  solution: number[] | null;
}

const analyses = new WeakMap<TracksPuzzle, Analysis>();

export function analyze(p: TracksPuzzle): Analysis {
  const hit = analyses.get(p);
  if (hit) return hit;
  const r = logicSolve(p, 2);
  let a: Analysis;
  if (r.level !== null) a = { count: 1, level: r.level, solution: trackEdges(r.k) };
  else if (!r.ok) a = { count: 0, level: null, solution: null };
  else {
    const c = countSolutions(p, r.k, 2);
    a = { count: c.count as 0 | 1 | 2, level: null, solution: c.first ? trackEdges(c.first) : null };
  }
  analyses.set(p, a);
  return a;
}

// --- generation ---

/** A random self-avoiding walk from the left edge (row `entry`) until it steps off the bottom edge: per cell its direction bits. */
function layPath(w: number, h: number, rng: Rng): { bits: number[]; entry: number; exit: number } {
  for (;;) {
    const bits = Array.from({ length: w * h }, () => 0);
    const entry = rng.int(h);
    let x = 0, y = entry;
    bits[y * w + x] = BIT[LEFT];
    let done = false, exit = -1;
    for (;;) {
      const dirs = rng.shuffle([UP, RIGHT, DOWN, LEFT]);
      let moved = false;
      for (const d of dirs) {
        const nx = x + DX[d]!, ny = y + DY[d]!;
        if (ny === h && nx >= 0 && nx < w) {
          bits[y * w + x] = bits[y * w + x]! | BIT[d]!;
          exit = x;
          done = true;
          moved = true;
          break;
        }
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || bits[ny * w + nx]) continue;
        bits[y * w + x] = bits[y * w + x]! | BIT[d]!;
        bits[ny * w + nx] = BIT[opposite(d)]!;
        x = nx;
        y = ny;
        moved = true;
        break;
      }
      if (done || !moved) break;
    }
    if (done) return { bits, entry, exit };
  }
}

export interface GenOptions {
  w: number;
  h: number;
  level: Level;
}

const EXACT_ATTEMPTS = 80;
const MAX_ATTEMPTS = 1000;

/**
 * Deterministic in (o, rng). A random track gets its counts (none of them 0, no two neighboring
 * counts both 1, no 1 where the track enters or leaves); pieces of it are shown until the puzzle
 * is solvable at o.level (so unique), then each dropped again if it can be. It needs exactly
 * o.level when such a board turns up within EXACT_ATTEMPTS boards, otherwise the hardest found is
 * returned.
 */
export async function generatePuzzle(o: GenOptions, rng: Rng, ctx: GenerateContext): Promise<TracksPuzzle> {
  const { w, h } = o;
  let best: { p: TracksPuzzle; level: Level } | null = null;
  let made = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (best && made >= EXACT_ATTEMPTS) break;
    await ctx.yield();
    const r = rng.fork(`attempt ${attempt}`);
    const { bits, entry, exit } = layPath(w, h, r);
    const cols = Array.from({ length: w }, (_, x) => countCells({ w, h }, x).filter((c) => bits[c]).length);
    const rows = Array.from({ length: h }, (_, y) => countCells({ w, h }, w + y).filter((c) => bits[c]).length);
    const all = [...cols, ...rows];
    if (all.some((v) => v === 0)) continue;
    if (all.some((v, i) => v === 1 && i > 0 && all[i - 1] === 1) || rows[entry] === 1 || cols[exit] === 1) continue;
    const given = bits.map(() => 0);
    const en = entry * w, ex = (h - 1) * w + exit;
    given[en] = bits[en]!;
    given[ex] = bits[ex]!;
    const puzzle = (): TracksPuzzle => ({ w, h, given: given.slice(), cols, rows, entry, exit });
    const addLevel = Math.min(o.level, 1) as Level;
    const order = r.shuffle(bits.flatMap((b, c) => (b && c !== en && c !== ex ? [c] : [])));
    let i = 0;
    while (logicSolve(puzzle(), addLevel).level === null && i < order.length) {
      given[order[i]!] = bits[order[i]!]!;
      i++;
      if (i % 4 === 0) await ctx.yield();
    }
    if (logicSolve(puzzle(), addLevel).level === null) continue;
    for (const c of order.slice(0, i)) {
      given[c] = 0;
      if (logicSolve(puzzle(), o.level).level === null) given[c] = bits[c]!;
      await ctx.yield();
    }
    const p = puzzle();
    made++;
    const level = logicSolve(p, o.level).level!;
    if (level === o.level) return p;
    if (!best || level > best.level) best = { p, level };
  }
  if (best) return best.p;
  throw new Error("couldn't make a puzzle with these settings; try a different size");
}
