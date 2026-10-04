import type { Technique } from "../../core/types";
import { valueOf, type Deduction } from "./kit/csp";
import { cellList, cellName, technique, type Focus, type Reading } from "./kit/names";
import {
  NONE, colourWord, lineName, markOf, model, readMarks,
  type UnrulyAction, type UnrulyPuzzle, type UnrulyState,
} from "./logic";

type UnrulyTechnique = Technique<UnrulyPuzzle, UnrulyState, UnrulyAction>;

const readings = new WeakMap<UnrulyState, Reading>();

/**
 * Givens plus the player's pieces, each read as a fact only when it agrees with the unique
 * solution (every piece counts when there isn't one), so an auto-applied step never builds on a
 * mistake.
 */
function read(p: UnrulyPuzzle, s: UnrulyState): Reading {
  let r = readings.get(s);
  if (!r) readings.set(s, r = { model: model(p), k: readMarks(p, s) });
  return r;
}

const changes = (p: UnrulyPuzzle, s: UnrulyState, d: Deduction): number[] => d.vars.filter((c) => p.cells[c] === -1 && s.marks[c] === NONE);

function step(p: UnrulyPuzzle, d: Deduction, vars: number[], why: string, nudge: string, nudgeFocus: Focus, extra: { because?: number[]; related?: number[] } = {}) {
  const colour = valueOf(d.keep);
  return {
    message: `${why}, so ${cellList(p, vars)} ${vars.length === 1 ? "is" : "are"} ${colourWord(colour)}`,
    nudge,
    focus: { cells: vars, because: extra.because ?? d.because, related: extra.related ?? d.related ?? [] } satisfies Focus,
    nudgeFocus,
    actions: [{ type: "set" as const, cells: vars, value: markOf(colour) }],
  };
}

const lineOf = (d: Deduction) => (d.data as { line: number }).line;
const colourIn = (d: Deduction) => (d.data as { colour: number }).colour;

const base = { puzzle: "unruly", read, changes };

export const three: UnrulyTechnique = technique<UnrulyPuzzle, UnrulyState, UnrulyAction>({
  ...base,
  id: "unruly.three",
  name: "no three in a row",
  level: 1,
  kinds: ["three"],
  description: "two of a colour side by side, or with one gap between them, can't become three: the cell that would complete the run takes the other colour.",
  explain(p, _s, d, vars) {
    const [a, b] = d.because as [number, number];
    const c = colourWord(colourIn(d));
    return step(p, d, vars, `${cellName(p, a)} and ${cellName(p, b)} are both ${c} and three ${c} in a row isn't allowed`,
      `look at ${cellName(p, a)} and ${cellName(p, b)}`, { cells: [], because: [a, b] });
  },
  practice: { params: { width: 6, height: 6, difficulty: "trivial" } },
});

export const lastCell: UnrulyTechnique = technique<UnrulyPuzzle, UnrulyState, UnrulyAction>({
  ...base,
  id: "unruly.last-cell",
  name: "last empty cell",
  level: 2,
  kinds: ["last-cell"],
  description: "a row or column with one empty cell left already has its half of one colour, so the last cell takes the other.",
  explain(p, _s, d, vars) {
    const li = lineOf(d);
    return step(p, d, vars, `${lineName(p, li)} already has its half of ${colourWord(colourIn(d))}`, `${lineName(p, li)} has one empty cell left`, { cells: [], because: [] }, { related: geometryLine(p, li) });
  },
  practice: { params: { width: 6, height: 6, difficulty: "trivial" } },
});

export const countFull: UnrulyTechnique = technique<UnrulyPuzzle, UnrulyState, UnrulyAction>({
  ...base,
  id: "unruly.count-full",
  name: "half done",
  level: 3,
  kinds: ["count-full"],
  description: "a row or column that already has half its cells in one colour can't take any more of it: every empty cell in it takes the other colour.",
  explain(p, _s, d, vars) {
    const li = lineOf(d);
    return step(p, d, vars, `${lineName(p, li)} already has its half of ${colourWord(colourIn(d))}`, `count the colours in ${lineName(p, li)}`, { cells: [], because: [] }, { related: geometryLine(p, li) });
  },
  practice: { params: { width: 8, height: 8, difficulty: "easy" } },
});

export const unique: UnrulyTechnique = technique<UnrulyPuzzle, UnrulyState, UnrulyAction>({
  ...base,
  id: "unruly.unique",
  name: "no copies",
  level: 4,
  requires: ["unique-lines"],
  kinds: ["unique"],
  description: "with all lines different: a line that matches a finished line everywhere it's filled, and needs just one more of a colour, can't put it where the finished line has it, or the two would be the same.",
  explain(p, _s, d, vars) {
    return step(p, d, vars, `otherwise ${cellList(p, d.related ?? [])} would end up the same as the finished line through ${cellName(p, d.because[0]!)}`,
      `compare the line through ${cellName(p, vars[0]!)} with a finished one`, { cells: vars, because: [] });
  },
  practice: { params: { width: 8, height: 8, difficulty: "easy", unique: true } },
});

export const lastOne: UnrulyTechnique = technique<UnrulyPuzzle, UnrulyState, UnrulyAction>({
  ...base,
  id: "unruly.last-one",
  name: "where the last one goes",
  level: 5,
  kinds: ["last-one"],
  description: "a line that needs just one more of a colour, with three cells in a row that have none of it and two still empty: the last one has to go among those three (or they'd be three of the other colour), so every other empty cell in the line takes the other colour.",
  explain(p, _s, d, vars) {
    const li = lineOf(d);
    const c = colourWord(colourIn(d));
    return step(p, d, vars, `${lineName(p, li)} needs one more ${c}, and it has to go in ${cellList(p, d.related ?? [])} to stop three of the other colour in a row`,
      `${lineName(p, li)} needs just one more ${c}`, { cells: [], because: [] }, { related: d.related ?? [] });
  },
  practice: { params: { width: 8, height: 8, difficulty: "normal" } },
});

export const trial: UnrulyTechnique = technique<UnrulyPuzzle, UnrulyState, UnrulyAction>({
  ...base,
  id: "unruly.trial",
  name: "try it both ways",
  level: 6,
  kinds: ["trial"],
  description: "pretend a cell is one colour and follow the other techniques from there. if that breaks a rule, the cell must be the other colour.",
  explain(p, _s, d, vars) {
    const c = vars[0]!;
    const tried = colourWord((d.data as { value: number }).value);
    return step(p, d, vars, `if ${cellName(p, c)} were ${tried}, following the other techniques would break a rule`, `try ${cellName(p, c)} both ways`, { cells: [c], because: [] });
  },
  practice: { params: { width: 8, height: 8, difficulty: "hard" } },
});

function geometryLine(p: UnrulyPuzzle, li: number): number[] {
  return li < p.h ? Array.from({ length: p.w }, (_, x) => li * p.w + x) : Array.from({ length: p.h }, (_, y) => y * p.w + (li - p.h));
}

export const unrulyTechniques: UnrulyTechnique[] = [three, lastCell, countFull, unique, lastOne, trial];
