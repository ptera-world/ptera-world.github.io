import type { Rng } from "../../core/rng";
import type { GenerateContext } from "../../core/types";
import { DOWN, LEFT, LINE, NO, RIGHT, UNK, UP, around, edgeAt, edgeGrid, opposite, pieces, stateAt, step, type EdgeGrid } from "./edges";

export const EMPTY = 0, BLACK = 1, WHITE = 2;

export interface PearlPuzzle {
  w: number;
  h: number;
  /** Row-major: EMPTY, BLACK (the loop turns here) or WHITE (the loop goes straight). */
  pearls: number[];
}

/** Per edge: UNK, LINE or NO. */
export type Knowledge = Int8Array;

export const LEVEL_NAMES = ["easy", "hard"] as const;
/** 0 easy: cell counting, the pearls' own rules, no early loops. 1 hard: + one-edge trials refuted by the easy rules. */
export type Level = 0 | 1;

export type StepKind = "full" | "continue" | "dead-end" | "pearl-two" | "black" | "white" | "white-turn" | "loop" | "white-needs-turn" | "trial";

export interface Step {
  kind: StepKind;
  level: Level;
  lines: number[];
  nos: number[];
  /** Cells whose constraint forced the step. */
  because: number[];
}

type Emit = (s: Step) => -1 | 0 | 1;
const CONTRA = -1, NONE = 0, MORE = 1;
type RuleResult = typeof CONTRA | typeof NONE | typeof MORE;
type Rule = (p: PearlPuzzle, g: EdgeGrid, k: Knowledge, emit: Emit) => RuleResult;

export const freshKnowledge = (g: EdgeGrid): Knowledge => new Int8Array(g.ne);

export function apply(k: Knowledge, s: Pick<Step, "lines" | "nos">): boolean {
  for (const e of s.lines) {
    if (k[e] === NO) return false;
    k[e] = LINE;
  }
  for (const e of s.nos) {
    if (k[e] === LINE) return false;
    k[e] = NO;
  }
  return true;
}

function settle(r: -1 | 0 | 1): RuleResult | null {
  return r === 0 ? null : r < 0 ? CONTRA : MORE;
}

/** True if the step would change k. */
const changes = (k: Knowledge, lines: readonly number[], nos: readonly number[]) => lines.some((e) => k[e] !== LINE) || nos.some((e) => k[e] !== NO);

const cellRule = (kind: "full" | "continue" | "dead-end" | "pearl-two"): Rule => (p, g, k, emit) => {
  let res: RuleResult = NONE;
  for (let c = 0; c < g.n; c++) {
    const { lines, unk } = around(g, k, c);
    const pearl = p.pearls[c] !== EMPTY;
    if (lines > 2 || (lines === 1 && unk.length === 0) || (pearl && lines + unk.length < 2)) return CONTRA;
    if (!unk.length) continue;
    let s: Step | null = null;
    if (kind === "full" && lines === 2) s = { kind, level: 0, lines: [], nos: unk, because: [c] };
    else if (kind === "continue" && lines === 1 && unk.length === 1) s = { kind, level: 0, lines: unk, nos: [], because: [c] };
    else if (kind === "dead-end" && !pearl && lines === 0 && unk.length === 1) s = { kind, level: 0, lines: [], nos: unk, because: [c] };
    else if (kind === "pearl-two" && pearl && lines === 0 && unk.length === 2) s = { kind, level: 0, lines: unk, nos: [], because: [c] };
    if (!s) continue;
    res = MORE;
    const r = settle(emit(s));
    if (r !== null) return r;
  }
  return res;
};

/** Whether a black pearl at c can send its line out in direction d: two straight steps that way. */
function blackArm(p: PearlPuzzle, g: EdgeGrid, k: Knowledge, c: number, d: number): boolean {
  if (stateAt(g, k, c, d) === NO) return false;
  const n1 = step(g, c, d);
  if (n1 < 0 || p.pearls[n1] === BLACK || stateAt(g, k, n1, d) === NO) return false;
  return stateAt(g, k, n1, (d + 1) % 4) !== LINE && stateAt(g, k, n1, (d + 3) % 4) !== LINE;
}

