import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef, Rating } from "../../core/types";
import { obfuscateBitmap } from "./sha1";
import {
  MINE, UNKNOWN, countNumbers, deduceAt, deduceCount, deduceGlobal, deducePairs, generateLayout,
  neighbourTable, solveLayout, startKnowledge, type Deduction, type Level,
} from "./solver";

export const params = defineSchema({
  width: { type: "int", label: "width", default: 9, min: 4, max: 60 },
  height: { type: "int", label: "height", default: 9, min: 4, max: 60 },
  mines: { type: "int", label: "mines", default: 10, min: 1, max: 3000, description: "capped so the start area stays clear" },
  noGuess: {
    type: "bool", label: "never needs a guess", default: true,
    description: "the whole board can be cleared by logic from the starting opening",
  },
  difficulty: {
    type: "enum", label: "logic needed", default: "normal",
    when: (v) => v.noGuess === true,
    options: [
      { value: "easy", label: "easy", description: "one number at a time" },
      { value: "normal", label: "normal", description: "comparing two numbers" },
      { value: "hard", label: "hard", description: "whole regions and the mine count" },
    ],
  },
});

export const LEVELS: Record<string, Level> = { easy: 1, normal: 2, hard: 3 };
export const LEVEL_NAMES = ["trivial", "easy", "normal", "hard"] as const;

export interface MinesPuzzle {
  w: number;
  h: number;
  /** Row-major, 1 = mine. */
  mines: number[];
  /** Pre-opened safe cell, or null (imported layouts with no zero cell). */
  start: number | null;
}

export interface MinesState {
  open: number[];
  flags: number[];
  /** Cell of the mine that was opened, or -1. */
  dead: number;
}

export type MinesAction =
  | { type: "open"; cells: number[] }
  | { type: "flag"; cells: number[]; on?: boolean }
  | { type: "chord"; cell: number };

export interface MinesInteraction {
  cursor: number;
  /** Touch: taps place flags instead of opening. */
  flagMode: boolean;
}

/** Hint focus understood by the mines views. */
export interface MinesFocus {
  cells: number[];
  sources: number[];
}

const numbersCache = new WeakMap<MinesPuzzle, number[]>();

export function numbers(p: MinesPuzzle): number[] {
  let n = numbersCache.get(p);
  if (!n) numbersCache.set(p, (n = countNumbers(p.w, p.h, p.mines)));
  return n;
}

export function mineCount(p: MinesPuzzle): number {
  return p.mines.reduce((a, b) => a + b, 0);
}

export const cellName = (p: { w: number }, c: number) => `(${(c % p.w) + 1}, ${Math.floor(c / p.w) + 1})`;

/** Open `cells` (flood-filling zeros, skipping flags). Mutates `open`; returns the mine hit or -1. */
function openCells(p: MinesPuzzle, open: number[], flags: number[], cells: readonly number[]): number {
  const nums = numbers(p);
  const nb = neighbourTable(p.w, p.h);
  const stack: number[] = [];
  for (const c of cells) {
    if (open[c] || flags[c]) continue;
    if (p.mines[c]) {
      open[c] = 1;
      return c;
    }
    stack.push(c);
  }
  while (stack.length) {
    const c = stack.pop()!;
    if (open[c]) continue;
    open[c] = 1;
    if (nums[c] !== 0) continue;
    for (const d of nb[c]!) if (!open[d] && !flags[d] && !p.mines[d]) stack.push(d);
  }
  return -1;
}

/** Applies an open to a state, returning the same object when nothing changes. */
export function openIn(p: MinesPuzzle, s: MinesState, cells: readonly number[]): MinesState {
  if (s.dead >= 0) return s;
  const valid = cells.filter((c) => c >= 0 && c < p.mines.length && !s.open[c] && !s.flags[c]);
  if (!valid.length) return s;
  const open = s.open.slice();
  const dead = openCells(p, open, s.flags, valid);
  return { ...s, open, dead };
}

export function chordCells(p: MinesPuzzle, s: MinesState, cell: number): number[] {
  if (!s.open[cell] || p.mines[cell]) return [];
  const nb = neighbourTable(p.w, p.h)[cell]!;
  const flagged = nb.filter((d) => s.flags[d]).length;
  if (flagged !== numbers(p)[cell]) return [];
  return nb.filter((d) => !s.open[d] && !s.flags[d]);
}

