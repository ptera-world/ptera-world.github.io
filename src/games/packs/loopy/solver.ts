import { Board, CROSS, LINE, UNKNOWN, check, propagateEasy, type Deduction, type EdgeState } from "./board";
import type { Grid } from "./grid";
import { clueRef, dotRef, edgeRef, edgesRef } from "./names";

export const TIERS = ["easy", "normal", "tricky", "hard"] as const;
export type TierName = (typeof TIERS)[number];

/**
 * A set of clue faces and dots reasoned about together. Every edge of every listed face and
 * dot is in `edges`.
 */
interface Window {
  kind: "face" | "dot" | "pair";
  faces: number[];
  vertices: number[];
  edges: Int32Array;
}

/**
 * One step of the generator's and rater's solving engine, beyond the single-constraint rules.
 * `run` either applies everything it can find (returning whether anything changed) or, with
 * `first`, returns its first deduction without applying it. Deductions must be sound: true in
 * every solution of the current marks. Hints and auto-apply use the techniques in
 * techniques.ts, which find the same deductions one kind at a time.
 */
export interface Pass {
  id: string;
  tier: number;
  run(s: Solver, first: boolean): Deduction | boolean | null;
}

function makeWindow(g: Grid, kind: Window["kind"], faces: number[], vertices: number[]): Window {
  const es = new Set<number>();
  for (const f of faces) for (const e of g.fe[f]!) es.add(e);
  for (const v of vertices) for (const e of g.ve[v]!) es.add(e);
  return { kind, faces, vertices, edges: Int32Array.from(es) };
}

/** Clue-independent windows, shared by every solve on a grid. */
const gridWindows = new WeakMap<Grid, { face: Window[]; pair: Map<number, Window> }>();

function buildWindows(g: Grid, clues: Int8Array, tier: number): Window[] {
  let cached = gridWindows.get(g);
  if (!cached) {
    cached = { face: g.fv.map((vs, f) => makeWindow(g, "face", [f], vs)), pair: new Map() };
    gridWindows.set(g, cached);
  }
  const out: Window[] = [];
  if (tier === 1) {
    for (let f = 0; f < g.nf; f++) if (clues[f]! >= 0) out.push(cached.face[f]!);
    for (let v = 0; v < g.nv; v++) {
      const fs = [...new Set(g.vf[v]!.filter((f) => f >= 0 && clues[f]! >= 0))];
      if (fs.length) out.push(makeWindow(g, "dot", fs, [v]));
    }
  } else if (tier === 2) {
    for (let a = 0; a < g.nf; a++) {
      if (clues[a]! < 0) continue;
      for (const b of new Set(g.ring[a]!)) {
        if (b <= a || clues[b]! < 0) continue;
        const key = a * g.nf + b;
        let w = cached.pair.get(key);
        if (!w) {
          w = makeWindow(g, "pair", [a, b], [...new Set([...g.fv[a]!, ...g.fv[b]!])]);
          cached.pair.set(key, w);
        }
        out.push(w);
      }
    }
  }
  return out;
}

interface TierWindows {
  ws: Window[];
  /** Window ids per edge. */
  byEdge: number[][];
}

/** Which windows of one tier still need a look on this board. */
interface Pending {
  dirty: Uint8Array;
  queue: number[];
  head: number;
  /** How much of the board's change log has been turned into dirty marks. */
  logPos: number;
}

/** Board plus per-window bookkeeping so unchanged windows aren't re-enumerated. */
export class Solver {
  /** Windows per tier, built on first use and shared with clones. */
  private readonly shared: (TierWindows | undefined)[];
  private readonly pending: (Pending | undefined)[];
  /** Highest tier that produced a deduction, and how many deductions each tier made. */
  maxTierUsed = 0;
  readonly used = [0, 0, 0, 0];

  constructor(readonly b: Board, src?: Solver) {
    this.shared = src ? src.shared : [];
    this.pending = src
      ? src.pending.map((p) => p && { dirty: p.dirty.slice(), queue: p.queue.slice(p.head), head: 0, logPos: p.logPos })
      : [];
  }

