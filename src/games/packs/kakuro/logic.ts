import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import {
  analyzeModel, bit, decidedBy, decides, isSingle, levelNeeded, popcount, trialRule, valueOf, valuesOf,
  type Analysis, type Constraint, type Doms, type Model, type Rule,
} from "../../lib/grid-kit/csp";
import { neighbours, pieces } from "../../lib/grid-kit/grid";
import { cellList, cellName, type Focus } from "../../lib/grid-kit/names";

export interface KakuroPuzzle {
  /** Whole board, including the top row and left column, which never take digits. */
  w: number;
  h: number;
  /** Row-major: true for cells that take a digit. */
  white: boolean[];
  /** Per black cell, the sum of the white run to its right; 0 when it shows none. */
  across: number[];
  /** Per black cell, the sum of the white run below it; 0 when it shows none. */
  down: number[];
}

export interface KakuroState {
  /** Per cell, the digits it can still hold (bit v for v); one bit is a placed digit. Black cells hold bit 0 and never change. */
  doms: number[];
}

/** "set" replaces masks (player moves); "clear" forgets a cell; "toggle" flips one note; "narrow" intersects (technique steps). */
export type KakuroAction =
  | { type: "set"; cells: number[]; mask: number }
  | { type: "clear"; cells: number[] }
  | { type: "toggle"; cells: number[]; value: number }
  | { type: "narrow"; cells: number[]; keep: number };

export interface KakuroInteraction {
  cursor: number;
  /** Cells a typed digit goes into. */
  selection: number[];
  /** Typing toggles small notes instead of placing. */
  candidates: boolean;
}

export const LEVEL_NAMES = ["easy", "medium", "hard"] as const;
export type Level = 0 | 1 | 2;

export const params = defineSchema({
  width: { type: "int", label: "width", default: 8, min: 3, max: 14, description: "columns of the playing area, not counting the clue column" },
  height: { type: "int", label: "height", default: 8, min: 3, max: 14, description: "rows of the playing area, not counting the clue row" },
  difficulty: {
    type: "enum", label: "difficulty", default: "easy",
    options: [
      { value: "easy", label: "easy", description: "last cells, no repeats, and which digits a sum can use" },
      { value: "medium", label: "medium", description: "also how a sum's digits fit around the other cells" },
      { value: "hard", label: "hard", description: "also trying a digit both ways" },
    ],
  },
});

/** Bits 1 … 9. */
export const DIGIT_MASK = 0b1111111110;
/** The value a black cell holds in the model. */
const BLACK = bit(0);

// --- sum combinations ---

/** COMBOS[len][sum]: sets of `len` different digits (as masks) that add up to `sum`; sum 0 lists every set of that size. */
const COMBOS: number[][][] = (() => {
  const t: number[][][] = Array.from({ length: 10 }, () => Array.from({ length: 46 }, () => []));
  for (let m = 2; m <= DIGIT_MASK; m += 2) {
    const len = popcount(m);
    const sum = valuesOf(m).reduce((a, b) => a + b, 0);
    t[len]![sum]!.push(m);
    t[len]![0]!.push(m);
  }
  return t;
})();

export const combosFor = (len: number, sum: number): readonly number[] => COMBOS[len]?.[sum] ?? [];

// --- geometry ---

export interface Run {
  cells: number[];
  /** 0 when the clue cell shows no sum for it. */
  sum: number;
  /** The black cell its sum is written in. */
  clue: number;
  dir: "across" | "down";
}

export interface Geometry {
  w: number;
  h: number;
  n: number;
  runs: Run[];
  /** Per cell, the runs it belongs to (across first). */
  runsOf: number[][];
  whites: number[];
}

const geoCache = new WeakMap<KakuroPuzzle, Geometry>();