function reduce(p: MinesPuzzle, s: MinesState, a: MinesAction): MinesState {
  switch (a.type) {
    case "open":
      return openIn(p, s, a.cells);
    case "chord":
      if (s.dead >= 0 || a.cell < 0 || a.cell >= p.mines.length) return s;
      return openIn(p, s, chordCells(p, s, a.cell));
    case "flag": {
      if (s.dead >= 0) return s;
      let flags: number[] | null = null;
      for (const c of a.cells) {
        if (c < 0 || c >= p.mines.length || s.open[c]) continue;
        const v = a.on === undefined ? s.flags[c]! ^ 1 : a.on ? 1 : 0;
        if (v === s.flags[c]) continue;
        flags ??= s.flags.slice();
        flags[c] = v;
      }
      return flags ? { ...s, flags } : s;
    }
    default:
      return s;
  }
}

function init(p: MinesPuzzle): MinesState {
  const n = p.w * p.h;
  const open = Array.from({ length: n }, () => 0);
  const flags = Array.from({ length: n }, () => 0);
  if (p.start !== null) openCells(p, open, flags, [p.start]);
  return { open, flags, dead: -1 };
}

/** What the player can see: opened numbers, nothing else. */
export function visibleKnowledge(p: MinesPuzzle, s: MinesState): Int8Array {
  const nums = numbers(p);
  const K = new Int8Array(p.w * p.h).fill(UNKNOWN);
  for (let c = 0; c < K.length; c++) if (s.open[c] && !p.mines[c]) K[c] = nums[c]!;
  return K;
}

/**
 * Deductions available from opened cells, lowest level first. Mine deductions the player has
 * already flagged are folded into the knowledge and skipped, so the result is always news.
 */
export function nextDeduction(p: MinesPuzzle, s: MinesState, maxLevel: Level = 3): Deduction | null {
  const K = visibleKnowledge(p, s);
  const nb = neighbourTable(p.w, p.h);
  const total = mineCount(p);
  for (let guard = 0; guard < K.length + 1; guard++) {
    const found: Deduction[] = [];
    for (let c = 0; c < K.length; c++) {
      const d = deduceAt(K, nb, c);
      if (d) found.push(d);
    }
    const g = deduceCount(K, total);
    if (g) found.push(g);
    if (!found.length && maxLevel >= 2) found.push(...deducePairs(K, p.w, p.h, nb));
    if (!found.length && maxLevel >= 3) {
      const d = deduceGlobal(K, nb, total);
      if (d) found.push(d);
    }
    if (!found.length) return null;
    const news = found.map((d) => ({ ...d, mines: d.mines.filter((c) => !s.flags[c]) }));
    const pick = news.find((d) => d.safe.length) ?? news.find((d) => d.mines.length);
    if (pick) return pick;
    for (const d of found) for (const c of d.mines) K[c] = MINE;
  }
  return null;
}

function describeDeduction(p: MinesPuzzle, d: Deduction): string {
  const nums = numbers(p);
  const what = d.safe.length ? "safe" : d.mines.length === 1 ? "a mine" : "mines";
  const these = (d.safe.length || d.mines.length) === 1 ? "this cell is" : "these are";
  if (d.level === 1 && d.sources.length === 1) {
    const c = d.sources[0]!;
    return d.safe.length
      ? `the ${nums[c]} at ${cellName(p, c)} already has all its mines, so ${these} safe`
      : `the ${nums[c]} at ${cellName(p, c)} has no other room, so ${these} ${what}`;
  }
  if (d.level === 1) {
    return d.safe.length ? "every mine is accounted for, the rest is safe" : "every hidden cell left is a mine";
  }
  if (d.level === 2) {
    const [a, b] = d.sources as [number, number];
    return `comparing the ${nums[a]} at ${cellName(p, a)} with the ${nums[b]} at ${cellName(p, b)}: ${these} ${what}`;
  }
  return `trying every way the ${d.remaining} remaining mines can fit around here: ${these} ${what}`;
}

