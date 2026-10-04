import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, PuzzleDef } from "../../core/types";
import { obfuscateBitmap } from "../../lib/sha1";

export const params = defineSchema({
  colours: { type: "int", label: "colors", default: 6, min: 2, max: 10 },
  pegs: { type: "int", label: "pegs per guess", default: 4, min: 2, max: 5 },
  guesses: { type: "int", label: "guesses", default: 10, min: 1, max: 20 },
  blanks: { type: "bool", label: "allow blank pegs in guesses", default: false, description: "a blank never counts, so it can help you learn about the other pegs" },
  duplicates: { type: "bool", label: "allow repeated colors", default: true, description: "the code (and your guesses) may use a color more than once" },
});

export interface GuessPuzzle {
  colours: number;
  pegs: number;
  guesses: number;
  blanks: boolean;
  duplicates: boolean;
  /** The hidden code, colors 1..colors. */
  code: number[];
}

export interface Marked {
  code: number[];
  /** Pegs of the right color in the right place. */
  black: number;
  /** Further pegs of a right color in the wrong place. */
  white: number;
}

export interface GuessState {
  /** Guesses already marked, oldest first. */
  done: Marked[];
  /** The guess being built: color per peg, 0 for empty (or blank). */
  row: number[];
  /** Pegs whose color carries over to the next guess. */
  holds: boolean[];
}

/** Clearing a peg is the only thing that undoes the player's own work, so it alone is a retraction. */
export type GuessAction =
  | { type: "peg"; index: number; colour: number }
  | { type: "row"; code: number[] }
  | { type: "hold"; index: number }
  | { type: "submit" };

export interface GuessInteraction {
  /** Selected peg position in the current guess. */
  slot: number;
  /** Selected color in the tray. */
  colour: number;
}

/** Black and white marks for a guess against a code; blanks (0) count for nothing. */
export function mark(guess: readonly number[], code: readonly number[], colours: number): { black: number; white: number } {
  let black = 0;
  const a = new Int32Array(colours + 1), b = new Int32Array(colours + 1);
  for (let i = 0; i < code.length; i++) {
    if (guess[i] === code[i]) black++;
    else if (guess[i]) {
      a[guess[i]!]!++;
      b[code[i]!]!++;
    }
  }
  let white = 0;
  for (let c = 1; c <= colours; c++) white += Math.min(a[c]!, b[c]!);
  return { black, white };
}

/** True if the guess may be marked: every peg filled (unless blanks are allowed), no repeats unless allowed, not all blank. */
export function canSubmit(p: GuessPuzzle, row: readonly number[]): boolean {
  if (row.every((v) => v === 0)) return false;
  if (!p.blanks && row.some((v) => v === 0)) return false;
  if (!p.duplicates) {
    const used = row.filter((v) => v > 0);
    if (new Set(used).size !== used.length) return false;
  }
  return true;
}

export const isSolved = (p: GuessPuzzle, s: GuessState): boolean => s.done.length > 0 && s.done[s.done.length - 1]!.black === p.pegs;
export const isOver = (p: GuessPuzzle, s: GuessState): boolean => isSolved(p, s) || s.done.length >= p.guesses;

export function reduce(p: GuessPuzzle, s: GuessState, a: GuessAction): GuessState {
  if (isOver(p, s)) return s;
  switch (a.type) {
    case "peg": {
      if (a.index < 0 || a.index >= p.pegs || !(a.colour >= 0 && a.colour <= p.colours) || s.row[a.index] === a.colour) return s;
      const row = s.row.slice();
      row[a.index] = a.colour;
      return { ...s, row };
    }
    case "row": {
      if (a.code.length !== p.pegs || a.code.every((v, i) => v === s.row[i]) || a.code.some((v) => !(v >= 0 && v <= p.colours))) return s;
      return { ...s, row: a.code.slice() };
    }
    case "hold": {
      if (a.index < 0 || a.index >= p.pegs) return s;
      const holds = s.holds.slice();
      holds[a.index] = !holds[a.index];
      return { ...s, holds };
    }
    case "submit": {
      if (!canSubmit(p, s.row)) return s;
      const done = [...s.done, { code: s.row.slice(), ...mark(s.row, p.code, p.colours) }];
      return { done, row: s.row.map((v, i) => (s.holds[i] ? v : 0)), holds: s.holds };
    }
    default:
      return s;
  }
}

// --- reasoning ---