  tier(t: number): TierWindows {
    let tw = this.shared[t];
    if (!tw) {
      const ws = buildWindows(this.b.g, this.b.clues, t);
      const byEdge: number[][] = Array.from({ length: this.b.g.ne }, () => []);
      ws.forEach((w, i) => { for (const e of w.edges) byEdge[e]!.push(i); });
      tw = this.shared[t] = { ws, byEdge };
    }
    return tw;
  }

  /** Next window of tier t touched by a change since it was last examined, or -1. */
  nextDirty(t: number): number {
    const tw = this.tier(t);
    let p = this.pending[t];
    if (!p) {
      p = this.pending[t] = { dirty: new Uint8Array(tw.ws.length).fill(1), queue: tw.ws.map((_, i) => i), head: 0, logPos: this.b.log.length };
    }
    const log = this.b.log;
    for (; p.logPos < log.length; p.logPos++) {
      for (const w of tw.byEdge[log[p.logPos]!]!) {
        if (!p.dirty[w]) {
          p.dirty[w] = 1;
          p.queue.push(w);
        }
      }
    }
    if (p.head >= p.queue.length) return -1;
    const w = p.queue[p.head++]!;
    p.dirty[w] = 0;
    if (p.head > 4096 && p.head * 2 > p.queue.length) {
      p.queue = p.queue.slice(p.head);
      p.head = 0;
    }
    return w;
  }

  clone(): Solver {
    return new Solver(this.b.clone(), this);
  }
}

// --- local enumeration ---

const BUDGET = 40000;
const scratch = new WeakMap<Grid, Int32Array>();

interface Enumerated {
  vars: number[];
  /** Bit 1 = seen as line, bit 2 = seen as cross; `raw` ignores the loop check. */
  seen: Uint8Array;
  raw: Uint8Array;
  count: number;
}

function enumerate(b: Board, w: Window): Enumerated | null {
  const g = b.g;
  let idx = scratch.get(g);
  if (!idx) {
    idx = new Int32Array(g.ne).fill(-1);
    scratch.set(g, idx);
  }
  const vars: number[] = [];
  for (const e of w.edges) if (b.e[e] === UNKNOWN) vars.push(e);
  if (!vars.length) return null;
  vars.forEach((e, i) => { idx[e] = i; });
  try {
    const cons: { face: boolean; base: number; vars: number[] }[] = [];
    for (const f of w.faces) {
      const vs = g.fe[f]!.filter((e) => b.e[e] === UNKNOWN).map((e) => idx[e]!);
      if (vs.length) cons.push({ face: true, base: b.clues[f]! - b.fLine[f]!, vars: vs });
    }
    for (const v of w.vertices) {
      const vs = g.ve[v]!.filter((e) => b.e[e] === UNKNOWN).map((e) => idx[e]!);
      if (vs.length) cons.push({ face: false, base: b.vLine[v]!, vars: vs });
    }
    const n = vars.length;
    const varCons: number[][] = Array.from({ length: n }, () => []);
    cons.forEach((c, ci) => c.vars.forEach((vi) => varCons[vi]!.push(ci)));
    const cl = new Int32Array(cons.length);
    const cr = Int32Array.from(cons, (c) => c.vars.length);
    const ok = (ci: number): boolean => {
      const c = cons[ci]!;
      if (c.face) return cl[ci]! <= c.base && cl[ci]! + cr[ci]! >= c.base;
      const t = c.base + cl[ci]!;
      return t <= 2 && (cr[ci]! > 0 || t !== 1);
    };
    const val = new Uint8Array(n);
    const seen = new Uint8Array(n), raw = new Uint8Array(n);
    let count = 0, nodes = 0, undecided = n;
    const rec = (i: number): boolean => {
      if (++nodes > BUDGET) return false;
      if (i === n) {
        for (let k = 0; k < n; k++) raw[k]! |= val[k] === LINE ? 1 : 2;
        if (!loopOk(b, vars, val)) return true;
        count++;
        for (let k = 0; k < n; k++) {
          const before = seen[k]!;
          seen[k]! |= val[k] === LINE ? 1 : 2;
          if (before !== 3 && seen[k] === 3) undecided--;
        }
        return true;
      }
      for (const v of [LINE, CROSS] as const) {
        val[i] = v;
        let good = true;
        for (const ci of varCons[i]!) {
          cr[ci]!--;
          if (v === LINE) cl[ci]!++;
        }
        for (const ci of varCons[i]!) if (!ok(ci)) { good = false; break; }
        const cont = good ? rec(i + 1) : true;
        for (const ci of varCons[i]!) {
          cr[ci]!++;
          if (v === LINE) cl[ci]!--;
        }
        if (!cont) return false;
        if (count > 0 && undecided === 0) return false;
      }
      return true;
    };
    const finished = rec(0) || (count > 0 && undecided === 0);
    if (!finished && nodes > BUDGET) return null;
    return { vars, seen, raw, count };
  } finally {
    for (const e of vars) idx[e] = -1;
  }
}

