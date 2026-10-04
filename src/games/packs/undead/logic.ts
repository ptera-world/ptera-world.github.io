import type { Rng } from "../../core/rng";
import { colName, rowName } from "../../core/names";
import { cellList, cellName } from "../../lib/grid-kit/names";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, Hint, PuzzleDef } from "../../core/types";
import { ALL, EMPTY, GHOST, MIRROR_L, MIRROR_R, VAMPIRE, ZOMBIE, bit, geometry, seen, type UndeadPuzzle } from "./grid";
import { LEVEL_NAMES, analyze, generatePuzzle, type Level } from "./solver";

export { cellList, cellName };

export type { UndeadPuzzle } from "./grid";

export const params = defineSchema({
  width: { type: "int", label: "width", default: 5, min: 3, max: 10 },
  height: { type: "int", label: "height", default: 5, min: 3, max: 10 },
  difficulty: {
    type: "enum", label: "difficulty", default: "medium",
    options: [
      { value: "easy", label: "easy", description: "sight counts that are nearly full or nearly empty, and monster totals" },
      { value: "medium", label: "medium", description: "also working through every way to fill one line of sight" },
      { value: "hard", label: "hard", description: "also trying a monster in a cell and seeing it fail" },
    ],
  },
});

export interface UndeadState {
  /** Monster per cell (0 none); givens included. */
  monsters: number[];
  /** Pencil marks per cell: candidate bits, 0 for none. */
  marks: number[];
}

/** Clearing a monster and toggling a pencil mark are the player's own edits, so they count as retractions. */
export type UndeadAction =
  | { type: "set"; cells: number[]; value: number }
  | { type: "marks"; cells: number[]; marks: number }
  | { type: "toggle-mark"; cell: number; value: number };

export interface UndeadInteraction {
  cursor: number;
  /** Typed monsters go in as pencil marks. */
  pencil: boolean;
}

export const MONSTER_NAMES = ["", "ghost", "vampire", "zombie"] as const;
export const MONSTER_PLURALS = ["", "ghosts", "vampires", "zombies"] as const;

const editable = (p: UndeadPuzzle, c: number) => c >= 0 && c < p.cells.length && p.cells[c] === EMPTY && !p.given[c];

export function reduce(p: UndeadPuzzle, s: UndeadState, a: UndeadAction): UndeadState {
  switch (a.type) {
    case "set": {
      if (!(a.value >= 0 && a.value <= 3)) return s;
      let mon: number[] | null = null, marks: number[] | null = null;
      for (const c of a.cells) {
        if (!editable(p, c) || (s.monsters[c] === a.value && (a.value === 0 || !s.marks[c]))) continue;
        mon ??= s.monsters.slice();
        marks ??= s.marks.slice();
        mon[c] = a.value;
        if (a.value) marks[c] = 0;
      }
      return mon ? { monsters: mon, marks: marks! } : s;
    }
    case "marks": {
      let marks: number[] | null = null;
      for (const c of a.cells) {
        if (!editable(p, c) || s.monsters[c] || s.marks[c] === (a.marks & ALL)) continue;
        marks ??= s.marks.slice();
        marks[c] = a.marks & ALL;
      }
      return marks ? { ...s, marks } : s;
    }
    case "toggle-mark": {
      if (!editable(p, a.cell) || s.monsters[a.cell] || !(a.value >= 1 && a.value <= 3)) return s;
      const marks = s.marks.slice();
      marks[a.cell] = marks[a.cell]! ^ bit(a.value);
      return { ...s, marks };
    }
    default:
      return s;
  }
}

export function sightCountsOf(p: UndeadPuzzle, monsters: readonly number[]): number[] {
  const g = geometry(p);
  return g.paths.map((path) => path.reduce((sum, vis) => sum + (monsters[vis.cell] ? seen(vis, monsters[vis.cell]!) : 0), 0));
}

export function isSolved(p: UndeadPuzzle, s: UndeadState): boolean {
  const g = geometry(p);
  if (g.empties.some((c) => !s.monsters[c])) return false;
  const counts = [0, 0, 0];
  for (const c of g.empties) counts[s.monsters[c]! - 1]!++;
  if (counts.some((v, i) => v !== p.counts[i])) return false;
  return sightCountsOf(p, s.monsters).every((v, i) => v === p.clues[i]);
}

// --- formats ---

const SGT_RE = /^(\d+)(?:x(\d+))?[^:]*:(\d+),(\d+),(\d+),([a-zLRGVZ]*)((?:,\d+)*)$/;

