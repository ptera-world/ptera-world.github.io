import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import {
  EMPTY, FILLED, Lines, UNKNOWN, analyze, cluesOf, countSolutions, generatePicture, lineCells, lineName, runs, solveLine,
  type Analysis, type Cell, type Clue, type Level,
} from "./solver";

export const params = defineSchema({
  width: { type: "int", label: "width", default: 10, min: 3, max: 40 },
  height: { type: "int", label: "height", default: 10, min: 3, max: 40 },
  difficulty: {
    type: "enum", label: "difficulty", default: "easy",
    options: [
      { value: "easy", label: "easy", description: "every step follows from a single row or column" },
      { value: "hard", label: "hard", description: "some steps need a what-if: assume a cell, find a line that breaks" },
    ],
  },
  density: { type: "int", label: "filled %", default: 50, min: 20, max: 80 },
  smoothing: {
    type: "int", label: "blobbiness", default: 1, min: 0, max: 4,
    description: "0 is pure noise, higher makes bigger connected shapes",
  },
});

export type PatternParams = Values<typeof params>;

export interface PatternPuzzle {
  w: number;
  h: number;
  rows: number[][];
  cols: number[][];
  title?: string;
}

export interface PatternState {
  /** Row-major, values UNKNOWN / FILLED / EMPTY (crossed). */
  cells: number[];
}

export type PatternAction = { type: "set"; cells: number[]; value: Cell };

export interface PatternInteraction {
  cursor: number;
  /** Primary input crosses instead of fills (for touch). */
  crossMode: boolean;
  /** Clue number the player is pointing at, if any. */
  clue?: ClueRef | null;
}

/** What the player points at, for aimed techniques: a cell (its row and column) or one clue's line. */
export interface PatternTarget {
  lines: number[];
  cell?: number;
}

/** One clue number: block `block` of line `line`. */
export interface ClueRef {
  line: number;
  block: number;
}

/** A block placement drawn on the board, in positions along `line`. */
export interface GuideSpan {
  line: number;
  block: number;
  from: number;
  to: number;
  kind: "left" | "right" | "reach" | "place";
}

/** Highlight data understood by the pattern view (hints, techniques, effects). */
export interface PatternFocus {
  /** Cells being decided. */
  cells?: number[];
  /** Line indices: rows 0..h-1, columns h..h+w-1. */
  lines?: number[];
  /** Existing marks the reasoning uses. */
  sources?: number[];
  clues?: ClueRef[];
  spans?: GuideSpan[];
  /** A line shown as impossible. */
  broken?: number;
  /** A what-if: the supposed cell and what line logic derives from it. */
  suppose?: { cell: number; value: number; fill: number[]; empty: number[] };
}

const LEVEL_OF: Record<string, Level> = { easy: "line", hard: "probe" };

export interface PuzzleInfo {
  lines: Lines;
  analysis: Analysis;
  /** A solution (the solution when `unique`), FILLED/EMPTY cells; null if none was found. */
  solution: Uint8Array | null;
  /** null when the search budget ran out before uniqueness was settled. */
  unique: boolean | null;
}

const infoCache = new WeakMap<PatternPuzzle, PuzzleInfo>();

/** Solver results for a puzzle, memoized per puzzle object. */
export function info(p: PatternPuzzle): PuzzleInfo {
  let i = infoCache.get(p);
  if (i) return i;
  const lines = new Lines(p);
  const analysis = analyze(p, "probe", lines);
  if (analysis.status === "solved") {
    i = { lines, analysis, solution: analysis.cells, unique: true };
  } else if (analysis.status === "contradiction") {
    i = { lines, analysis, solution: null, unique: false };
  } else {
    const c = countSolutions(p, 2, 200_000, lines);
    i = {
      lines, analysis,
      solution: c.solutions[0] ?? null,
      unique: c.count >= 2 ? false : c.exhausted ? null : c.count === 1,
    };
  }
  infoCache.set(p, i);
  return i;
}

function normalizeClue(nums: number[]): number[] {
  return nums.filter((n) => n !== 0);
}

/** Throws a player-facing error if the clues can't describe any picture. */
export function validate(p: PatternPuzzle): PatternPuzzle {
  if (!Number.isInteger(p.w) || !Number.isInteger(p.h) || p.w < 1 || p.h < 1 || p.w > 80 || p.h > 80) {
    throw new Error("size must be between 1 and 80");
  }
  if (p.rows.length !== p.h) throw new Error(`expected ${p.h} row clues, got ${p.rows.length}`);
  if (p.cols.length !== p.w) throw new Error(`expected ${p.w} column clues, got ${p.cols.length}`);
  const check = (clue: Clue, len: number, what: string) => {
    if (clue.some((n) => !Number.isInteger(n) || n < 1)) throw new Error(`${what}: clue numbers must be whole numbers`);
    const need = clue.reduce((a, b) => a + b, 0) + Math.max(0, clue.length - 1);
    if (need > len) throw new Error(`${what}: clue ${clue.join(" ")} doesn't fit in ${len} cells`);
  };
  p.rows.forEach((c, i) => check(c, p.w, `row ${i + 1}`));
  p.cols.forEach((c, i) => check(c, p.h, `column ${i + 1}`));
  const sum = (cs: Clue[]) => cs.flat().reduce((a, b) => a + b, 0);
  if (sum(p.rows) !== sum(p.cols)) throw new Error("rows and columns don't add up to the same number of filled cells");
  const i = info(p);
  if (!i.solution && i.unique !== null) throw new Error("these clues have no solution");
  return p;
}