export function geometry(p: KakuroPuzzle): Geometry {
  const hit = geoCache.get(p);
  if (hit) return hit;
  const n = p.w * p.h;
  const runs: Run[] = [];
  const runsOf: number[][] = Array.from({ length: n }, () => []);
  const scan = (start: number, step: number, steps: number, dir: Run["dir"]) => {
    const cells: number[] = [];
    for (let i = 1; i <= steps && p.white[start + i * step]; i++) cells.push(start + i * step);
    if (!cells.length) return;
    for (const c of cells) runsOf[c]!.push(runs.length);
    runs.push({ cells, sum: (dir === "across" ? p.across : p.down)[start]!, clue: start, dir });
  };
  for (let c = 0; c < n; c++) {
    if (p.white[c]) continue;
    scan(c, 1, p.w - 1 - (c % p.w), "across");
  }
  for (let c = 0; c < n; c++) {
    if (p.white[c]) continue;
    const y = Math.floor(c / p.w);
    scan(c, p.w, p.h - 1 - y, "down");
  }
  const g = { w: p.w, h: p.h, n, runs, runsOf, whites: Array.from({ length: n }, (_, c) => c).filter((c) => p.white[c]) };
  geoCache.set(p, g);
  return g;
}

/** "the across sum of 16 at B3" / "the down run from C1" when it shows no sum. */
export function runName(p: KakuroPuzzle, r: Run): string {
  return r.sum ? `the ${r.dir} ${r.sum} at ${cellName(p, r.clue)}` : `the ${r.dir} run from ${cellName(p, r.clue)}`;
}

// --- model ---

/** Can the cells at `at` (masks in `k`) take the digits of `digits`, one each? */
function fits(k: readonly number[], at: readonly number[], digits: number): boolean {
  const ds = valuesOf(digits);
  if (ds.length !== at.length) return false;
  const owner = new Int32Array(10).fill(-1);
  const visit = (i: number, seen: Uint8Array): boolean => {
    const m = k[at[i]!]!;
    for (const d of ds) {
      if (!(m & bit(d)) || seen[d]) continue;
      seen[d] = 1;
      if (owner[d] === -1 || visit(owner[d]!, seen)) {
        owner[d] = i;
        return true;
      }
    }
    return false;
  };
  for (let i = 0; i < at.length; i++) if (!visit(i, new Uint8Array(10))) return false;
  return true;
}

/** What a run's masks say: its placed digits and the sum combinations still open; null if it's broken. */
interface RunFacts {
  k: number[];
  placed: number;
  placedSum: number;
  /** Positions in the run without a placed digit. */
  open: number[];
  /** Combinations holding every placed digit whose other digits some open cell could take. */
  combos: number[];
}

function runFacts(r: Run, live: Doms): RunFacts | null {
  const k = r.cells.map((c) => live[c]!);
  let placed = 0, placedSum = 0;
  const open: number[] = [];
  for (let i = 0; i < k.length; i++) {
    const m = k[i]!;
    if (!isSingle(m)) {
      open.push(i);
      continue;
    }
    const v = valueOf(m);
    if (placed & bit(v)) return null;
    placed |= bit(v);
    placedSum += v;
  }
  if (!open.length) return !r.sum || placedSum === r.sum ? { k, placed, placedSum, open, combos: [placed] } : null;
  let avail = 0;
  for (const i of open) avail |= k[i]!;
  const combos = combosFor(k.length, r.sum).filter((c) => (c & placed) === placed && (c & ~placed & ~avail) === 0);
  return combos.length ? { k, placed, placedSum, open, combos } : null;
}

/** Level 0: placed digits don't repeat, a run's last cell takes what the sum leaves, cells keep only digits of the open combinations. */
function runConstraint(r: Run, index: number): Constraint {
  return {
    vars: r.cells,
    run(live, emit) {
      const f = runFacts(r, live);
      if (!f) return false;
      const { k, placed, placedSum, open, combos } = f;
      if (!open.length) return true;
      const data = { run: index };
      const holding = (mask: number) => r.cells.filter((_, i) => isSingle(k[i]!) && k[i]! & mask);
      for (const i of open) {
        if (!(k[i]! & placed)) continue;
        if (emit({ kind: "no-repeat", level: 0, vars: [r.cells[i]!], keep: ~(k[i]! & placed), because: holding(k[i]! & placed), related: [r.clue], data })) return true;
      }
      if (open.length === 1 && r.sum) {
        const v = r.sum - placedSum;
        if (v < 1 || v > 9 || placed & bit(v)) return false;
        const c = r.cells[open[0]!]!;
        emit({ kind: "last-cell", level: 0, vars: [c], keep: bit(v), because: r.cells.filter((x) => x !== c), related: [r.clue], data: { ...data, value: v } });
        return true;
      }
      let union = 0;
      for (const c of combos) union |= c;
      union &= ~placed;
      const narrowed = open.filter((i) => k[i]! & ~placed & ~union);
      if (narrowed.length) emit({ kind: "combos", level: 0, vars: narrowed.map((i) => r.cells[i]!), keep: union, because: [r.clue], data: { ...data, combos } });
      return true;
    },
  };
}

