import type { Rng } from "../../core/rng";
import { cellName as boardCell } from "../../core/names";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import { dpair, geometry, type DominosaPuzzle } from "./grid";
import { LEVEL_NAMES, analyze, balanced, generatePuzzle, type Level } from "./solver";

export type { DominosaPuzzle } from "./grid";

export const params = defineSchema({
  max: { type: "int", label: "highest number", default: 6, min: 1, max: 12, description: "dominoes go from 0-0 up to this number; the board is (n+2)×(n+1)" },
  difficulty: {
    type: "enum", label: "difficulty", default: "medium",
    options: [
      { value: "easy", label: "easy", description: "dominoes and cells with only one place left" },
      { value: "medium", label: "medium", description: "also cells whose options are all one domino, places every option shares, and areas that can't be filled" },
      { value: "hard", label: "hard", description: "also trying a domino somewhere and seeing it fail" },
    ],
  },
});

/** Mark per placement. */
export const NONE = 0, DOMINO = 1, LINE = 2;
export type Mark = typeof NONE | typeof DOMINO | typeof LINE;

export interface DominosaState {
  /** Per placement (see Geometry). */
  marks: number[];
}

/** Setting NONE is the only way marks are removed, so it alone is a retraction. */
export type DominosaAction = { type: "set"; placements: number[]; value: Mark };

export interface DominosaInteraction {
  /** Doubled-grid cursor: (2x, 2y) is a cell, odd in exactly one axis is the edge between two cells. */
  cx: number;
  cy: number;
  /** Numbers highlighted everywhere on the board (up to two). */
  highlight: number[];
}

/** Placements whose domino covers a cell. */
export function coveredBy(p: DominosaPuzzle, marks: readonly number[], cell: number): number {
  for (const q of geometry(p).byCell[cell]!) if (marks[q] === DOMINO) return q;
  return -1;
}

export function reduce(p: DominosaPuzzle, s: DominosaState, a: DominosaAction): DominosaState {
  if (a.type !== "set" || ![NONE, DOMINO, LINE].includes(a.value)) return s;
  const g = geometry(p);
  let next: number[] | null = null;
  for (const q of a.placements) {
    if (q < 0 || q >= g.np) continue;
    const cur = next ?? s.marks;
    if (cur[q] === a.value) continue;
    if (a.value === LINE) {
      const ca = coveredBy(p, cur, g.pa[q]!), cb = coveredBy(p, cur, g.pb[q]!);
      if ((ca >= 0 && ca !== q) || (cb >= 0 && cb !== q) || cur[q] === DOMINO) continue;
    }
    next ??= s.marks.slice();
    if (a.value === DOMINO) {
      for (const c of [g.pa[q]!, g.pb[q]!]) for (const o of g.byCell[c]!) if (next[o] === DOMINO) next[o] = NONE;
    }
    next[q] = a.value;
  }
  return next ? { marks: next } : s;
}

/** Toggle a domino (or line) on a placement. */
export const toggle = (s: DominosaState, q: number, value: typeof DOMINO | typeof LINE): DominosaAction =>
  ({ type: "set", placements: [q], value: s.marks[q] === value ? NONE : value });

export function isSolved(p: DominosaPuzzle, s: DominosaState): boolean {
  const g = geometry(p);
  const seen = new Uint8Array(g.nd);
  let count = 0;
  for (let q = 0; q < g.np; q++) {
    if (s.marks[q] !== DOMINO) continue;
    if (seen[g.pd[q]!]) return false;
    seen[g.pd[q]!] = 1;
    count++;
  }
  return count === g.nd;
}

// --- formats ---

const SGT_RE = /^(\d+)([^:]*):([0-9[\]]+)$/;

function fromNumbers(n: number, numbers: number[]): DominosaPuzzle {
  if (!(n >= 1 && n <= 30)) throw new Error("the highest number must be between 1 and 30");
  const p: DominosaPuzzle = { n, w: n + 2, h: n + 1, numbers };
  if (numbers.length !== p.w * p.h) throw new Error(`expected ${p.w * p.h} numbers, got ${numbers.length}`);
  if (numbers.some((v) => v < 0 || v > n)) throw new Error(`numbers must be between 0 and ${n}`);
  if (!balanced(p)) throw new Error(`every number from 0 to ${n} must appear exactly ${n + 2} times`);
  return p;
}

