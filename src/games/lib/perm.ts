import { work } from "./work";

/**
 * Hint engine for puzzles whose moves are fixed rearrangements of cells (rows sliding, blocks
 * turning). Copied verbatim into each pack that uses it; packs can't import each other.
 *
 * Tiles are placed one cell at a time in a fixed order. Each placement searches for the cheapest
 * way to bring a matching tile home using "macros": single moves, plus commutators (a b a⁻¹ b⁻¹)
 * and their variants, which shuffle only a few cells and so can work around finished ones. The
 * last few cells are searched together; if they can't be finished without disturbing the rest
 * (a parity problem, or turns that only add up right after some number of moves), a few moves that
 * fix it are made first and the placement starts over.
 */

export interface PermMove<A> {
  action: A;
  /** to[c] = cell the content of c ends up in. */
  to: Int32Array;
  /** Quarter turns (mod turns) added to the content of c; null when nothing turns. */
  turn: Int8Array | null;
}

export interface PermSpec<A> {
  /** Shape key: specs with equal keys must have identical cells, moves and order. */
  key: string;
  n: number;
  /** Orientations a tile can have (1 = orientation doesn't matter). */
  turns: number;
  /** Every move the player can make, inverses included. */
  moves: readonly PermMove<A>[];
  /** Placement order; cells never moved by any move may be left out. */
  order: readonly number[];
  /** Every value appears once (so arrangement parity is meaningful). */
  distinct: boolean;
  /** How many cells at the end of the order are searched together (default 6). */
  endgame?: number;
  /**
   * Also build 3-cycles of every reachable triple of cells, as commutators of short words
   * conjugated round the board. Needed when single moves are too big for their commutators to
   * stay small (blocks of 3×3 and up).
   */
  deep?: boolean;
}

export interface PermState {
  /** Value per cell; tiles with equal values are interchangeable. */
  values: readonly number[];
  /** Orientation per cell (0 = upright); omitted when turns is 1. */
  turns?: readonly number[];
}

export type MacroKind = "move" | "cycle";

export interface Macro<A> {
  kind: MacroKind;
  actions: A[];
  to: Int32Array;
  turn: Int8Array | null;
  /** Cells whose content moves or turns. */
  support: number[];
}

export type StepKind = "move" | "cycle" | "endgame" | "parity";

export interface PermStep<A> {
  kind: StepKind;
  actions: A[];
  /** Cell being filled (endgame and parity: the first unfinished cell). */
  cell: number;
  /** Where that cell's tile is now (endgame and parity: -1). */
  from: number;
  /** Cells this step moves. */
  support: number[];
  /** Further moves needed to finish this cell (or the endgame) after this step. */
  left: number;
}

const ENDGAME_CELLS = 6;
const ENDGAME_STATES = 400_000;
const SUPPORT_CAP = 6;

function macroFrom<A>(kind: MacroKind, actions: A[], to: Int32Array, turn: Int8Array | null): Macro<A> {
  const support: number[] = [];
  for (let c = 0; c < to.length; c++) if (to[c] !== c || (turn && turn[c])) support.push(c);
  return { kind, actions, to, turn, support };
}

function compose<A>(kind: MacroKind, a: Macro<A>, b: Macro<A>, turns: number): Macro<A> {
  work.units++;
  const n = a.to.length;
  const to = new Int32Array(n);
  const turn = turns > 1 ? new Int8Array(n) : null;
  for (let c = 0; c < n; c++) {
    const mid = a.to[c]!;
    to[c] = b.to[mid]!;
    if (turn) turn[c] = ((a.turn?.[c] ?? 0) + (b.turn?.[mid] ?? 0)) % turns;
  }
  return macroFrom(kind, [...a.actions, ...b.actions], to, turn);
}

const signature = (m: Macro<unknown>): string => `${m.to.join(",")}|${m.turn ? m.turn.join("") : ""}`;

interface Library<A> {
  /** Macros placement may use, cheapest first. */
  macros: Macro<A>[];
  /** Orbit of each cell under the moves, -1 if no move touches it. Invariants are counted per orbit. */
  orbit: Int32Array;
  /**
   * Set when the macros inside the endgame cells can't reach every invariant the moves can: placement
   * then sticks to macros that keep every invariant, and a state with a nonzero one is first fixed
   * with the word stored under the invariant that cancels it.
   */
  fixes: Map<string, Macro<A>> | null;
  /** Indexes into macros of the ones that move each cell. */
  byCell: number[][];
}