/** Would these new lines close a loop that can't be the whole answer? */
function loopOk(b: Board, vars: number[], val: Uint8Array): boolean {
  const g = b.g;
  const parent = new Map<number, number>();
  const weight = new Map<number, number>();
  const node = (v: number): number => {
    if (b.vLine[v] === 1) return Math.min(v, b.end[v]!);
    return v;
  };
  const find = (x: number): number => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const w0 = (x: number): number => {
    if (weight.has(x)) return weight.get(x)!;
    const l = b.vLine[x] === 1 ? b.chainAt(x) : 0;
    weight.set(x, l);
    parent.set(x, x);
    return l;
  };
  let added = 0;
  for (let k = 0; k < vars.length; k++) if (val[k] === LINE) added++;
  if (!added) return true;
  for (let k = 0; k < vars.length; k++) {
    if (val[k] !== LINE) continue;
    const e = vars[k]!;
    const na = node(g.ev[2 * e]!), nb = node(g.ev[2 * e + 1]!);
    w0(na);
    w0(nb);
    const ra = find(na), rb = find(nb);
    if (ra === rb) {
      const len = weight.get(ra)! + 1;
      if (len < b.lines + added) return false;
      // the loop would be everything: every clue must then be exact
      const extra = new Set<number>();
      for (let j = 0; j < vars.length; j++) if (val[j] === LINE) extra.add(vars[j]!);
      for (let f = 0; f < g.nf; f++) {
        const c = b.clues[f]!;
        if (c < 0) continue;
        let l = b.fLine[f]!;
        for (const fe of g.fe[f]!) if (extra.has(fe)) l++;
        if (l !== c) return false;
      }
      weight.set(ra, len);
      continue;
    }
    parent.set(ra, rb);
    weight.set(rb, weight.get(ra)! + weight.get(rb)! + 1);
  }
  return true;
}

const clueOf = (b: Board, f: number) => clueRef(b.g, b.clues[f]!, f);

function windowLead(b: Board, w: Window): string {
  if (w.kind === "face") return `look at ${clueOf(b, w.faces[0]!)} and the dots at its corners`;
  if (w.kind === "dot") {
    const dot = dotRef(b.g, w.vertices[0]!);
    return w.faces.length === 1
      ? `look at ${dot} and ${clueOf(b, w.faces[0]!)} next to it`
      : `look at ${dot} and the numbers around it`;
  }
  return `look at ${clueOf(b, w.faces[0]!)} and ${clueOf(b, w.faces[1]!)} together`;
}