/** Every code the rules allow, in order. */
export function allCodes(p: Pick<GuessPuzzle, "colours" | "pegs" | "duplicates">): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  const walk = () => {
    if (cur.length === p.pegs) {
      out.push(cur.slice());
      return;
    }
    for (let c = 1; c <= p.colours; c++) {
      if (!p.duplicates && cur.includes(c)) continue;
      cur.push(c);
      walk();
      cur.pop();
    }
  };
  walk();
  return out;
}

/** How many codes the rules allow. */
export function codeCount(p: Pick<GuessPuzzle, "colours" | "pegs" | "duplicates">): number {
  let n = 1;
  for (let i = 0; i < p.pegs; i++) n *= p.duplicates ? p.colours : p.colours - i;
  return n;
}

/** Largest number of codes the hints reason about; bigger games get no hints. */
export const REASON_LIMIT = 200_000;

const codeCache = new WeakMap<GuessPuzzle, number[][]>();
const candidateCache = new WeakMap<GuessState, number[][]>();

export function codes(p: GuessPuzzle): number[][] {
  let c = codeCache.get(p);
  if (!c) codeCache.set(p, c = allCodes(p));
  return c;
}

/** Codes that agree with every guess marked so far. */
export function candidates(p: GuessPuzzle, s: GuessState): number[][] {
  const hit = candidateCache.get(s);
  if (hit) return hit;
  let list = codes(p);
  for (const g of s.done) list = list.filter((c) => { const m = mark(g.code, c, p.colours); return m.black === g.black && m.white === g.white; });
  candidateCache.set(s, list);
  return list;
}

/** Largest work allowed for picking a best guess: guesses tried × codes still possible. */
const BEST_BUDGET = 2_500_000;

/**
 * The guess whose worst outcome leaves the fewest codes possible, among every code (or, when that
 * is too much work, among the possible codes first in order). Ties go to a guess that could be
 * the answer, then to the earlier code. Null when nothing is left to narrow down.
 */
export function bestGuess(p: GuessPuzzle, s: GuessState): { code: number[]; worst: number; left: number } | null {
  const cand = candidates(p, s);
  if (cand.length < 2) return null;
  const all = codes(p);
  const budgetRows = Math.max(1, Math.floor(BEST_BUDGET / cand.length));
  const pool = all.length <= budgetRows ? all : cand.slice(0, budgetRows);
  const candSet = new Set(cand.map((c) => c.join(",")));
  let best: { code: number[]; worst: number; isCand: boolean } | null = null;
  const buckets = new Int32Array((p.pegs + 1) * (p.pegs + 1));
  for (const g of pool) {
    buckets.fill(0);
    let worst = 0;
    for (const c of cand) {
      const m = mark(g, c, p.colours);
      const i = m.black * (p.pegs + 1) + m.white;
      if (++buckets[i]! > worst) worst = buckets[i]!;
      if (best && worst > best.worst) break;
    }
    const isCand = candSet.has(g.join(","));
    if (!best || worst < best.worst || (worst === best.worst && isCand && !best.isCand)) best = { code: g, worst, isCand };
  }
  return best ? { code: best.code, worst: best.worst, left: cand.length } : null;
}

// --- formats ---

const SGT_RE = /^([cpgbBmM\d]*):([0-9a-fA-F]+)$/;

function decodeParams(text: string): Omit<GuessPuzzle, "code"> {
  const out = { colours: 6, pegs: 4, guesses: 10, blanks: false, duplicates: true };
  for (const [, k, v] of text.matchAll(/([cpgbBmM])(\d*)/g)) {
    if (k === "c") out.colours = Number(v);
    else if (k === "p") out.pegs = Number(v);
    else if (k === "g") out.guesses = Number(v);
    else if (k === "b" || k === "B") out.blanks = k === "b";
    else if (k === "m" || k === "M") out.duplicates = k === "m";
  }
  if (!(out.colours >= 2 && out.colours <= 10)) throw new Error("colors must be between 2 and 10");
  if (!(out.pegs >= 2 && out.pegs <= 10)) throw new Error("pegs must be between 2 and 10");
  if (!(out.guesses >= 1)) throw new Error("there must be at least one guess");
  if (!out.duplicates && out.pegs > out.colours) throw new Error("without repeated colors there must be at least as many colors as pegs");
  return out;
}