/** Parity of a permutation per orbit, as a bit vector (bit k set: odd on orbit k). */
function parity(to: ArrayLike<number>, orbit: Int32Array): number {
  const seen = new Uint8Array(to.length);
  let par = 0;
  for (let i = 0; i < to.length; i++) {
    if (seen[i]) continue;
    let len = 0;
    for (let j = i; !seen[j]; j = to[j]!) { seen[j] = 1; len++; }
    if ((len - 1) & 1) par ^= 1 << orbit[i]!;
  }
  return par;
}

/** Orbits of cells under the moves, numbered from 0; cells no move touches get -1. */
function orbits(n: number, moves: readonly { to: Int32Array }[]): Int32Array {
  const root = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => { while (root[i] !== i) i = root[i] = root[root[i]!]!; return i; };
  const moved = new Uint8Array(n);
  for (const m of moves) for (let c = 0; c < n; c++) if (m.to[c] !== c) { moved[c] = 1; root[find(c)] = find(m.to[c]!); }
  const ids = new Map<number, number>();
  const out = new Int32Array(n).fill(-1);
  for (let c = 0; c < n; c++) {
    if (!moved[c]) continue;
    const r = find(c);
    if (!ids.has(r)) ids.set(r, ids.size);
    out[c] = ids.get(r)!;
  }
  if (ids.size > 30) throw new Error("perm: parity vectors hold at most 30 orbits");
  return out;
}

/**
 * What no commutator can change: the parity of the arrangement on each orbit (when values are
 * distinct) and the turns added up over each orbit, mod the number of orientations.
 */
interface Invariant { par: number; sums: number[] }

const invKey = (v: Invariant) => `${v.par}:${v.sums.join(",")}`;
const isZero = (v: Invariant) => !v.par && v.sums.every((x) => !x);
const addInv = (a: Invariant, b: Invariant, T: number): Invariant => ({ par: a.par ^ b.par, sums: a.sums.map((x, i) => (x + b.sums[i]!) % T) });
const negInv = (a: Invariant, T: number): Invariant => ({ par: a.par, sums: a.sums.map((x) => (T - x) % T) });

function invariantOf(to: ArrayLike<number>, turn: ArrayLike<number> | null | undefined, orbit: Int32Array, T: number, distinct: boolean): Invariant {
  const count = Math.max(-1, ...orbit) + 1;
  const sums = Array.from({ length: T > 1 ? count : 0 }, () => 0);
  if (turn && T > 1) for (let c = 0; c < orbit.length; c++) if (orbit[c]! >= 0) sums[orbit[c]!] = (sums[orbit[c]!]! + turn[c]!) % T;
  return { par: distinct ? parity(to, orbit) : 0, sums };
}

const libraries = new Map<string, Library<unknown>>();

/** Two-move words the search for small macros starts from. */
const DEEP_WORDS = 600;
/** Elements carried from one round of commutators to the next, smallest support first. */
const DEEP_POOL = 300;
const DEEP_ROUNDS = 10;
/** Commutators are only taken of elements sharing at most this many cells, so the result stays small. */
const DEEP_SHARED = 4;
/** Largest support of a macro kept by threeCycles. */
const DEEP_SUPPORT = 3;

/**
 * Macros moving at most three cells (3-cycles, and twists when tiles turn), each with the shortest
 * word found, for every cell conjugation reaches. A commutator [x, y] only moves cells near where
 * x and y overlap, so commutators of elements that share few cells are smaller than either; rounds
 * of that shrink big moves (4×4 turns) down to 3-cycles. Each one found is then carried round the
 * board by conjugating it with single moves. Moves that keep cells apart (3×3 turns keep every tile
 * on its checkerboard color) need a seed in each class, so rounds go on until every moving cell is covered.
 */
