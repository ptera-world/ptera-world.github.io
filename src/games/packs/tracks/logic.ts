import type { Rng } from "../../core/rng";
import { colName, rowName } from "../../core/names";
import { cellList, cellName } from "../../lib/grid-kit/names";
import { edgeList, edgeName } from "../../lib/edge-names";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import { LINE, NO, UNK, edgeAt, edgeGrid } from "../../lib/edges";
import {
  EMPTY, LEVEL_NAMES, TRACK, analyze, countCells, entryCell, exitCell, freshKnowledge, generatePuzzle, sides, target, trackPieces,
  type Level, type TracksPuzzle,
} from "./solver";

export { cellList, cellName, edgeList, edgeName };

export type { TracksPuzzle } from "./solver";

export const params = defineSchema({
  width: { type: "int", label: "width", default: 8, min: 4, max: 20 },
  height: { type: "int", label: "height", default: 8, min: 4, max: 20 },
  difficulty: {
    type: "enum", label: "difficulty", default: "medium",
    options: [
      { value: "easy", label: "easy", description: "each cell's two ends, the row and column counts, and no loops" },
      { value: "medium", label: "medium", description: "also a track that would drag its neighbor in and break a count" },
      { value: "hard", label: "hard", description: "also trying a cell or an edge and seeing it fail" },
    ],
  },
});

/** Marks the player draws: on edges NONE, LINE or CROSS; on cells NONE, TRACK or EMPTY. */
export const NONE = 0, CROSS = NO;
export { LINE, TRACK, EMPTY };

export interface TracksState {
  edges: number[];
  cells: number[];
}

/** Setting NONE is the only way marks are removed, so it alone is a retraction. */
export type TracksAction =
  | { type: "edge"; edges: number[]; value: number }
  | { type: "cell"; cells: number[]; value: number };

export interface TracksInteraction {
  cursor: number;
}

export function reduce(p: TracksPuzzle, s: TracksState, a: TracksAction): TracksState {
  const g = edgeGrid(p.w, p.h);
  if (a.type === "edge") {
    if (![NONE, LINE, CROSS].includes(a.value)) return s;
    let edges: number[] | null = null;
    for (const e of a.edges) {
      if (e < 0 || e >= g.ne || s.edges[e] === a.value || p.given[g.ea[e]!] || p.given[g.eb[e]!]) continue;
      edges ??= s.edges.slice();
      edges[e] = a.value;
    }
    return edges ? { ...s, edges } : s;
  }
  if (a.type === "cell") {
    if (![NONE, TRACK, EMPTY].includes(a.value)) return s;
    let cells: number[] | null = null;
    for (const c of a.cells) {
      if (c < 0 || c >= g.n || s.cells[c] === a.value || p.given[c]) continue;
      cells ??= s.cells.slice();
      cells[c] = a.value;
    }
    return cells ? { ...s, cells } : s;
  }
  return s;
}

/** The drawn lines and the given pieces as knowledge of lines only. */
export function drawn(p: TracksPuzzle, s: TracksState) {
  const k = freshKnowledge(p);
  s.edges.forEach((v, e) => { if (v === LINE) k.e[e] = LINE; });
  for (let e = 0; e < k.e.length; e++) if (k.e[e] === NO) k.e[e] = UNK;
  for (let c = 0; c < k.c.length; c++) k.c[c] = 0;
  return k;
}

/** Cells the drawn track runs through. */
export function trackCells(p: TracksPuzzle, s: TracksState): boolean[] {
  const g = edgeGrid(p.w, p.h);
  const k = drawn(p, s);
  return Array.from({ length: g.n }, (_, c) => sides(p, g, k, c).lines > 0);
}

export function isSolved(p: TracksPuzzle, s: TracksState): boolean {
  const g = edgeGrid(p.w, p.h);
  const k = drawn(p, s);
  for (let c = 0; c < g.n; c++) if (sides(p, g, k, c).lines > 2) return false;
  const pc = trackPieces(p, g, k);
  const i = pc.id[entryCell(p)]!;
  if (pc.cells.length !== 1 || i < 0 || pc.id[exitCell(p)] !== i || pc.ends[i]!.length) return false;
  const on = new Set(pc.cells[i]);
  for (let t = 0; t < p.w + p.h; t++) if (countCells(p, t).filter((c) => on.has(c)).length !== target(p, t)) return false;
  return true;
}

// --- formats ---

const SGT_RE = /^(\d+)(?:x(\d+))?[^:]*:([0-9A-Fa-z]*)((?:,S?\d+)+)$/;

/**
 * Simon Tatham's Tracks game id: `WxH[dX][o]:cells,counts`. Cells: a hex digit of the piece's
 * directions (right 1, up 2, left 4, down 8) or a–z for 1–26 cells without one. Then the column
 * counts and the row counts, each after a comma; `S` marks the exit column and the entrance row.
 */
