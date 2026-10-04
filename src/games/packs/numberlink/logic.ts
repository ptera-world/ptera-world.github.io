import type { Rng } from "../../core/rng";
import type { Ids } from "../../core/commands";
import { featureTests } from "../../core/define";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import { LINE, NO, edgeAt, edgeGrid, pieces } from "../../lib/edges";
import { cellList, cellName, type Focus } from "../../lib/grid-kit/names";
import { LEVEL_NAMES, MAX_PAIRS, analyze, dotCells, generatePuzzle, pairCount, type NumberlinkPuzzle } from "./solver";

export type { NumberlinkPuzzle } from "./solver";

export const params = defineSchema({
  width: { type: "int", label: "width", default: 7, min: 4, max: 14 },
  height: { type: "int", label: "height", default: 7, min: 4, max: 14 },
  difficulty: {
    type: "enum", label: "difficulty", default: "medium",
    options: [
      { value: "easy", label: "easy", description: "lines with one way to go, cells with two open sides, colors that can't meet, and no loops" },
      { value: "medium", label: "medium", description: "also working out which colors can still reach a cell" },
      { value: "hard", label: "hard", description: "also trying a line both ways and seeing one fail" },
    ],
  },
});

/** Marks on edges: NONE, LINE (the player's line) or CROSS (the player's note that no line crosses here). */
export const NONE = 0, CROSS = NO;
export { LINE };

export interface NumberlinkState {
  edges: number[];
}

/** Setting NONE is the only way marks are removed, so it alone is a retraction. */
export type NumberlinkAction = { type: "edge"; edges: number[]; value: number };

export interface NumberlinkInteraction {
  cursor: number;
}

/** Hint focus: grid-kit cells, plus edges the hint changes. */
export interface NumberlinkFocus extends Focus {
  edges?: number[];
}

const NAMES = ["", "red", "green", "blue", "yellow", "orange", "cyan", "magenta", "maroon", "purple", "white", "gray", "lime", "tan", "navy", "teal", "pink"];
/** Line colors by pair id 1…16; a theme can override any with --numberlink-1 … --numberlink-16. */
const PALETTE = ["", "#e5352b", "#3a9d23", "#2f5bea", "#e8d23a", "#f08c1c", "#34c6d6", "#d63bd6", "#8b2d2d", "#7d3cb5", "#e8e8e8", "#8c8c8c", "#9be03a", "#c8a46e", "#2b2f8a", "#2a8c8c", "#f3a0c4"];

export const pairName = (i: number): string => NAMES[i] ?? `number ${i}`;
export const pairColor = (i: number): string =>
  i < PALETTE.length ? `var(--numberlink-${i}, ${PALETTE[i]})` : `hsl(${Math.round((i * 137.508) % 360)} 65% 55%)`;

export function reduce(p: NumberlinkPuzzle, s: NumberlinkState, a: NumberlinkAction): NumberlinkState {
  if (a.type !== "edge" || ![NONE, LINE, CROSS].includes(a.value)) return s;
  const g = edgeGrid(p.w, p.h);
  let edges: number[] | null = null;
  for (const e of a.edges) {
    if (e < 0 || e >= g.ne || s.edges[e] === a.value) continue;
    edges ??= s.edges.slice();
    edges[e] = a.value;
  }
  return edges ? { edges } : s;
}

/** Per cell: the pair whose dot its line reaches, 0 for none (or no line), -1 where a line joins two different pairs. */
export function lineColors(p: NumberlinkPuzzle, edges: readonly number[]): number[] {
  const g = edgeGrid(p.w, p.h);
  const pc = pieces(g, edges);
  const out = Array.from({ length: g.n }, () => 0);
  pc.cells.forEach((cells) => {
    const ids = new Set(cells.map((c) => p.dots[c]!).filter(Boolean));
    const v = ids.size === 0 ? 0 : ids.size === 1 ? [...ids][0]! : -1;
    for (const c of cells) out[c] = v;
  });
  p.dots.forEach((d, c) => { if (d && out[c] === 0) out[c] = d; });
  return out;
}

function lineCount(p: NumberlinkPuzzle, edges: readonly number[], c: number): number {
  const g = edgeGrid(p.w, p.h);
  let n = 0;
  for (let d = 0; d < 4; d++) {
    const e = edgeAt(g, c, d);
    if (e >= 0 && edges[e] === LINE) n++;
  }
  return n;
}