function threeCycles<A>(base: Macro<A>[], inv: Map<Macro<A>, Macro<A>>, T: number): Macro<A>[] {
  const n = base[0]?.to.length ?? 0;
  const invAction = new Map(base.map((b) => [b.actions[0], inv.get(b)!.actions[0]!]));
  const inverse = (m: Macro<A>): Macro<A> => {
    const to = new Int32Array(n);
    const turn = T > 1 ? new Int8Array(n) : null;
    for (let c = 0; c < n; c++) {
      to[m.to[c]!] = c;
      if (turn) turn[m.to[c]!] = (T - (m.turn?.[c] ?? 0)) % T;
    }
    return macroFrom("cycle", m.actions.slice().reverse().map((a) => invAction.get(a)!), to, turn);
  };
  const comm = (x: Macro<A>, y: Macro<A>) => compose("cycle", compose("cycle", compose("cycle", x, y, T), inverse(x), T), inverse(y), T);
  const found = new Map<string, Macro<A>>();
  const keep = (m: Macro<A>) => {
    const sig = signature(m);
    const old = found.get(sig);
    if (!old || old.actions.length > m.actions.length) found.set(sig, m);
  };
  const moving = new Uint8Array(n);
  for (const b of base) for (const c of b.support) moving[c] = 1;
  /** Cells some kept 3-cycle moves, and (when tiles turn) cells some kept twist turns in place. */
  const covered = new Uint8Array(n), twisted = new Uint8Array(n);
  const done = (c: number) => covered[c] && (T === 1 || twisted[c]);
  const uncovered = () => moving.some((v, c) => v && !done(c));
  const still = T > 1 ? "|" + "0".repeat(n) : "";
  const isTwist = (m: Macro<A>) => m.support.every((c) => m.to[c] === c);
  const close = () => {
    const queue = [...found.values()];
    for (let i = 0; i < queue.length; i++) {
      work.units++;
      const c = queue[i]!;
      for (const s of c.support) (isTwist(c) ? twisted : covered)[s] = 1;
      if (T > 1 && !isTwist(c)) {
        // a turning 3-cycle undone by the plain one on the same cells leaves only the turns
        const plain = found.get(c.to.join(",") + still);
        if (plain && plain !== c) {
          const t = compose("cycle", c, inverse(plain), T);
          const sig = signature(t);
          if (t.support.length && !found.has(sig)) { found.set(sig, t); queue.push(t); }
        }
      }
      for (const b of base) {
        const m = compose("cycle", compose("cycle", b, c, T), inv.get(b)!, T);
        const sig = signature(m);
        if (found.has(sig)) continue;
        found.set(sig, m);
        queue.push(m);
      }
    }
  };
  let pool: Macro<A>[] = base.slice();
  for (const a of base) for (const b of base) {
    if (pool.length >= DEEP_WORDS) break;
    if (b !== inv.get(a)) pool.push(compose("cycle", a, b, T));
  }
  for (let round = 0; round < DEEP_ROUNDS && uncovered(); round++) {
    pool.sort((a, b) => a.support.length - b.support.length || a.actions.length - b.actions.length);
    pool = pool.slice(0, DEEP_POOL);
    const next = new Map<string, Macro<A>>();
    for (let i = 0; i < pool.length; i++) {
      const x = pool[i]!;
      const xs = new Uint8Array(n);
      for (const c of x.support) xs[c] = 1;
      for (let j = i + 1; j < pool.length; j++) {
        const y = pool[j]!;
        let k = 0, at = -1;
        for (const c of y.support) if (xs[c]) { k++; at = c; }
        if (k < 1 || k > DEEP_SHARED || (k === 1 && done(at))) continue;
        const c = comm(x, y);
        if (!c.support.length) continue;
        if (c.support.length <= DEEP_SUPPORT) { if (!c.support.every(done)) keep(c); }
        else if (c.support.length < Math.max(x.support.length, y.support.length)) {
          const sig = signature(c);
          const old = next.get(sig);
          if (!old || old.actions.length > c.actions.length) next.set(sig, c);
        }
      }
    }
    close();
    pool = [...pool, ...next.values()];
  }
  return [...found.values()];
}

