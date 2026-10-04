import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import { edgeAt, edgeGrid, step } from "../../lib/edges";
import { cellList, cellName, type Focus } from "../../lib/grid-kit/names";
import { LEVEL_NAMES, advance, analyze, board, generatePuzzle, headOf, isDone, moves, trouble, walkOf, type Trouble, type ZipPuzzle } from "./solver";

export type { ZipPuzzle } from "./solver";

export const params = defineSchema({
  width: { type: "int", label: "width", default: 7, min: 3, max: 10 },
  height: { type: "int", label: "height", default: 7, min: 3, max: 10 },
  difficulty: {
    type: "enum", label: "difficulty", default: "medium",
    options: [
      { value: "easy", label: "easy", description: "more numbers; only-way moves, dead ends, not cutting the board in two, and numbers in order" },
      { value: "medium", label: "medium", description: "also following the cells that have only two ways in" },
      { value: "hard", label: "hard", description: "fewer numbers; also trying a move and seeing it fail a few moves later" },
    ],
  },
  walls: { type: "bool", label: "walls", default: true, description: "some cells have walls between them that the path can't cross" },
});

export interface ZipState {
  /** Cells in order from the cell numbered 1. Never empty. */
  path: number[];
}

/** extend: walk on into these cells (stops at the first that isn't a legal next step). cut: keep only the first `length` cells. */
export type ZipAction = { type: "extend"; cells: number[] } | { type: "cut"; length: number };

export function reduce(p: ZipPuzzle, s: ZipState, a: ZipAction): ZipState {
  if (a.type === "cut") {
    const len = Math.max(1, Math.min(s.path.length, Math.floor(a.length)));
    return len === s.path.length ? s : { path: s.path.slice(0, len) };
  }
  if (a.type !== "extend") return s;
  let w = walkOf(p, s.path);
  for (const c of a.cells) {
    if (!moves(p, w).includes(c)) break;
    w = advance(p, w, c);
  }
  return w.path.length === s.path.length ? s : { path: w.path };
}

export const isSolved = (p: ZipPuzzle, s: ZipState): boolean => isDone(p, walkOf(p, s.path));

// --- formats ---

function parseCell(p: { w: number; h: number }, name: string): number {
  const m = /^([A-Z]+)(\d+)$/i.exec(name.trim());
  if (!m) throw new Error(`"${name}" isn't a cell name like C4`);
  let col = 0;
  for (const ch of m[1]!.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  const x = col - 1, y = Number(m[2]) - 1;
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) throw new Error(`${name} is off the board`);
  return y * p.w + x;
}

function edgeBetween(p: { w: number; h: number }, a: number, b: number): number {
  const g = edgeGrid(p.w, p.h);
  for (let d = 0; d < 4; d++) if (step(g, a, d) === b) return edgeAt(g, a, d);
  return -1;
}

/**
 * Rows of cells separated by spaces, a number or `.` each, then optionally a line
 * `walls: B2-B3 C4-D4` naming pairs of side-by-side cells with a wall between them.
 */
export const gridFormat: Format<ZipPuzzle> = {
  id: "grid",
  label: "grid (rows of numbers and dots, then walls: B2-B3 …)",
  detect: (t) => /^[\d.\s]+(walls:.*)?$/is.test(t.trim()) && t.trim().includes("\n"),
  parse(text) {
    const lines = text.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const wallLine = lines.findIndex((l) => /^walls:/i.test(l));
    const rows = (wallLine >= 0 ? lines.slice(0, wallLine) : lines).map((l) => l.split(/\s+/));
    const h = rows.length, w = rows[0]?.length ?? 0;
    if (rows.some((r) => r.length !== w)) throw new Error("rows have different lengths");
    if (w < 2 || h < 2 || w > 20 || h > 20) throw new Error("size must be between 2×2 and 20×20");
    const nums = rows.flat().map((t) => {
      if (t === "." || t === "0") return 0;
      const v = Number(t);
      if (!Number.isInteger(v) || v < 1) throw new Error(`"${t}" isn't a number or .`);
      return v;
    });
    const k = Math.max(...nums);
    if (k < 2) throw new Error("the puzzle needs at least the numbers 1 and 2");
    for (let v = 1; v <= k; v++) {
      const count = nums.filter((x) => x === v).length;
      if (count !== 1) throw new Error(count ? `${v} appears ${count} times` : `${v} is missing: the numbers run 1, 2, 3, … without gaps`);
    }
    const walls: number[] = [];
    if (wallLine >= 0) {
      for (const pair of lines.slice(wallLine).join(" ").replace(/^walls:/i, "").trim().split(/[\s,]+/).filter(Boolean)) {
        const [a, b] = pair.split("-");
        if (!a || !b) throw new Error(`"${pair}" isn't a wall like B2-B3`);
        const e = edgeBetween({ w, h }, parseCell({ w, h }, a), parseCell({ w, h }, b));
        if (e < 0) throw new Error(`${pair}: a wall goes between two side-by-side cells`);
        if (!walls.includes(e)) walls.push(e);
      }
    }
    return { w, h, nums, walls: walls.sort((a, b) => a - b) };
  },
  serialize(p) {
    const width = String(board(p).last).length;
    const rows: string[] = [];
    for (let y = 0; y < p.h; y++) rows.push(p.nums.slice(y * p.w, y * p.w + p.w).map((v) => (v ? String(v) : ".").padStart(width)).join(" "));
    const g = edgeGrid(p.w, p.h);
    const walls = p.walls.map((e) => `${cellName(p, g.ea[e]!)}-${cellName(p, g.eb[e]!)}`);
    return rows.join("\n") + (walls.length ? `\nwalls: ${walls.join(" ")}` : "");
  },
};

