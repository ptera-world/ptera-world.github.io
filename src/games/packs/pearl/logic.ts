import type { Rng } from "../../core/rng";
import { cellList, cellName } from "../../lib/grid-kit/names";
import { edgeList, edgeName } from "../../lib/edge-names";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import { DOWN, LEFT, LINE, NO, RIGHT, UP, around, edgeGrid, opposite, pieces, stateAt, step, type EdgeGrid } from "../../lib/edges";
import { BLACK, EMPTY, LEVEL_NAMES, WHITE, analyze, generatePuzzle, type Level, type PearlPuzzle } from "./solver";

export { cellList, cellName, edgeList, edgeName };

export type { PearlPuzzle } from "./solver";

export const params = defineSchema({
  width: { type: "int", label: "width", default: 8, min: 5, max: 12 },
  height: { type: "int", label: "height", default: 8, min: 5, max: 12 },
  difficulty: {
    type: "enum", label: "difficulty", default: "easy",
    options: [
      { value: "easy", label: "easy", description: "what each pearl and each cell allows, and not closing the loop too early" },
      { value: "hard", label: "hard", description: "also trying a line and seeing it fail" },
    ],
  },
});

/** What the player has drawn per edge. */
export const NONE = 0;
export { LINE, NO as CROSS };

export interface PearlState {
  edges: number[];
}

/** Setting NONE is the only way marks are removed, so it alone is a retraction. */
export type PearlAction = { type: "set"; edges: number[]; value: number };

export interface PearlInteraction {
  cursor: number;
}

export function reduce(p: PearlPuzzle, s: PearlState, a: PearlAction): PearlState {
  if (a.type !== "set" || ![NONE, LINE, NO].includes(a.value)) return s;
  let next: number[] | null = null;
  for (const e of a.edges) {
    if (e < 0 || e >= s.edges.length || s.edges[e] === a.value) continue;
    next ??= s.edges.slice();
    next[e] = a.value;
  }
  return next ? { edges: next } : s;
}

export const toggle = (s: PearlState, e: number, value: number): PearlAction => ({ type: "set", edges: [e], value: s.edges[e] === value ? NONE : value });

const linesOnly = (s: PearlState) => Int8Array.from(s.edges, (v) => (v === LINE ? LINE : 0));

/** True if the lines form one loop through every pearl, obeying every pearl. */
export function isSolved(p: PearlPuzzle, s: PearlState): boolean {
  const g = edgeGrid(p.w, p.h);
  const k = linesOnly(s);
  const pc = pieces(g, k);
  if (pc.cells.length !== 1 || pc.ends[0]!.length !== 0) return false;
  const on = new Set(pc.cells[0]);
  for (let c = 0; c < g.n; c++) {
    if (around(g, k, c).lines > 2) return false;
    if (p.pearls[c] !== EMPTY && (!on.has(c) || pearlBroken(p, g, k, c))) return false;
  }
  return true;
}

const straightAt = (g: EdgeGrid, k: ArrayLike<number>, c: number) =>
  c >= 0 && ((stateAt(g, k, c, UP) === LINE && stateAt(g, k, c, DOWN) === LINE) || (stateAt(g, k, c, LEFT) === LINE && stateAt(g, k, c, RIGHT) === LINE));
const turnAt = (g: EdgeGrid, k: ArrayLike<number>, c: number) =>
  c >= 0 && around(g, k, c).lines === 2 && !straightAt(g, k, c);

/** True if the drawn lines already break the pearl at c (only judges what is drawn). */
export function pearlBroken(p: PearlPuzzle, g: EdgeGrid, k: ArrayLike<number>, c: number): boolean {
  if (p.pearls[c] === BLACK) {
    if (straightAt(g, k, c)) return true;
    for (let d = 0; d < 4; d++) {
      if (stateAt(g, k, c, d) !== LINE) continue;
      const n1 = step(g, c, d);
      if (turnAt(g, k, n1) || stateAt(g, k, n1, (d + 1) % 4) === LINE || stateAt(g, k, n1, (d + 3) % 4) === LINE) return true;
    }
    return false;
  }
  if (p.pearls[c] === WHITE) {
    if (turnAt(g, k, c)) return true;
    if (!straightAt(g, k, c)) return false;
    const d = stateAt(g, k, c, UP) === LINE ? UP : LEFT;
    return straightAt(g, k, step(g, c, d)) && straightAt(g, k, step(g, c, opposite(d)));
  }
  return false;
}

// --- formats ---

