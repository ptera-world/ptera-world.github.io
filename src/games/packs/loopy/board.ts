import { edgeBetween, otherEnd, type Grid } from "./grid";

export const UNKNOWN = 0;
export const LINE = 1;
export const CROSS = 2;
export type EdgeState = typeof UNKNOWN | typeof LINE | typeof CROSS;

/** Where a contradiction was found, for explanations. */
export interface Conflict {
  why: string;
  faces?: number[];
  vertices?: number[];
  edges?: number[];
}

/**
 * Mutable solving state: edge marks plus incrementally maintained counters.
 *
 * Invariants: `fLine/fUnk/vLine/vUnk` always match `e`. `end[v]` is the other end of v's chain
 * whenever `vLine[v] === 1`. Marks only ever go from UNKNOWN to LINE/CROSS; any conflicting
 * write sets `conflict` and is otherwise ignored. `stamp[e]` is the `clock` value of the write.
 */
export class Board {
  readonly e: Uint8Array;
  readonly fLine: Int16Array;
  readonly fUnk: Int16Array;
  readonly vLine: Int16Array;
  readonly vUnk: Int16Array;
  readonly end: Int32Array;
  readonly chainLen: Int32Array;
  readonly stamp: Int32Array;
  clock = 1;
  lines = 0;
  unknown: number;
  /** A closed loop exists. */
  closed = false;
  conflict: Conflict | null = null;
  /** Every edge written, in order. */
  log: number[] = [];
  /** Edges written since the queue was last drained. */
  queue: number[] = [];

  constructor(readonly g: Grid, readonly clues: Int8Array, src?: Board) {
    if (src) {
      this.e = src.e.slice();
      this.fLine = src.fLine.slice();
      this.fUnk = src.fUnk.slice();
      this.vLine = src.vLine.slice();
      this.vUnk = src.vUnk.slice();
      this.end = src.end.slice();
      this.chainLen = src.chainLen.slice();
      this.stamp = src.stamp.slice();
      this.clock = src.clock;
      this.lines = src.lines;
      this.unknown = src.unknown;
      this.closed = src.closed;
      this.conflict = src.conflict;
      this.queue = src.queue.slice();
      this.log = src.log.slice();
      return;
    }
    this.e = new Uint8Array(g.ne);
    this.fLine = new Int16Array(g.nf);
    this.fUnk = Int16Array.from(g.fe, (es) => es.length);
    this.vLine = new Int16Array(g.nv);
    this.vUnk = Int16Array.from(g.ve, (es) => es.length);
    this.end = new Int32Array(g.nv).fill(-1);
    this.chainLen = new Int32Array(g.nv);
    this.stamp = new Int32Array(g.ne);
    this.unknown = g.ne;
    this.queue = Array.from({ length: g.ne }, (_, i) => i);
    for (let f = 0; f < g.nf; f++) this.checkFace(f);
  }

  clone(): Board {
    return new Board(this.g, this.clues, this);
  }

  /** Mark e; returns true if it changed. */
  set(e: number, v: EdgeState): boolean {
    const cur = this.e[e]!;
    if (cur === v) return false;
    if (cur !== UNKNOWN) {
      this.fail({ why: "an edge would need to be both a line and crossed", edges: [e] });
      return false;
    }
    const g = this.g;
    this.e[e] = v;
    this.stamp[e] = ++this.clock;
    this.log.push(e);
    this.unknown--;
    this.queue.push(e);
    const a = g.ev[2 * e]!, b = g.ev[2 * e + 1]!;
    const f1 = g.ef[2 * e]!, f2 = g.ef[2 * e + 1]!;
    this.vUnk[a]!--;
    this.vUnk[b]!--;
    if (f1 >= 0) this.fUnk[f1]!--;
    if (f2 >= 0) this.fUnk[f2]!--;
    if (v === LINE) {
      if (this.closed) this.fail({ why: "a line would be left outside the finished loop", edges: [e] });
      this.lines++;
      this.vLine[a]!++;
      this.vLine[b]!++;
      if (f1 >= 0) this.fLine[f1]!++;
      if (f2 >= 0) this.fLine[f2]!++;
      this.link(e, a, b);
    }
    this.checkVertex(a);
    this.checkVertex(b);
    if (f1 >= 0) this.checkFace(f1);
    if (f2 >= 0) this.checkFace(f2);
    return true;
  }