interface Fit {
  /** Combinations that can be spread over the open cells. */
  fitting: number[];
  /** Per open position, the digits some fitting spread puts there. */
  supported: number[];
}

/** Fits depend only on a run's sum and masks; generation re-asks the same ones many times. */
const fitCache = new Map<string, Fit>();

function fitOf(sum: number, f: RunFacts): Fit {
  const key = `${sum}|${f.k.join(",")}`;
  const hit = fitCache.get(key);
  if (hit) return hit;
  const { k, placed, open, combos } = f;
  const fitting = combos.filter((c) => fits(k, open, c & ~placed));
  const supported = open.map((i) => {
    const others = open.filter((j) => j !== i);
    let got = 0;
    for (const combo of fitting) {
      const rest = combo & ~placed;
      for (const d of valuesOf(rest & k[i]! & ~got)) if (fits(k, others, rest & ~bit(d))) got |= bit(d);
    }
    return got;
  });
  if (fitCache.size > 100000) fitCache.clear();
  const fit = { fitting, supported };
  fitCache.set(key, fit);
  return fit;
}

/** Level 1: a digit stays in a cell only if some combination can be spread over the run's open cells with it there. */
function fitRule(runs: readonly Run[]): Rule {
  return {
    level: 1,
    kinds: ["fit"],
    run(live, emit) {
      for (let index = 0; index < runs.length; index++) {
        const r = runs[index]!;
        const f = runFacts(r, live);
        if (!f) return false;
        if (f.open.length < 2) continue;
        const { fitting, supported } = fitOf(r.sum, f);
        for (let j = 0; j < f.open.length; j++) {
          const i = f.open[j]!;
          if (!(f.k[i]! & ~supported[j]!)) continue;
          const others = f.open.filter((x) => x !== i).map((x) => r.cells[x]!);
          if (emit({ kind: "fit", level: 1, vars: [r.cells[i]!], keep: supported[j]!, because: others, related: [r.clue], data: { run: index, combos: fitting } })) return true;
        }
      }
      return true;
    },
  };
}

const modelCache = new WeakMap<KakuroPuzzle, Model>();

/** One variable per cell (black cells fixed to 0); every run's digits differ and add up to its sum. */
export function model(p: KakuroPuzzle): Model {
  const hit = modelCache.get(p);
  if (hit) return hit;
  const g = geometry(p);
  const m: Model = { n: g.n, constraints: g.runs.map(runConstraint), rules: [fitRule(g.runs)], countLevel: 0 };
  m.rules.push(trialRule(m, 2, 1));
  modelCache.set(p, m);
  return m;
}

export const initialDoms = (p: KakuroPuzzle): Doms => Int32Array.from(p.white, (w) => (w ? DIGIT_MASK : BLACK));

const analyses = new WeakMap<KakuroPuzzle, Analysis>();

export function analyze(p: KakuroPuzzle): Analysis {
  let a = analyses.get(p);
  if (!a) analyses.set(p, a = analyzeModel(model(p), initialDoms(p), 2));
  return a;
}

/** Board masks as domains. */
export function readMasks(p: KakuroPuzzle, s: KakuroState): Doms {
  return Int32Array.from(s.doms, (m, c) => (!p.white[c] ? BLACK : m & DIGIT_MASK));
}

// --- state ---

export const initState = (p: KakuroPuzzle): KakuroState => ({ doms: p.white.map((w) => (w ? DIGIT_MASK : BLACK)) });

export function reduce(p: KakuroPuzzle, s: KakuroState, a: KakuroAction): KakuroState {
  let next: number[] | null = null;
  for (const c of a.cells) {
    if (!(c >= 0 && c < s.doms.length) || !p.white[c]) continue;
    const cur = s.doms[c]!;
    const m = a.type === "set" ? a.mask & DIGIT_MASK
      : a.type === "clear" ? DIGIT_MASK
      : a.type === "narrow" ? cur & a.keep
      : a.value >= 1 && a.value <= 9 ? (cur === DIGIT_MASK ? bit(a.value) : cur ^ bit(a.value)) : cur;
    if (!m || m === cur) continue;
    next ??= s.doms.slice();
    next[c] = m;
  }
  return next ? { doms: next } : s;
}