function windowDeductions(b: Board, w: Window, tier: number): Deduction[] | null {
  const r = enumerate(b, w);
  if (!r) return null;
  if (r.count === 0) {
    b.fail({ why: () => "no way to fill in the highlighted area works", faces: w.faces, vertices: w.vertices });
    return null;
  }
  const out: Deduction[] = [];
  for (const value of [LINE, CROSS] as const) {
    const bit = value === LINE ? 1 : 2;
    const edges = r.vars.filter((_, k) => r.seen[k] === bit);
    if (!edges.length) continue;
    const viaLoop = r.vars.some((_, k) => r.seen[k] === bit && r.raw[k] === 3);
    out.push({
      technique: `window-${w.kind}`, tier, edges, value,
      explain: () => {
        const many = edges.length > 1;
        const which = edgesRef(b.g, edges);
        const verb = value === LINE
          ? (many ? "makes the highlighted edges lines" : `makes ${which} a line`)
          : (many ? "leaves the highlighted edges crossed" : `leaves ${which} crossed`);
        const loop = viaLoop ? ", since anything else would close a loop too early" : "";
        return {
          message: `${windowLead(b, w)}: every way to fill it in ${verb}${loop}`,
          faces: w.faces,
          vertices: w.kind === "dot" ? w.vertices : [],
        };
      },
    });
  }
  return out;
}

function windowPass(tier: number): Pass {
  return {
    id: tier === 1 ? "windows-single" : "windows-pair",
    tier,
    run(s, first) {
      const b = s.b;
      const { ws } = s.tier(tier);
      if (first) {
        for (const w of ws) {
          const ds = windowDeductions(b, w, tier);
          if (b.conflict) return null;
          if (ds?.length) return ds[0]!;
        }
        return null;
      }
      for (let i = s.nextDirty(tier); i >= 0; i = s.nextDirty(tier)) {
        const ds = windowDeductions(b, ws[i]!, tier);
        if (b.conflict) return false;
        if (!ds?.length) continue;
        for (const d of ds) for (const e of d.edges) b.set(e, d.value);
        return true;
      }
      return false;
    },
  };
}

// --- inside / outside parity ---

/** Union-find over faces plus one "outside" node, tracking whether two faces are on the same side. */
class Sides {
  readonly parent: Int32Array;
  readonly par: Uint8Array;
  constructor(n: number) {
    this.parent = Int32Array.from({ length: n }, (_, i) => i);
    this.par = new Uint8Array(n);
  }
  find(x: number): [number, number] {
    let p = 0, r = x;
    while (this.parent[r] !== r) {
      p ^= this.par[r]!;
      r = this.parent[r]!;
    }
    let y = x, py = p;
    while (this.parent[y] !== y) {
      const next = this.parent[y]!, pn = py ^ this.par[y]!;
      this.parent[y] = r;
      this.par[y] = py;
      y = next;
      py = pn;
    }
    return [r, p];
  }
  union(a: number, b: number, diff: number): void {
    const [ra, pa] = this.find(a), [rb, pb] = this.find(b);
    if (ra === rb) return;
    this.parent[ra] = rb;
    this.par[ra] = pa ^ pb ^ diff;
  }
}

/** Sides of every face (index nf = outside the grid) implied by the given marks. */
export function sidesOf(g: Grid, edges: ArrayLike<number>): Sides {
  const s = new Sides(g.nf + 1);
  const out = g.nf;
  for (let e = 0; e < g.ne; e++) {
    const m = edges[e];
    if (m !== LINE && m !== CROSS) continue;
    const a = g.ef[2 * e]!, c = g.ef[2 * e + 1]!;
    s.union(a < 0 ? out : a, c < 0 ? out : c, m === LINE ? 1 : 0);
  }
  return s;
}