function library<A>(spec: PermSpec<A>): Library<A> {
  const cached = libraries.get(spec.key);
  if (cached) return cached as Library<A>;
  const T = spec.turns;
  const base = spec.moves.map((m) => macroFrom("move", [m.action], m.to, m.turn));
  const inverse = (m: Macro<A>): Macro<A> => {
    const sig = (() => {
      const to = new Int32Array(m.to.length);
      const turn = T > 1 ? new Int8Array(m.to.length) : null;
      for (let c = 0; c < m.to.length; c++) {
        to[m.to[c]!] = c;
        if (turn) turn[m.to[c]!] = (T - (m.turn?.[c] ?? 0)) % T;
      }
      return `${to.join(",")}|${turn ? turn.join("") : ""}`;
    })();
    const found = base.find((b) => signature(b) === sig);
    if (!found) throw new Error("perm: every move needs its inverse in the move list");
    return found;
  };
  const inv = new Map(base.map((b) => [b, inverse(b)]));
  const best = new Map<string, Macro<A>>();
  const add = (m: Macro<A>) => {
    if (!m.support.length || m.support.length > SUPPORT_CAP) return;
    const sig = signature(m);
    const old = best.get(sig);
    if (!old || old.actions.length > m.actions.length) best.set(sig, m);
  };
  for (const b of base) best.set(signature(b), b);
  const overlaps = (a: Macro<A>, b: Macro<A>) => { const s = new Set(a.support); return b.support.some((c) => s.has(c)); };
  const comms: Macro<A>[] = [];
  for (const a of base) for (const b of base) {
    if (a === b || inv.get(a) === b || !overlaps(a, b)) continue;
    const m = compose("cycle", compose("cycle", compose("cycle", a, b, T), inv.get(a)!, T), inv.get(b)!, T);
    if (m.support.length && m.support.length <= SUPPORT_CAP) { comms.push(m); add(m); }
  }
  for (const c of base) for (const x of comms) {
    if (!overlaps(c, x)) continue;
    add(compose("cycle", compose("cycle", c, x, T), inv.get(c)!, T));
  }
  const small = comms.filter((m) => m.support.length <= 3);
  const byCell = new Map<number, Macro<A>[]>();
  for (const m of small) for (const c of m.support) byCell.set(c, [...(byCell.get(c) ?? []), m]);
  const id = new Map(small.map((m, i) => [m, i]));
  const tried = new Set<number>();
  for (const list of byCell.values()) {
    for (const x of list) for (const y of list) {
      const k = id.get(x)! * small.length + id.get(y)!;
      if (x === y || tried.has(k)) continue;
      tried.add(k);
      add(compose("cycle", x, y, T));
    }
  }
  if (spec.deep) for (const m of threeCycles(base, inv, T)) add(m);
  const all = [...best.values()].sort((a, b) => a.actions.length - b.actions.length);
  const region = new Set(spec.order.slice(Math.max(0, spec.order.length - (spec.endgame ?? ENDGAME_CELLS))));
  const orbit = orbits(spec.n, base);
  const inv0 = (m: Macro<A>) => invariantOf(m.to, m.turn, orbit, T, spec.distinct);
  /** Every invariant the given macros reach, each with the shortest word reaching it. */
  const reach = (from: Macro<A>[]) => {
    const zero = inv0(macroFrom("move", [], Int32Array.from({ length: spec.n }, (_, i) => i), null));
    const words = new Map<string, { v: Invariant; word: Macro<A> | null }>([[invKey(zero), { v: zero, word: null }]]);
    const queue = [zero];
    for (let i = 0; i < queue.length; i++) {
      const at = words.get(invKey(queue[i]!))!;
      for (const m of from) {
        const v = addInv(at.v, inv0(m), T);
        if (words.has(invKey(v))) continue;
        words.set(invKey(v), { v, word: at.word ? compose("move", at.word, m, T) : m });
        queue.push(v);
      }
    }
    return words;
  };
  const varying = base.filter((m) => !isZero(inv0(m)));
  const reachable = varying.length ? reach(base) : null;
  const inRegion = reachable ? reach(all.filter((m) => m.support.every((c) => region.has(c)) && !isZero(inv0(m)))) : null;
  const fixFirst = !!reachable && reachable.size > inRegion!.size;
  const macros = fixFirst ? all.filter((m) => isZero(inv0(m))) : all;
  const fixes = fixFirst ? new Map([...reachable!].flatMap(([k, w]) => (w.word ? [[k, w.word] as const] : []))) : null;
  const byCellIdx: number[][] = Array.from({ length: spec.n }, () => []);
  macros.forEach((m, k) => { for (const c of m.support) byCellIdx[c]!.push(k); });
  const lib: Library<A> = { macros, orbit, fixes, byCell: byCellIdx };
  libraries.set(spec.key, lib as Library<unknown>);
  return lib;
}

const done = (spec: PermSpec<unknown>, goal: readonly number[], st: PermState, c: number): boolean =>
  st.values[c] === goal[c] && (spec.turns === 1 || !st.turns?.[c]);