/** Digit placed in each cell (0 where none is). */
export const placedDigits = (p: KakuroPuzzle, doms: readonly number[]): number[] =>
  doms.map((m, c) => (p.white[c] && isSingle(m) ? valueOf(m) : 0));

export interface KakuroConflicts extends Record<string, number[]> {
  /** Cells holding a digit that appears twice in one run. */
  repeats: number[];
  /** Cells of runs whose placed digits already overshoot the sum, or fill it with the wrong total. */
  sums: number[];
}

export function findConflicts(p: KakuroPuzzle, doms: readonly number[]): KakuroConflicts {
  const g = geometry(p);
  const d = placedDigits(p, doms);
  const repeats = new Set<number>(), sums = new Set<number>();
  for (const r of g.runs) {
    const seen = new Map<number, number>();
    let total = 0, full = true;
    for (const c of r.cells) {
      if (!d[c]) { full = false; continue; }
      total += d[c]!;
      const prev = seen.get(d[c]!);
      if (prev !== undefined) { repeats.add(prev); repeats.add(c); }
      seen.set(d[c]!, c);
    }
    if (r.sum && (total > r.sum || (full && total !== r.sum))) for (const c of r.cells) if (d[c]) sums.add(c);
  }
  return { repeats: [...repeats], sums: [...sums] };
}

export function isSolved(p: KakuroPuzzle, s: KakuroState): boolean {
  const d = placedDigits(p, s.doms);
  if (p.white.some((w, c) => w && !d[c])) return false;
  const c = findConflicts(p, s.doms);
  return !c.repeats.length && !c.sums.length;
}

// --- formats ---

const URL_RE = /(?:^|[?/])kakuro\/(\d+)\/(\d+)\/([0-9a-zA-Z.-]+)\/?$/;

/** A sum in one character: 0-9a-j for 0-19, A-Z for 20-45. */
const decval = (ch: string): number => (/^[0-9a-j]$/.test(ch) ? parseInt(ch, 36) : /^[A-Z]$/.test(ch) ? parseInt(ch, 36) + 10 : -1);
const encval = (v: number): string => (v >= 0 && v <= 19 ? v.toString(36) : v <= 45 ? (v - 10).toString(36).toUpperCase() : "-");

/**
 * puz.link / pzv.jp URLs: `…?kakuro/W/H/<body>`, W×H being the area inside the clue row and column.
 * Body: per inner cell in reading order, black cells as `.` or two sum characters (down, then
 * across) and runs of white cells as `k`-`z` (1-16); then the down sums of the outer row's runs
 * and the across sums of the outer column's runs.
 */