/** Unknown edges whose two sides are already related. With `first`, returns the first without applying it. */
export function parityDirect(b: Board, first: boolean): Deduction | boolean | null {
  const g = b.g, out = g.nf;
  const sides = sidesOf(g, b.e);
  const node = (f: number) => (f < 0 ? out : f);
  let progress = false;
  for (let e = 0; e < g.ne; e++) {
    if (b.e[e] !== UNKNOWN) continue;
    const fa = g.ef[2 * e]!, fb = g.ef[2 * e + 1]!;
    const [ra, pa] = sides.find(node(fa)), [rb, pb] = sides.find(node(fb));
    if (ra !== rb) continue;
    const value: EdgeState = pa !== pb ? LINE : CROSS;
    const d: Deduction = {
      technique: "inside-outside", tier: 2, edges: [e], value,
      explain: () => ({
        message: value === LINE
          ? `following the lines and crosses, the cells either side of ${edgeRef(g, e)} end up on opposite sides of the loop (one inside, one outside), so it's a line`
          : `following the lines and crosses, the cells either side of ${edgeRef(g, e)} end up on the same side of the loop, so it's crossed`,
        faces: [fa, fb].filter((f) => f >= 0),
      }),
    };
    if (first) return d;
    b.set(e, value);
    progress = true;
  }
  return first ? null : progress;
}

/**
 * Per clue and per dot: enumerate the unknown side of each group of related cells. Applies (or
 * with `first`, returns) the first deduction found.
 */
export function parityGroup(b: Board, first: boolean): Deduction | boolean | null {
  const g = b.g, out = g.nf;
  const sides = sidesOf(g, b.e);
  const node = (f: number) => (f < 0 ? out : f);
  const [outRoot, outPar] = sides.find(out);
  const groups = (es: number[]) => {
    const roots: number[] = [];
    const terms = es.map((e) => {
      const fa = g.ef[2 * e]!, fb = g.ef[2 * e + 1]!;
      const [ra, pa] = sides.find(node(fa)), [rb, pb] = sides.find(node(fb));
      const ia = ra === outRoot ? -1 : (roots.includes(ra) ? roots.indexOf(ra) : roots.push(ra) - 1);
      const ib = rb === outRoot ? -1 : (roots.includes(rb) ? roots.indexOf(rb) : roots.push(rb) - 1);
      // line = side(a) xor side(b); side(x) = bit(root) xor par(x), outside's root bit is fixed
      const k = pa ^ pb ^ (ia < 0 ? outPar : 0) ^ (ib < 0 ? outPar : 0);
      return { ia, ib, k };
    });
    return { roots, terms };
  };
  const consider = (es: number[], base: number, isFace: boolean, label: () => { message: string; faces?: number[]; vertices?: number[] }): Deduction | null => {
    if (es.length < 2) return null;
    const { roots, terms } = groups(es);
    if (roots.length > 10 || roots.length >= es.length) return null;
    const seen = new Uint8Array(es.length);
    let any = false;
    for (let m = 0; m < 1 << roots.length; m++) {
      let lines = 0;
      const vals = terms.map((t) => {
        const v = t.k ^ (t.ia >= 0 ? (m >> t.ia) & 1 : 0) ^ (t.ib >= 0 ? (m >> t.ib) & 1 : 0);
        lines += v;
        return v;
      });
      const total = base + lines;
      if (isFace ? total !== 0 : total !== 0 && total !== 2) continue;
      any = true;
      vals.forEach((v, i) => { seen[i]! |= v ? 1 : 2; });
    }
    if (!any) {
      b.fail({ why: () => "no way to shade the cells inside and outside works here", ...label() });
      return null;
    }
    for (const value of [LINE, CROSS] as const) {
      const bit = value === LINE ? 1 : 2;
      const edges = es.filter((_, i) => seen[i] === bit);
      if (edges.length) {
        return {
          technique: "inside-outside-group", tier: 2, edges, value,
          explain: () => {
            const l = label();
            const which = edges.length > 1 ? "the highlighted edges" : edgeRef(g, edges[0]!);
            return { ...l, message: `${l.message} ${which} ${value === LINE ? (edges.length > 1 ? "are lines" : "is a line") : (edges.length > 1 ? "are crossed" : "is crossed")}` };
          },
        };
      }
    }
    return null;
  };
  for (let f = 0; f < g.nf; f++) {
    const c = b.clues[f]!;
    if (c < 0 || !b.fUnk[f]) continue;
    const es = g.fe[f]!.filter((e) => b.e[e] === UNKNOWN);
    const d = consider(es, b.fLine[f]! - c, true, () => ({
      message: `shade the cells around ${clueRef(g, c, f)} as inside or outside the loop: the neighbours already tied together mean`,
      faces: [f],
    }));
    if (b.conflict) return first ? null : false;
    if (!d) continue;
    if (first) return d;
    for (const e of d.edges) b.set(e, d.value);
    return true;
  }
  for (let v = 0; v < g.nv; v++) {
    if (!b.vUnk[v]) continue;
    const es = g.ve[v]!.filter((e) => b.e[e] === UNKNOWN);
    const d = consider(es, b.vLine[v]!, false, () => ({
      message: `shade the cells around ${dotRef(g, v)} as inside or outside the loop: the cells already tied together mean`,
      vertices: [v],
    }));
    if (b.conflict) return first ? null : false;
    if (!d) continue;
    if (first) return d;
    for (const e of d.edges) b.set(e, d.value);
    return true;
  }
  return first ? null : false;
}

