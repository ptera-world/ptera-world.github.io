import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import { BLACK, EMPTY, geometry, litCounts, type LightupPuzzle } from "./grid";
import { cellList, cellName } from "../../lib/grid-kit/names";
import { LEVEL_NAMES, analyze, generatePuzzle, type Level, type Symmetry } from "./solver";

export { cellList, cellName };

export type { LightupPuzzle } from "./grid";

export const params = defineSchema({
  width: { type: "int", label: "width", default: 10, min: 3, max: 30 },
  height: { type: "int", label: "height", default: 10, min: 3, max: 30 },
  walls: { type: "int", label: "walls (%)", default: 20, min: 5, max: 50 },
  symmetry: {
    type: "enum", label: "symmetry", default: "rot2",
    options: [
      { value: "none", label: "none" },
      { value: "mirror", label: "mirror" },
      { value: "rot2", label: "2-way rotation" },
      { value: "rot4", label: "4-way rotation", description: "square boards only; others use 2-way" },
    ],
  },
  difficulty: {
    type: "enum", label: "difficulty", default: "medium",
    options: [
      { value: "easy", label: "easy", description: "counting around numbers, and cells only one spot can light" },
      { value: "medium", label: "medium", description: "also lights that would leave a cell dark or crowd a number" },
      { value: "hard", label: "hard", description: "also trying a cell both ways" },
    ],
  },
});

/** Per-cell mark. Only meaningful on open cells. */
export const NONE = 0, BULB = 1, DOT = 2;
export type Mark = typeof NONE | typeof BULB | typeof DOT;

export interface LightupState {
  marks: number[];
}

/** Setting NONE is the only way marks are removed, so it alone is a retraction. */
export type LightupAction = { type: "set"; cells: number[]; value: Mark };

export interface LightupInteraction {
  cursor: number;
  /** Primary input places dots instead of lights (touch). */
  markMode: boolean;
}

function setMarks(p: LightupPuzzle, s: LightupState, cells: readonly number[], value: number): LightupState {
  let next: number[] | null = null;
  for (const c of cells) {
    if (p.cells[c] !== EMPTY || s.marks[c] === value) continue;
    next ??= s.marks.slice();
    next[c] = value;
  }
  return next ? { marks: next } : s;
}

export function reduce(p: LightupPuzzle, s: LightupState, a: LightupAction): LightupState {
  if (a.type !== "set" || ![NONE, BULB, DOT].includes(a.value)) return s;
  return setMarks(p, s, a.cells, a.value);
}

/** Put `value` on the cell, or clear it if it is already there. */
export const toggleMark = (s: LightupState, cell: number, value: typeof BULB | typeof DOT): LightupAction =>
  ({ type: "set", cells: [cell], value: s.marks[cell] === value ? NONE : value });

export function isSolved(p: LightupPuzzle, s: LightupState): boolean {
  const g = geometry(p);
  const lit = litCounts(g, s.marks);
  for (const c of g.empties) {
    if (lit[c] === 0) return false;
    if (s.marks[c] === BULB && lit[c] !== 1) return false;
  }
  return g.clues.every((q) => g.adj[q]!.filter((a) => s.marks[a] === BULB).length === p.cells[q]);
}

// --- formats ---

const SGT_RE = /^(\d+)x(\d+)[^:]*:([0-4Ba-z]*)$/;

/** Simon Tatham's Light Up game id: `WxH[params]:desc`; desc runs a–z are 1–26 open cells, B wall, 0–4 clue. */
export const sgtFormat: Format<LightupPuzzle> = {
  id: "sgt",
  label: "game id (WxH:…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(t) {
    const m = SGT_RE.exec(t.trim());
    if (!m) throw new Error("expected WxH:desc, e.g. 7x7:b1c2aBd…");
    const w = Number(m[1]), h = Number(m[2]);
    checkSize(w, h);
    const cells: number[] = [];
    for (const ch of m[3]!) {
      if (ch >= "a" && ch <= "z") for (let i = 0; i <= ch.charCodeAt(0) - 97; i++) cells.push(EMPTY);
      else if (ch === "B") cells.push(BLACK);
      else cells.push(Number(ch));
    }
    if (cells.length !== w * h) throw new Error(`expected ${w * h} cells, got ${cells.length}`);
    return { w, h, cells };
  },
  serialize(p) {
    let out = "", run = 0;
    const flush = () => {
      if (run) out += String.fromCharCode(96 + run);
      run = 0;
    };
    for (const v of p.cells) {
      if (v === EMPTY) {
        if (run === 26) flush();
        run++;
        continue;
      }
      flush();
      out += v === BLACK ? "B" : String(v);
    }
    flush();
    return `${p.w}x${p.h}:${out}`;
  },
};