export const sgtFormat: Format<TracksPuzzle> = {
  id: "sgt",
  label: "game id (WxH:…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(t) {
    const m = SGT_RE.exec(t.trim());
    if (!m) throw new Error("expected WxH:cells,counts…");
    const w = Number(m[1]), h = m[2] ? Number(m[2]) : w;
    if (!(w >= 2 && h >= 2 && w <= 40 && h <= 40)) throw new Error("size must be between 2×2 and 40×40");
    const given: number[] = [];
    for (const ch of m[3]!) {
      if (ch >= "a" && ch <= "z") for (let i = 0; i <= ch.charCodeAt(0) - 97; i++) given.push(0);
      else {
        const v = parseInt(ch, 16);
        if ([0, 1, 2, 4, 8].includes(v) || v > 15) throw new Error(`a piece of track needs two directions ("${ch}")`);
        given.push(v);
      }
    }
    if (given.length !== w * h) throw new Error(`expected ${w * h} cells, got ${given.length}`);
    const counts = m[4]!.split(",").slice(1);
    if (counts.length !== w + h) throw new Error(`expected ${w + h} counts, got ${counts.length}`);
    let entry = -1, exit = -1;
    counts.forEach((v, i) => {
      if (!v.startsWith("S")) return;
      if (i < w) { if (exit >= 0) throw new Error("only one exit is allowed"); exit = i; }
      else { if (entry >= 0) throw new Error("only one entrance is allowed"); entry = i - w; }
    });
    if (entry < 0 || exit < 0) throw new Error("the puzzle needs an entrance and an exit");
    const nums = counts.map((v) => Number(v.replace("S", "")));
    return { w, h, given, cols: nums.slice(0, w), rows: nums.slice(w), entry, exit };
  },
  serialize(p) {
    let cells = "", run = 0;
    const flush = () => {
      if (run) cells += String.fromCharCode(96 + run);
      run = 0;
    };
    for (const v of p.given) {
      if (!v) {
        if (run === 26) flush();
        run++;
        continue;
      }
      flush();
      cells += v.toString(16).toUpperCase();
    }
    flush();
    const cols = p.cols.map((v, x) => `${x === p.exit ? "S" : ""}${v}`);
    const rows = p.rows.map((v, y) => `${y === p.entry ? "S" : ""}${v}`);
    return `${p.w}x${p.h}:${cells},${[...cols, ...rows].join(",")}`;
  },
};

// --- names, conflicts, hints ---

export const countName = (p: TracksPuzzle, i: number) => (i < p.w ? `column ${colName(i)}` : `row ${rowName(i - p.w)}`);

/** Focus payload understood by the tracks view. */
export interface TracksFocus {
  edges: number[];
  /** Cells the hint changes. */
  cells: number[];
  /** Cells explaining why. */
  because: number[];
  /** Counts explaining why: column index, or w + row index. */
  counts?: number[];
}

/** Rule breaks visible without knowing the answer. */
export interface Conflicts {
  /** Cells with more than two ends drawn, or a track that can't go on. */
  cells: number[];
  /** Counts already exceeded, or out of reach. */
  counts: number[];
  /** A loop of track. */
  loop: number[];
}

export function findConflicts(p: TracksPuzzle, s: TracksState): Conflicts {
  const g = edgeGrid(p.w, p.h);
  const k = drawn(p, s);
  s.edges.forEach((v, e) => { if (v === CROSS && k.e[e] !== LINE) k.e[e] = NO; });
  for (let c = 0; c < g.n; c++) {
    if (p.given[c]) for (let d = 0; d < 4; d++) { const e = edgeAt(g, c, d); if (e >= 0 && k.e[e] !== LINE) k.e[e] = NO; }
  }
  const cells: number[] = [];
  const has = Array.from({ length: g.n }, () => false);
  for (let c = 0; c < g.n; c++) {
    const { lines, unk } = sides(p, g, k, c);
    has[c] = lines > 0 || s.cells[c] === TRACK;
    if (lines > 2 || (lines === 1 && unk.length === 0) || (s.cells[c] === EMPTY && lines > 0)) cells.push(c);
  }
  const counts: number[] = [];
  for (let i = 0; i < p.w + p.h; i++) {
    const list = countCells(p, i);
    const on = list.filter((c) => has[c]).length;
    const possible = list.filter((c) => has[c] || (s.cells[c] !== EMPTY && sides(p, g, k, c).unk.length + sides(p, g, k, c).lines >= 2)).length;
    if (on > target(p, i) || possible < target(p, i)) counts.push(i);
  }
  const pc = trackPieces(p, g, k);
  const entryPiece = pc.id[entryCell(p)]!;
  const loop = pc.cells.flatMap((list, i) => (pc.ends[i]!.length === 0 && i !== entryPiece ? list : []));
  return { cells, counts, loop };
}