export function isSolved(p: NumberlinkPuzzle, s: NumberlinkState): boolean {
  const g = edgeGrid(p.w, p.h);
  for (let c = 0; c < g.n; c++) {
    const n = lineCount(p, s.edges, c);
    if (p.dots[c] ? n !== 1 : n === 1 || n > 2 || (p.fill && n !== 2)) return false;
  }
  const pc = pieces(g, s.edges);
  if (pc.cells.length !== pairCount(p)) return false;
  return pc.ends.every((ends) => ends.length === 2 && p.dots[ends[0]!] !== 0 && p.dots[ends[0]!] === p.dots[ends[1]!]);
}

// --- formats ---

const EMPTY_TOKENS = new Set([".", "_"]);
const OPEN_HEADER = /^empty cells allowed$/i;

function fromTokens(rows: string[][], fill: boolean): NumberlinkPuzzle {
  const h = rows.length, w = rows[0]?.length ?? 0;
  if (rows.some((r) => r.length !== w)) throw new Error("rows have different lengths");
  if (w < 2 || h < 2 || w > 40 || h > 40) throw new Error("size must be between 2×2 and 40×40");
  const ids = new Map<string, number>();
  const dots = rows.flat().map((t) => {
    if (EMPTY_TOKENS.has(t)) return 0;
    if (!ids.has(t)) ids.set(t, ids.size + 1);
    return ids.get(t)!;
  });
  return checked({ w, h, dots, fill }, (i) => [...ids.keys()][i - 1]!);
}

function checked(p: NumberlinkPuzzle, label: (id: number) => string): NumberlinkPuzzle {
  const ends = dotCells(p);
  if (ends.length - 1 > MAX_PAIRS) throw new Error(`at most ${MAX_PAIRS} pairs are supported`);
  if (ends.length < 2) throw new Error("the puzzle needs at least one pair of dots");
  for (let i = 1; i < ends.length; i++) if (ends[i]!.length !== 2) throw new Error(`"${label(i)}" appears ${ends[i]!.length} times; every dot needs exactly one partner`);
  return p;
}

/**
 * Rows of cells, `.` for an empty one and any other token for a dot (each exactly twice). Rows are
 * split on spaces if they have any, else one character per cell. A first line "empty cells
 * allowed" switches to numberlink rules, where lines need not cover every cell.
 */
export const gridFormat: Format<NumberlinkPuzzle> = {
  id: "grid",
  label: "grid (rows, . for an empty cell)",
  detect: (t) => t.trim().includes("\n") && !t.includes("numlin"),
  parse(text) {
    const lines = text.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const open = OPEN_HEADER.test(lines[0] ?? "");
    if (open) lines.shift();
    const spaced = lines.some((l) => /\s/.test(l));
    return fromTokens(lines.map((l) => (spaced ? l.split(/\s+/) : [...l])), !open);
  },
  serialize(p) {
    const k = pairCount(p);
    const width = String(k).length;
    const rows: string[] = [];
    for (let y = 0; y < p.h; y++) {
      const cells = p.dots.slice(y * p.w, y * p.w + p.w).map((d) => (d ? String(d) : ".").padStart(width));
      rows.push(k > 9 ? cells.join(" ") : cells.join(""));
    }
    return `${p.fill ? "" : "empty cells allowed\n"}${rows.join("\n")}`;
  },
};

/** One pzprjs number: [value, characters used], value -1 when `s[i]` doesn't start one, -2 for "?". */
function readNumber16(s: string, i: number): [number, number] {
  const ch = s[i]!;
  const hex = (from: number, len: number) => parseInt(s.slice(from, from + len), 16);
  if (/[0-9a-f]/.test(ch)) return [parseInt(ch, 16), 1];
  if (ch === "-") return [hex(i + 1, 2), 3];
  if (ch === "+") return [hex(i + 1, 3), 4];
  if (ch === "=") return [hex(i + 1, 3) + 4096, 4];
  if (ch === "%" || ch === "@") return [hex(i + 1, 3) + 8192, 4];
  if (ch === "*") return [hex(i + 1, 4) + 12240, 5];
  if (ch === "$") return [hex(i + 1, 5) + 77776, 6];
  if (ch === ".") return [-2, 1];
  return [-1, 0];
}

const writeNumber16 = (n: number): string => (n < 16 ? n.toString(16) : n < 256 ? `-${n.toString(16)}` : `+${n.toString(16)}`);