const parity: Pass = {
  id: "inside-outside",
  tier: 2,
  run(s, first) {
    const direct = parityDirect(s.b, first);
    if (direct || s.b.conflict) return direct;
    return parityGroup(s.b, first);
  },
};

// --- trial ---

/** Tier whose techniques a trial may use to reach a contradiction. */
const TRIAL_DEPTH = 1;

const trial: Pass = {
  id: "trial",
  tier: 3,
  run(s, first) {
    const b = s.b, g = b.g;
    const order: number[] = [];
    const late: number[] = [];
    const clueSide = (f: number) => f >= 0 && b.clues[f]! >= 0;
    // suppositions only start at a loose end or on an edge of a clue
    for (let e = 0; e < g.ne; e++) {
      if (b.e[e] !== UNKNOWN) continue;
      if (b.vLine[g.ev[2 * e]!] === 1 || b.vLine[g.ev[2 * e + 1]!] === 1) order.push(e);
      else if (clueSide(g.ef[2 * e]!) || clueSide(g.ef[2 * e + 1]!)) late.push(e);
    }
    for (const e of [...order, ...late]) {
      for (const guess of [LINE, CROSS] as const) {
        const t = s.clone();
        t.b.set(e, guess);
        run(t, TRIAL_DEPTH);
        if (!t.b.conflict) continue;
        const value: EdgeState = guess === LINE ? CROSS : LINE;
        const c = t.b.conflict;
        const d: Deduction = {
          technique: "trial", tier: 3, edges: [e], value,
          explain: () => ({
            message: `suppose ${edgeRef(g, e)} were ${guess === LINE ? "a line" : "crossed"}: following on from that, ${c.why()}. so it's ${value === LINE ? "a line" : "crossed"}`,
            faces: c.faces,
            vertices: c.vertices,
          }),
        };
        if (first) return d;
        b.set(e, value);
        return true;
      }
    }
    return first ? null : false;
  },
};

/** Engine passes beyond the single-constraint rules, cheapest first. Mods may add to this list (it changes generation and rating). */
export const passes: Pass[] = [windowPass(1), parity, windowPass(2), trial];

/** Run every technique up to maxTier until stuck, finished or contradicted. */
function run(s: Solver, maxTier: number): void {
  const b = s.b;
  for (;;) {
    propagateEasy(b);
    if (b.conflict || b.done) return;
    let progressed = false;
    for (const t of passes) {
      if (t.tier > maxTier) continue;
      const r = t.run(s, false);
      if (b.conflict) return;
      if (r) {
        progressed = true;
        s.used[t.tier]!++;
        if (t.tier > s.maxTierUsed) s.maxTierUsed = t.tier;
        break;
      }
    }
    if (!progressed) return;
  }
}

export type Status = "solved" | "stuck" | "contradiction";

export interface SolveResult {
  status: Status;
  /** Hardest tier needed (only meaningful when solved). */
  tier: number;
  used: number[];
  board: Board;
}