export const pzprFormat: Format<KakuroPuzzle> = {
  id: "pzpr",
  label: "puzz.link URL",
  detect: (t) => URL_RE.test(t.trim()),
  parse(t) {
    const m = URL_RE.exec(t.trim());
    if (!m) throw new Error("expected a puzz.link kakuro URL, e.g. https://puzz.link/p?kakuro/8/8/…");
    const cw = Number(m[1]), ch = Number(m[2]);
    if (!(cw >= 1 && ch >= 1 && cw <= 40 && ch <= 40)) throw new Error("size must be between 1×1 and 40×40");
    const w = cw + 1, h = ch + 1, n = w * h;
    const white = Array.from({ length: n }, (_, c) => c % w > 0 && c >= w);
    const across = Array.from({ length: n }, () => 0), down = Array.from({ length: n }, () => 0);
    const body = m[3]!;
    let i = 0, inner = 0;
    const at = (k: number) => (Math.floor(k / cw) + 1) * w + (k % cw) + 1;
    for (; i < body.length && inner < cw * ch; i++) {
      const c = body[i]!;
      if (c >= "k" && c <= "z") { inner += parseInt(c, 36) - 19; continue; }
      const cell = at(inner);
      white[cell] = false;
      if (c !== ".") {
        down[cell] = Math.max(0, decval(c));
        across[cell] = Math.max(0, decval(body[i + 1] ?? ""));
        i++;
      }
      inner++;
    }
    if (inner < cw * ch) throw new Error("not enough data to fill the grid");
    for (let x = 1; x < w; x++) if (white[w + x]) down[x] = Math.max(0, decval(body[i++] ?? ""));
    for (let y = 1; y < h; y++) if (white[y * w + 1]) across[y * w] = Math.max(0, decval(body[i++] ?? ""));
    return checkPuzzle({ w, h, white, across, down });
  },
  serialize(p) {
    const cw = p.w - 1, ch = p.h - 1;
    let out = "", count = 0;
    for (let y = 1; y < p.h; y++) {
      for (let x = 1; x < p.w; x++) {
        const c = y * p.w + x;
        let piece = "";
        if (!p.white[c]) piece = p.across[c] || p.down[c] ? encval(p.down[c]!) + encval(p.across[c]!) : ".";
        else count++;
        if (count === 0) out += piece;
        else if (piece || count === 16) {
          out += (count + 19).toString(36) + piece;
          count = 0;
        }
      }
    }
    if (count > 0) out += (count + 19).toString(36);
    for (let x = 1; x < p.w; x++) if (p.white[p.w + x]) out += encval(p.down[x]!);
    for (let y = 1; y < p.h; y++) if (p.white[y * p.w + 1]) out += encval(p.across[y * p.w]!);
    return `https://puzz.link/p?kakuro/${cw}/${ch}/${out}`;
  },
};

/**
 * One row per line, cells separated by spaces: `.` a white cell, `#` a black cell, `D\A` a black
 * cell with a down sum D and an across sum A (either may be left out, e.g. `\17` or `23\`).
 */
export const textFormat: Format<KakuroPuzzle> = {
  id: "text",
  label: "text: . white, # black, down\\across sums",
  detect: (t) => /\\/.test(t) && /^[\s.#\\\d]+$/.test(t.trim()),
  parse(t) {
    const rows = t.trim().split(/\r?\n/).map((r) => r.trim().split(/\s+/));
    const w = rows[0]!.length, h = rows.length;
    if (rows.some((r) => r.length !== w)) throw new Error("every row needs the same number of cells");
    const white: boolean[] = [], across: number[] = [], down: number[] = [];
    for (const tok of rows.flat()) {
      if (tok === ".") { white.push(true); across.push(0); down.push(0); continue; }
      white.push(false);
      if (tok === "#") { across.push(0); down.push(0); continue; }
      const m = /^(\d*)\\(\d*)$/.exec(tok);
      if (!m) throw new Error(`don't know the cell "${tok}"`);
      down.push(m[1] ? Number(m[1]) : 0);
      across.push(m[2] ? Number(m[2]) : 0);
    }
    return checkPuzzle({ w, h, white, across, down });
  },
  serialize: (p) => {
    const rows: string[] = [];
    for (let y = 0; y < p.h; y++) {
      const cells: string[] = [];
      for (let x = 0; x < p.w; x++) {
        const c = y * p.w + x;
        cells.push(p.white[c] ? "." : p.across[c] || p.down[c] ? `${p.down[c] || ""}\\${p.across[c] || ""}` : "#");
      }
      rows.push(cells.join(" "));
    }
    return rows.join("\n");
  },
};

/** Throws a player-facing error unless the top row and left column are black, sums fit their runs, and sums sit only before a run. */
function checkPuzzle(p: KakuroPuzzle): KakuroPuzzle {
  if (p.w < 2 || p.h < 2) throw new Error("the board needs at least one row and column besides the clues");
  for (let c = 0; c < p.w * p.h; c++) {
    if ((c < p.w || c % p.w === 0) && p.white[c]) throw new Error("the top row and left column hold only clues");
    if (p.white[c]) continue;
    const right = c % p.w < p.w - 1 && p.white[c + 1], below = c + p.w < p.w * p.h && p.white[c + p.w];
    if (p.across[c] && !right) throw new Error(`${cellName(p, c)} has an across sum but no cells to its right`);
    if (p.down[c] && !below) throw new Error(`${cellName(p, c)} has a down sum but no cells below it`);
  }
  for (const r of geometry(p).runs) {
    if (r.cells.length > 9) throw new Error(`${runName(p, r)} is longer than nine cells`);
    if (r.sum && !combosFor(r.cells.length, r.sum).length) throw new Error(`no ${r.cells.length} different digits add up to ${r.sum} (${runName(p, r)})`);
  }
  return p;
}

// --- hints ---

export function wrongHint(p: KakuroPuzzle, s: KakuroState): Hint<KakuroAction> | null {
  const a = analyze(p);
  if (a.count !== 1 || !a.solution) return null;
  const sol = a.solution;
  const wrong = s.doms.flatMap((m, c) => (p.white[c] && m !== DIGIT_MASK && !(m & bit(sol[c]!)) ? [c] : []));
  if (!wrong.length) return null;
  return {
    message: `${cellList(p, wrong)} ${wrong.length === 1 ? "has" : "have"} a digit or notes that rule out the answer`,
    focus: { cells: wrong, because: [] } satisfies Focus,
    actions: [{ type: "clear", cells: wrong }],
  };
}

export function hint(p: KakuroPuzzle, s: KakuroState): Hint<KakuroAction> | null {
  const c = findConflicts(p, s.doms);
  if (c.repeats.length) return { message: `${cellList(p, c.repeats)} repeat a digit in one run`, focus: { cells: c.repeats, because: [] } satisfies Focus };
  if (c.sums.length) return { message: `the digits on ${cellList(p, c.sums)} don't add up to their sum`, focus: { cells: c.sums, because: [] } satisfies Focus };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: KakuroPuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 3 };
  return { label: LEVEL_NAMES[a.level]!, score: a.level };
}