export function applyMacro(st: PermState, m: { to: Int32Array; turn: Int8Array | null }, turns: number): PermState {
  const values = st.values.slice();
  const tn = st.turns ? st.turns.slice() : undefined;
  for (let c = 0; c < m.to.length; c++) {
    const d = m.to[c]!;
    values[d] = st.values[c]!;
    if (tn) tn[d] = ((st.turns![c] ?? 0) + (m.turn?.[c] ?? 0)) % turns;
  }
  return tn ? { values, turns: tn } : { values };
}

/** Cheapest macros bringing some tile with the goal value to (cell, upright) without touching locked cells. */
function place<A>(spec: PermSpec<A>, lib: Library<A>, goal: readonly number[], st: PermState, cell: number, locked: Uint8Array): Macro<A>[] | null {
  const T = spec.turns, n = spec.n, size = n * T;
  const allowed = lib.macros.map((m) => m.support.every((c) => !locked[c]));
  const dist = new Float64Array(size).fill(Infinity);
  const via = new Int32Array(size).fill(-1);
  const prev = new Int32Array(size).fill(-1);
  const buckets: number[][] = [];
  for (let c = 0; c < n; c++) {
    if (locked[c] || st.values[c] !== goal[cell]) continue;
    const id = c * T + (T > 1 ? st.turns![c]! : 0);
    dist[id] = 0;
    (buckets[0] ??= []).push(id);
  }
  const target = cell * T;
  for (let d = 0; d < buckets.length; d++) {
    const bucket = buckets[d];
    if (!bucket) continue;
    for (let i = 0; i < bucket.length; i++) {
      const id = bucket[i]!;
      if (dist[id] !== d) continue;
      work.units++;
      if (id === target) {
        const path: Macro<A>[] = [];
        for (let x = id; via[x]! >= 0; x = prev[x]!) path.push(lib.macros[via[x]!]!);
        return path.reverse();
      }
      const pos = Math.floor(id / T), o = id % T;
      for (const k of lib.byCell[pos]!) {
        if (!allowed[k]) continue;
        const m = lib.macros[k]!;
        const to = m.to[pos]!;
        const nid = to * T + (T > 1 ? (o + (m.turn?.[pos] ?? 0)) % T : 0);
        const nd = d + m.actions.length;
        if (nd < dist[nid]!) {
          dist[nid] = nd;
          via[nid] = k;
          prev[nid] = id;
          (buckets[nd] ??= []).push(nid);
        }
      }
    }
  }
  return null;
}

/** Breadth-first over the joint contents of the unfinished cells, using macros that stay inside them. */
function endgame<A>(spec: PermSpec<A>, lib: Library<A>, goal: readonly number[], st: PermState, cells: number[]): Macro<A>[] | null {
  const k = cells.length, T = spec.turns;
  const local = new Map(cells.map((c, i) => [c, i]));
  const macros = lib.macros.filter((m) => m.support.every((c) => local.has(c)));
  const moves = macros.map((m) => ({
    to: cells.map((c) => local.get(m.to[c]!)!),
    turn: cells.map((c) => m.turn?.[c] ?? 0),
  }));
  const symbols = [...new Set(cells.map((c) => goal[c]!))];
  const sym = new Map(symbols.map((v, i) => [v, i]));
  if (cells.some((c) => !sym.has(st.values[c]!))) return null;
  const base = symbols.length * T;
  if (base ** k > 2 ** 52) return null;
  const encode = (v: ArrayLike<number>, o: ArrayLike<number>) => {
    let code = 0;
    for (let i = k - 1; i >= 0; i--) code = code * base + v[i]! * T + o[i]!;
    return code;
  };
  const startV = cells.map((c) => sym.get(st.values[c]!)!), startO = cells.map((c) => (T > 1 ? st.turns![c]! : 0));
  const goalCode = encode(cells.map((c) => sym.get(goal[c]!)!), cells.map(() => 0));
  const s0 = encode(startV, startO);
  if (s0 === goalCode) return [];
  const parent = new Map<number, number>([[s0, -1]]);
  const via = new Map<number, number>();
  let frontier = [s0];
  const v = new Int32Array(k), o = new Int32Array(k), nv = new Int32Array(k), no = new Int32Array(k);
  while (frontier.length && parent.size < ENDGAME_STATES) {
    const next: number[] = [];
    for (const code of frontier) {
      work.units++;
      let x = code;
      for (let i = 0; i < k; i++) { const d = x % base; x = (x - d) / base; v[i] = Math.floor(d / T); o[i] = d % T; }
      for (let mi = 0; mi < moves.length; mi++) {
        const mv = moves[mi]!;
        for (let i = 0; i < k; i++) { const j = mv.to[i]!; nv[j] = v[i]!; no[j] = (o[i]! + mv.turn[i]!) % T; }
        const nc = encode(nv, no);
        if (parent.has(nc)) continue;
        parent.set(nc, code);
        via.set(nc, mi);
        if (nc === goalCode) {
          const path: Macro<A>[] = [];
          for (let c = nc; c !== s0; c = parent.get(c)!) path.push(macros[via.get(c)!]!);
          return path.reverse();
        }
        next.push(nc);
      }
    }
    frontier = next;
  }
  return null;
}