const NUMLIN_RE = /numlin\/(?:[^/\d][^/]*\/)?(\d+)\/(\d+)\/([^/?#\s]*)/;

/**
 * puzz.link / pzv.jp numberlink URL (`…?numlin/W/H/body`): numbers as in pzprjs (a hex digit, or
 * `-xx` / `+xxx` for larger ones), `g`…`z` skipping 1…20 empty cells. Numberlink rules: cells may
 * stay empty, so only puzzles with those rules can be written.
 */
export const puzzlinkFormat: Format<NumberlinkPuzzle> = {
  id: "puzzlink",
  label: "puzz.link url (numlin)",
  detect: (t) => NUMLIN_RE.test(t),
  parse(text) {
    const m = NUMLIN_RE.exec(text.replace(/\s/g, ""));
    if (!m) throw new Error("expected a puzz.link numlin url, e.g. https://puzz.link/p?numlin/5/5/…");
    const w = Number(m[1]), h = Number(m[2]), body = m[3]!;
    if (!(w >= 2 && h >= 2 && w <= 40 && h <= 40)) throw new Error("size must be between 2×2 and 40×40");
    const values = Array.from({ length: w * h }, () => 0);
    let c = 0;
    for (let i = 0; i < body.length && c < w * h;) {
      const [v, used] = readNumber16(body, i);
      if (v === -2) throw new Error("dots without a number (?) aren't supported");
      if (v >= 0) {
        values[c++] = v + 1;
        i += used;
      } else if (body[i]! >= "g" && body[i]! <= "z") {
        c += parseInt(body[i]!, 36) - 15;
        i++;
      } else i++;
    }
    const order = [...new Set(values.filter(Boolean))].sort((a, b) => a - b);
    const ids = new Map(order.map((v, i) => [v, i + 1]));
    return checked({ w, h, dots: values.map((v) => (v ? ids.get(v)! : 0)), fill: false }, (i) => String(order[i - 1]! - 1));
  },
  serialize(p) {
    if (p.fill) throw new Error("puzz.link numberlink lets cells stay empty; this puzzle needs every cell used");
    let body = "", run = 0;
    const flush = () => {
      if (run) body += (run + 15).toString(36);
      run = 0;
    };
    for (const d of p.dots) {
      if (!d) {
        if (++run === 20) flush();
        continue;
      }
      flush();
      body += writeNumber16(d);
    }
    flush();
    return `https://puzz.link/p?numlin/${p.w}/${p.h}/${body}`;
  },
};

// --- conflicts and hints ---

export const edgeName = (p: NumberlinkPuzzle, e: number): string => {
  const g = edgeGrid(p.w, p.h);
  return `${cellName(p, g.ea[e]!)}-${cellName(p, g.eb[e]!)}`;
};

export function edgeList(p: NumberlinkPuzzle, edges: readonly number[]): string {
  const names = edges.slice(0, 3).map((e) => edgeName(p, e));
  const rest = edges.length - names.length;
  if (rest > 0) return `${names.join(", ")} and ${rest} more`;
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "";
}

/** Rule breaks visible without knowing the answer, as cells to flag. */
export interface Conflicts {
  /** Too many lines, or a line end with nowhere to go. */
  cells: number[];
  /** Lines joining two different colors. */
  mixed: number[];
  /** Closed loops. */
  loop: number[];
}

export function findConflicts(p: NumberlinkPuzzle, s: NumberlinkState): Conflicts {
  const g = edgeGrid(p.w, p.h);
  const cells: number[] = [];
  for (let c = 0; c < g.n; c++) {
    let lines = 0, open = 0;
    for (let d = 0; d < 4; d++) {
      const e = edgeAt(g, c, d);
      if (e < 0) continue;
      if (s.edges[e] === LINE) lines++;
      else if (s.edges[e] === NONE) open++;
    }
    const max = p.dots[c] ? 1 : 2;
    const stuck = p.dots[c] ? lines === 0 && open === 0 : lines === 1 && open === 0;
    if (lines > max || stuck) cells.push(c);
  }
  const col = lineColors(p, s.edges);
  const mixed = col.flatMap((v, c) => (v === -1 ? [c] : []));
  const pc = pieces(g, s.edges);
  const loop = pc.cells.flatMap((list, i) => (pc.ends[i]!.length === 0 ? list : []));
  return { cells, mixed, loop };
}

/** Lines and crosses that disagree with the unique solution, as a hint that clears them. */
export function wrongMarksHint(p: NumberlinkPuzzle, s: NumberlinkState): Hint<NumberlinkAction> | null {
  const a = analyze(p);
  if (a.count !== 1 || !a.solution) return null;
  const sol = a.solution;
  const edges = s.edges.flatMap((v, e) => ((v === LINE && !sol[e]) || (v === CROSS && sol[e]) ? [e] : []));
  if (!edges.length) return null;
  const g = edgeGrid(p.w, p.h);
  const many = edges.length > 1;
  return {
    message: `the ${many ? "lines or crosses" : s.edges[edges[0]!] === LINE ? "line" : "cross"} on ${edgeList(p, edges)} ${many ? "are" : "is"} wrong`,
    focus: { cells: [], because: [], related: edges.flatMap((e) => [g.ea[e]!, g.eb[e]!]), edges } satisfies NumberlinkFocus,
    actions: [{ type: "edge", edges, value: NONE }],
  };
}

export function hint(p: NumberlinkPuzzle, s: NumberlinkState): Hint<NumberlinkAction> | null {
  const c = findConflicts(p, s);
  if (c.cells.length) return { message: `the line at ${cellList(p, c.cells)} can't be right: a dot has one line and any other cell two (or none)`, focus: { cells: [], because: c.cells } satisfies NumberlinkFocus };
  if (c.mixed.length) return { message: `a line joins two different colors at ${cellList(p, c.mixed)}`, focus: { cells: [], because: c.mixed } satisfies NumberlinkFocus };
  if (c.loop.length) return { message: "there's a closed loop: every line runs from a dot to its partner", focus: { cells: [], because: c.loop } satisfies NumberlinkFocus };
  const a = analyze(p);
  if (a.count === 0) return { message: "this puzzle has no solution" };
  if (a.count === 2) return { message: "this puzzle has more than one solution, so it can need a guess" };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: NumberlinkPuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.count === -1) return { label: "unknown", score: 9 };
  if (a.level === null) return { label: "needs guessing", score: 7 };
  return { label: a.level <= 4 ? "easy" : a.level === 5 ? "medium" : "hard", score: a.level };
}

function describeAction(p: NumberlinkPuzzle, a: NumberlinkAction, before: NumberlinkState, after: NumberlinkState): string {
  if (a.type !== "edge" || !a.edges.length) return "";
  const g = edgeGrid(p.w, p.h);
  const e = a.edges[0]!;
  const colorAt = (s: NumberlinkState) => {
    const v = lineColors(p, s.edges)[g.ea[e]!]!;
    return v > 0 ? `${pairName(v)} ` : "";
  };
  if (a.value === LINE) return `${colorAt(after)}line`;
  if (a.value === CROSS) return a.edges.length === 1 ? `cross ${edgeName(p, e)}` : "crosses";
  return before.edges[e] === CROSS ? "remove cross" : `erase ${colorAt(before)}line`;
}

function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<NumberlinkPuzzle> {
  return generatePuzzle({ w: v.width, h: v.height, difficulty: LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) }, rng, ctx);
}