/** Simon Tatham's Guess game id: `c6p4g10Bm:hex`, the code hidden the same way as the original (so ids can be shared without giving it away). */
export const sgtFormat: Format<GuessPuzzle> = {
  id: "sgt",
  label: "game id (c6p4g10Bm:…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(t) {
    const m = SGT_RE.exec(t.trim());
    if (!m) throw new Error("expected params:hex, e.g. c6p4g10Bm:1a2b3c4d");
    const base = decodeParams(m[1]!);
    if (m[2]!.length !== base.pegs * 2) throw new Error(`expected ${base.pegs * 2} hex digits`);
    const bmp = Uint8Array.from({ length: base.pegs }, (_, i) => parseInt(m[2]!.slice(2 * i, 2 * i + 2), 16));
    obfuscateBitmap(bmp, base.pegs * 8, true);
    const code = Array.from(bmp);
    if (code.some((v) => v < 1 || v > base.colours)) throw new Error("the game id is corrupted");
    return { ...base, code };
  },
  serialize(p) {
    const bmp = Uint8Array.from(p.code);
    obfuscateBitmap(bmp, p.pegs * 8, false);
    const hex = Array.from(bmp, (v) => v.toString(16).padStart(2, "0")).join("");
    return `c${p.colours}p${p.pegs}g${p.guesses}${p.blanks ? "b" : "B"}${p.duplicates ? "m" : "M"}:${hex}`;
  },
};

// --- definition ---

export const COLOUR_NAMES = ["blank", "red", "yellow", "green", "blue", "orange", "purple", "brown", "light blue", "light green", "pink"] as const;

/** Focus payload understood by the guess view: pegs of the current guess, and marked guesses. */
export interface GuessFocus {
  slots: number[];
  rows: number[];
}

function generate(v: Values<typeof params>, rng: Rng): GuessPuzzle {
  const colours = !v.duplicates && v.pegs > v.colours ? v.pegs : v.colours;
  const pool = Array.from({ length: colours }, (_, i) => i + 1);
  const code = v.duplicates ? Array.from({ length: v.pegs }, () => rng.pick(pool)) : rng.shuffle(pool).slice(0, v.pegs);
  return { colours, pegs: v.pegs, guesses: v.guesses, blanks: v.blanks, duplicates: v.duplicates, code };
}

export const guess: PuzzleDef<GuessPuzzle, GuessState, GuessAction, GuessInteraction, typeof params> = {
  id: "guess",
  name: "guess",
  aliases: ["mastermind", "bulls and cows", "codebreaker", "master mind"],
  tags: ["deduction", "code"],
  description: "work out the hidden row of colored pegs. after each guess you learn how many pegs are the right color in the right place, and how many more are a right color in the wrong place.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "mastermind (6 colors, 4 pegs)", params: {} },
    { label: "easy (4 colors, 3 pegs)", params: { colours: 4, pegs: 3, guesses: 8 } },
    { label: "no repeats (8 colors, 4 pegs)", params: { colours: 8, pegs: 4, duplicates: false } },
    { label: "super (8 colors, 5 pegs)", params: { colours: 8, pegs: 5, guesses: 12 } },
  ],
  generate,
  formats: [sgtFormat],
  init: (p) => ({ done: [], row: p.code.map(() => 0), holds: p.code.map(() => false) }),
  initInteraction: () => ({ slot: 0, colour: 1 }),
  reduce,
  isRetraction: (a) => a.type === "peg" && a.colour === 0,
  isSolved,
  isLost: (p, s) => !isSolved(p, s) && s.done.length >= p.guesses,
  rules: (p) => [
    `a code of ${p.pegs} pegs is hidden, each one of ${p.colours} colors${p.duplicates ? " (colors can repeat)" : " (no color twice)"}.`,
    `you have ${p.guesses} guesses. each guess is marked with a black peg for every peg of the right color in the right place, and a white peg for every other peg of a color the code has but somewhere else.`,
    "the marks don't say which pegs they belong to.",
    ...(p.blanks ? ["you can leave pegs blank in a guess; blanks never count."] : []),
    "a held peg keeps its color in your next guess.",
  ],
  solve: (p) => ({ done: [{ code: p.code.slice(), black: p.pegs, white: 0 }], row: p.code.map(() => 0), holds: p.code.map(() => false) }),
  describe: (p) => `${p.colours} colors, ${p.pegs} pegs`,
  rate: (p) => {
    const n = codeCount(p);
    return { label: `${n} possible codes`, score: Math.log2(n) / p.guesses };
  },
};
