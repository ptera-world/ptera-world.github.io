import type { Rng } from "../../core/rng";
import { colName, rowName } from "../../core/names";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import {
  analyzeModel, bit, decides, isSingle, isUnique, solveLevel, trialRule, valueOf,
  type Analysis, type Constraint, type Doms, type Model,
} from "../../lib/grid-kit/csp";
import { cellList, cellName, type Focus } from "../../lib/grid-kit/names";
import { listOf } from "../../lib/edge-names";

/** Cell signs. */
export const BLANK = 0, PLUS = 1, MINUS = 2;

/** Domino values: blank, or which end is plus. A domino's state is a mask of the values it can still take. */
export const NEUTRAL = 0, A_PLUS = 1, A_MINUS = 2;
export const FULL = 7, MAGNET = bit(A_PLUS) | bit(A_MINUS);

export interface MagnetsPuzzle {
  w: number;
  h: number;
  /** Per cell, the other cell of its domino; itself for a lone cell (always blank). */
  pair: number[];
  /** Plus count per column / row and minus count per column / row; -1 where hidden. */
  colPlus: number[];
  rowPlus: number[];
  colMinus: number[];
  rowMinus: number[];
}

export interface MagnetsState {
  /** Per domino (see dominoes()), the mask of values still allowed. FULL = nothing known. */
  doms: number[];
}

/** "set" replaces masks (player moves); "narrow" intersects with `keep` (technique steps). FULL is the only retraction. */
export type MagnetsAction =
  | { type: "set"; doms: number[]; mask: number }
  | { type: "narrow"; doms: number[]; keep: number };

export interface MagnetsInteraction {
  cursor: number;
}

export const LEVEL_NAMES = ["easy", "tricky", "hard"] as const;
export type Level = 0 | 1 | 2;

export const params = defineSchema({
  width: { type: "int", label: "width", default: 6, min: 3, max: 12 },
  height: { type: "int", label: "height", default: 5, min: 3, max: 12 },
  difficulty: {
    type: "enum", label: "difficulty", default: "easy",
    options: [
      { value: "easy", label: "easy", description: "like poles, and lines whose counts are full or need every spot left" },
      { value: "tricky", label: "tricky", description: "also counting whole magnets along a line" },
      { value: "hard", label: "hard", description: "also trying a magnet both ways" },
    ],
  },
  strip: { type: "bool", label: "hide some numbers", default: false },
});

// --- geometry ---

export interface Geometry {
  w: number;
  h: number;
  n: number;
  /** Dominoes as [first cell, second cell]; first is the left or top end. Lone cells aren't dominoes. */
  dominoes: [number, number][];
  /** Domino index per cell, -1 for a lone cell. */
  domOf: Int32Array;
  nbrs: number[][];
  /** Rows then columns. */
  lines: number[][];
}

const geoCache = new WeakMap<MagnetsPuzzle, Geometry>();

export function geometry(p: MagnetsPuzzle): Geometry {
  const hit = geoCache.get(p);
  if (hit) return hit;
  const { w, h } = p;
  const n = w * h;
  const dominoes: [number, number][] = [];
  const domOf = new Int32Array(n).fill(-1);
  for (let c = 0; c < n; c++) {
    const o = p.pair[c]!;
    if (o > c) {
      domOf[c] = domOf[o] = dominoes.length;
      dominoes.push([c, o]);
    }
  }
  const nbrs = Array.from({ length: n }, (_, i) => {
    const x = i % w, y = Math.floor(i / w);
    const out: number[] = [];
    if (y > 0) out.push(i - w);
    if (x > 0) out.push(i - 1);
    if (x < w - 1) out.push(i + 1);
    if (y < h - 1) out.push(i + w);
    return out;
  });
  const lines: number[][] = [];
  for (let y = 0; y < h; y++) lines.push(Array.from({ length: w }, (_, x) => y * w + x));
  for (let x = 0; x < w; x++) lines.push(Array.from({ length: h }, (_, y) => y * w + x));
  const g = { w, h, n, dominoes, domOf, nbrs, lines };
  geoCache.set(p, g);
  return g;
}

/** Sign of cell c when its domino takes value v. */
export function signAt(g: Geometry, c: number, v: number): number {
  if (v === NEUTRAL) return BLANK;
  const first = g.dominoes[g.domOf[c]!]![0] === c;
  return (v === A_PLUS) === first ? PLUS : MINUS;
}