const GRID_CHARS: Record<string, number> = { ".": EMPTY, "_": EMPTY, "-": EMPTY, "#": BLACK, "X": BLACK, "x": BLACK, "B": BLACK, "0": 0, "1": 1, "2": 2, "3": 3, "4": 4 };

/** One text row per board row: `.` open, `#` wall, `0`–`4` clue. Spaces between cells are ignored. */
export const gridFormat: Format<LightupPuzzle> = {
  id: "grid",
  label: "grid (. # 0-4)",
  detect: (t) => /^[.#0-4xXB_\-\s]+$/.test(t.trim()) && t.trim().includes("\n"),
  parse(t) {
    const rows = t.trim().split(/\r?\n/).map((r) => r.replace(/\s+/g, "")).filter((r) => r.length > 0);
    const h = rows.length, w = rows[0]?.length ?? 0;
    checkSize(w, h);
    const cells: number[] = [];
    rows.forEach((r, y) => {
      if (r.length !== w) throw new Error(`row ${y + 1} has ${r.length} cells, expected ${w}`);
      for (const ch of r) {
        const v = GRID_CHARS[ch];
        if (v === undefined) throw new Error(`unexpected "${ch}" in row ${y + 1}`);
        cells.push(v);
      }
    });
    return { w, h, cells };
  },
  serialize(p) {
    const rows: string[] = [];
    for (let y = 0; y < p.h; y++) {
      rows.push(p.cells.slice(y * p.w, (y + 1) * p.w).map((v) => (v === EMPTY ? "." : v === BLACK ? "#" : String(v))).join(""));
    }
    return rows.join("\n");
  },
};

function checkSize(w: number, h: number): void {
  if (!(w >= 1 && h >= 1 && w <= 60 && h <= 60)) throw new Error("size must be between 1×1 and 60×60");
}

// --- hints ---

/** Focus payload understood by the lightup views. Every cell a hint's text names is in one of these lists. */
export interface LightupFocus {
  /** Cells the hint acts on. */
  cells: number[];
  /** Cells explaining why (clues or cells that need lighting). */
  because: number[];
  /** Other cells the text talks about, e.g. the spots that could still light a cell. */
  related?: number[];
}

/** Rule breaks visible on the board without knowing the answer. */
export interface Conflicts {
  /** Lights shining on another light. */
  lights: number[];
  /** Numbers with too many lights, or too little room left for theirs. */
  clues: number[];
  /** Unlit cells that nothing can light any more. */
  dark: number[];
}

const bulbsAround = (p: LightupPuzzle, marks: readonly number[], q: number) => geometry(p).adj[q]!.filter((a) => marks[a] === BULB).length;

/** True if the number at q has exactly its count of lights. */
export const clueMet = (p: LightupPuzzle, marks: readonly number[], q: number) => bulbsAround(p, marks, q) === p.cells[q];

export function findConflicts(p: LightupPuzzle, marks: readonly number[]): Conflicts {
  const g = geometry(p);
  const lit = litCounts(g, marks);
  const lights = g.empties.filter((c) => marks[c] === BULB && lit[c]! > 1);
  const open = (c: number) => marks[c] === NONE && lit[c] === 0;
  const clues = g.clues.filter((q) => {
    const n = p.cells[q]!, have = bulbsAround(p, marks, q);
    return have > n || have + g.adj[q]!.filter(open).length < n;
  });
  const dark = g.empties.filter((c) => lit[c] === 0 && ![c, ...g.sees[c]!].some(open));
  return { lights, clues, dark };
}

/** Marks that disagree with the unique solution, as a hint that clears them; null if none or no unique solution. */
export function wrongMarksHint(p: LightupPuzzle, s: LightupState): Hint<LightupAction> | null {
  const a = analyze(p);
  if (a.count !== 1 || !a.solution) return null;
  const sol = a.solution;
  const wrong = geometry(p).empties.filter((c) => (s.marks[c] === BULB && sol[c] !== 1) || (s.marks[c] === DOT && sol[c] === 1));
  if (!wrong.length) return null;
  return {
    message: `${wrong.length === 1 ? "the light or mark on" : "the lights or marks on"} ${cellList(p, wrong)} ${wrong.length === 1 ? "is" : "are"} wrong`,
    focus: { cells: wrong, because: [] } satisfies LightupFocus,
    actions: [{ type: "set", cells: wrong, value: NONE }],
  };
}

/** Fallback when no technique offers a hint: a visible rule break, or why there's no next step. */
export function hint(p: LightupPuzzle, s: LightupState): Hint<LightupAction> | null {
  const c = findConflicts(p, s.marks);
  if (c.lights.length) return { message: `the lights on ${cellList(p, c.lights)} shine on each other`, focus: { cells: c.lights, because: [] } satisfies LightupFocus };
  if (c.clues.length) {
    const q = c.clues[0]!;
    return { message: `the ${p.cells[q]} on ${cellName(p, q)} can't get exactly ${p.cells[q]} touching lights any more`, focus: { cells: [], because: [q] } satisfies LightupFocus };
  }
  if (c.dark.length) return { message: `nothing can light ${cellList(p, c.dark)} any more`, focus: { cells: c.dark, because: [] } satisfies LightupFocus };
  const a = analyze(p);
  if (a.count === 0) return { message: "this puzzle has no solution" };
  if (a.count === 2) return { message: "this puzzle has more than one solution, so it can need a guess" };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: LightupPuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 3 };
  return { label: LEVEL_NAMES[a.level], score: a.level };
}