// --- generation ---

/**
 * A layout with the clue row and column, rotationally symmetric black cells, every white cell in
 * an across and a down run of 2 to 9 cells, and all white cells joined. Null if this try failed.
 */
export function makeLayout(w: number, h: number, rng: Rng): boolean[] | null {
  const n = w * h;
  const white = Array.from({ length: n }, (_, c) => c % w > 0 && c >= w);
  const mirror = (c: number) => (h - Math.floor(c / w)) * w + (w - (c % w));
  const inner = Array.from({ length: n }, (_, c) => c).filter((c) => white[c]);
  const blacken = (c: number) => { white[c] = false; white[mirror(c)] = false; };
  const target = Math.round(inner.length * (0.30 + rng.int(8) / 100));
  for (const c of rng.shuffle(inner.slice())) {
    if (inner.length - inner.filter((x) => white[x]).length >= target) break;
    blacken(c);
  }
  // the top row and left column are black, so a run never wraps past them
  const runLen = (c: number, step: number) => {
    let a = c, b = c;
    while (white[a - step]) a -= step;
    while (white[b + step]) b += step;
    return { a, b, len: (b - a) / step + 1 };
  };
  for (let guard = 0; guard < 4 * n; guard++) {
    let changed = false;
    for (const c of inner) {
      if (!white[c]) continue;
      for (const step of [1, w]) {
        const r = runLen(c, step);
        if (r.len === 1) { blacken(c); changed = true; break; }
        if (r.len > 9) {
          const cut = r.a + step * (2 + rng.int(r.len - 4));
          blacken(cut);
          changed = true;
          break;
        }
      }
    }
    if (!changed) break;
  }
  const nbrs = neighbours(w, h);
  const count = inner.filter((c) => white[c]).length;
  if (count < inner.length / 2) return null;
  if (pieces(nbrs, (c) => white[c]!).count !== 1) return null;
  for (const c of inner) {
    if (!white[c]) continue;
    if (runLen(c, 1).len < 2 || runLen(c, w).len < 2 || runLen(c, 1).len > 9 || runLen(c, w).len > 9) return null;
  }
  return white;
}

/** Digits for every white cell, different within each run; null if the search runs out. */
export function fillDigits(g: Geometry, rng: Rng): number[] | null {
  const digits = Array.from({ length: g.n }, () => 0);
  const used = (c: number) => g.runsOf[c]!.reduce((m, r) => m | g.runs[r]!.cells.reduce((a, x) => a | (digits[x] ? bit(digits[x]!) : 0), 0), 0);
  let budget = 20 * g.whites.length;
  const go = (left: number[]): boolean => {
    if (!left.length) return true;
    if (--budget < 0) return false;
    let pick = 0, best = 10;
    for (let i = 0; i < left.length; i++) {
      const free = 9 - popcount(used(left[i]!));
      if (free < best) { best = free; pick = i; }
    }
    const c = left[pick]!;
    const rest = left.filter((_, i) => i !== pick);
    for (const d of rng.shuffle(valuesOf(DIGIT_MASK & ~used(c)))) {
      digits[c] = d;
      if (go(rest)) return true;
    }
    digits[c] = 0;
    return false;
  };
  return go(g.whites.slice()) ? digits : null;
}