/** Edges a black pearl's arm in direction d sets: two lines out, the opposite edge off, and n1's sides off. */
function blackArmEdges(g: EdgeGrid, c: number, d: number): { lines: number[]; nos: number[] } {
  const n1 = step(g, c, d);
  const lines = [edgeAt(g, c, d), edgeAt(g, n1, d)];
  const nos = [edgeAt(g, c, opposite(d)), edgeAt(g, n1, (d + 1) % 4), edgeAt(g, n1, (d + 3) % 4)].filter((e) => e >= 0);
  return { lines, nos };
}

const blackRule: Rule = (p, g, k, emit) => {
  let res: RuleResult = NONE;
  for (let c = 0; c < g.n; c++) {
    if (p.pearls[c] !== BLACK) continue;
    for (const [a, b] of [[UP, DOWN], [LEFT, RIGHT]] as const) {
      const okA = blackArm(p, g, k, c, a), okB = blackArm(p, g, k, c, b);
      if (!okA && !okB) return CONTRA;
      const lineA = stateAt(g, k, c, a) === LINE, lineB = stateAt(g, k, c, b) === LINE;
      if (lineA && lineB) return CONTRA;
      let d = -1;
      if (lineA || (!okB && okA)) d = a;
      else if (lineB || (!okA && okB)) d = b;
      if (d < 0) continue;
      if (!(d === a ? okA : okB)) return CONTRA;
      const { lines, nos } = blackArmEdges(g, c, d);
      if (!changes(k, lines, nos)) continue;
      res = MORE;
      const r = settle(emit({ kind: "black", level: 0, lines, nos, because: [c] }));
      if (r !== null) return r;
    }
  }
  return res;
};

/** Whether a white pearl at c can run along the axis containing direction d. */
function whiteAxis(g: EdgeGrid, k: Knowledge, c: number, d: number): boolean {
  return stateAt(g, k, c, d) !== NO && stateAt(g, k, c, opposite(d)) !== NO
    && stateAt(g, k, c, (d + 1) % 4) !== LINE && stateAt(g, k, c, (d + 3) % 4) !== LINE;
}

function whiteEdges(g: EdgeGrid, c: number, d: number): { lines: number[]; nos: number[] } {
  return {
    lines: [edgeAt(g, c, d), edgeAt(g, c, opposite(d))],
    nos: [edgeAt(g, c, (d + 1) % 4), edgeAt(g, c, (d + 3) % 4)].filter((e) => e >= 0),
  };
}

const whiteRule: Rule = (p, g, k, emit) => {
  let res: RuleResult = NONE;
  for (let c = 0; c < g.n; c++) {
    if (p.pearls[c] !== WHITE) continue;
    const v = whiteAxis(g, k, c, UP), hz = whiteAxis(g, k, c, LEFT);
    if (!v && !hz) return CONTRA;
    if (v && hz) continue;
    const { lines, nos } = whiteEdges(g, c, v ? UP : LEFT);
    if (!changes(k, lines, nos)) continue;
    res = MORE;
    const r = settle(emit({ kind: "white", level: 0, lines, nos, because: [c] }));
    if (r !== null) return r;
  }
  return res;
};

/** Axis a white pearl is known to run along (UP or LEFT), or -1. */
function whiteKnown(g: EdgeGrid, k: Knowledge, c: number): number {
  if (stateAt(g, k, c, UP) === LINE && stateAt(g, k, c, DOWN) === LINE) return UP;
  if (stateAt(g, k, c, LEFT) === LINE && stateAt(g, k, c, RIGHT) === LINE) return LEFT;
  return -1;
}

const whiteTurnRule: Rule = (p, g, k, emit) => {
  let res: RuleResult = NONE;
  for (let c = 0; c < g.n; c++) {
    if (p.pearls[c] !== WHITE) continue;
    const axis = whiteKnown(g, k, c);
    if (axis < 0) continue;
    for (const d of [axis, opposite(axis)]) {
      const n1 = step(g, c, d), n2 = step(g, c, opposite(d));
      if (stateAt(g, k, n1, d) !== LINE) continue;
      const far = edgeAt(g, n2, opposite(d));
      if (stateAt(g, k, n2, opposite(d)) === LINE) return CONTRA;
      if (far < 0 || k[far] === NO) continue;
      res = MORE;
      const r = settle(emit({ kind: "white-turn", level: 0, lines: [], nos: [far], because: [c, n1] }));
      if (r !== null) return r;
    }
  }
  return res;
};

