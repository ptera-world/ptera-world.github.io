import type { Technique } from "../../core/types";
import { bit, type Deduction } from "../../lib/grid-kit/csp";
import { cellList, cellName, technique, type Focus, type Reading } from "../../lib/grid-kit/names";
import {
  mosaic, BLACK, DOT, NONE, SHADED, WHITE, model, readMarks,
  type Mark, type MosaicAction, type MosaicPuzzle, type MosaicState,
} from "./logic";

type MosaicTechnique = Technique<MosaicPuzzle, MosaicState, MosaicAction>;

const readings = new WeakMap<MosaicState, Reading>();

/** Blacks and dots on the board. */
function read(p: MosaicPuzzle, s: MosaicState): Reading {
  let r = readings.get(s);
  if (!r) readings.set(s, r = { model: model(p), k: readMarks(p, s) });
  return r;
}

const changes = (_p: MosaicPuzzle, s: MosaicState, d: Deduction): number[] => d.vars.filter((c) => s.marks[c] === NONE);

function step(p: MosaicPuzzle, d: Deduction, vars: number[], why: string, nudge: string, nudgeFocus: Focus) {
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

const num = (p: MosaicPuzzle, q: number) => `the ${p.clues[q]} on ${cellName(p, q)}`;
const base = { puzzle: mosaic, read, changes };

export const done: MosaicTechnique = technique<MosaicPuzzle, MosaicState, MosaicAction>({
  ...base,
  id: "mosaic.done",
  name: "number complete",
  level: 1,
  kinds: ["clue-done"],
  description: "a number whose block already has that many blacks gets no more: the rest of its block stays white. a 0 is complete from the start.",
  explain: (p, _s, d, vars) => step(p, d, vars, `${num(p, d.because[0]!)} already has ${p.clues[d.because[0]!]} black${p.clues[d.because[0]!] === 1 ? "" : "s"} around it`, `look at ${num(p, d.because[0]!)}`, { cells: [], because: d.because }),
  practice: { params: { width: 8, height: 8, difficulty: "easy" } },
});

export const full: MosaicTechnique = technique<MosaicPuzzle, MosaicState, MosaicAction>({
  ...base,
  id: "mosaic.full",
  name: "needs every cell",
  level: 2,
  kinds: ["clue-full"],
  description: "a number that needs every cell left undecided in its block to reach its count: all of them are black. a 9 always is, and so is a 4 in a corner.",
  explain: (p, _s, d, vars) => step(p, d, vars, `${num(p, d.because[0]!)} needs all the cells it has left`, `look at ${num(p, d.because[0]!)}`, { cells: [], because: d.because }),
  practice: { params: { width: 8, height: 8, difficulty: "easy" } },
});

export const pair: MosaicTechnique = technique<MosaicPuzzle, MosaicState, MosaicAction>({
  ...base,
  id: "mosaic.pair",
  name: "two numbers together",
  level: 3,
  kinds: ["pair"],
  description: "two numbers whose blocks overlap share some cells. counting how many blacks the shared cells can and must hold (from both numbers) can settle the cells only one of them sees, or the shared ones.",
  explain(p, _s, d, vars) {
    const [a, b] = d.because as [number, number];
    return step(p, d, vars, `comparing ${num(p, a)} with ${num(p, b)}, the cells their blocks share hold just enough blacks to settle it`, `compare ${num(p, a)} with ${num(p, b)}`, { cells: [], because: [a, b] });
  },
  practice: { params: { width: 8, height: 8, difficulty: "medium" } },
});

export const trial: MosaicTechnique = technique<MosaicPuzzle, MosaicState, MosaicAction>({
  ...base,
  id: "mosaic.trial",
  name: "try it both ways",
  level: 4,
  kinds: ["trial"],
  description: "pretend a cell is black (or stays white) and follow the other techniques from there. if that breaks a number, the cell must be the other way.",
  explain(p, _s, d, vars) {
    const c = vars[0]!;
    const tried = (d.data as { value: number }).value === WHITE ? "stayed white" : "were black";
    return step(p, d, vars, `if ${cellName(p, c)} ${tried}, following the other techniques would break a number`, `try ${cellName(p, c)} both ways`, { cells: [c], because: [] });
  },
  practice: { params: { width: 8, height: 8, difficulty: "hard" } },
});

export const mosaicTechniques: MosaicTechnique[] = [done, full, pair, trial];