interface Progress { index: number; locked: Uint8Array }

function progress(spec: PermSpec<unknown>, goal: readonly number[], st: PermState): Progress {
  const locked = new Uint8Array(spec.n);
  let index = 0;
  while (index < spec.order.length && done(spec, goal, st, spec.order[index]!)) locked[spec.order[index++]!] = 1;
  return { index, locked };
}

const cost = (ms: Macro<unknown>[]) => ms.reduce((a, m) => a + m.actions.length, 0);

/** The state's invariant relative to the goal (parity only when every value is distinct). */
function stateInvariant(spec: PermSpec<unknown>, goal: readonly number[], st: PermState, orbit: Int32Array): Invariant {
  const where = new Map(goal.map((v, c) => [v, c]));
  const to = spec.distinct ? st.values.map((v) => where.get(v)!) : goal.map((_, c) => c);
  return invariantOf(to, st.turns, orbit, spec.turns, spec.distinct);
}

interface Stretch<A> {
  kind: StepKind;
  path: Macro<A>[];
  cell: number;
  locked: Uint8Array;
}

/** The next stretch of the method: the macros that fill the next cell, the whole endgame, or a parity fix. */
function stretch<A>(spec: PermSpec<A>, goal: readonly number[], st: PermState): Stretch<A> | "solved" | null {
  const lib = library(spec);
  const { index, locked } = progress(spec, goal, st);
  if (index === spec.order.length) return "solved";
  const cell = spec.order[index]!;
  if (lib.fixes) {
    const v = stateInvariant(spec, goal, st, lib.orbit);
    if (!isZero(v)) {
      const fix = lib.fixes.get(invKey(negInv(v, spec.turns)));
      return fix ? { kind: "parity", path: [fix], cell, locked } : null;
    }
  }
  const endStart = Math.max(0, spec.order.length - (spec.endgame ?? ENDGAME_CELLS));
  if (index < endStart) {
    const path = place(spec, lib, goal, st, cell, locked);
    return path?.length ? { kind: path[0]!.kind, path, cell, locked } : null;
  }
  const path = endgame(spec, lib, goal, st, spec.order.slice(endStart));
  return path?.length ? { kind: "endgame", path, cell, locked } : null;
}

/** Where the content of `from` ends up after `path`. */
function traces(path: Macro<unknown>[], from: number): number {
  let pos = from;
  for (const m of path) pos = m.to[pos]!;
  return pos;
}

/** One step of the placement method from `st`, or null when solved or stuck. */
export function nextStep<A>(spec: PermSpec<A>, goal: readonly number[], st: PermState): PermStep<A> | null {
  const s = stretch(spec, goal, st);
  if (!s || s === "solved") return null;
  const m = s.path[0]!;
  let from = -1;
  if (s.kind === "move" || s.kind === "cycle") {
    for (let c = 0; c < spec.n && from < 0; c++) if (!s.locked[c] && st.values[c] === goal[s.cell] && traces(s.path, c) === s.cell) from = c;
  }
  return { kind: s.kind, actions: m.actions, cell: s.cell, from, support: m.support, left: cost(s.path) - m.actions.length };
}

/** Every action of the placement method from `st` to the goal, or null if it gets stuck. */
export function solveAll<A>(spec: PermSpec<A>, goal: readonly number[], st0: PermState): A[] | null {
  let st = st0;
  const out: A[] = [];
  for (let guard = 0; guard < spec.n * 4 + 8; guard++) {
    const s = stretch(spec, goal, st);
    if (s === "solved") return out;
    if (!s) return null;
    for (const m of s.path) {
      st = applyMacro(st, m, spec.turns);
      out.push(...m.actions);
    }
  }
  return null;
}
