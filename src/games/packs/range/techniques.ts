import type { Technique } from "../../core/types";
import { bit, type Deduction } from "../../lib/grid-kit/csp";
import { cellList, cellName, technique, type Focus, type Reading } from "../../lib/grid-kit/names";
import {
  range, BLACK, DOT, NONE, SHADED, WHITE, model, readMarks,
  type Mark, type RangeAction, type RangePuzzle, type RangeState,
} from "./logic";

type RangeTechnique = Technique<RangePuzzle, RangeState, RangeAction>;

const readings = new WeakMap<RangeState, Reading>();

/** Blacks and dots on the board. */
function read(p: RangePuzzle, s: RangeState): Reading {
  let r = readings.get(s);
  if (!r) readings.set(s, r = { model: model(p), k: readMarks(p, s) });
  return r;
}

const changes = (p: RangePuzzle, s: RangeState, d: Deduction): number[] => d.vars.filter((c) => p.nums[c] === 0 && s.marks[c] === NONE);

function step(p: RangePuzzle, d: Deduction, vars: number[], why: string, nudge: string, nudgeFocus: Focus) {
  const black = d.keep === bit(SHADED);
  const one = vars.length === 1;
  return {
    message: `${why}, so ${cellList(p, vars)} ${black ? (one ? "is black" : "are black") : (one ? "stays white" : "stay white")}`,
    nudge,
    focus: { cells: vars, because: d.because, related: d.related ?? [] } satisfies Focus,
    nudgeFocus,
    actions: [{ type: "set" as const, cells: vars, value: (black ? BLACK : DOT) as Mark }],
  };
}

const num = (p: RangePuzzle, q: number) => `the ${p.nums[q]} on ${cellName(p, q)}`;
const base = { puzzle: range, read, changes };
const EASY = { width: 9, height: 6, difficulty: "easy" };

export const blackNeighbour: RangeTechnique = technique<RangePuzzle, RangeState, RangeAction>({
  ...base,
  id: "range.black-neighbour",
  name: "next to a black",
  level: 1,
  kinds: ["black-neighbour"],
  description: "blacks can't touch side by side, so every cell next to a black stays white.",
  explain: (p, _s, d, vars) => step(p, d, vars, `${cellName(p, d.because[0]!)} is black and blacks can't touch`, `look around the black on ${cellName(p, d.because[0]!)}`, { cells: [], because: d.because }),
  practice: { params: EASY },
});

export const closed: RangeTechnique = technique<RangePuzzle, RangeState, RangeAction>({
  ...base,
  id: "range.closed",
  name: "number satisfied",
  level: 2,
  kinds: ["clue-closed"],
  description: "a number that already sees exactly its count of white cells must see no more: the next cell along each line from it is black.",
  explain: (p, _s, d, vars) => step(p, d, vars, `${num(p, d.because[0]!)} already sees ${p.nums[d.because[0]!]} cells`, `count what ${num(p, d.because[0]!)} sees`, { cells: [], because: d.because }),
  practice: { params: EASY },
});

export const reach: RangeTechnique = technique<RangePuzzle, RangeState, RangeAction>({
  ...base,
  id: "range.reach",
  name: "must see this far",
  level: 3,
  kinds: ["clue-reach"],
  description: "if the other three directions together can't give a number all the cells it needs, the rest must come from this direction: that many cells along it stay white.",
  explain: (p, _s, d, vars) => step(p, d, vars, `${num(p, d.because[0]!)} can't see enough cells in the other directions`, `how far can ${num(p, d.because[0]!)} see in each direction?`, { cells: [], because: d.because }),
  practice: { params: EASY },
});

export const overflow: RangeTechnique = technique<RangePuzzle, RangeState, RangeAction>({
  ...base,
  id: "range.overflow",
  name: "would see too many",
  level: 4,
  kinds: ["clue-overflow"],
  description: "if leaving a cell white would let a number see past it into a run of white cells and go over its count, that cell is black.",
  explain: (p, _s, d, vars) => step(p, d, vars, `leaving ${cellName(p, vars[0]!)} white would let ${num(p, d.because[0]!)} see more than ${p.nums[d.because[0]!]} cells`,
    `what would ${num(p, d.because[0]!)} see past its white cells?`, { cells: [], because: d.because }),
  practice: { params: EASY },
});

export const split: RangeTechnique = technique<RangePuzzle, RangeState, RangeAction>({
  ...base,
  id: "range.split",
  name: "would cut the white area",
  level: 5,
  kinds: ["split"],
  description: "a cell whose blackening would cut the cells that aren't black into two separate pieces stays white, because the whites must stay connected.",
  explain: (p, _s, d, vars) => step(p, d, vars, `blacking out ${cellName(p, vars[0]!)} would cut the white area in two`, `which cell holds the white area together?`, { cells: [], because: [] }),
  practice: { params: { width: 9, height: 6, difficulty: "normal" } },
});

export const trial: RangeTechnique = technique<RangePuzzle, RangeState, RangeAction>({
  ...base,
  id: "range.trial",
  name: "try it both ways",
  level: 6,
  kinds: ["trial"],
  description: "pretend a cell is black (or stays white) and follow the other techniques from there. if that breaks a rule, the cell must be the other way.",
  explain(p, _s, d, vars) {
    const c = vars[0]!;
    const tried = (d.data as { value: number }).value === WHITE ? "stayed white" : "were black";
    return step(p, d, vars, `if ${cellName(p, c)} ${tried}, following the other techniques would break a rule`, `try ${cellName(p, c)} both ways`, { cells: [c], because: [] });
  },
  practice: { params: { width: 9, height: 6, difficulty: "hard" } },
});

export const rangeTechniques: RangeTechnique[] = [blackNeighbour, closed, reach, overflow, split, trial];