function hint(p: MinesPuzzle, s: MinesState): Hint<MinesAction> | null {
  if (s.dead >= 0) {
    return { message: "that was a mine. undo to step back", focus: { cells: [s.dead], sources: [] } satisfies MinesFocus };
  }
  const wrong = s.flags.flatMap((f, c) => (f && !p.mines[c] ? [c] : []));
  if (wrong.length) {
    return {
      message: wrong.length === 1 ? `the flag at ${cellName(p, wrong[0]!)} isn't on a mine` : `${wrong.length} flags aren't on mines`,
      focus: { cells: wrong, sources: [] } satisfies MinesFocus,
      actions: [{ type: "flag", cells: wrong, on: false }],
    };
  }
  const d = nextDeduction(p, s);
  if (!d) {
    return p.start === null && !s.open.some(Boolean)
      ? { message: "nothing is open yet, so the first click is a guess" }
      : { message: "no safe deduction from here, this board needs a guess" };
  }
  const cells = d.safe.length ? d.safe : d.mines;
  return {
    message: describeDeduction(p, d),
    focus: { cells, sources: d.sources } satisfies MinesFocus,
    actions: [d.safe.length ? { type: "open", cells } : { type: "flag", cells, on: true }],
  };
}

const ratingCache = new WeakMap<MinesPuzzle, Rating>();

function rate(p: MinesPuzzle): Rating {
  let r = ratingCache.get(p);
  if (r) return r;
  const res = solveLayout(p.w, p.h, p.mines, startKnowledge(p.w, p.h, p.mines, p.start), 3);
  r = res.complete
    ? { label: LEVEL_NAMES[res.maxLevel], score: res.maxLevel }
    : { label: "needs guessing", score: 10 };
  ratingCache.set(p, r);
  return r;
}

/** Start cell for an imported layout: the zero cell whose opening reveals the most, or null. */
export function bestStart(w: number, h: number, mines: number[]): number | null {
  const p: MinesPuzzle = { w, h, mines, start: null };
  const nums = numbers(p);
  let best: number | null = null, bestSize = 0;
  const seen = new Uint8Array(w * h);
  for (let c = 0; c < w * h; c++) {
    if (mines[c] || nums[c] !== 0 || seen[c]) continue;
    const open = Array.from({ length: w * h }, () => 0);
    openCells(p, open, Array.from({ length: w * h }, () => 0), [c]);
    let size = 0;
    open.forEach((v, i) => {
      if (!v) return;
      size++;
      if (nums[i] === 0) seen[i] = 1;
    });
    if (size > bestSize) { best = c; bestSize = size; }
  }
  return best;
}

async function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<MinesPuzzle> {
  const w = v.width, h = v.height, n = w * h;
  const count = Math.max(1, Math.min(v.mines, v.noGuess ? n - 9 : n - 1));
  const sx = w > 2 ? rng.range(1, w - 2) : rng.int(w);
  const sy = h > 2 ? rng.range(1, h - 2) : rng.int(h);
  const start = sy * w + sx;
  const level = v.noGuess ? LEVELS[v.difficulty] ?? 2 : null;
  const { mines } = await generateLayout({ w, h, count, start, level }, rng.fork("layout"), ctx);
  return { w, h, mines, start };
}

// --- formats ---

function checkSize(w: number, h: number): void {
  if (!(w >= 1 && h >= 1 && w <= 200 && h <= 200)) throw new Error("size out of range");
}

