import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import { BLACK, EMPTY, geometry, litCounts, type LightupPuzzle } from "./grid";
import {
  DARK, LEVEL_NAMES, LIGHT, analyze, assign, freshKnowledge, generatePuzzle, nextStep,
  type Level, type Step, type Symmetry,
} from "./solver";

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
      { value: "easy", label: "easy", description: "clue counting and single sources" },
      { value: "medium", label: "medium", description: "spot lights that would starve a clue or cell" },
      { value: "hard", label: "hard", description: "needs trying a cell and finding a contradiction" },
    ],
  },
});

/** Per-cell mark. Only meaningful on open cells. */
export const NONE = 0, BULB = 1, DOT = 2;
export type Mark = typeof NONE | typeof BULB | typeof DOT;

export interface LightupState {
  marks: number[];
}

export type LightupAction =
  | { type: "set"; cells: number[]; value: Mark }
  /** Mark if the cell doesn't have it, else clear. */
  | { type: "toggle"; cell: number; value: typeof BULB | typeof DOT };

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
  switch (a.type) {
    case "set":
      return setMarks(p, s, a.cells, a.value);
    case "toggle":
      if (p.cells[a.cell] !== EMPTY) return s;
      return setMarks(p, s, [a.cell], s.marks[a.cell] === a.value ? NONE : a.value);
    default:
      return s;
  }
}

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

const pos = (p: LightupPuzzle, c: number) => `(${(c % p.w) + 1}, ${Math.floor(c / p.w) + 1})`;

function stepMessage(p: LightupPuzzle, s: Step): string {
  const q = s.because[0]!;
  switch (s.kind) {
    case "clue-full": return `the ${p.cells[q]} at ${pos(p, q)} already has its lights, so its other neighbours stay dark`;
    case "clue-needs-all": return `the ${p.cells[q]} at ${pos(p, q)} needs a light in every remaining neighbour`;
    case "only-source": return `only one cell can still light ${pos(p, q)}`;
    case "starves-cell": return `a light at ${pos(p, s.cells[0]!)} would leave ${pos(p, q)} with no way to be lit`;
    case "starves-clue": return `a light at ${pos(p, s.cells[0]!)} would leave the ${p.cells[q]} at ${pos(p, q)} without enough room`;
    case "probe-light": return `a light at ${pos(p, s.cells[0]!)} leads to a contradiction`;
    case "probe-dark": return `leaving ${pos(p, s.cells[0]!)} dark leads to a contradiction, so it's a light`;
  }
}

/** Focus payload understood by the lightup views. */
export interface LightupFocus {
  /** Cells the hint acts on. */
  cells: number[];
  /** Cells explaining why. */
  because: number[];
}

export function hint(p: LightupPuzzle, s: LightupState): Hint<LightupAction> | null {
  const a = analyze(p);
  const g = geometry(p);
  if (a.count === 1 && a.solution) {
    const wrong = g.empties.filter((c) => (s.marks[c] === BULB && a.solution![c] !== 1) || (s.marks[c] === DOT && a.solution![c] === 1));
    if (wrong.length) {
      return {
        message: wrong.length === 1 ? `the mark at ${pos(p, wrong[0]!)} is wrong` : `${wrong.length} marks are wrong`,
        focus: { cells: wrong, because: [] } satisfies LightupFocus,
        actions: [{ type: "set", cells: wrong, value: NONE }],
      };
    }
  }
  const k = freshKnowledge(g);
  for (const c of g.empties) {
    if (s.marks[c] === BULB && !assign(g, k, c, LIGHT)) return { message: "two lights see each other" };
  }
  for (const c of g.empties) {
    if (s.marks[c] === DOT && !assign(g, k, c, DARK)) return { message: "a marked cell contradicts a light" };
  }
  const step = nextStep(g, k, 2);
  if (step === "contradiction") return { message: "something here can't be right; a clue or cell can no longer be satisfied" };
  if (!step) return null;
  return {
    message: stepMessage(p, step),
    focus: { cells: step.cells, because: step.because } satisfies LightupFocus,
    actions: [{ type: "set", cells: step.cells, value: step.value === LIGHT ? BULB : DOT }],
  };
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
  description: "place lights so every open square is lit. lights can't see each other; numbers count adjacent lights.",
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
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? { marks: a.solution.map((v) => (v === 1 ? BULB : NONE)) } : null;
  },
  hint,
  rate,
  describe: (p) => `${p.w}×${p.h}`,
};