/** Simon Tatham's Dominosa game id: `N[params]:desc`; desc is one digit per cell, `[k]` for numbers above 9. */
export const sgtFormat: Format<DominosaPuzzle> = {
  id: "sgt",
  label: "game id (N:…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(t) {
    const m = SGT_RE.exec(t.trim());
    if (!m) throw new Error("expected N:desc, e.g. 3:0123…");
    const n = Number(m[1]);
    const numbers: number[] = [];
    const desc = m[3]!;
    for (let i = 0; i < desc.length; i++) {
      const ch = desc[i]!;
      if (ch === "[") {
        const end = desc.indexOf("]", i);
        if (end < 0) throw new Error("missing ] in the game id");
        numbers.push(Number(desc.slice(i + 1, end)));
        i = end;
      } else if (ch >= "0" && ch <= "9") numbers.push(Number(ch));
      else throw new Error(`unexpected "${ch}" in the game id`);
    }
    return fromNumbers(n, numbers);
  },
  serialize: (p) => `${p.n}:${p.numbers.map((v) => (v < 10 ? String(v) : `[${v}]`)).join("")}`,
};

/** One text row per board row; numbers separated by spaces, or one digit per cell when all are below 10. */
export const gridFormat: Format<DominosaPuzzle> = {
  id: "grid",
  label: "grid (rows of numbers)",
  detect: (t) => /^[\d \t]+(\r?\n[\d \t]+)+$/.test(t.trim()),
  parse(t) {
    const rows = t.trim().split(/\r?\n/).map((r) => r.trim()).filter((r) => r.length > 0);
    const cells = rows.map((r) => (/\s/.test(r) ? r.split(/\s+/) : [...r]).map(Number));
    const w = cells[0]?.length ?? 0;
    cells.forEach((r, y) => { if (r.length !== w) throw new Error(`row ${y + 1} has ${r.length} numbers, expected ${w}`); });
    const n = w - 2;
    if (rows.length !== n + 1) throw new Error(`a board ${w} wide needs ${n + 1} rows (the highest number is ${n})`);
    return fromNumbers(n, cells.flat());
  },
  serialize(p) {
    const sep = p.n >= 10 ? " " : "";
    const rows: string[] = [];
    for (let y = 0; y < p.h; y++) rows.push(p.numbers.slice(y * p.w, (y + 1) * p.w).join(sep));
    return rows.join("\n");
  },
};

// --- names, conflicts, hints ---

export const cellName = (p: { w: number }, c: number) => boardCell(c % p.w, Math.floor(c / p.w));

export function cellList(p: { w: number }, cells: readonly number[]): string {
  const names = cells.slice(0, 3).map((c) => cellName(p, c));
  const rest = cells.length - names.length;
  if (rest > 0) return `${names.join(", ")} and ${rest} more`;
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "";
}

/** "C5-D5". */
export function placementName(p: DominosaPuzzle, q: number): string {
  const g = geometry(p);
  return `${cellName(p, g.pa[q]!)}-${cellName(p, g.pb[q]!)}`;
}

export function placementList(p: DominosaPuzzle, qs: readonly number[]): string {
  const names = qs.slice(0, 3).map((q) => placementName(p, q));
  const rest = qs.length - names.length;
  if (rest > 0) return `${names.join(", ")} and ${rest} more`;
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "";
}

export const dominoName = (d: number): string => dpair(d).join("-");

/** Focus payload understood by the dominosa view. */
export interface DominosaFocus {
  /** Placements the hint acts on. */
  placements: number[];
  /** Cells explaining why. */
  because: number[];
}

/** Rule breaks visible without knowing the answer. */
export interface Conflicts {
  /** Dominoes placed more than once (every copy). */
  duplicates: number[];
  /** Uncovered cells with no way left to cover them. */
  stuck: number[];
}

