import type { Step, Technique } from "../../core/types";
import { EMPTY, geometry, litCounts } from "./grid";
import {
  BULB, DOT, NONE, cellName,
  type LightupAction, type LightupFocus, type LightupPuzzle, type LightupState,
} from "./logic";
import {
  DARK, LIGHT, analyze, assign, freshKnowledge, scanSteps,
  type Knowledge, type Step as SolverStep, type StepKind,
} from "./solver";

type LightupTechnique = Technique<LightupPuzzle, LightupState, LightupAction>;

const knowledgeCache = new WeakMap<LightupState, Knowledge | null>();

/**
 * What the board establishes: lights and no-light marks, each read as a fact only when it agrees
 * with the unique solution (every mark counts when there isn't one). Deductions from it stay
 * true however wrong the board is, so an auto-applied step never builds on a mistake. Null when
 * the counted marks contradict each other.
 */
export function knowledge(p: LightupPuzzle, s: LightupState): Knowledge | null {
  if (knowledgeCache.has(s)) return knowledgeCache.get(s)!;
  const g = geometry(p);
  const a = analyze(p);
  const sol = a.count === 1 ? a.solution : null;
  let k: Knowledge | null = freshKnowledge(g);
  for (const c of g.empties) {
    if (s.marks[c] === BULB && (!sol || sol[c] === 1) && !assign(g, k, c, LIGHT)) { k = null; break; }
  }
  if (k) {
    for (const c of g.empties) {
      if (s.marks[c] === DOT && (!sol || sol[c] === 0) && !assign(g, k, c, DARK)) { k = null; break; }
    }
  }
  knowledgeCache.set(s, k);
  return k;
}

/**
 * The cells of a step that would change the board: unmarked and unlit. Player marks are never
 * overwritten, and nothing is put in a lit cell, so a step can't create a visible clash even
 * next to a wrong light.
 */
function effectiveCells(p: LightupPuzzle, s: LightupState, step: SolverStep): number[] {
  const lit = litCounts(geometry(p), s.marks);
  return step.cells.filter((c) => p.cells[c] === EMPTY && s.marks[c] === NONE && lit[c] === 0);
}