/** True if a white pearl's neighbour n (reached going direction d) could still turn there. */
function canTurn(g: EdgeGrid, k: Knowledge, n: number, d: number): boolean {
  if (n < 0 || stateAt(g, k, n, d) === LINE) return false;
  return stateAt(g, k, n, (d + 1) % 4) !== NO || stateAt(g, k, n, (d + 3) % 4) !== NO;
}

const whiteNeedsTurnRule: Rule = (p, g, k, emit) => {
  let res: RuleResult = NONE;
  for (let c = 0; c < g.n; c++) {
    if (p.pearls[c] !== WHITE || whiteKnown(g, k, c) >= 0) continue;
    for (const [axis, other] of [[UP, LEFT], [LEFT, UP]] as const) {
      if (!whiteAxis(g, k, c, axis)) continue;
      if (canTurn(g, k, step(g, c, axis), axis) || canTurn(g, k, step(g, c, opposite(axis)), opposite(axis))) continue;
      if (!whiteAxis(g, k, c, other)) return CONTRA;
      const { lines, nos } = whiteEdges(g, c, other);
      res = MORE;
      const r = settle(emit({ kind: "white-needs-turn", level: 0, lines, nos, because: [c, step(g, c, axis), step(g, c, opposite(axis))].filter((x) => x >= 0) }));
      if (r !== null) return r;
      break;
    }
  }
  return res;
};

/** Whether the closed loop formed by a piece would be the whole answer: every pearl on it and no other line anywhere. */
function wouldFinish(p: PearlPuzzle, g: EdgeGrid, k: Knowledge, pieceCells: ReadonlySet<number>): boolean {
  for (let c = 0; c < g.n; c++) if (p.pearls[c] !== EMPTY && !pieceCells.has(c)) return false;
  for (let e = 0; e < g.ne; e++) if (k[e] === LINE && !pieceCells.has(g.ea[e]!)) return false;
  return true;
}

/** False if a closed loop exists that isn't the whole answer (another piece of line, or a pearl left off it). */
function loopsOk(p: PearlPuzzle, g: EdgeGrid, k: Knowledge, pc = pieces(g, k)): boolean {
  const closed = pc.ends.findIndex((t, i) => t.length === 0 && pc.cells[i]!.length > 0);
  return closed < 0 || (pc.cells.length === 1 && wouldFinish(p, g, k, new Set(pc.cells[closed])));
}

const loopRule: Rule = (p, g, k, emit) => {
  const pc = pieces(g, k);
  let res: RuleResult = NONE;
  if (!loopsOk(p, g, k, pc)) return CONTRA;
  for (let i = 0; i < pc.cells.length; i++) {
    const ends = pc.ends[i]!;
    if (ends.length !== 2) continue;
    const [a, b] = ends as [number, number];
    let e = -1;
    for (let d = 0; d < 4; d++) if (step(g, a, d) === b) e = edgeAt(g, a, d);
    if (e < 0 || k[e] !== UNK) continue;
    if (wouldFinish(p, g, k, new Set(pc.cells[i]))) continue;
    res = MORE;
    const r = settle(emit({ kind: "loop", level: 0, lines: [], nos: [e], because: [a, b] }));
    if (r !== null) return r;
  }
  return res;
};

const EASY_RULES: Rule[] = [cellRule("full"), cellRule("continue"), cellRule("dead-end"), cellRule("pearl-two"), blackRule, whiteRule, whiteTurnRule, whiteNeedsTurnRule, loopRule];

/** Repeats the easy rules until nothing changes; false on contradiction. */
function close(p: PearlPuzzle, g: EdgeGrid, k: Knowledge): boolean {
  const rules = EASY_RULES;
  for (;;) {
    let changed = false;
    for (const rule of rules) {
      const r = rule(p, g, k, (s) => {
        if (!changes(k, s.lines, s.nos)) return 0;
        changed = true;
        return apply(k, s) ? 0 : -1;
      });
      if (r === CONTRA) return false;
    }
    if (!changed) return true;
  }
}

const trialRule: Rule = (p, g, k, emit) => {
  let res: RuleResult = NONE;
  for (let e = 0; e < g.ne; e++) {
    if (k[e] !== UNK) continue;
    for (const v of [LINE, NO]) {
      const t = k.slice();
      t[e] = v;
      if (close(p, g, t)) continue;
      res = MORE;
      const r = settle(emit({ kind: "trial", level: 1, lines: v === NO ? [e] : [], nos: v === LINE ? [e] : [], because: [g.ea[e]!, g.eb[e]!] }));
      if (r !== null) return r;
      break;
    }
  }
  return res;
};