/** Simon Tatham's Undead game id: `WxH[dX]:ghosts,vampires,zombies,grid,clue,clue,…`; grid runs a–z of 1–26 empty cells, L = \, R = /, G V Z shown monsters; clues clockwise from the top-left. */
export const sgtFormat: Format<UndeadPuzzle> = {
  id: "sgt",
  label: "game id (WxH:…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(t) {
    const m = SGT_RE.exec(t.trim());
    if (!m) throw new Error("expected WxH:ghosts,vampires,zombies,grid,clues…");
    const w = Number(m[1]), h = m[2] ? Number(m[2]) : w;
    if (!(w >= 1 && h >= 1 && w <= 30 && h <= 30)) throw new Error("size must be between 1×1 and 30×30");
    const counts: [number, number, number] = [Number(m[3]), Number(m[4]), Number(m[5])];
    const cells: number[] = [], given: number[] = [];
    for (const ch of m[6]!) {
      if (ch >= "a" && ch <= "z") for (let i = 0; i <= ch.charCodeAt(0) - 97; i++) { cells.push(EMPTY); given.push(0); }
      else if (ch === "L" || ch === "R") { cells.push(ch === "L" ? MIRROR_L : MIRROR_R); given.push(0); }
      else { cells.push(EMPTY); given.push(ch === "G" ? GHOST : ch === "V" ? VAMPIRE : ZOMBIE); }
    }
    if (cells.length !== w * h) throw new Error(`expected ${w * h} cells, got ${cells.length}`);
    const clues = m[7]!.split(",").slice(1).map(Number);
    if (clues.length !== 2 * (w + h)) throw new Error(`expected ${2 * (w + h)} sight counts, got ${clues.length}`);
    const monsters = cells.filter((v) => v === EMPTY).length;
    if (counts[0] + counts[1] + counts[2] !== monsters) throw new Error(`the monster totals add up to ${counts[0] + counts[1] + counts[2]}, but there are ${monsters} monster cells`);
    return { w, h, cells, given, counts, clues };
  },
  serialize(p) {
    let grid = "", run = 0;
    const flush = () => {
      if (run) grid += String.fromCharCode(96 + run);
      run = 0;
    };
    p.cells.forEach((v, c) => {
      if (v === EMPTY && !p.given[c]) {
        if (run === 26) flush();
        run++;
        return;
      }
      flush();
      grid += v === MIRROR_L ? "L" : v === MIRROR_R ? "R" : "GVZ"[p.given[c]! - 1];
    });
    flush();
    return `${p.w}x${p.h}:${p.counts.join(",")},${grid},${p.clues.join(",")}`;
  },
};

// --- names, conflicts, hints ---

/** "the 2 above column C", "the 0 right of row 4". */
export function clueName(p: UndeadPuzzle, i: number): string {
  const { w, h } = p;
  const v = p.clues[i];
  if (i < w) return `the ${v} above column ${colName(i)}`;
  if (i < w + h) return `the ${v} right of row ${rowName(i - w)}`;
  if (i < 2 * w + h) return `the ${v} below column ${colName(w - 1 - (i - w - h))}`;
  return `the ${v} left of row ${rowName(h - 1 - (i - 2 * w - h))}`;
}

/** "a ghost", "a ghost or a vampire". */
export function monstersText(mask: number, article = true): string {
  const names = [GHOST, VAMPIRE, ZOMBIE].filter((m) => mask & bit(m)).map((m) => (article ? `a ${MONSTER_NAMES[m]}` : MONSTER_NAMES[m]));
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : names[0] ?? "";
}

/** Focus payload understood by the undead view. */
export interface UndeadFocus {
  /** Cells the hint changes. */
  cells: number[];
  /** Cells explaining why. */
  because: number[];
  /** Sight clues explaining why. */
  clues?: number[];
  /** Monster totals explaining why (monster codes). */
  totals?: number[];
}

/** Rule breaks visible without knowing the answer. */
export interface Conflicts {
  /** Clues already seeing too many, or unable to reach their count. */
  clues: number[];
  /** Monsters with more placed than their total, or not enough room left. */
  totals: number[];
}

export function findConflicts(p: UndeadPuzzle, s: UndeadState): Conflicts {
  const g = geometry(p);
  const clues: number[] = [];
  g.paths.forEach((path, i) => {
    let lo = 0, hi = 0;
    for (const vis of path) {
      const m = s.monsters[vis.cell]!;
      if (m) { lo += seen(vis, m); hi += seen(vis, m); } else hi += vis.z;
    }
    if (lo > p.clues[i]! || hi < p.clues[i]!) clues.push(i);
  });
  const totals: number[] = [];
  const empty = g.empties.filter((c) => !s.monsters[c]).length;
  for (const m of [GHOST, VAMPIRE, ZOMBIE]) {
    const placed = g.empties.filter((c) => s.monsters[c] === m).length;
    if (placed > p.counts[m - 1]! || placed + empty < p.counts[m - 1]!) totals.push(m);
  }
  return { clues, totals };
}