/** First step of these kinds that changes the board, narrowed to the cells it changes. */
function first(p: LightupPuzzle, s: LightupState, kinds: readonly StepKind[]): { raw: SolverStep; cells: number[] } | null {
  const k = knowledge(p, s);
  if (!k) return null;
  let cells: number[] = [];
  const raw = scanSteps(geometry(p), k, kinds, (st) => (cells = effectiveCells(p, s, st)).length > 0);
  return raw ? { raw, cells } : null;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function outcome(cells: readonly number[], value: number): string {
  const n = cells.length;
  if (value === LIGHT) return n === 1 ? "that cell is a light" : `those ${n} cells are lights`;
  return n === 1 ? "that cell can't hold a light" : `those ${n} cells can't hold lights`;
}

function step(raw: SolverStep, cells: number[], message: string, nudge: string, nudgeFocus: LightupFocus): Step<LightupAction> {
  return {
    message,
    nudge,
    focus: { cells, because: raw.because } satisfies LightupFocus,
    nudgeFocus,
    actions: [{ type: "set", cells, value: raw.value === LIGHT ? BULB : DOT }],
  };
}

const EASY = { width: 7, height: 7, difficulty: "easy" };
const MEDIUM = { width: 8, height: 8, difficulty: "medium" };
const HARD = { width: 8, height: 8, difficulty: "hard" };

export const finished: LightupTechnique = {
  id: "lightup.finished",
  name: "finished number",
  puzzles: ["lightup"],
  level: 1,
  description: "a number that already touches as many lights as it shows can't take any more, so its other open neighbours get no-light marks. a 0 is finished from the start.",
  find(p, s) {
    const hit = first(p, s, ["clue-full"]);
    if (!hit) return null;
    const q = hit.raw.because[0]!;
    const v = p.cells[q]!;
    const at = cellName(p, q);
    const why = v === 0 ? `the 0 at ${at} can't touch any lights` : `the ${v} at ${at} already touches ${v} ${plural(v, "light", "lights")}`;
    return step(hit.raw, hit.cells, `${why}, so ${outcome(hit.cells, DARK)}`, `look at the ${v} at ${at}`, { cells: [], because: [q] });
  },
  practice: { params: EASY },
};

export const needsAll: LightupTechnique = {
  id: "lightup.needs-all",
  name: "no room to spare",
  puzzles: ["lightup"],
  level: 2,
  description: "a number with exactly as many neighbours that could still take a light as lights it still needs: every one of them is a light. a 4 always is, and so is a 3 against an edge.",
  find(p, s) {
    const hit = first(p, s, ["clue-needs-all"]);
    if (!hit) return null;
    const q = hit.raw.because[0]!;
    const v = p.cells[q]!;
    const need = hit.raw.cells.length;
    const at = cellName(p, q);
    return step(hit.raw, hit.cells,
      `the ${v} at ${at} still needs ${need} ${plural(need, "light", "lights")} and only ${need} of its neighbours can take one, so ${outcome(hit.cells, LIGHT)}`,
      `look at the ${v} at ${at}`, { cells: [], because: [q] });
  },
  practice: { params: EASY },
};

export const onlySource: LightupTechnique = {
  id: "lightup.only-source",
  name: "only one way to light it",
  puzzles: ["lightup"],
  level: 3,
  description: "a dark cell that only one cell can still light (itself, or a cell with a clear view of it along its row or column): that cell is a light.",
  find(p, s) {
    const hit = first(p, s, ["only-source"]);
    if (!hit) return null;
    const x = hit.raw.because[0]!;
    const c = hit.cells[0]!;
    const message = c === x
      ? `nothing can light ${cellName(p, x)} except a light on it, so it's a light`
      : `only a light at ${cellName(p, c)} can still light ${cellName(p, x)}, so it's a light`;
    return step(hit.raw, hit.cells, message, `what can still light ${cellName(p, x)}?`, { cells: [], because: [x] });
  },
  practice: { params: EASY },
};

export const leavesDark: LightupTechnique = {
  id: "lightup.leaves-dark",
  name: "would leave a cell dark",
  puzzles: ["lightup"],
  level: 4,
  description: "a cell that can see every spot that could still light some dark cell: a light there would block them all and leave that cell dark forever, so it can't hold one.",
  find(p, s) {
    const hit = first(p, s, ["starves-cell"]);
    if (!hit) return null;
    const x = hit.raw.because[0]!;
    const y = hit.cells[0]!;
    return step(hit.raw, hit.cells,
      `a light at ${cellName(p, y)} would shine on every spot that could light ${cellName(p, x)}, so ${outcome(hit.cells, DARK)}`,
      `which cells could light ${cellName(p, x)}?`, { cells: [], because: [x] });
  },
  practice: { params: MEDIUM },
};

export const crowds: LightupTechnique = {
  id: "lightup.crowds",
  name: "would crowd a number",
  puzzles: ["lightup"],
  level: 5,
  description: "a light that would shine on so many of a number's open neighbours that the number couldn't get its lights any more can't go there. the classic cases: the corners diagonal to a 3, or the corner between a 1's only two open neighbours.",
  find(p, s) {
    const hit = first(p, s, ["starves-clue"]);
    if (!hit) return null;
    const q = hit.raw.because[0]!;
    const y = hit.cells[0]!;
    const v = p.cells[q]!;
    const at = cellName(p, q);
    return step(hit.raw, hit.cells,
      `a light at ${cellName(p, y)} would leave the ${v} at ${at} too few places for its lights, so ${outcome(hit.cells, DARK)}`,
      `look at the ${v} at ${at} and the cells around its corners`, { cells: [], because: [q] });
  },
  practice: { params: MEDIUM },
};

export const trial: LightupTechnique = {
  id: "lightup.trial",
  name: "try it both ways",
  puzzles: ["lightup"],
  level: 6,
  description: "pretend a cell is a light (or stays dark) and follow the first three techniques from there. if that runs into a clash (two lights seeing each other, a number that can't be met, a cell nothing can light), the cell must be the other way.",
  find(p, s) {
    const hit = first(p, s, ["probe-light", "probe-dark"]);
    if (!hit) return null;
    const c = hit.cells[0]!;
    const at = cellName(p, c);
    const message = hit.raw.kind === "probe-light"
      ? `if ${at} were a light, the easy rules would run into a clash, so ${outcome(hit.cells, DARK)}`
      : `if ${at} stayed dark, the easy rules would run into a clash, so ${outcome(hit.cells, LIGHT)}`;
    return step(hit.raw, hit.cells, message, `try ${at} both ways`, { cells: [c], because: [] });
  },
  practice: { params: HARD },
};

export const lightupTechniques: LightupTechnique[] = [finished, needsAll, onlySource, leavesDark, crowds, trial];