function parseNums(text: string, sep: RegExp): number[] {
  const t = text.trim();
  if (t === "") return [];
  return normalizeClue(t.split(sep).map((x) => {
    if (!/^\d+$/.test(x)) throw new Error(`"${x}" isn't a number`);
    return Number(x);
  }));
}

const sgtFormat: Format<PatternPuzzle> = {
  id: "sgt",
  label: "sgt puzzles (WxH:clues)",
  detect: (t) => /^\d+(x\d+)?:[\d./]*$/.test(t.trim()),
  parse(text) {
    const m = /^(\d+)(?:x(\d+))?:([\d./]*)$/.exec(text.trim());
    if (!m) throw new Error("expected WxH:clues, e.g. 3x3:1/3/1/1.1/1/1");
    const w = Number(m[1]), h = m[2] ? Number(m[2]) : w;
    const parts = m[3]!.split("/");
    if (parts.length !== w + h) throw new Error(`expected ${w + h} clue groups (columns then rows), got ${parts.length}`);
    const lines = parts.map((s) => parseNums(s, /\./));
    return validate({ w, h, cols: lines.slice(0, w), rows: lines.slice(w) });
  },
  serialize: (p) => `${p.w}x${p.h}:${[...p.cols, ...p.rows].map((c) => c.join(".")).join("/")}`,
};

const NON_KEYWORDS = /^(catalogue|title|by|copyright|license|width|height|rows|columns|goal|solution|color|colour)\b/i;

const nonFormat: Format<PatternPuzzle> = {
  id: "non",
  label: ".non file",
  detect: (t) => /^\s*width\s+\d+/im.test(t) && /^\s*rows\s*$/im.test(t),
  parse(text) {
    let w = 0, h = 0, title: string | undefined;
    const rows: number[][] = [], cols: number[][] = [];
    let section: number[][] | null = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line === "" || line.startsWith("#")) continue;
      const kw = NON_KEYWORDS.exec(line);
      if (kw) {
        const key = kw[1]!.toLowerCase();
        const rest = line.slice(kw[0].length).trim();
        section = null;
        if (key === "width") w = Number(rest);
        else if (key === "height") h = Number(rest);
        else if (key === "rows") section = rows;
        else if (key === "columns") section = cols;
        else if (key === "title") title = rest.replace(/^"|"$/g, "") || undefined;
        continue;
      }
      if (!section) continue;
      section.push(parseNums(line, /[,\s]+/));
    }
    if (!w || !h) throw new Error("missing width/height");
    return validate({ w, h, rows, cols, ...(title ? { title } : {}) });
  },
  serialize(p) {
    const clue = (c: Clue) => (c.length ? c.join(",") : "0");
    return [
      ...(p.title ? [`title "${p.title.replace(/"/g, "'")}"`] : []),
      `width ${p.w}`, `height ${p.h}`, "",
      "rows", ...p.rows.map(clue), "",
      "columns", ...p.cols.map(clue), "",
    ].join("\n");
  },
};