/** Monsters and pencil marks that disagree with the unique solution, as a hint that clears them. */
export function wrongMarksHint(p: UndeadPuzzle, s: UndeadState): Hint<UndeadAction> | null {
  const a = analyze(p);
  if (a.count !== 1 || !a.solution) return null;
  const sol = a.solution;
  const g = geometry(p);
  const wrongMon = g.empties.filter((c) => !p.given[c] && s.monsters[c] && s.monsters[c] !== sol[c]);
  const wrongMarks = g.empties.filter((c) => !s.monsters[c] && s.marks[c] && !(s.marks[c]! & bit(sol[c]!)));
  if (!wrongMon.length && !wrongMarks.length) return null;
  const parts: string[] = [];
  if (wrongMon.length) parts.push(`the ${wrongMon.length === 1 ? "monster" : "monsters"} on ${cellList(p, wrongMon)} ${wrongMon.length === 1 ? "is" : "are"} wrong`);
  if (wrongMarks.length) parts.push(`the pencil marks on ${cellList(p, wrongMarks)} leave out the right monster`);
  const actions: UndeadAction[] = [];
  if (wrongMon.length) actions.push({ type: "set", cells: wrongMon, value: 0 });
  if (wrongMarks.length) actions.push({ type: "marks", cells: wrongMarks, marks: 0 });
  return { message: parts.join(", and "), focus: { cells: [...wrongMon, ...wrongMarks], because: [] } satisfies UndeadFocus, actions };
}

export function hint(p: UndeadPuzzle, s: UndeadState): Hint<UndeadAction> | null {
  const c = findConflicts(p, s);
  if (c.clues.length) return { message: `${clueName(p, c.clues[0]!)} can't be met any more`, focus: { cells: [], because: [], clues: c.clues } satisfies UndeadFocus };
  if (c.totals.length) return { message: `the number of ${MONSTER_PLURALS[c.totals[0]!]} can't be right any more`, focus: { cells: [], because: [], totals: c.totals } satisfies UndeadFocus };
  const a = analyze(p);
  if (a.count === 0) return { message: "this puzzle has no solution" };
  if (a.count === 2) return { message: "this puzzle has more than one solution, so it can need a guess" };
  return { message: "none of the techniques you have hints on applies here" };
}

function rate(p: UndeadPuzzle): { label: string; score: number } {
  const a = analyze(p);
  if (a.count === 0) return { label: "no solution", score: -1 };
  if (a.count === 2) return { label: "multiple solutions", score: 10 };
  if (a.level === null) return { label: "needs guessing", score: 3 };
  return { label: LEVEL_NAMES[a.level], score: a.level };
}

function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<UndeadPuzzle> {
  return generatePuzzle(v.width, v.height, LEVEL_NAMES.indexOf(v.difficulty as (typeof LEVEL_NAMES)[number]) as Level, rng, ctx);
}

export const undead: PuzzleDef<UndeadPuzzle, UndeadState, UndeadAction, UndeadInteraction, typeof params> = {
  id: "undead",
  name: "undead",
  aliases: ["haunted mirror maze", "spukschloss", "mirror maze", "ghosts vampires zombies"],
  tags: ["logic", "grid", "numbers", "mirrors"],
  description: "fill every cell that isn't a mirror with a ghost, a vampire or a zombie, so that the numbers around the edge count how many monsters can be seen looking in from there.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "4×4 easy", params: { width: 4, height: 4, difficulty: "easy" } },
    { label: "5×5 medium", params: { width: 5, height: 5, difficulty: "medium" } },
    { label: "5×5 hard", params: { width: 5, height: 5, difficulty: "hard" } },
    { label: "7×7 medium", params: { width: 7, height: 7, difficulty: "medium" } },
    { label: "7×7 hard", params: { width: 7, height: 7, difficulty: "hard" } },
  ],
  generate,
  formats: [sgtFormat],
  init: (p) => ({ monsters: p.given.slice(), marks: p.cells.map(() => 0) }),
  initInteraction: (p) => ({ cursor: geometry(p).empties[0] ?? 0, pencil: false }),
  reduce,
  isRetraction: (a) => (a.type === "set" && a.value === 0) || a.type === "toggle-mark",
  rules: (p) => [
    "every cell that isn't a mirror holds one monster: a ghost, a vampire or a zombie.",
    `there are exactly ${p.counts[0]} ghosts, ${p.counts[1]} vampires and ${p.counts[2]} zombies.`,
    "a number on the edge counts the monsters you'd see looking into the board from there. sight bounces off mirrors (both sides reflect).",
    "vampires are only seen directly, before the line of sight has hit a mirror. ghosts are only seen in a mirror, after it has bounced. zombies are always seen.",
    "a monster passed more than once along the same line of sight counts each time it's seen.",
    "pencil marks are your own notes of which monsters a cell could still be. they don't count for anything.",
  ],
  isSolved,
  solve(p) {
    const a = analyze(p);
    return a.solution ? { monsters: a.solution.slice(), marks: p.cells.map(() => 0) } : null;
  },
  hint,
  rate,
  describe: (p) => `${p.w}×${p.h}`,
};