/** Marks that disagree with the unique solution, as a hint that clears them. */
export function wrongMarksHint(p: TracksPuzzle, s: TracksState): Hint<TracksAction> | null {
  const a = analyze(p);
  if (a.count !== 1 || !a.solution) return null;
  const sol = a.solution;
  const g = edgeGrid(p.w, p.h);
  const on = Array.from({ length: g.n }, () => false);
  sol.forEach((v, e) => { if (v) { on[g.ea[e]!] = true; on[g.eb[e]!] = true; } });
  on[entryCell(p)] = on[exitCell(p)] = true;
  const edges = s.edges.flatMap((v, e) => ((v === LINE && !sol[e]) || (v === CROSS && sol[e]) ? [e] : []));
  const cells = s.cells.flatMap((v, c) => ((v === TRACK && !on[c]) || (v === EMPTY && on[c]) ? [c] : []));
  if (!edges.length && !cells.length) return null;
  const parts: string[] = [];
  if (edges.length) parts.push(`the ${edges.length === 1 ? "line or cross" : "lines or crosses"} on ${edgeList(p, edges)} ${edges.length === 1 ? "is" : "are"} wrong`);
  if (cells.length) parts.push(`the ${cells.length === 1 ? "mark" : "marks"} on ${cellList(p, cells)} ${cells.length === 1 ? "is" : "are"} wrong`);
  const actions: TracksAction[] = [];
  if (edges.length) actions.push({ type: "edge", edges, value: NONE });
  if (cells.length) actions.push({ type: "cell", cells, value: NONE });
  return { message: parts.join(", and "), focus: { edges, cells, because: [] } satisfies TracksFocus, actions };
}

export function hint(p: TracksPuzzle, s: TracksState): Hint<TracksAction> | null {
  const c = findConflicts(p, s);
  if (c.cells.length) return { message: `the track at ${cellList(p, c.cells)} can't be right: a cell has exactly two ends of track, or none`, focus: { edges: [], cells: [], because: c.cells } satisfies TracksFocus };
  if (c.counts.length) return { message: `${countName(p, c.counts[0]!)} can't get exactly ${target(p, c.counts[0]!)} track cells any more`, focus: { edges: [], cells: [], because: [], counts: c.counts } satisfies TracksFocus };
  if (c.loop.length) return { message: "there's a loop of track: the track has to run from the entrance to the exit", focus: { edges: [], cells: [], because: c.loop } satisfies TracksFocus };
  const a = analyze(p);
  if (a.count === 0) return { message: "this puzzle has no solution" };
  if (a.count === 2) return { message: "this puzzle has more than one solution, so it can need a guess" };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: TracksPuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 3 };
  return { label: LEVEL_NAMES[a.level], score: a.level };
}

function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<TracksPuzzle> {
  return generatePuzzle({ w: v.width, h: v.height, level: LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) as Level }, rng, ctx);
}

export const tracks: PuzzleDef<TracksPuzzle, TracksState, TracksAction, TracksInteraction, typeof params> = {
  id: "tracks",
  name: "tracks",
  aliases: ["train tracks", "railway", "rail maze"],
  tags: ["logic", "grid", "path", "numbers"],
  description: "lay a railway from the entrance on the left to the exit at the bottom, so that each row and column has as many track cells as its number says.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "6×6 easy", params: { width: 6, height: 6, difficulty: "easy" } },
    { label: "8×8 easy", params: { width: 8, height: 8, difficulty: "easy" } },
    { label: "8×8 medium", params: { width: 8, height: 8, difficulty: "medium" } },
    { label: "8×8 hard", params: { width: 8, height: 8, difficulty: "hard" } },
    { label: "10×8 medium", params: { width: 10, height: 8, difficulty: "medium" } },
    { label: "15×10 hard", params: { width: 15, height: 10, difficulty: "hard" } },
  ],
  generate,
  formats: [sgtFormat],
  init: (p) => ({ edges: Array.from({ length: edgeGrid(p.w, p.h).ne }, () => NONE), cells: p.given.map(() => NONE) }),
  initInteraction: (p) => ({ cursor: entryCell(p) }),
  reduce,
  isRetraction: (a) => a.value === NONE,
  rules: (p) => [
    `lay one track from the entrance (A, left of row ${rowName(p.entry)}) to the exit (B, below column ${colName(p.exit)}).`,
    "the track runs between side-by-side cells, straight or round 90° bends. it never crosses or touches itself, and there's no other track anywhere.",
    "the numbers above and to the right say how many cells in that column or row the track passes through.",
    "pieces of track shown from the start are part of it.",
    "crosses (no track across this edge) and cell marks (track here, or no track here) are your own notes. they don't count for anything.",
  ],
  describeAction: (p, a) => (a.type === "edge"
    ? `${a.value === LINE ? "track" : a.value === CROSS ? "cross" : "clear"} ${edgeList(p, a.edges)}`
    : `${a.value === TRACK ? "track in" : a.value === EMPTY ? "no track in" : "clear"} ${cellList(p, a.cells)}`),
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? { board: { edges: a.solution.map((v) => (v ? LINE : NONE)), cells: p.given.map(() => NONE) } } : null;
  },
  hint,
  rate,
  describe: (p) => `${p.w}×${p.h}`,
};