const pictureFormat: Format<PatternPuzzle> = {
  id: "picture",
  label: "picture (# filled, . empty)",
  detect: (t) => {
    const lines = t.trim().split(/\r?\n/).map((l) => l.trim());
    return lines.length > 0 && lines.every((l) => /^[#.]+$/.test(l) && l.length === lines[0]!.length);
  },
  parse(text) {
    const lines = text.trim().split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
    if (!lines.length) throw new Error("empty picture");
    const w = lines[0]!.length, h = lines.length;
    if (lines.some((l) => l.length !== w)) throw new Error("every line needs the same length");
    if (lines.some((l) => !/^[#.]+$/.test(l))) throw new Error("use # for filled and . for empty");
    const c = cluesOf(w, h, [...lines.join("")].map((ch) => (ch === "#" ? FILLED : EMPTY)));
    return validate({ w, h, rows: c.rows.map((r) => [...r]), cols: c.cols.map((r) => [...r]) });
  },
  serialize(p) {
    const sol = info(p).solution;
    if (!sol) return "";
    const out: string[] = [];
    for (let y = 0; y < p.h; y++) {
      out.push(Array.from({ length: p.w }, (_, x) => (sol[y * p.w + x] === FILLED ? "#" : ".")).join(""));
    }
    return out.join("\n");
  },
};

async function generate(v: PatternParams, rng: Rng, ctx: GenerateContext): Promise<PatternPuzzle> {
  const g = await generatePicture({
    w: v.width, h: v.height, level: LEVEL_OF[v.difficulty] ?? "line",
    density: v.density / 100, smoothing: v.smoothing,
  }, rng.fork("picture"), () => ctx.yield());
  const p: PatternPuzzle = { w: v.width, h: v.height, rows: g.clues.rows.map((r) => [...r]), cols: g.clues.cols.map((r) => [...r]) };
  infoCache.set(p, { lines: new Lines(p), analysis: analyze(p, "probe"), solution: g.grid, unique: true });
  return p;
}

function lineMatches(clue: Clue, cells: number[], idx: number[]): boolean {
  const r = runs(idx.map((i) => cells[i]!));
  return r.length === clue.length && r.every((n, i) => n === clue[i]);
}

export function isSolved(p: PatternPuzzle, s: PatternState): boolean {
  for (let l = 0; l < p.w + p.h; l++) {
    const clue = l < p.h ? p.rows[l]! : p.cols[l - p.h]!;
    if (!lineMatches(clue, s.cells, lineCells(p, l))) return false;
  }
  return true;
}

/** Points at a line that can no longer fit its clue; techniques cover every actual deduction. */
export function hint(p: PatternPuzzle, s: PatternState): Hint<PatternAction> | null {
  for (let l = 0; l < p.w + p.h; l++) {
    const clue = l < p.h ? p.rows[l]! : p.cols[l - p.h]!;
    if (!solveLine(clue, lineCells(p, l).map((i) => s.cells[i]!))) {
      return { message: `${lineName(p, l)} can't fit its clue any more`, focus: { lines: [l], broken: l } satisfies PatternFocus };
    }
  }
  return null;
}

export const pattern: PuzzleDef<PatternPuzzle, PatternState, PatternAction, PatternInteraction, typeof params> = {
  id: "pattern",
  name: "nonogram",
  description: "uncover a hidden picture. the numbers beside each row and above each column are the lengths of its blocks of filled cells, in order: fill in cells until every row and column matches its numbers.",
  aliases: ["picross", "griddlers", "paint by numbers", "hanjie", "pic-a-pix", "japanese crosswords", "logic pictures", "pattern"],
  tags: ["logic", "grid", "numbers", "picture"],
  generatorVersion: 1,
  params,
  presets: [
    { label: "10×10", params: { width: 10, height: 10, difficulty: "easy" } },
    { label: "15×15", params: { width: 15, height: 15, difficulty: "easy" } },
    { label: "15×15 hard", params: { width: 15, height: 15, difficulty: "hard" } },
    { label: "20×20 hard", params: { width: 20, height: 20, difficulty: "hard" } },
    { label: "30×20", params: { width: 30, height: 20, difficulty: "easy" } },
  ],
  generate,
  formats: [sgtFormat, nonFormat, pictureFormat],
  init: (p) => ({ cells: Array.from({ length: p.w * p.h }, () => UNKNOWN) }),
  initInteraction: (p) => ({ cursor: Math.floor(p.h / 2) * p.w + Math.floor(p.w / 2), crossMode: false, clue: null }),
  isRetraction: (a) => a.type === "set" && a.value === UNKNOWN,
  rules: () => [
    "fill in cells so every row and column matches its clue.",
    "a clue lists the lengths of the blocks of filled cells in that line, in order: left to right for rows, top to bottom for columns.",
    "blocks are separated by at least one empty cell. a 0 means the line is empty.",
    "cross out cells you know are empty, to keep track. crosses don't count towards the answer.",
  ],
  reduce(p, s, a) {
    if (a.type !== "set") return s;
    if (a.value !== UNKNOWN && a.value !== FILLED && a.value !== EMPTY) return s;
    const n = p.w * p.h;
    let next: number[] | null = null;
    for (const c of a.cells) {
      if (!Number.isInteger(c) || c < 0 || c >= n) continue;
      if ((next ?? s.cells)[c] === a.value) continue;
      next ??= s.cells.slice();
      next[c] = a.value;
    }
    return next ? { cells: next } : s;
  },
  isSolved,
  solve(p) {
    const sol = info(p).solution;
    return sol ? { cells: Array.from(sol) } : null;
  },
  hint,
  rate(p) {
    const i = info(p);
    if (i.analysis.status === "solved") {
      return i.analysis.level === "line" ? { label: "easy", score: 1 } : { label: "hard", score: 2 };
    }
    if (i.unique === false) return { label: i.solution ? "multiple solutions" : "no solution", score: 4 };
    return { label: "beyond lookahead logic", score: 3 };
  },
  describe: (p) => (p.title ? `${p.title} · ${p.w}×${p.h}` : `${p.w}×${p.h}`),
};

