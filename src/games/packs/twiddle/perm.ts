/**
 * Hint engine for puzzles whose moves are fixed rearrangements of cells (rows sliding, blocks
 * turning). Copied verbatim into each pack that uses it; packs can't import each other.
 *
 * Tiles are placed one cell at a time in a fixed order. Each placement searches for the cheapest
 * way to bring a matching tile home using "macros": single moves, plus commutators (a b a⁻¹ b⁻¹)
 * and their variants, which shuffle only a few cells and so can work around finished ones. The
 * last few cells are searched together; if they can't be finished without disturbing the rest
 * (a parity problem), one move that flips the parity is made and the placement starts over.
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
  /** Rounds of re-aiming small cycles with single moves before and after (default 0). */
  spread?: number;
  /** Macros moving more cells than this are dropped (default 6). */
  supportCap?: number;
  /** How many cells at the end of the order are searched together (default 6). */
  endgame?: number;
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
  /**
   * Set when nothing inside the endgame cells can change the arrangement's parity but some move can:
   * placement then sticks to parity-preserving macros, and an odd arrangement is first fixed with this move.
   */
  flip: Macro<A> | null;
  /** Indexes into macros of the ones that move each cell. */
  byCell: number[][];
}

function parity(to: ArrayLike<number>): number {
  const seen = new Uint8Array(to.length);
  let par = 0;
  for (let i = 0; i < to.length; i++) {
    if (seen[i]) continue;
    let len = 0;
    for (let j = i; !seen[j]; j = to[j]!) { seen[j] = 1; len++; }
    par ^= (len - 1) & 1;
  }
  return par;
}

const libraries = new Map<string, Library<unknown>>();

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
  const cap = spec.supportCap ?? SUPPORT_CAP;
  const best = new Map<string, Macro<A>>();
  const add = (m: Macro<A>) => {
    if (!m.support.length || m.support.length > cap) return;
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
    if (m.support.length && m.support.length <= cap) { comms.push(m); add(m); }
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
  for (let round = 0; round < (spec.spread ?? 0); round++) {
    const seeds = [...best.values()].filter((m) => m.kind === "cycle" && m.support.length <= 4);
    for (const c of base) for (const x of seeds) if (overlaps(c, x)) add(compose("cycle", compose("cycle", c, x, T), inv.get(c)!, T));
  }
  const all = [...best.values()].sort((a, b) => a.actions.length - b.actions.length);
  const region = new Set(spec.order.slice(Math.max(0, spec.order.length - (spec.endgame ?? ENDGAME_CELLS))));
  const oddBase = base.find((m) => parity(m.to));
  const regionOdd = all.some((m) => parity(m.to) && m.support.every((c) => region.has(c)));
  const flip = spec.distinct && oddBase && !regionOdd ? oddBase : null;
  const macros = flip ? all.filter((m) => !parity(m.to)) : all;
  const byCellIdx: number[][] = Array.from({ length: spec.n }, () => []);
  macros.forEach((m, k) => { for (const c of m.support) byCellIdx[c]!.push(k); });
  const lib: Library<A> = { macros, flip, byCell: byCellIdx };
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
  const inside = new Set(cells);
  const macros = lib.macros.filter((m) => m.support.every((c) => inside.has(c)));
  const key = (s: PermState) => cells.map((c) => `${s.values[c]}.${s.turns?.[c] ?? 0}`).join(",");
  const isGoal = (s: PermState) => cells.every((c) => done(spec, goal, s, c));
  if (isGoal(st)) return [];
  const seen = new Map<string, { from: string; m: number } | null>([[key(st), null]]);
  let frontier: PermState[] = [st];
  while (frontier.length && seen.size < ENDGAME_STATES) {
    const next: PermState[] = [];
    for (const s of frontier) {
      const sk = key(s);
      for (let k = 0; k < macros.length; k++) {
        const t = applyMacro(s, macros[k]!, spec.turns);
        const tk = key(t);
        if (seen.has(tk)) continue;
        seen.set(tk, { from: sk, m: k });
        if (isGoal(t)) {
          const path: Macro<A>[] = [];
          for (let e = seen.get(tk); e; e = seen.get(e.from)) path.push(macros[e.m]!);
          return path.reverse();
        }
        next.push(t);
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

/** Parity of the arrangement relative to the goal; only meaningful when every value is distinct. */
function stateParity(goal: readonly number[], st: PermState): number {
  const where = new Map(goal.map((v, c) => [v, c]));
  return parity(st.values.map((v) => where.get(v)!));
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
  if (lib.flip && stateParity(goal, st)) return { kind: "parity", path: [lib.flip], cell, locked };
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