const FEATURES = {
  /** Every cell must be on a line. */
  fill: (p: NumberlinkPuzzle) => p.fill,
  /** Cells may stay empty. */
  gaps: (p: NumberlinkPuzzle) => !p.fill,
};

export const numberlink: PuzzleDef<NumberlinkPuzzle, NumberlinkState, NumberlinkAction, NumberlinkInteraction, typeof params> = {
  id: "numberlink",
  name: "numberlink",
  aliases: ["flow free", "flow", "arukone", "number link", "numlin"],
  tags: ["logic", "grid", "path", "colors"],
  description: "join each pair of matching dots with a line. lines never cross or branch, and together they fill the board.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "5×5 easy", params: { width: 5, height: 5, difficulty: "easy" } },
    { label: "7×7 easy", params: { width: 7, height: 7, difficulty: "easy" } },
    { label: "7×7 medium", params: { width: 7, height: 7, difficulty: "medium" } },
    { label: "9×9 medium", params: { width: 9, height: 9, difficulty: "medium" } },
    { label: "9×9 hard", params: { width: 9, height: 9, difficulty: "hard" } },
    { label: "12×12 hard", params: { width: 12, height: 12, difficulty: "hard" } },
  ],
  generate,
  formats: [gridFormat, puzzlinkFormat],
  init: (p) => ({ edges: Array.from({ length: edgeGrid(p.w, p.h).ne }, () => NONE) }),
  initInteraction: (p) => ({ cursor: p.dots.findIndex(Boolean) }),
  reduce,
  isRetraction: (a) => a.value === NONE,
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? { edges: a.solution.map((v) => (v ? LINE : NONE)) } : null;
  },
  hint,
  rate,
  describeAction,
  features: featureTests(FEATURES),
  rules: (p) => [
    "join each pair of matching dots with one line.",
    "lines run between side-by-side cells, straight or turning. they never cross, branch or touch a cell twice.",
    p.fill ? "every cell is used by some line." : "cells may stay empty.",
    "crosses (no line across this edge) are your own notes. they don't count for anything.",
  ],
  describe: (p) => `${p.w}×${p.h}${p.fill ? "" : ", empty cells allowed"}`,
};

declare module "../../core/types" {
  interface FeatureNames extends Ids<typeof FEATURES> {}
}