const SGT_RE = /^(\d+)(?:x(\d+))?[^:]*:([a-zBW]*)$/;

function checkSize(w: number, h: number): void {
  if (!(w >= 2 && h >= 2 && w <= 40 && h <= 40)) throw new Error("size must be between 2×2 and 40×40");
}

/** Simon Tatham's Pearl game id: `WxH[dX]:desc`; runs a–z of 1–26 empty cells, B black, W white. */
export const sgtFormat: Format<PearlPuzzle> = {
  id: "sgt",
  label: "game id (WxH:…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(t) {
    const m = SGT_RE.exec(t.trim());
    if (!m) throw new Error("expected WxH:desc, e.g. 6x6:cBbWe…");
    const w = Number(m[1]), h = m[2] ? Number(m[2]) : w;
    checkSize(w, h);
    const pearls: number[] = [];
    for (const ch of m[3]!) {
      if (ch === "B") pearls.push(BLACK);
      else if (ch === "W") pearls.push(WHITE);
      else for (let i = 0; i <= ch.charCodeAt(0) - 97; i++) pearls.push(EMPTY);
    }
    if (pearls.length !== w * h) throw new Error(`expected ${w * h} cells, got ${pearls.length}`);
    return { w, h, pearls };
  },
  serialize(p) {
    let out = "", run = 0;
    const flush = () => {
      if (run) out += String.fromCharCode(96 + run);
      run = 0;
    };
    for (const v of p.pearls) {
      if (v === EMPTY) {
        if (run === 26) flush();
        run++;
        continue;
      }
      flush();
      out += v === BLACK ? "B" : "W";
    }
    flush();
    return `${p.w}x${p.h}:${out}`;
  },
};

const GRID_CHARS: Record<string, number> = { ".": EMPTY, "_": EMPTY, "B": BLACK, "b": BLACK, "●": BLACK, "*": BLACK, "W": WHITE, "w": WHITE, "○": WHITE, "o": WHITE, "O": WHITE };

/** One text row per board row: `.` empty, `B` (or ●) black, `W` (or ○) white. Spaces are ignored. */
export const gridFormat: Format<PearlPuzzle> = {
  id: "grid",
  label: "grid (. B W)",
  detect: (t) => /^[._BbWwoO●○*\s]+$/u.test(t.trim()) && t.trim().includes("\n"),
  parse(t) {
    const rows = t.trim().split(/\r?\n/).map((r) => [...r.replace(/\s+/g, "")]).filter((r) => r.length > 0);
    const h = rows.length, w = rows[0]?.length ?? 0;
    checkSize(w, h);
    const pearls: number[] = [];
    rows.forEach((r, y) => {
      if (r.length !== w) throw new Error(`row ${y + 1} has ${r.length} cells, expected ${w}`);
      for (const ch of r) {
        const v = GRID_CHARS[ch];
        if (v === undefined) throw new Error(`unexpected "${ch}" in row ${y + 1}`);
        pearls.push(v);
      }
    });
    return { w, h, pearls };
  },
  serialize(p) {
    const rows: string[] = [];
    for (let y = 0; y < p.h; y++) rows.push(p.pearls.slice(y * p.w, (y + 1) * p.w).map((v) => ".BW"[v]).join(""));
    return rows.join("\n");
  },
};

// --- names, conflicts, hints ---

/** Focus payload understood by the pearl view. */
export interface PearlFocus {
  /** Edges the hint changes. */
  edges: number[];
  /** Cells explaining why. */
  because: number[];
}

/** Rule breaks visible without knowing the answer. */
export interface Conflicts {
  /** Cells with more than two lines, or a line that can't go on. */
  cells: number[];
  /** Pearls whose rule the lines already break. */
  pearls: number[];
  /** A closed loop that isn't the whole answer. */
  loop: number[];
}

export function findConflicts(p: PearlPuzzle, s: PearlState): Conflicts {
  const g = edgeGrid(p.w, p.h);
  const k = Int8Array.from(s.edges);
  const cells: number[] = [], pearls: number[] = [];
  for (let c = 0; c < g.n; c++) {
    const { lines, unk } = around(g, k, c);
    if (lines > 2 || (lines === 1 && unk.length === 0)) cells.push(c);
    if (p.pearls[c] !== EMPTY && (pearlBroken(p, g, k, c) || lines + unk.length < 2)) pearls.push(c);
  }
  const lk = linesOnly(s);
  const pc = pieces(g, lk);
  let loop: number[] = [];
  const closed = pc.ends.findIndex((t, i) => t.length === 0 && pc.cells[i]!.length > 0);
  if (closed >= 0) {
    const on = new Set(pc.cells[closed]);
    const whole = pc.cells.length === 1 && p.pearls.every((v, c) => v === EMPTY || on.has(c));
    if (!whole) loop = pc.cells[closed]!;
  }
  return { cells, pearls, loop };
}