function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<LightupPuzzle> {
  return generatePuzzle({
    w: v.width, h: v.height, blackPct: v.walls,
    symmetry: v.symmetry as Symmetry,
    level: LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) as Level,
  }, rng, ctx);
}

export const lightup: PuzzleDef<LightupPuzzle, LightupState, LightupAction, LightupInteraction, typeof params> = {
  id: "lightup",
  name: "light up",
  aliases: ["akari", "bijutsukan", "lightup", "lights"],
  tags: ["logic", "grid", "numbers", "nikoli"],
  description: "put lights on the board until every empty cell is lit. a light shines along its row and column up to the nearest wall, no light may shine on another, and a number on a wall says how many lights touch it.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "7×7 easy", params: { width: 7, height: 7, difficulty: "easy" } },
    { label: "10×10 medium", params: { width: 10, height: 10, difficulty: "medium" } },
    { label: "10×10 hard", params: { width: 10, height: 10, difficulty: "hard" } },
    { label: "14×14 medium", params: { width: 14, height: 14, difficulty: "medium" } },
    { label: "18×10 hard", params: { width: 18, height: 10, difficulty: "hard" } },
  ],
  generate,
  formats: [sgtFormat, gridFormat],
  init: (p) => ({ marks: p.cells.map(() => NONE) }),
  initInteraction: (p) => ({ cursor: geometry(p).empties[0] ?? 0, markMode: false }),
  reduce,
  isRetraction: (a) => a.value === NONE,
  rules: () => [
    "the board has empty cells and walls (the dark cells). lights go in empty cells.",
    "a light lights its own cell and shines along its row and column until it hits a wall or the edge.",
    "every empty cell must end up lit.",
    "no light may shine on another light.",
    "a number on a wall is exactly how many lights touch that wall (above, below, left and right; not diagonally). walls without a number can touch any number.",
    "a no-light mark (a small dot) is your own note that a cell can't hold a light. it doesn't count for anything.",
  ],
  describeAction: (p, a) => `${["clear", "light", "dot"][a.value] ?? "mark"} ${cellList(p, a.cells)}`,
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? { board: { marks: a.solution.map((v) => (v === 1 ? BULB : NONE)) } } : null;
  },
  hint,
  rate,
  describe: (p) => `${p.w}×${p.h}`,
};
