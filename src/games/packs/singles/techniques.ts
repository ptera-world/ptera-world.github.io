import type { Technique } from "../../core/types";
import { bit, type Deduction } from "../../lib/grid-kit/csp";
import { cellList, cellName, technique, type Focus, type Reading } from "../../lib/grid-kit/names";
import {
  singles, BLACK, CIRCLE, NONE, SHADED, WHITE, model, readMarks,
  type SinglesAction, type SinglesPuzzle, type SinglesState,
} from "./logic";

type SinglesTechnique = Technique<SinglesPuzzle, SinglesState, SinglesAction>;

const readings = new WeakMap<SinglesState, Reading | null>();

/**
 * What the board establishes: blacks and circles, each read as a fact only when it agrees with
 * the unique solution (every mark counts when there isn't one). Deductions from it stay true
 * however wrong the board is, so an auto-applied step never builds on a mistake.
 */
function read(p: SinglesPuzzle, s: SinglesState): Reading | null {
  if (readings.has(s)) return readings.get(s)!;
  const k = readMarks(p, s, true);
  const r = k ? { model: model(p), k } : null;
  readings.set(s, r);
  return r;
}

const markOf = (keep: number): SinglesAction["value"] => (keep === bit(SHADED) ? BLACK : CIRCLE);

/** Cells the deduction would change: unmarked ones (player marks are never overwritten). */
const changes = (_p: SinglesPuzzle, s: SinglesState, d: Deduction): number[] => d.vars.filter((c) => s.marks[c] === NONE);

const outcome = (p: SinglesPuzzle, cells: readonly number[], keep: number) =>
  `${cellList(p, cells)} ${keep === bit(SHADED) ? (cells.length === 1 ? "is black" : "are black") : (cells.length === 1 ? "stays white" : "stay white")}`;

function step(p: SinglesPuzzle, d: Deduction, vars: number[], message: string, nudge: string, nudgeFocus: Focus, related: number[] = []) {
  return {
    message: `${message}, so ${outcome(p, vars, d.keep)}`,
    nudge,
    focus: { cells: vars, because: d.because, related } satisfies Focus,
    nudgeFocus,
    actions: [{ type: "set" as const, cells: vars, value: markOf(d.keep) }],
  };
}

const num = (p: SinglesPuzzle, c: number) => p.nums[c]!;
const EASY = { width: 6, height: 6, difficulty: "easy" };
const TRICKY = { width: 8, height: 8, difficulty: "tricky" };
const HARD = { width: 8, height: 8, difficulty: "hard" };

const base = { puzzle: singles, read, changes };

export const sandwich: SinglesTechnique = technique<SinglesPuzzle, SinglesState, SinglesAction>({
  ...base,
  id: "singles.sandwich",
  name: "between twins",
  level: 1,
  kinds: ["sandwich"],
  description: "a cell between two equal numbers (like 3 ? 3 in a row) stays white: one of the twins has to be black, and a black can't touch another black.",
  explain(p, _s, d, vars) {
    const [a, b] = d.because as [number, number];
    return step(p, d, vars, `one of the ${num(p, a)}s on ${cellName(p, a)} and ${cellName(p, b)} must be black, and ${cellName(p, vars[0]!)} touches both`,
      `look at the ${num(p, a)}s on ${cellName(p, a)} and ${cellName(p, b)}`, { cells: [], because: [a, b] });
  },
  practice: { params: EASY },
});

export const pair: SinglesTechnique = technique<SinglesPuzzle, SinglesState, SinglesAction>({
  ...base,
  id: "singles.pair",
  name: "twins side by side",
  level: 2,
  kinds: ["pair"],
  description: "two equal numbers side by side can't both be black (blacks can't touch) and can't both stay white, so exactly one of them stays white. every other copy of that number in their row or column is black.",
  explain(p, _s, d, vars) {
    const [a, b] = d.because as [number, number];
    return step(p, d, vars, `one of the ${num(p, a)}s on ${cellName(p, a)} and ${cellName(p, b)} stays white`,
      `look at the ${num(p, a)}s side by side on ${cellName(p, a)} and ${cellName(p, b)}`, { cells: [], because: [a, b] });
  },
  practice: { params: EASY },
});

export const duplicate: SinglesTechnique = technique<SinglesPuzzle, SinglesState, SinglesAction>({
  ...base,
  id: "singles.duplicate",
  name: "repeated number",
  level: 3,
  kinds: ["duplicate"],
  description: "once a cell is known to stay white, every other copy of its number in its row and column has to be black.",
  explain(p, _s, d, vars) {
    const a = d.because[0]!;
    return step(p, d, vars, `the ${num(p, a)} on ${cellName(p, a)} stays white`, `what else can't stay white because of ${cellName(p, a)}?`, { cells: [], because: [a] });
  },
  practice: { params: EASY },
});

export const blackNeighbour: SinglesTechnique = technique<SinglesPuzzle, SinglesState, SinglesAction>({
  ...base,
  id: "singles.black-neighbour",
  name: "next to a black",
  level: 4,
  kinds: ["black-neighbour"],
  description: "blacks can't touch side by side, so every cell next to a black stays white.",
  explain(p, _s, d, vars) {
    const a = d.because[0]!;
    return step(p, d, vars, `${cellName(p, a)} is black and blacks can't touch`, `look around the black on ${cellName(p, a)}`, { cells: [], because: [a] });
  },
  practice: { params: EASY },
});

export const wayOut: SinglesTechnique = technique<SinglesPuzzle, SinglesState, SinglesAction>({
  ...base,
  id: "singles.way-out",
  name: "only way out",
  level: 5,
  kinds: ["way-out"],
  description: "a white cell has to connect to the other white cells. if all its neighbors but one are black, that last one stays white.",
  explain(p, _s, d, vars) {
    const a = d.because[0]!;
    return step(p, d, vars, `${cellName(p, a)} stays white and ${cellName(p, vars[0]!)} is its only neighbor that isn't black`, `how does ${cellName(p, a)} connect to the other white cells?`, { cells: [], because: [a] });
  },
  practice: { params: EASY },
});

export const split: SinglesTechnique = technique<SinglesPuzzle, SinglesState, SinglesAction>({
  ...base,
  id: "singles.split",
  name: "would cut the white area",
  level: 6,
  kinds: ["split"],
  description: "a cell whose blackening would cut the cells that aren't black into two separate pieces stays white, because the whites must stay connected.",
  explain(p, _s, d, vars) {
    const c = vars[0]!;
    return step(p, d, vars, `blacking out ${cellName(p, c)} would cut the cells that aren't black into two pieces`, `which cell holds the white area together?`, { cells: [], because: [] });
  },
  practice: { params: TRICKY },
});

export const trial: SinglesTechnique = technique<SinglesPuzzle, SinglesState, SinglesAction>({
  ...base,
  id: "singles.trial",
  name: "try it both ways",
  level: 7,
  kinds: ["trial"],
  description: "pretend a cell is black (or stays white) and follow the other techniques from there. if that breaks a rule, the cell must be the other way.",
  explain(p, _s, d, vars) {
    const c = vars[0]!;
    const tried = (d.data as { value: number }).value === WHITE ? "stayed white" : "were black";
    return step(p, d, vars, `if ${cellName(p, c)} ${tried}, following the other techniques would break a rule`, `try ${cellName(p, c)} both ways`, { cells: [c], because: [] });
  },
  practice: { params: HARD },
});

export const singlesTechniques: SinglesTechnique[] = [sandwich, pair, duplicate, blackNeighbour, wayOut, split, trial];