/** Signs cell c can still have under domino mask m, as a mask over BLANK / PLUS / MINUS. */
export function cellSigns(g: Geometry, c: number, m: number): number {
  if (g.domOf[c]! < 0) return bit(BLANK);
  let out = 0;
  for (const v of [NEUTRAL, A_PLUS, A_MINUS]) if (m & bit(v)) out |= bit(signAt(g, c, v));
  return out;
}

/** The domino value that gives cell c this sign. */
export function valueFor(g: Geometry, c: number, sign: number): number {
  if (sign === BLANK) return NEUTRAL;
  const first = g.dominoes[g.domOf[c]!]![0] === c;
  return (sign === PLUS) === first ? A_PLUS : A_MINUS;
}

/** Targets for line li: [plus, minus], -1 where hidden. */
export function targets(p: MagnetsPuzzle, li: number): [number, number] {
  return li < p.h ? [p.rowPlus[li]!, p.rowMinus[li]!] : [p.colPlus[li - p.h]!, p.colMinus[li - p.h]!];
}

export function lineName(p: MagnetsPuzzle, li: number): string {
  return li < p.h ? `row ${rowName(li)}` : `column ${colName(li - p.h)}`;
}

// --- model ---

const modelCache = new WeakMap<MagnetsPuzzle, Model>();
export const SIGN_WORD = ["blank", "plus", "minus"] as const;