/** Lines and crosses that disagree with the unique solution, as a hint that clears them. */
export function wrongMarksHint(p: PearlPuzzle, s: PearlState): Hint<PearlAction> | null {
  const a = analyze(p);
  if (a.count !== 1 || !a.solution) return null;
  const sol = a.solution;
  const wrong = s.edges.flatMap((v, e) => ((v === LINE && sol[e] !== 1) || (v === NO && sol[e] === 1) ? [e] : []));
  if (!wrong.length) return null;
  const one = wrong.length === 1;
  return {
    message: `the ${one ? "line or cross" : "lines or crosses"} on ${edgeList(p, wrong)} ${one ? "is" : "are"} wrong`,
    focus: { edges: wrong, because: [] } satisfies PearlFocus,
    actions: [{ type: "set", edges: wrong, value: NONE }],
  };
}

export function hint(p: PearlPuzzle, s: PearlState): Hint<PearlAction> | null {
  const c = findConflicts(p, s);
  if (c.cells.length) return { message: `the lines at ${cellList(p, c.cells)} can't be right: the loop goes into a cell once and out once`, focus: { edges: [], because: c.cells } satisfies PearlFocus };
  if (c.pearls.length) return { message: `the pearl at ${cellList(p, c.pearls)} is broken`, focus: { edges: [], because: c.pearls } satisfies PearlFocus };
  if (c.loop.length) return { message: "a loop is closed but it isn't the whole answer", focus: { edges: [], because: c.loop } satisfies PearlFocus };
  const a = analyze(p);
  if (a.count === 0) return { message: "this puzzle has no solution" };
  if (a.count === 2) return { message: "this puzzle has more than one solution, so it can need a guess" };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: PearlPuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 3 };
  return { label: LEVEL_NAMES[a.level], score: a.level };
}

function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<PearlPuzzle> {
  return generatePuzzle(v.width, v.height, LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) as Level, rng, ctx);
}

export const pearl: PuzzleDef<PearlPuzzle, PearlState, PearlAction, PearlInteraction, typeof params> = {
  id: "pearl",
  name: "pearl",
  aliases: ["masyu", "pearls", "shinju"],
  tags: ["logic", "grid", "loop", "nikoli"],
  description: "draw one loop through the centers of cells, passing through every pearl. it must turn on black pearls and go straight through white ones.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "6×6 easy", params: { width: 6, height: 6, difficulty: "easy" } },
    { label: "6×6 hard", params: { width: 6, height: 6, difficulty: "hard" } },
    { label: "8×8 easy", params: { width: 8, height: 8, difficulty: "easy" } },
    { label: "8×8 hard", params: { width: 8, height: 8, difficulty: "hard" } },
    { label: "10×10 easy", params: { width: 10, height: 10, difficulty: "easy" } },
    { label: "10×10 hard", params: { width: 10, height: 10, difficulty: "hard" } },
  ],
  generate,
  formats: [sgtFormat, gridFormat],
  init: (p) => ({ edges: Array.from({ length: edgeGrid(p.w, p.h).ne }, () => NONE) }),
  initInteraction: (p) => ({ cursor: Math.floor(p.h / 2) * p.w + Math.floor(p.w / 2) }),
  reduce,
  isRetraction: (a) => a.value === NONE,
  rules: () => [
    "draw a single closed loop through the centers of cells, moving between side-by-side cells. it never crosses or touches itself.",
    "the loop passes through every pearl. it doesn't have to visit every cell.",
    "on a black pearl the loop turns, and goes straight through the next cell on both sides.",
    "on a white pearl the loop goes straight through, and turns in at least one of the cells just before and after it.",
    "a cross on an edge is your own note that the loop doesn't go that way. it doesn't count for anything.",
  ],
  describeAction: (p, a) => `${a.value === LINE ? "line" : a.value === NO ? "cross" : "clear"} ${edgeList(p, a.edges)}`,
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? { edges: a.solution.map((v) => (v ? LINE : NONE)) } : null;
  },
  hint,
  rate,
  describe: (p) => `${p.w}×${p.h}`,
};