/** The puzzle whose sums are those of `digits` on `white`. */
export function withSums(w: number, h: number, white: boolean[], digits: readonly number[]): KakuroPuzzle {
  const n = w * h;
  const p: KakuroPuzzle = { w, h, white, across: Array.from({ length: n }, () => 0), down: Array.from({ length: n }, () => 0) };
  for (const r of geometry({ ...p }).runs) (r.dir === "across" ? p.across : p.down)[r.clue] = r.cells.reduce((a, c) => a + digits[c]!, 0);
  return p;
}

const SAMPLE = 8;

/** Digits and the puzzle their sums make. */
interface Filled {
  digits: number[];
  p: KakuroPuzzle;
}

/** `digits` with cell c changed to a random other digit its runs don't already hold; null if none is free. */
function changeDigit(g: Geometry, digits: readonly number[], c: number, rng: Rng): number[] | null {
  const taken = g.runsOf[c]!.reduce((m, r) => m | g.runs[r]!.cells.reduce((a, x) => a | (x === c ? 0 : bit(digits[x]!)), 0), 0);
  const free = valuesOf(DIGIT_MASK & ~taken & ~bit(digits[c]!));
  if (!free.length) return null;
  const next = digits.slice();
  next[c] = rng.pick(free);
  return next;
}

/**
 * Changes single digits until logic at `level` (easy or medium) decides every cell. Each step
 * scores a sample of changes, made where that logic stalls, by how much it then decides, and
 * keeps the best, sideways included. A change keeps each run's digits different, so the digits
 * stay a solution of the sums they make. Null when the budget runs out.
 */
export async function climbDigits(w: number, h: number, white: boolean[], start: number[], level: 0 | 1, rng: Rng, ctx: GenerateContext): Promise<Filled | null> {
  const n = w * h;
  let cur: Filled = { digits: start.slice(), p: withSums(w, h, white, start) };
  const score = (q: KakuroPuzzle) => decidedBy(model(q), initialDoms(q), level);
  let got = score(cur.p);
  const g = geometry(cur.p);
  for (let step = 0; step < 8 * g.whites.length; step++) {
    if (got === n) return cur;
    await ctx.yield();
    const k = initialDoms(cur.p);
    decidedBy(model(cur.p), k, level);
    // cells logic leaves open: changing their digits is what can make it decide them
    const stalled = g.whites.filter((c) => !isSingle(k[c]!));
    let best: (Filled & { score: number }) | null = null;
    for (let t = 0; t < SAMPLE; t++) {
      const digits = changeDigit(g, cur.digits, rng.pick(stalled), rng);
      if (!digits) continue;
      const p = withSums(w, h, white, digits);
      const sc = score(p);
      if (!best || sc > best.score) best = { digits, p, score: sc };
    }
    if (best && best.score >= got) {
      cur = best;
      got = best.score;
    }
  }
  return got === n ? cur : null;
}

/**
 * From a puzzle medium logic finishes, single digit changes until one is left that medium logic
 * can't finish but trying digits both ways can. Null when none turns up within `tries`.
 */
async function hardenDigits(w: number, h: number, white: boolean[], start: Filled, tries: number, rng: Rng, ctx: GenerateContext): Promise<KakuroPuzzle | null> {
  const g = geometry(start.p);
  for (let t = 0; t < tries; t++) {
    await ctx.yield();
    const digits = changeDigit(g, start.digits, rng.pick(g.whites), rng);
    if (!digits) continue;
    const p = withSums(w, h, white, digits);
    if (decides(model(p), initialDoms(p), 1)) continue;
    if (decides(model(p), initialDoms(p), 2)) return p;
  }
  return null;
}

const EXACT_ATTEMPTS = 30;
const HARDEN_TRIES = 40;
const LAYOUT_TRIES = 1000;
const MAX_ATTEMPTS = 200;