  private link(e: number, a: number, b: number): void {
    // vLine already includes e here
    const ea = this.vLine[a] === 1 ? a : this.end[a]!;
    const eb = this.vLine[b] === 1 ? b : this.end[b]!;
    const len = (this.vLine[a] === 1 ? 0 : this.chainLen[a]!) + (this.vLine[b] === 1 ? 0 : this.chainLen[b]!) + 1;
    if (this.vLine[a] === 2) this.end[a] = -1;
    if (this.vLine[b] === 2) this.end[b] = -1;
    if (ea === b && eb === a) {
      // closes a cycle: a and b were the two ends of one chain
      this.closed = true;
      if (this.chainLen[a]! + 1 !== this.lines) this.fail({ why: "this would close a loop that leaves other lines out", edges: [e] });
      return;
    }
    if (this.vLine[a]! > 2 || this.vLine[b]! > 2) return;
    this.end[ea] = eb;
    this.end[eb] = ea;
    this.chainLen[ea] = len;
    this.chainLen[eb] = len;
  }

  private checkFace(f: number): void {
    const c = this.clues[f]!;
    if (c < 0) return;
    if (this.fLine[f]! > c) this.fail({ why: `the ${c} would have too many lines`, faces: [f] });
    else if (this.fLine[f]! + this.fUnk[f]! < c) this.fail({ why: `the ${c} couldn't get enough lines`, faces: [f] });
  }

  private checkVertex(v: number): void {
    if (this.vLine[v]! > 2) this.fail({ why: "a dot would have more than two lines", vertices: [v] });
    else if (this.vLine[v] === 1 && this.vUnk[v] === 0) this.fail({ why: "a line would hit a dead end", vertices: [v] });
  }

  fail(c: Conflict): void {
    if (!this.conflict) this.conflict = c;
  }

  get done(): boolean {
    return this.unknown === 0;
  }

  /** Length of the chain ending at v (v must be a chain end). */
  chainAt(v: number): number {
    return this.chainLen[v]!;
  }

  /** True when every clue is met by the current lines, as if all unknown edges were crossed. */
  cluesMetBy(extra = -1): boolean {
    const g = this.g;
    for (let f = 0; f < g.nf; f++) {
      const c = this.clues[f]!;
      if (c < 0) continue;
      const add = extra >= 0 && (g.ef[2 * extra] === f || g.ef[2 * extra + 1] === f) ? 1 : 0;
      if (this.fLine[f]! + add !== c) return false;
    }
    return true;
  }
}

export function boardFrom(g: Grid, clues: Int8Array, edges: ArrayLike<number>): Board {
  const b = new Board(g, clues);
  for (let e = 0; e < g.ne; e++) {
    const v = edges[e]!;
    if (v === LINE || v === CROSS) b.set(e, v);
  }
  return b;
}

/** One forced change with a lazily built explanation. */
export interface Deduction {
  technique: string;
  tier: number;
  edges: number[];
  value: EdgeState;
  /** `faces` and `vertices` are where the reasoning looks. */
  explain(): { message: string; faces?: number[]; vertices?: number[] };
}

/**
 * If closing the chain that ends at `v` would be wrong, the closing edge must be crossed.
 * Returns that edge, or -1.
 */
export function prematureClosure(b: Board, v: number): number {
  if (b.vLine[v] !== 1) return -1;
  const w = b.end[v]!;
  if (w < 0 || w < v) return -1;
  const e = edgeBetween(b.g, v, w);
  if (e < 0 || b.e[e] !== UNKNOWN) return -1;
  if (b.chainAt(v) + 1 < b.lines + 1 || !b.cluesMetBy(e)) return e;
  return -1;
}