const RULES: readonly (readonly [Level, Rule, StepKind[]])[] = [
  [0, cellRule("full"), ["full"]],
  [0, cellRule("continue"), ["continue"]],
  [0, cellRule("dead-end"), ["dead-end"]],
  [0, cellRule("pearl-two"), ["pearl-two"]],
  [0, blackRule, ["black"]],
  [0, whiteRule, ["white"]],
  [0, whiteTurnRule, ["white-turn"]],
  [0, whiteNeedsTurnRule, ["white-needs-turn"]],
  [0, loopRule, ["loop"]],
  [1, trialRule, ["trial"]],
];

/** Applies every deduction up to maxLevel, easiest first; a closed loop that isn't the whole answer is a contradiction at every level. */
export function propagate(p: PearlPuzzle, g: EdgeGrid, k: Knowledge, maxLevel: Level): { ok: boolean; used: Level } {
  let used: Level = 0;
  const emit: Emit = (s) => (apply(k, s) ? 1 : -1);
  outer: for (;;) {
    if (!loopsOk(p, g, k)) return { ok: false, used };
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

export function scanSteps(p: PearlPuzzle, k: Knowledge, kinds: readonly StepKind[], accept: (s: Step) => boolean): Step | null {
  const g = edgeGrid(p.w, p.h);
  let found: Step | null = null;
  const emit: Emit = (s) => {
    if (!kinds.includes(s.kind) || !accept(s)) return 0;
    found = s;
    return 1;
  };
  for (const [, rule, ks] of RULES) {
    if (!ks.some((x) => kinds.includes(x))) continue;
    rule(p, g, k, emit);
    if (found) return found;
  }
  return null;
}

/** A single closed loop through every pearl, with no other lines, breaking no rule. */
export function isComplete(p: PearlPuzzle, g: EdgeGrid, k: Knowledge): boolean {
  const pc = pieces(g, k);
  if (pc.cells.length !== 1 || pc.ends[0]!.length !== 0 || !wouldFinish(p, g, k, new Set(pc.cells[0]))) return false;
  return EASY_RULES.every((rule) => rule(p, g, k, () => 0) !== CONTRA);
}

export function logicSolve(p: PearlPuzzle, maxLevel: Level = 1): { level: Level | null; k: Knowledge; ok: boolean } {
  const g = edgeGrid(p.w, p.h);
  const k = freshKnowledge(g);
  const r = propagate(p, g, k, maxLevel);
  return { level: r.ok && isComplete(p, g, k) ? r.used : null, k, ok: r.ok };
}

/** Loop edges of a knowledge state: 1 per LINE edge. */
export const loopEdges = (k: Knowledge): number[] => Array.from(k, (v) => (v === LINE ? 1 : 0));

export function countSolutions(p: PearlPuzzle, start: Knowledge, limit = 2): { count: number; first: Knowledge | null } {
  const g = edgeGrid(p.w, p.h);
  const out = { count: 0, first: null as Knowledge | null };
  const search = (k: Knowledge): void => {
    if (!close(p, g, k)) return;
    if (isComplete(p, g, k)) {
      out.count++;
      if (!out.first) out.first = k.slice();
      return;
    }
    let pick = -1;
    const pc = pieces(g, k);
    for (const ends of pc.ends) {
      for (const c of ends) {
        const u = around(g, k, c).unk;
        if (u.length) { pick = u[0]!; break; }
      }
      if (pick >= 0) break;
    }
    if (pick < 0) {
      for (let c = 0; c < g.n && pick < 0; c++) {
        if (p.pearls[c] === EMPTY) continue;
        const u = around(g, k, c);
        if (u.lines < 2 && u.unk.length) pick = u.unk[0]!;
      }
    }
    if (pick < 0) return;
    for (const v of [LINE, NO]) {
      if (out.count >= limit) return;
      const t = k.slice();
      t[pick] = v;
      search(t);
    }
  };
  search(start.slice());
  return out;
}

export interface Analysis {
  count: 0 | 1 | 2;
  level: Level | null;
  /** 1 per loop edge of the (first) solution. */
  solution: number[] | null;
}

const analyses = new WeakMap<PearlPuzzle, Analysis>();

export function analyze(p: PearlPuzzle): Analysis {
  const hit = analyses.get(p);
  if (hit) return hit;
  const r = logicSolve(p, 1);
  let a: Analysis;
  if (r.level !== null) a = { count: 1, level: r.level, solution: loopEdges(r.k) };
  else if (!r.ok) a = { count: 0, level: null, solution: null };
  else {
    const c = countSolutions(p, r.k, 2);
    a = { count: c.count as 0 | 1 | 2, level: null, solution: c.first ? loopEdges(c.first) : null };
  }
  analyses.set(p, a);
  return a;
}

// --- generation ---

/**
 * A random loop through cell centres: the outline between an inside and an outside colouring of
 * the (w-1)×(h-1) squares between centres (beyond the board counts as outside). Both colourings
 * grow from a seed one square at a time, always keeping each colour one connected piece that
 * never meets itself only at a corner, so the outline is a single loop that never touches itself.
 * Each step colours the square that leaves the most places for black pearls along the two
 * outlines so far, then the one with the fewest neighbours of its colour; afterwards squares
 * touching just one square of the other colour are flipped across, and then a tenth of the
 * flippable ones at random. 1 per loop edge.
 */
export function randomLoop(w: number, h: number, rng: Rng): number[] {
  const W = w - 1, H = h - 1, N = W * H;
  const GREY = 0, IN = 1, OUT = 2;
  const side = new Uint8Array(N);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? OUT : side[y * W + x]!);
  const RING = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]] as const;
  const NB = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
  const sameAround = (i: number, s: number) => {
    const x = i % W, y = Math.floor(i / W);
    return NB.filter(([dx, dy]) => at(x + dx, y + dy) === s).length;
  };
  const canColour = (i: number, s: number) => {
    if (sameAround(i, s) === 0) return false;
    const x = i % W, y = Math.floor(i / W);
    let flips = 0;
    let prev = at(x + RING[7][0], y + RING[7][1]) === s;
    for (const [dx, dy] of RING) {
      const cur = at(x + dx, y + dy) === s;
      if (cur !== prev) flips++;
      prev = cur;
    }
    return flips === 2;
  };
  /** Bits (up 1, right 2, down 4, left 8) of the outline of colour s through centre (x, y). */
  const arms = (x: number, y: number, s: number) => {
    const nw = at(x - 1, y - 1) === s, ne = at(x, y - 1) === s, sw = at(x - 1, y) === s, se = at(x, y) === s;
    return (nw !== ne ? 1 : 0) | (ne !== se ? 2 : 0) | (sw !== se ? 4 : 0) | (nw !== sw ? 8 : 0);
  };
  const straightV = (x: number, y: number, s: number) => x >= 0 && y >= 0 && x < w && y < h && arms(x, y, s) === 5;
  const straightH = (x: number, y: number, s: number) => x >= 0 && y >= 0 && x < w && y < h && arms(x, y, s) === 10;
  /** Black-pearl sites on the outline of colour s among centres with x0 <= x < x1, y0 <= y < y1. */
  const blackSites = (s: number, x0 = 0, y0 = 0, x1 = w, y1 = h) => {
    let n = 0;
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
        const a = arms(x, y, s);
        if (a !== 3 && a !== 6 && a !== 12 && a !== 9) continue;
        if ((a & 1 ? straightV(x, y - 1, s) : straightV(x, y + 1, s)) && (a & 2 ? straightH(x + 1, y, s) : straightH(x - 1, y, s))) n++;
      }
    }
    return n;
  };
  const tiebreak = Array.from({ length: N }, () => rng.next());
  side[rng.int(N)] = IN;
  for (;;) {
    const s = rng.bool() ? IN : OUT;
    let cands: number[] = [];
    for (let i = 0; i < N; i++) if (side[i] === GREY && canColour(i, s)) cands.push(i);
    if (!cands.length) {
      const t = s === IN ? OUT : IN;
      for (let i = 0; i < N; i++) if (side[i] === GREY && canColour(i, t)) cands.push(i);
      if (!cands.length) break;
      cands = cands.map((i) => -1 - i);
    }
    let best = -1, bestKey = -Infinity;
    for (const raw of cands) {
      const i = raw < 0 ? -1 - raw : raw;
      const colour = raw < 0 ? (s === IN ? OUT : IN) : s;
      const fx = i % W, fy = Math.floor(i / W);
      const local = () => blackSites(IN, fx - 2, fy - 2, fx + 4, fy + 4) + blackSites(OUT, fx - 2, fy - 2, fx + 4, fy + 4);
      const before = local();
      side[i] = colour;
      const key = (local() - before) * 16 - sameAround(i, colour) + tiebreak[i]! * 0.5;
      side[i] = GREY;
      if (key > bestKey) { bestKey = key; best = raw; }
    }
    if (best < 0) side[-1 - best] = s === IN ? OUT : IN;
    else side[best] = s;
  }
  const order = rng.shuffle(Array.from({ length: N }, (_, i) => i));
  for (let random = false; ;) {
    let flipped = false;
    for (const i of order) {
      const opp = side[i] === IN ? OUT : IN;
      if (!canColour(i, opp)) continue;
      if (random) {
        if (rng.int(10) === 0) side[i] = opp;
      } else if (sameAround(i, opp) === 1) {
        side[i] = opp;
        flipped = true;
      }
    }
    if (random) break;
    if (!flipped) random = true;
  }
  const g = edgeGrid(w, h);
  const inside = (x: number, y: number) => at(x, y) === IN;
  const edges = Array.from({ length: g.ne }, () => 0);
  for (let e = 0; e < g.ne; e++) {
    const a = g.ea[e]!, ax = a % w, ay = Math.floor(a / w);
    const horizontal = g.eb[e] === a + 1;
    if (inside(ax, ay) !== (horizontal ? inside(ax, ay - 1) : inside(ax - 1, ay))) edges[e] = 1;
  }
  return edges;
}