export function solveLogic(g: Grid, clues: Int8Array, maxTier: number, start?: Board): SolveResult {
  const b = start ?? new Board(g, clues);
  const s = new Solver(b);
  run(s, maxTier);
  let status: Status = b.conflict ? "contradiction" : b.done ? "solved" : "stuck";
  if (status === "solved" && b.lines === 0) status = "contradiction";
  return { status, tier: s.maxTierUsed, used: s.used, board: b };
}

/**
 * Up to `limit` solutions by logic plus branching. Each is a full edge array (LINE/CROSS).
 * `exhausted` is false if the node budget ran out first.
 */
export function searchSolutions(g: Grid, clues: Int8Array, limit = 2, budget = 20000): { solutions: Uint8Array[]; exhausted: boolean } {
  const solutions: Uint8Array[] = [];
  let nodes = 0;
  const rec = (s: Solver): boolean => {
    if (++nodes > budget) return false;
    run(s, 1);
    const b = s.b;
    if (b.conflict) return true;
    if (b.done) {
      if (b.lines > 0 && check(g, clues, b.e).solved) solutions.push(b.e.slice());
      return true;
    }
    let pick = -1;
    for (let e = 0; e < g.ne && pick < 0; e++) {
      if (b.e[e] === UNKNOWN && (b.vLine[g.ev[2 * e]!] === 1 || b.vLine[g.ev[2 * e + 1]!] === 1)) pick = e;
    }
    if (pick < 0) {
      let best = -1;
      for (let e = 0; e < g.ne; e++) {
        if (b.e[e] !== UNKNOWN) continue;
        let score = 0;
        for (const f of [g.ef[2 * e]!, g.ef[2 * e + 1]!]) if (f >= 0 && clues[f]! >= 0) score += 2;
        if (score > best) {
          best = score;
          pick = e;
        }
      }
    }
    for (const v of [LINE, CROSS] as const) {
      const t = s.clone();
      t.b.set(pick, v);
      if (!rec(t)) return false;
      if (solutions.length >= limit) return true;
    }
    return true;
  };
  const exhausted = rec(new Solver(new Board(g, clues)));
  return { solutions, exhausted };
}

export interface Analysis {
  /** The solution if unique (or the first found if not), else null. */
  solution: Uint8Array | null;
  /** 1, 2 (= more than one), 0 (none), or -1 (gave up). */
  count: number;
  /** Tier needed by pure logic, or -1 if logic alone gets stuck. */
  tier: number;
  used: number[];
}

export function analyse(g: Grid, clues: Int8Array): Analysis {
  const r = solveLogic(g, clues, 3);
  if (r.status === "solved") return { solution: r.board.e.slice(), count: 1, tier: r.tier, used: r.used };
  if (r.status === "contradiction") return { solution: null, count: 0, tier: -1, used: r.used };
  const s = searchSolutions(g, clues, 2);
  const count = s.solutions.length >= 2 ? 2 : !s.exhausted ? -1 : s.solutions.length;
  return { solution: s.solutions[0] ?? null, count, tier: -1, used: r.used };
}

// --- one kind at a time, for techniques ---

export type WindowKind = "face" | "dot" | "pair";

/** First deduction from a window of this kind, or null. Never changes `b` except to record a conflict. */
export function findWindow(b: Board, kind: WindowKind): Deduction | null {
  const tier = kind === "pair" ? 2 : 1;
  const s = new Solver(b);
  for (const w of s.tier(tier).ws) {
    if (w.kind !== kind) continue;
    const ds = windowDeductions(b, w, tier);
    if (b.conflict) return null;
    if (ds?.length) return ds[0]!;
  }
  return null;
}

/** First edge whose opposite leads to a contradiction using the normal-tier passes, or null. */
export function findTrial(b: Board): Deduction | null {
  const r = trial.run(new Solver(b), true);
  return r && typeof r === "object" && !b.conflict ? r : null;
}

/** First deduction of one inside/outside kind, or null. */
export function findParity(b: Board, kind: "direct" | "group"): Deduction | null {
  const r = kind === "direct" ? parityDirect(b, true) : parityGroup(b, true);
  return r && typeof r === "object" && !b.conflict ? r : null;
}