const n = (c: number) => String(c);

/** The single-clue rule at face f: "clue-full" or "clue-needs-all", or null. Broken clues give null. */
export function faceRule(b: Board, f: number): Deduction | null {
  const g = b.g;
  const c = b.clues[f]!;
  if (c < 0 || b.fUnk[f] === 0) return null;
  const unk = g.fe[f]!.filter((e) => b.e[e] === UNKNOWN);
  if (b.fLine[f] === c) {
    return {
      technique: "clue-full", tier: 0, edges: unk, value: CROSS,
      explain: () => ({
        message: c === 0
          ? "a 0 has no lines around it, so all its edges are crossed"
          : `this ${n(c)} already has ${c === 1 ? "its line" : `all ${n(c)} lines`}, so its other edges are crossed`,
        faces: [f],
      }),
    };
  }
  if (b.fLine[f]! + b.fUnk[f]! === c) {
    return {
      technique: "clue-needs-all", tier: 0, edges: unk, value: LINE,
      explain: () => ({ message: `this ${n(c)} needs every edge it has left to be a line`, faces: [f] }),
    };
  }
  return null;
}

/** The single-dot rule at v: "dot-full", "dot-continue" or "dot-dead-end", or null. Broken dots give null. */
export function dotRule(b: Board, v: number): Deduction | null {
  if (b.vUnk[v] === 0) return null;
  const unk = b.g.ve[v]!.filter((e) => b.e[e] === UNKNOWN);
  const lines = b.vLine[v]!;
  if (lines === 2) {
    return {
      technique: "dot-full", tier: 0, edges: unk, value: CROSS,
      explain: () => ({ message: "this dot already has two lines, so its other edges are crossed", vertices: [v] }),
    };
  }
  if (lines === 1 && unk.length === 1) {
    return {
      technique: "dot-continue", tier: 0, edges: unk, value: LINE,
      explain: () => ({ message: "the line coming into this dot has only one way to go", vertices: [v] }),
    };
  }
  if (lines === 0 && unk.length === 1) {
    return {
      technique: "dot-dead-end", tier: 0, edges: unk, value: CROSS,
      explain: () => ({ message: "only one edge is left at this dot, and a line can't stop here, so it's crossed", vertices: [v] }),
    };
  }
  return null;
}

/** Apply the single-constraint rules (one clue, one dot, loop closure) to a fixpoint. */
export function propagateEasy(b: Board): void {
  const g = b.g;
  const seenF = new Int32Array(g.nf).fill(-1);
  const seenV = new Int32Array(g.nv).fill(-1);
  let pass = 0;
  for (;;) {
    pass++;
    const faces: number[] = [], verts: number[] = [];
    const q = b.queue;
    b.queue = [];
    for (const e of q) {
      for (const f of [g.ef[2 * e]!, g.ef[2 * e + 1]!]) {
        if (f >= 0 && seenF[f] !== pass) {
          seenF[f] = pass;
          faces.push(f);
        }
      }
      for (const v of [g.ev[2 * e]!, g.ev[2 * e + 1]!]) {
        if (seenV[v] !== pass) {
          seenV[v] = pass;
          verts.push(v);
        }
      }
    }
    for (const f of faces) {
      if (b.conflict) return;
      const d = faceRule(b, f);
      if (d) for (const e of d.edges) b.set(e, d.value);
    }
    for (const v of verts) {
      if (b.conflict) return;
      const d = dotRule(b, v);
      if (d) for (const e of d.edges) b.set(e, d.value);
    }
    if (b.conflict) return;
    if (b.queue.length) continue;
    const loopD = loopDeduction(b);
    if (loopD) {
      for (const e of loopD.edges) b.set(e, loopD.value);
      if (b.conflict) return;
      continue;
    }
    return;
  }
}