/** Simon Tatham's Mines game ID: `WxH[nN][a]:[x,y,](m|u)<hex bitmap>`, masked with 'm'. */
const sgtFormat: Format<MinesPuzzle> = {
  id: "sgt",
  label: "sgt puzzles game id",
  detect: (t) => /^\d+x\d+(n\d+)?a?:/.test(t.trim()),
  parse(text) {
    const m = /^(\d+)x(\d+)[^:]*:(.*)$/.exec(text.trim());
    if (!m) throw new Error("expected WxH:desc, e.g. 9x9n10:4,4,m…");
    const w = Number(m[1]), h = Number(m[2]);
    checkSize(w, h);
    let desc = m[3]!;
    if (desc.startsWith("r")) {
      throw new Error("this is a random-seed id that only sgt's own generator can expand; copy the game id after the board has started instead");
    }
    let start: number | null = null;
    const pos = /^(\d+),(\d+),/.exec(desc);
    if (pos) {
      const x = Number(pos[1]), y = Number(pos[2]);
      if (x >= w || y >= h) throw new Error("start position is off the board");
      start = y * w + x;
      desc = desc.slice(pos[0].length);
    }
    const masked = desc.startsWith("m");
    if (masked || desc.startsWith("u")) desc = desc.slice(1);
    const n = w * h;
    const hexLen = (n + 3) >> 2;
    if (desc.length < hexLen || !/^[0-9a-fA-F]+$/.test(desc.slice(0, hexLen))) {
      throw new Error(`expected ${hexLen} hex digits of mine bitmap`);
    }
    const bmp = new Uint8Array((n + 7) >> 3);
    for (let i = 0; i < hexLen; i++) bmp[i >> 1] = bmp[i >> 1]! | (parseInt(desc[i]!, 16) << (4 * (1 - (i % 2))));
    if (masked) obfuscateBitmap(bmp, n, true);
    const mines = Array.from({ length: n }, (_, i) => (bmp[i >> 3]! & (0x80 >> (i % 8)) ? 1 : 0));
    if (start !== null && mines[start]) throw new Error("the start square is a mine");
    return { w, h, mines, start: start ?? bestStart(w, h, mines) };
  },
  serialize(p) {
    const n = p.w * p.h;
    const bmp = new Uint8Array((n + 7) >> 3);
    p.mines.forEach((v, i) => { if (v) bmp[i >> 3] = bmp[i >> 3]! | (0x80 >> (i % 8)); });
    obfuscateBitmap(bmp, n, false);
    let hex = "";
    for (let i = 0; i < (n + 3) >> 2; i++) hex += ((bmp[i >> 1]! >> (4 * (1 - (i % 2)))) & 15).toString(16);
    const pos = p.start === null ? "" : `${p.start % p.w},${Math.floor(p.start / p.w)},`;
    return `${p.w}x${p.h}n${mineCount(p)}:${pos}m${hex}`;
  },
};

/** One row per line: `*` mine, `.` safe, `S` the pre-opened start (safe). Digits count as safe. */
const gridFormat: Format<MinesPuzzle> = {
  id: "grid",
  label: "grid (* mine, . safe, S start)",
  detect: (t) => /^[*.sS0-8xX\s]+$/.test(t.trim()) && t.trim().includes("\n"),
  parse(text) {
    const rows = text.trim().split(/\r?\n/).map((r) => r.replace(/\s+/g, "")).filter(Boolean);
    const h = rows.length, w = rows[0]?.length ?? 0;
    checkSize(w, h);
    if (rows.some((r) => r.length !== w)) throw new Error("rows have different lengths");
    const mines: number[] = [];
    let start: number | null = null;
    rows.forEach((r, y) => [...r].forEach((ch, x) => {
      if (ch === "*" || ch === "x" || ch === "X") mines.push(1);
      else if (ch === "." || /[0-8]/.test(ch)) mines.push(0);
      else if (ch === "s" || ch === "S") {
        if (start !== null) throw new Error("more than one start cell");
        start = y * w + x;
        mines.push(0);
      } else throw new Error(`unexpected '${ch}'`);
    }));
    return { w, h, mines, start: start ?? bestStart(w, h, mines) };
  },
  serialize(p) {
    const rows: string[] = [];
    for (let y = 0; y < p.h; y++) {
      let r = "";
      for (let x = 0; x < p.w; x++) {
        const c = y * p.w + x;
        r += p.mines[c] ? "*" : c === p.start ? "S" : ".";
      }
      rows.push(r);
    }
    return rows.join("\n");
  },
};

export const mines: PuzzleDef<MinesPuzzle, MinesState, MinesAction, MinesInteraction, typeof params> = {
  id: "mines",
  name: "mines",
  description: "clear every safe cell. numbers count the mines around them.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "9×9 · 10", params: { width: 9, height: 9, mines: 10 } },
    { label: "16×16 · 40", params: { width: 16, height: 16, mines: 40 } },
    { label: "30×16 · 99", params: { width: 30, height: 16, mines: 99 } },
    { label: "30×16 · 99 hard", params: { width: 30, height: 16, mines: 99, difficulty: "hard" } },
  ],
  generate,
  formats: [sgtFormat, gridFormat],
  init,
  initInteraction: (p) => ({ cursor: p.start ?? Math.floor(p.h / 2) * p.w + Math.floor(p.w / 2), flagMode: false }),
  reduce,
  isSolved: (p, s) => s.dead < 0 && p.mines.every((m, c) => m || s.open[c]),
  solve: (p) => ({ open: p.mines.map((m) => (m ? 0 : 1)), flags: p.mines.slice(), dead: -1 }),
  hint,
  rate,
  describe: (p) => `${p.w}×${p.h} · ${mineCount(p)} mines`,
};