export function model(p: MagnetsPuzzle): Model {
  const hit = modelCache.get(p);
  if (hit) return hit;
  const g = geometry(p);
  const constraints: Constraint[] = [];
  // like poles may not touch
  const seen = new Set<string>();
  for (let a = 0; a < g.n; a++) {
    const da = g.domOf[a]!;
    if (da < 0) continue;
    for (const b of g.nbrs[a]!) {
      const db = g.domOf[b]!;
      if (db < 0 || db === da) continue;
      const key = `${Math.min(da, db)}:${Math.max(da, db)}:${Math.min(a, b)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      constraints.push({
        vars: [da, db],
        run(k, emit) {
          for (const [x, y, cx, cy] of [[da, db, a, b], [db, da, b, a]] as const) {
            const fixed = cellSigns(g, cx, k[x]!);
            if (!isSingle(fixed) || fixed === bit(BLANK)) continue;
            const sign = valueOf(fixed);
            const bad = bit(valueFor(g, cy, sign));
            if (!(k[y]! & bad)) continue;
            if (k[y] === bad) return false;
            emit({ kind: "poles", level: 0, vars: [y], keep: FULL & ~bad, because: [cx], related: [cy], data: { sign } });
          }
          return true;
        },
      });
    }
  }
  // counts along lines
  g.lines.forEach((line, li) => {
    const [tp, tm] = targets(p, li);
    if (tp < 0 && tm < 0) return;
    const blankTarget = tp >= 0 && tm >= 0 ? line.length - tp - tm : -1;
    const goal = [blankTarget, tp, tm];
    const lone = line.filter((c) => g.domOf[c]! < 0).length;
    const cells = line.filter((c) => g.domOf[c]! >= 0);
    // per cell: its domino and the sign each domino value gives it
    const cellDom = cells.map((c) => g.domOf[c]!);
    const cellSign = cells.map((c) => [NEUTRAL, A_PLUS, A_MINUS].map((v) => signAt(g, c, v)));
    const doms = [...new Set(cellDom)];
    // per domino on the line: per sign, per value, how many of its cells on the line get that sign
    const per = doms.map((d) => [BLANK, PLUS, MINUS].map((s) => [NEUTRAL, A_PLUS, A_MINUS].map((v) => g.dominoes[d]!.filter((c) => line.includes(c) && signAt(g, c, v) === s).length)));
    constraints.push({
      vars: doms,
      run(k, emit) {
        for (const sign of [PLUS, MINUS, BLANK]) {
          const target = goal[sign]!;
          if (target < 0) continue;
          let have = sign === BLANK ? lone : 0, could = 0;
          const open: number[] = [];
          for (let i = 0; i < cells.length; i++) {
            const m = k[cellDom[i]!]!;
            let sm = 0;
            for (let v = 0; v < 3; v++) if (m & (1 << v)) sm |= 1 << cellSign[i]![v]!;
            if (sm === 1 << sign) have++;
            else if (sm & (1 << sign)) {
              could++;
              open.push(i);
            }
          }
          if (have > target || have + could < target) return false;
          if (!open.length || (have !== target && have + could !== target)) continue;
          const full = have === target;
          for (const i of open) {
            const c = cells[i]!;
            const bad = bit(valueFor(g, c, sign));
            if (emit({ kind: full ? "count-full" : "count-all", level: 0, vars: [cellDom[i]!], keep: full ? FULL & ~bad : bad, because: [], related: line, data: { line: li, sign, cell: c } })) return true;
          }
        }
        // whole dominoes: a domino lying along the line gives at most one of each sign
        for (const sign of [PLUS, MINUS, BLANK]) {
          const target = goal[sign]!;
          if (target < 0) continue;
          let lo = sign === BLANK ? lone : 0, hi = lo;
          for (let j = 0; j < doms.length; j++) {
            const m = k[doms[j]!]!, row = per[j]![sign]!;
            let mn = 9, mx = -1;
            for (let v = 0; v < 3; v++) {
              if (!(m & (1 << v))) continue;
              if (row[v]! < mn) mn = row[v]!;
              if (row[v]! > mx) mx = row[v]!;
            }
            lo += mn;
            hi += mx;
          }
          if (lo > target || hi < target) return false;
          if (lo !== target && hi !== target) continue;
          const atLow = lo === target;
          for (let j = 0; j < doms.length; j++) {
            const d = doms[j]!, m = k[d]!, row = per[j]![sign]!;
            let best = atLow ? 9 : -1;
            for (let v = 0; v < 3; v++) if (m & (1 << v)) best = atLow ? Math.min(best, row[v]!) : Math.max(best, row[v]!);
            let keep = 0;
            for (let v = 0; v < 3; v++) if (m & (1 << v) && row[v] === best) keep |= 1 << v;
            if (keep === m) continue;
            if (emit({ kind: atLow ? "dominoes-full" : "dominoes-all", level: 1, vars: [d], keep, because: [], related: line, data: { line: li, sign } })) return true;
          }
        }
        return true;
      },
    });
  });
  const m: Model = {
    n: g.dominoes.length,
    constraints,
    rules: [],
    countLevel: 1,
    done: (k) => isDoneBy(p, g, (d) => (isSingle(k[d]!) ? valueOf(k[d]!) : NEUTRAL), (d) => !!(k[d]! & bit(NEUTRAL)) || isSingle(k[d]!)),
  };
  m.rules.push(trialRule(m, 2, 1));
  modelCache.set(p, m);
  return m;
}

/**
 * True if reading every domino as `value` (undecided ones as blank) obeys every rule. With a
 * unique solution, that reading is the solution.
 */
function isDoneBy(p: MagnetsPuzzle, g: Geometry, value: (d: number) => number, canBlank: (d: number) => boolean): boolean {
  for (let d = 0; d < g.dominoes.length; d++) if (!canBlank(d)) return false;
  const sign = (c: number) => (g.domOf[c]! < 0 ? BLANK : signAt(g, c, value(g.domOf[c]!)));
  for (let c = 0; c < g.n; c++) {
    const sc = sign(c);
    if (sc !== BLANK && g.nbrs[c]!.some((o) => g.domOf[o] !== g.domOf[c] && sign(o) === sc)) return false;
  }
  return g.lines.every((line, li) => {
    const [tp, tm] = targets(p, li);
    const np = line.filter((c) => sign(c) === PLUS).length, nm = line.filter((c) => sign(c) === MINUS).length;
    return (tp < 0 || tp === np) && (tm < 0 || tm === nm);
  });
}

export const initialDoms = (p: MagnetsPuzzle): Doms => new Int32Array(geometry(p).dominoes.length).fill(FULL);

const analyses = new WeakMap<MagnetsPuzzle, Analysis>();

/** Unique-solution analysis, memoized per puzzle. `solution` holds a value per domino. */
export function analyze(p: MagnetsPuzzle): Analysis {
  let a = analyses.get(p);
  if (!a) analyses.set(p, a = analyzeModel(model(p), initialDoms(p), 2));
  return a;
}

/** Board masks as domains. */
export function readMasks(p: MagnetsPuzzle, s: MagnetsState): Doms {
  return Int32Array.from(s.doms, (m) => m);
}

// --- state ---

export function reduce(p: MagnetsPuzzle, s: MagnetsState, a: MagnetsAction): MagnetsState {
  let next: number[] | null = null;
  for (const d of a.doms) {
    if (!(d >= 0 && d < s.doms.length)) continue;
    const m = a.type === "set" ? a.mask : s.doms[d]! & a.keep;
    if (!(m > 0 && m <= FULL) || m === s.doms[d]) continue;
    next ??= s.doms.slice();
    next[d] = m;
  }
  return next ? { doms: next } : s;
}

/** Sign per cell as the board shows it: decided dominoes only, everything else blank. */
export function shownSigns(p: MagnetsPuzzle, doms: readonly number[]): number[] {
  const g = geometry(p);
  return Array.from({ length: g.n }, (_, c) => {
    const d = g.domOf[c]!;
    return d >= 0 && isSingle(doms[d]!) ? signAt(g, c, valueOf(doms[d]!)) : BLANK;
  });
}

export interface MagnetsConflicts extends Record<string, number[]> {
  /** Cells whose like pole touches another. */
  poles: number[];
  /** Lines (index into rows then columns, times 2, plus 0 for plus or 1 for minus) whose count is over, or can't be reached. */
  counts: number[];
}

export function findConflicts(p: MagnetsPuzzle, doms: readonly number[]): MagnetsConflicts {
  const g = geometry(p);
  const sign = shownSigns(p, doms);
  const poles = new Set<number>();
  for (let c = 0; c < g.n; c++) {
    if (sign[c] === BLANK) continue;
    for (const o of g.nbrs[c]!) if (g.domOf[o] !== g.domOf[c] && sign[o] === sign[c]) poles.add(c);
  }
  const counts: number[] = [];
  g.lines.forEach((line, li) => {
    targets(p, li).forEach((t, si) => {
      if (t < 0) return;
      const want = si === 0 ? PLUS : MINUS;
      const have = line.filter((c) => sign[c] === want).length;
      const room = line.filter((c) => g.domOf[c]! >= 0 && !isSingle(doms[g.domOf[c]!]!) && (cellSigns(g, c, doms[g.domOf[c]!]!) & bit(want))).length;
      if (have > t || have + room < t) counts.push(li * 2 + si);
    });
  });
  return { poles: [...poles], counts };
}

export function isSolved(p: MagnetsPuzzle, s: MagnetsState): boolean {
  const g = geometry(p);
  return isDoneBy(p, g, (d) => (isSingle(s.doms[d]!) ? valueOf(s.doms[d]!) : NEUTRAL), () => true);
}

// --- formats ---

const n2c = (n: number) => (n < 0 ? "." : n < 10 ? String(n) : n < 36 ? String.fromCharCode(87 + n) : String.fromCharCode(29 + n));
function c2n(ch: string): number {
  if (ch === ".") return -1;
  if (ch >= "0" && ch <= "9") return Number(ch);
  if (ch >= "a" && ch <= "z") return ch.charCodeAt(0) - 87;
  if (ch >= "A" && ch <= "Z") return ch.charCodeAt(0) - 29;
  throw new Error(`unexpected "${ch}" in the numbers`);
}

const SGT_RE = /^(\d+)(?:x(\d+))?(?:d.)?S?:([^,]*),([^,]*),([^,]*),([^,]*),([LRTB*,]+)$/;

function checkPuzzle(p: MagnetsPuzzle): MagnetsPuzzle {
  const { w, h } = p;
  if (!(w >= 1 && h >= 1 && w <= 60 && h <= 60)) throw new Error("size must be between 1×1 and 60×60");
  if (p.colPlus.length !== w || p.colMinus.length !== w || p.rowPlus.length !== h || p.rowMinus.length !== h) throw new Error("wrong number of counts");
  for (let c = 0; c < w * h; c++) {
    const o = p.pair[c]!;
    const adjacent = o === c || (Math.abs(o - c) === 1 && Math.floor(o / w) === Math.floor(c / w)) || Math.abs(o - c) === w;
    if (!(o >= 0 && o < w * h) || !adjacent || p.pair[o] !== c) throw new Error("the dominoes don't fit together");
  }
  for (let y = 0; y < h; y++) if (p.rowPlus[y]! >= 0 && p.rowMinus[y]! >= 0 && p.rowPlus[y]! + p.rowMinus[y]! > w) throw new Error(`row ${y + 1} counts add up to more than its length`);
  for (let x = 0; x < w; x++) if (p.colPlus[x]! >= 0 && p.colMinus[x]! >= 0 && p.colPlus[x]! + p.colMinus[x]! > h) throw new Error(`column ${x + 1} counts add up to more than its length`);
  return p;
}

/**
 * Simon Tatham's Magnets game id: `WxH[dX][S]:` then plus counts per column, plus per row, minus
 * per column, minus per row (one character each, `.` hidden), comma-separated, then one letter
 * per cell for its domino end: L / R / T / B, or `*` for a lone cell.
 */
export const sgtFormat: Format<MagnetsPuzzle> = {
  id: "sgt",
  label: "game id (WxH:…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(t) {
    const m = SGT_RE.exec(t.trim());
    if (!m) throw new Error("expected WxH:counts,counts,counts,counts,layout, e.g. 3x3:201,102,120,111,LRTT*BBLR");
    const w = Number(m[1]), h = Number(m[2] ?? m[1]);
    const nums = (s: string, len: number, what: string) => {
      if (s.length !== len) throw new Error(`expected ${len} ${what}, got ${s.length}`);
      return [...s].map(c2n);
    };
    const layout = m[7]!.replace(/,/g, "");
    if (layout.length !== w * h) throw new Error(`expected ${w * h} layout letters, got ${layout.length}`);
    const pair = [...layout].map((ch, i) => (ch === "L" ? i + 1 : ch === "R" ? i - 1 : ch === "T" ? i + w : ch === "B" ? i - w : i));
    return checkPuzzle({
      w, h, pair,
      colPlus: nums(m[3]!, w, "column plus counts"), rowPlus: nums(m[4]!, h, "row plus counts"),
      colMinus: nums(m[5]!, w, "column minus counts"), rowMinus: nums(m[6]!, h, "row minus counts"),
    });
  },
  serialize(p) {
    const lay = p.pair.map((o, i) => (o === i ? "*" : o === i + 1 ? "L" : o === i - 1 ? "R" : o === i + p.w ? "T" : "B")).join("");
    return `${p.w}x${p.h}:${p.colPlus.map(n2c).join("")},${p.rowPlus.map(n2c).join("")},${p.colMinus.map(n2c).join("")},${p.rowMinus.map(n2c).join("")},${lay}`;
  },
};

// --- hints ---

export function wrongHint(p: MagnetsPuzzle, s: MagnetsState): Hint<MagnetsAction> | null {
  const a = analyze(p);
  if (a.count !== 1 || !a.solution) return null;
  const sol = a.solution;
  const g = geometry(p);
  const wrong = s.doms.flatMap((m, d) => (m !== FULL && !(m & bit(sol[d]!)) ? [d] : []));
  if (!wrong.length) return null;
  const cells = wrong.flatMap((d) => g.dominoes[d]!);
  return {
    message: `${wrong.length === 1 ? "the domino on" : "the dominoes on"} ${cellList(p, cells)} ${wrong.length === 1 ? "is" : "are"} marked wrong`,
    focus: { cells, because: [] } satisfies Focus,
    actions: [{ type: "set", doms: wrong, mask: FULL }],
  };
}

export function hint(p: MagnetsPuzzle, s: MagnetsState): Hint<MagnetsAction> | null {
  const c = findConflicts(p, s.doms);
  const g = geometry(p);
  if (c.poles.length) return { message: `like poles touch at ${cellList(p, c.poles)}`, focus: { cells: c.poles, because: [] } satisfies Focus };
  if (c.counts.length) {
    const li = c.counts[0]! >> 1;
    return { message: `${lineName(p, li)} can't get its ${(c.counts[0]! & 1) ? "minus" : "plus"} count right any more`, focus: { cells: [], because: [], related: g.lines[li]! } satisfies Focus };
  }
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: MagnetsPuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 3 };
  return { label: LEVEL_NAMES[a.level]!, score: a.level };
}