// --- conflicts and hints ---

/** Focus: grid-kit cells, plus path cells to draw as a route. */
export interface ZipFocus extends Focus {
  route?: number[];
}

/** What the board shows can't be finished, as cells to flag. */
export interface Conflicts {
  /** The head, when it can't go on (or reached the last number too early). */
  stuck: number[];
  /** Cells left with too few ways in. */
  dead: number[];
  /** Cells cut off from the head (or a next number that can't be reached in turn). */
  cut: number[];
}

export function findConflicts(p: ZipPuzzle, s: ZipState): Conflicts {
  const w = walkOf(p, s.path);
  const t = trouble(p, w);
  const out: Conflicts = { stuck: [], dead: [], cut: [] };
  if (!t) return out;
  if (t.kind === "stuck" || t.kind === "early-end") out.stuck.push(headOf(w));
  else if (t.kind === "dead") out.dead.push(t.cell);
  else if (t.kind === "cut") out.cut.push(...t.cells);
  else out.cut.push(board(p).numCell[t.num]!);
  return out;
}

export function troubleText(p: ZipPuzzle, t: Trouble): string {
  switch (t.kind) {
    case "stuck": return "the path has nowhere left to go";
    case "early-end": return `the path reached ${board(p).last} with cells still empty`;
    case "dead": return `${cellName(p, t.cell)} has too few ways in left to be passed through`;
    case "cut": return `${cellList(p, t.cells)} ${t.cells.length === 1 ? "is" : "are"} cut off from the path`;
    case "order": return `${t.num} can't be reached any more without passing a later number first`;
  }
}

/** A path that leaves the unique solution, as a hint that cuts it back to where it went wrong. */
export function wrongPathHint(p: ZipPuzzle, s: ZipState): Hint<ZipAction> | null {
  const a = analyze(p);
  if (a.count !== 1 || !a.solution) return null;
  const i = s.path.findIndex((c, k) => c !== a.solution![k]);
  if (i < 0) return null;
  const from = s.path[i - 1]!;
  return {
    message: `the path goes wrong after ${cellName(p, from)}: it shouldn't go on to ${cellName(p, s.path[i]!)}`,
    focus: { cells: [s.path[i]!], because: [from] } satisfies ZipFocus,
    actions: [{ type: "cut", length: i }],
  };
}

export function hint(p: ZipPuzzle, s: ZipState): Hint<ZipAction> | null {
  const w = walkOf(p, s.path);
  const t = trouble(p, w);
  if (t) {
    const c = findConflicts(p, s);
    return { message: `${troubleText(p, t)}. undo, or drag back along the path.`, focus: { cells: [], because: [...c.stuck, ...c.dead, ...c.cut] } satisfies ZipFocus };
  }
  const a = analyze(p);
  if (a.count === 0) return { message: "this puzzle has no solution" };
  if (a.count === 2) return { message: "this puzzle has more than one solution, so it can need a guess" };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: ZipPuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.count === -1) return { label: "unknown", score: 9 };
  if (a.level === null) return { label: "needs guessing", score: 8 };
  return { label: a.level <= 4 ? "easy" : a.level === 5 ? "medium" : "hard", score: a.level };
}

function describeAction(p: ZipPuzzle, a: ZipAction, before: ZipState, after: ZipState): string {
  if (a.type === "cut") return `back to ${cellName(p, after.path[after.path.length - 1]!)}`;
  const added = after.path.length - before.path.length;
  if (added <= 0) return "";
  const to = cellName(p, after.path[after.path.length - 1]!);
  return added === 1 ? `to ${to}` : `to ${to} (${added} cells)`;
}

function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<ZipPuzzle> {
  return generatePuzzle({ w: v.width, h: v.height, difficulty: LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]), walls: v.walls }, rng, ctx);
}

export const zip: PuzzleDef<ZipPuzzle, ZipState, ZipAction, null, typeof params> = {
  id: "zip",
  name: "zip",
  aliases: ["linkedin zip", "number path", "hamiltonian path", "one stroke"],
  tags: ["logic", "grid", "path", "numbers"],
  description: "draw one path from 1 through every cell, passing the numbers in order and finishing on the last one.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "6×6 easy", params: { width: 6, height: 6, difficulty: "easy" } },
    { label: "7×7 easy", params: { width: 7, height: 7, difficulty: "easy" } },
    { label: "6×6 medium", params: { width: 6, height: 6, difficulty: "medium" } },
    { label: "7×7 medium", params: { width: 7, height: 7, difficulty: "medium" } },
    { label: "7×7 hard", params: { width: 7, height: 7, difficulty: "hard" } },
    { label: "8×8 hard", params: { width: 8, height: 8, difficulty: "hard" } },
  ],
  generate,
  formats: [gridFormat],
  init: (p) => ({ path: [board(p).numCell[1]!] }),
  reduce,
  isRetraction: (a) => a.type === "cut",
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? { path: a.solution.slice() } : null;
  },
  hint,
  rate,
  describeAction,
  features: (p) => (p.walls.length ? ["walls"] : []),
  rules: (p) => [
    "draw one path that starts on 1 and visits every cell exactly once, moving between side-by-side cells.",
    `it passes the numbers in order (1, 2, 3, …) and ends on ${board(p).last}.`,
    ...(p.walls.length ? ["the path can't cross a wall."] : []),
  ],
  describe: (p) => `${p.w}×${p.h}`,
};

declare module "../../core/types" {
  interface FeatureNames {
    /** Some side-by-side cells have a wall between them. */
    walls: true;
  }
}