/**
 * Deterministic in (params, rng): a symmetric layout, random digits, their sums; then digits
 * changed until logic at the level finishes it. Needs exactly the level when one turns up within
 * EXACT_ATTEMPTS layouts, else the hardest found.
 */
export async function generatePuzzle(cw: number, ch: number, level: Level, rng: Rng, ctx: GenerateContext): Promise<KakuroPuzzle> {
  const w = cw + 1, h = ch + 1;
  let best: { p: KakuroPuzzle; level: number } | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (best && attempt >= EXACT_ATTEMPTS) break;
    await ctx.yield();
    const r = rng.fork(`attempt ${attempt}`);
    let white: boolean[] | null = null;
    for (let t = 0; !white && t < LAYOUT_TRIES; t++) white = makeLayout(w, h, r);
    if (!white) continue;
    const digits = fillDigits(geometry(withSums(w, h, white, Array.from({ length: w * h }, () => 0))), r);
    if (!digits) continue;
    const filled = await climbDigits(w, h, white, digits, level === 2 ? 1 : level, r, ctx);
    if (!filled) continue;
    const p = level === 2 ? await hardenDigits(w, h, white, filled, HARDEN_TRIES, r, ctx) : filled.p;
    if (!p) continue;
    const got = levelNeeded(model(p), initialDoms(p), level);
    if (got === null) continue;
    if (got === level) return p;
    if (!best || got > best.level) best = { p, level: got };
  }
  if (best) return best.p;
  throw new Error("couldn't make a puzzle with these settings; try a different size");
}

export const kakuro: PuzzleDef<KakuroPuzzle, KakuroState, KakuroAction, KakuroInteraction, typeof params> = {
  id: "kakuro",
  name: "kakuro",
  aliases: ["cross sums", "kakro"],
  tags: ["logic", "grid", "numbers", "arithmetic", "nikoli"],
  description: "fill the white cells with digits 1 to 9 so that each run of white cells adds up to the sum in the clue before it, with no digit twice in a run.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "6×6 easy", params: { width: 6, height: 6, difficulty: "easy" } },
    { label: "8×8 easy", params: { width: 8, height: 8, difficulty: "easy" } },
    { label: "8×8 medium", params: { width: 8, height: 8, difficulty: "medium" } },
    { label: "10×10 medium", params: { width: 10, height: 10, difficulty: "medium" } },
    { label: "10×10 hard", params: { width: 10, height: 10, difficulty: "hard" } },
    { label: "12×12 hard", params: { width: 12, height: 12, difficulty: "hard" } },
  ],
  generate: (v: Values<typeof params>, rng, ctx) => generatePuzzle(v.width, v.height, LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) as Level, rng, ctx),
  formats: [pzprFormat, textFormat],
  init: initState,
  initInteraction: (p) => {
    const first = Math.max(0, p.white.indexOf(true));
    return { cursor: first, selection: [], candidates: false };
  },
  reduce,
  isRetraction: (a) => a.type === "toggle" || a.type === "clear",
  rules: () => [
    "write a digit from 1 to 9 in every white cell.",
    "a number in a black cell is a sum: below the diagonal, of the white cells running down from it; above the diagonal, of the white cells running across to its right.",
    "the digits in one run are all different.",
    "small digits in a cell are your own notes of what it could still be.",
  ],
  describeAction: (p, a, before, after) => {
    const parts = new Map<string, number[]>();
    for (const c of a.cells) {
      const now = after.doms[c] ?? DIGIT_MASK, gone = (before.doms[c] ?? DIGIT_MASK) & ~now;
      const key = now === DIGIT_MASK ? "clear" : isSingle(now) ? `: ${valueOf(now)}` : a.type === "narrow" && gone ? `: not ${valuesOf(gone).join("/")}` : `: ${valuesOf(now).join("/")}`;
      parts.set(key, [...(parts.get(key) ?? []), c]);
    }
    return [...parts].map(([k, cells]) => (k === "clear" ? `clear ${cellList(p, cells)}` : `${cellList(p, cells)}${k}`)).join(", ");
  },
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? { board: { doms: a.solution.map((v) => bit(v)) } } : null;
  },
  hint,
  rate,
  describe: (p) => `${p.w - 1}×${p.h - 1}`,
};