// --- generation ---

/**
 * A random domino tiling: random maximal matching, then augmenting paths until at most one cell
 * (odd areas) is left alone. Returns pair (partner per cell, itself when alone).
 */
export function dominoLayout(w: number, h: number, rng: Rng): number[] {
  const n = w * h;
  const pair = new Int32Array(n).fill(-1);
  const nbrs = (i: number) => {
    const x = i % w, y = Math.floor(i / w);
    const out: number[] = [];
    if (y > 0) out.push(i - w);
    if (x > 0) out.push(i - 1);
    if (x < w - 1) out.push(i + 1);
    if (y < h - 1) out.push(i + w);
    return rng.shuffle(out);
  };
  for (const i of rng.shuffle(Array.from({ length: n }, (_, j) => j))) {
    if (pair[i] !== -1) continue;
    const free = nbrs(i).filter((j) => pair[j] === -1);
    if (free.length) {
      const j = free[0]!;
      pair[i] = j;
      pair[j] = i;
    }
  }
  // augment from cells of one checkerboard color
  const black = (i: number) => ((i % w) + Math.floor(i / w)) % 2 === 0;
  const augment = (i: number, seen: Uint8Array): boolean => {
    for (const j of nbrs(i)) {
      if (seen[j]) continue;
      seen[j] = 1;
      if (pair[j] === -1 || augment(pair[j]!, seen)) {
        pair[i] = j;
        pair[j] = i;
        return true;
      }
    }
    return false;
  };
  for (const i of rng.shuffle(Array.from({ length: n }, (_, j) => j))) {
    if (pair[i] === -1 && black(i)) augment(i, new Uint8Array(n));
  }
  return Array.from(pair, (o, i) => (o === -1 ? i : o));
}