export function findConflicts(p: DominosaPuzzle, marks: readonly number[]): Conflicts {
  const g = geometry(p);
  const byD = new Map<number, number[]>();
  for (let q = 0; q < g.np; q++) {
    if (marks[q] !== DOMINO) continue;
    const list = byD.get(g.pd[q]!) ?? [];
    list.push(q);
    byD.set(g.pd[q]!, list);
  }
  const duplicates = [...byD.values()].filter((l) => l.length > 1).flat();
  const stuck: number[] = [];
  for (let c = 0; c < g.wh; c++) {
    if (coveredBy(p, marks, c) >= 0) continue;
    const free = g.byCell[c]!.some((q) => marks[q] === NONE && coveredBy(p, marks, g.pa[q] === c ? g.pb[q]! : g.pa[q]!) < 0);
    if (!free) stuck.push(c);
  }
  return { duplicates, stuck };
}

/** Marks that disagree with the unique solution, as a hint that clears them. */
export function wrongMarksHint(p: DominosaPuzzle, s: DominosaState): Hint<DominosaAction> | null {
  const a = analyze(p);
  if (a.count !== 1 || !a.solution) return null;
  const sol = a.solution;
  const g = geometry(p);
  const wrong: number[] = [];
  for (let q = 0; q < g.np; q++) {
    if ((s.marks[q] === DOMINO && sol[q] !== 1) || (s.marks[q] === LINE && sol[q] === 1)) wrong.push(q);
  }
  if (!wrong.length) return null;
  const one = wrong.length === 1;
  return {
    message: `the ${one ? "domino or line" : "dominoes or lines"} on ${placementList(p, wrong)} ${one ? "is" : "are"} wrong`,
    focus: { placements: wrong, because: [] } satisfies DominosaFocus,
    actions: [{ type: "set", placements: wrong, value: NONE }],
  };
}

export function hint(p: DominosaPuzzle, s: DominosaState): Hint<DominosaAction> | null {
  const c = findConflicts(p, s.marks);
  if (c.duplicates.length) {
    const g = geometry(p);
    return { message: `the ${dominoName(g.pd[c.duplicates[0]!]!)} domino is placed more than once`, focus: { placements: c.duplicates, because: [] } satisfies DominosaFocus };
  }
  if (c.stuck.length) return { message: `nothing can cover ${cellList(p, c.stuck)} any more`, focus: { placements: [], because: c.stuck } satisfies DominosaFocus };
  const a = analyze(p);
  if (a.count === 0) return { message: "this puzzle has no solution" };
  if (a.count === 2) return { message: "this puzzle has more than one solution, so it can need a guess" };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: DominosaPuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 3 };
  return { label: LEVEL_NAMES[a.level], score: a.level };
}

function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<DominosaPuzzle> {
  return generatePuzzle(v.max, LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) as Level, rng, ctx);
}

export const dominosa: PuzzleDef<DominosaPuzzle, DominosaState, DominosaAction, DominosaInteraction, typeof params> = {
  id: "dominosa",
  name: "dominosa",
  aliases: ["domino", "dominoes", "domino jigsaw", "domino search"],
  tags: ["logic", "grid", "numbers", "tiling"],
  description: "a full set of dominoes was laid out in a rectangle and then taken away, leaving only the numbers. put the dominoes back: every pair of numbers appears exactly once.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "0-3 easy", params: { max: 3, difficulty: "easy" } },
    { label: "0-6 easy", params: { max: 6, difficulty: "easy" } },
    { label: "0-6 medium", params: { max: 6, difficulty: "medium" } },
    { label: "0-6 hard", params: { max: 6, difficulty: "hard" } },
    { label: "0-9 medium", params: { max: 9, difficulty: "medium" } },
  ],
  generate,
  formats: [sgtFormat, gridFormat],
  init: (p) => ({ marks: Array.from({ length: geometry(p).np }, () => NONE) }),
  initInteraction: () => ({ cx: 1, cy: 0, highlight: [] }),
  reduce,
  isRetraction: (a) => a.value === NONE,
  rules: (p) => [
    `the board holds one of every domino from 0-0 to ${p.n}-${p.n}: every pair of numbers, each exactly once (a domino reads the same both ways round).`,
    "each domino covers two neighbouring cells (side by side or one above the other), and every cell is covered by exactly one domino.",
    "the numbers on the board are the numbers on the dominoes that cover them.",
    "a line between two cells is your own note that they aren't one domino. it doesn't count for anything.",
  ],
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? { marks: a.solution.map((v) => (v === 1 ? DOMINO : NONE)) } : null;
  },
  hint,
  rate,
  describe: (p) => `0-${p.n}`,
};