function loopDeduction(b: Board): Deduction | null {
  return loopClosed(b) ?? loopEarly(b);
}

/** Every unknown edge, once a loop has closed. */
function loopClosed(b: Board): Deduction | null {
  const g = b.g;
  if (!b.closed || b.unknown === 0) return null;
  const unk: number[] = [];
  for (let e = 0; e < g.ne; e++) if (b.e[e] === UNKNOWN) unk.push(e);
  return {
    technique: "loop-closed", tier: 0, edges: unk, value: CROSS,
    explain: () => ({ message: "the loop is closed, so every other edge is crossed" }),
  };
}

/** First edge that would close a loop too early. */
export function loopEarly(b: Board): Deduction | null {
  const g = b.g;
  for (let v = 0; v < g.nv; v++) {
    const e = prematureClosure(b, v);
    if (e < 0) continue;
    const others = b.chainAt(v) < b.lines;
    const w = otherEnd(g, e, v);
    return {
      technique: "loop-early", tier: 0, edges: [e], value: CROSS,
      explain: () => ({
        message: others
          ? "this edge would close a loop that leaves other lines out, so it's crossed"
          : "closing the loop here would leave some clues unfinished, so it's crossed",
        vertices: [v, w],
      }),
    };
  }
  return null;
}

/** Result of checking a full set of marks against the rules. */
export interface Check {
  solved: boolean;
  /** Clue faces with too many lines, or too few even counting every unknown edge. */
  badFaces: number[];
  /** Dots with three or more lines, or a line with nowhere to go. */
  badVertices: number[];
  /** Edges of closed loops; a loop is "premature" when it isn't the only line. */
  loops: number[][];
  /** Chain ends (dots with exactly one line). */
  ends: number[];
}

export function check(g: Grid, clues: ArrayLike<number>, edges: ArrayLike<number>): Check {
  const badFaces: number[] = [], badVertices: number[] = [], ends: number[] = [];
  let satisfied = true;
  for (let f = 0; f < g.nf; f++) {
    const c = clues[f]!;
    if (c < 0) continue;
    let l = 0, u = 0;
    for (const e of g.fe[f]!) {
      if (edges[e] === LINE) l++;
      else if (edges[e] === UNKNOWN) u++;
    }
    if (l !== c) satisfied = false;
    if (l > c || l + u < c) badFaces.push(f);
  }
  let total = 0;
  for (let v = 0; v < g.nv; v++) {
    let l = 0, u = 0;
    for (const e of g.ve[v]!) {
      if (edges[e] === LINE) l++;
      else if (edges[e] === UNKNOWN) u++;
    }
    if (l > 2 || (l === 1 && u === 0)) badVertices.push(v);
    if (l === 1) ends.push(v);
    if (l !== 0 && l !== 2) satisfied = false;
  }
  const loops: number[][] = [];
  const seen = new Uint8Array(g.ne);
  for (let e = 0; e < g.ne; e++) {
    if (edges[e] !== LINE) continue;
    total++;
    if (seen[e]) continue;
    // walk the component; it's a loop if every dot on it has exactly two lines
    const comp: number[] = [];
    const stack = [e];
    seen[e] = 1;
    let isLoop = true;
    while (stack.length) {
      const x = stack.pop()!;
      comp.push(x);
      for (const v of [g.ev[2 * x]!, g.ev[2 * x + 1]!]) {
        let deg = 0;
        for (const y of g.ve[v]!) {
          if (edges[y] !== LINE) continue;
          deg++;
          if (!seen[y]) {
            seen[y] = 1;
            stack.push(y);
          }
        }
        if (deg !== 2) isLoop = false;
      }
    }
    if (isLoop) loops.push(comp);
  }
  const solved = satisfied && total > 0 && loops.length === 1 && loops[0]!.length === total;
  return { solved, badFaces, badVertices, loops, ends };
}