/** Magnets laid at random: a few blank dominoes first, then magnets wherever like poles allow. */
export function layMagnets(g: Geometry, rng: Rng): number[] {
  const value = Array.from({ length: g.dominoes.length }, () => -1);
  const sign = new Int32Array(g.n);
  const initialBlank = g.n > 100 ? 5 : Math.floor(g.n / 10);
  let laid = 0;
  const ok = (c: number, s: number) => g.nbrs[c]!.every((o) => g.domOf[o] === g.domOf[c] || sign[o] !== s);
  for (const c of rng.shuffle(Array.from({ length: g.n }, (_, i) => i))) {
    const d = g.domOf[c]!;
    if (d < 0 || value[d] !== -1) continue;
    const other = g.dominoes[d]![0] === c ? g.dominoes[d]![1] : g.dominoes[d]![0];
    let v = NEUTRAL;
    if (laid >= initialBlank) {
      if (ok(c, PLUS) && ok(other, MINUS)) v = valueFor(g, c, PLUS);
      else if (ok(c, MINUS) && ok(other, PLUS)) v = valueFor(g, c, MINUS);
    }
    value[d] = v;
    for (const x of g.dominoes[d]!) sign[x] = signAt(g, x, v);
    laid++;
  }
  return value;
}

/** Logic up to `level` decides every domino (so the solution is unique). */
function decidedBy(p: MagnetsPuzzle, level: number): boolean {
  return decides(model(p), initialDoms(p), level);
}