/** Pearls a loop allows: BLACK where it turns with straight runs on both sides, WHITE where it runs straight next to a turn. */
export function pearlsFor(w: number, h: number, loop: readonly number[]): number[] {
  const g = edgeGrid(w, h);
  const k = Int8Array.from(loop, (v) => (v ? LINE : NO));
  const straight = (c: number, d: number) => c >= 0 && stateAt(g, k, c, d) === LINE && stateAt(g, k, c, opposite(d)) === LINE;
  const turns = (c: number) => c >= 0 && around(g, k, c).lines === 2 && !straight(c, UP) && !straight(c, LEFT);
  return Array.from({ length: g.n }, (_, c) => {
    if (around(g, k, c).lines !== 2) return EMPTY;
    if (turns(c)) {
      const arms = [UP, RIGHT, DOWN, LEFT].filter((d) => stateAt(g, k, c, d) === LINE);
      return arms.every((d) => straight(step(g, c, d), d)) ? BLACK : EMPTY;
    }
    const d = straight(c, UP) ? UP : LEFT;
    return turns(step(g, c, d)) || turns(step(g, c, opposite(d))) ? WHITE : EMPTY;
  });
}

const EXACT_ATTEMPTS = 40;
const MAX_ATTEMPTS = 5000;

/**
 * Deterministic in (w, h, level, rng). Pearls are removed from every pearl the loop allows while
 * the board stays solvable at `level` (so the loop is unique); it needs exactly `level` when such
 * a board turns up within EXACT_ATTEMPTS solvable loops, otherwise the hardest found is returned.
 */
export async function generatePuzzle(w: number, h: number, level: Level, rng: Rng, ctx: GenerateContext): Promise<PearlPuzzle> {
  let best: { p: PearlPuzzle; level: Level } | null = null;
  let made = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (best && made >= EXACT_ATTEMPTS) break;
    await ctx.yield();
    const r = rng.fork(`attempt ${attempt}`);
    const loop = randomLoop(w, h, r);
    const pearls = pearlsFor(w, h, loop);
    if (logicSolve({ w, h, pearls }, level).level === null) continue;
    made++;
    for (const c of r.shuffle(pearls.flatMap((v, i) => (v ? [i] : [])))) {
      const keep = pearls[c]!;
      pearls[c] = EMPTY;
      if (logicSolve({ w, h, pearls }, level).level === null) pearls[c] = keep;
      await ctx.yield();
    }
    const p: PearlPuzzle = { w, h, pearls };
    const got = logicSolve(p, level).level!;
    if (got === level) return p;
    if (!best || got > best.level) best = { p, level: got };
  }
  if (best) return best.p;
  throw new Error("couldn't make a puzzle with these settings; try a different size");
}