const EXACT_ATTEMPTS = 40;
const MAX_ATTEMPTS = 2000;

/**
 * Deterministic in (params, rng): random tiling, random magnets, all counts shown; kept when
 * logic at the requested level solves it (which proves it unique). With `strip`, counts are then
 * hidden in random order while that stays true. Needs exactly the level when one turns up within
 * EXACT_ATTEMPTS layouts, else the hardest found.
 */
export async function generatePuzzle(w: number, h: number, level: Level, strip: boolean, rng: Rng, ctx: GenerateContext): Promise<MagnetsPuzzle> {
  let best: { p: MagnetsPuzzle; level: number } | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (best && attempt >= EXACT_ATTEMPTS) break;
    await ctx.yield();
    const r = rng.fork(`attempt ${attempt}`);
    const pair = dominoLayout(w, h, r);
    const shape: MagnetsPuzzle = { w, h, pair, colPlus: [], rowPlus: [], colMinus: [], rowMinus: [] };
    const g = geometry(shape);
    const value = layMagnets(g, r);
    const count = (cells: number[], s: number) => cells.filter((c) => g.domOf[c]! >= 0 && signAt(g, c, value[g.domOf[c]!]!) === s).length;
    const p: MagnetsPuzzle = {
      w, h, pair,
      colPlus: g.lines.slice(h).map((l) => count(l, PLUS)), rowPlus: g.lines.slice(0, h).map((l) => count(l, PLUS)),
      colMinus: g.lines.slice(h).map((l) => count(l, MINUS)), rowMinus: g.lines.slice(0, h).map((l) => count(l, MINUS)),
    };
    let got = solveLevel(model(p), initialDoms(p), level);
    if (got === null || !isUnique(model(p), initialDoms(p), 2)) continue;
    let out = p;
    if (strip) {
      const slots = r.shuffle(Array.from({ length: 2 * (w + h) }, (_, i) => i));
      for (const i of slots) {
        await ctx.yield();
        const q = { ...out, colPlus: out.colPlus.slice(), rowPlus: out.rowPlus.slice(), colMinus: out.colMinus.slice(), rowMinus: out.rowMinus.slice() };
        const arr = [q.colPlus, q.rowPlus, q.colMinus, q.rowMinus];
        let j = i, which = 0;
        while (j >= arr[which]!.length) j -= arr[which++]!.length;
        arr[which]![j] = -1;
        if (decidedBy(q, level)) {
          out = q;
          got = solveLevel(model(q), initialDoms(q), level)!;
        }
      }
    }
    if (got === level) return out;
    if (!best || got > best.level) best = { p: out, level: got };
  }
  if (best) return best.p;
  throw new Error("couldn't make a puzzle with these settings; try a different size");
}

export const magnets: PuzzleDef<MagnetsPuzzle, MagnetsState, MagnetsAction, MagnetsInteraction, typeof params> = {
  id: "magnets",
  name: "magnets",
  aliases: ["magnetic", "magnetplatten"],
  tags: ["logic", "grid", "numbers"],
  description: "each domino is a magnet (one plus end, one minus end) or blank. like poles can't touch side by side, and the numbers round the edge count the plus and minus ends in each row and column.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "6×5 easy", params: { width: 6, height: 5, difficulty: "easy" } },
    { label: "6×5 tricky", params: { width: 6, height: 5, difficulty: "tricky" } },
    { label: "8×7 tricky", params: { width: 8, height: 7, difficulty: "tricky" } },
    { label: "8×7 tricky, numbers hidden", params: { width: 8, height: 7, difficulty: "tricky", strip: true } },
    { label: "10×9 hard", params: { width: 10, height: 9, difficulty: "hard" } },
  ],
  generate: (v: Values<typeof params>, rng, ctx) =>
    generatePuzzle(v.width, v.height, LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) as Level, v.strip, rng, ctx),
  formats: [sgtFormat],
  init: (p) => ({ doms: geometry(p).dominoes.map(() => FULL) }),
  initInteraction: () => ({ cursor: 0 }),
  reduce,
  isRetraction: (a) => a.type === "set" && a.mask === FULL,
  rules: () => [
    "the board is cut into dominoes. each domino is either a magnet, with a plus end and a minus end, or blank.",
    "two plus ends may not touch side by side, and neither may two minus ends (across dominoes; corners are fine).",
    "the numbers at the top and left count the plus ends in that column or row; the numbers at the bottom and right count the minus ends. a missing number can be anything.",
    "a lone cell that isn't part of any domino is always blank.",
    "you can also mark a domino as blank, or as a magnet you haven't turned yet; small marks show what's left when a technique rules a choice out.",
  ],
  describeAction: (p, a) => {
    const g = geometry(p);
    const m = a.type === "set" ? a.mask : a.keep;
    const pair = (d: number) => g.dominoes[d]!.map((c) => cellName(p, c)) as [string, string];
    const word = m === FULL ? "clear" : m === bit(NEUTRAL) ? "blank" : m === MAGNET ? "magnet" : null;
    if (word) return `${word} ${listOf(a.doms, (d) => pair(d).join("-"))}`;
    return listOf(a.doms, (d) => {
      const [x, y] = pair(d);
      if (m === bit(A_PLUS)) return `${x} +, ${y} −`;
      if (m === bit(A_MINUS)) return `${x} −, ${y} +`;
      if (m === (bit(NEUTRAL) | bit(A_PLUS))) return `${x} not −`;
      if (m === (bit(NEUTRAL) | bit(A_MINUS))) return `${x} not +`;
      return `${x}-${y}`;
    });
  },
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? { board: { doms: a.solution.map((v) => bit(v)) } } : null;
  },
  hint,
  rate,
  describe: (p) => `${p.w}×${p.h}`,
};

