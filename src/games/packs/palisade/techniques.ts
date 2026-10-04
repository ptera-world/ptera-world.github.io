import type { Step, Technique } from "../../core/types";
import { bit, type Deduction } from "../../lib/grid-kit/csp";
import { cellList, cellName, technique, type Focus, type Reading } from "../../lib/grid-kit/names";
import {
  GAP, LINE, NONE, OPEN, WALL, edgeCells, geometry, model, readMarks,
  type PalisadeAction, type PalisadePuzzle, type PalisadeState,
} from "./logic";

type PalisadeTechnique = Technique<PalisadePuzzle, PalisadeState, PalisadeAction>;

/** Focus with the edges a step draws or rubs out. */
export type PalisadeFocus = Focus & { edges?: number[] };

const readings = new WeakMap<PalisadeState, Reading>();

/** Walls and gaps that agree with the unique solution (all of them when there isn't one), so steps never build on a mistake. */
function read(p: PalisadePuzzle, s: PalisadeState): Reading {
  let r = readings.get(s);
  if (!r) readings.set(s, r = { model: model(p), k: readMarks(p, s) });
  return r;
}

const changes = (_p: PalisadePuzzle, s: PalisadeState, d: Deduction): number[] => d.vars.filter((e) => s.marks[e] === NONE);

function between(p: PalisadePuzzle, edges: readonly number[]): string {
  const g = geometry(p);
  const pairs = edges.slice(0, 2).map((e) => `${cellName(p, g.edges[e]![0])} and ${cellName(p, g.edges[e]![1])}`);
  return edges.length > 2 ? `${pairs.join(", ")} and ${edges.length - 2} more` : pairs.join(", and ");
}

function step(p: PalisadePuzzle, d: Deduction, vars: number[], why: string, nudge: string, nudgeFocus: Focus, extra: Partial<Focus> = {}): Step<PalisadeAction> {
  const wall = d.keep === bit(WALL);
  return {
    message: `${why}, so there ${vars.length === 1 ? "is" : "are"} ${wall ? (vars.length === 1 ? "a wall" : "walls") : "no wall"} between ${between(p, vars)}`,
    nudge,
    focus: { cells: edgeCells(p, vars), because: extra.because ?? d.because, related: extra.related ?? [], edges: vars } satisfies PalisadeFocus,
    nudgeFocus,
    actions: [{ type: "set", edges: vars, value: wall ? LINE : GAP }],
  };
}

/** Aimed at a cell: the step changes one of its sides, or comes from it. */
const aim = (p: PalisadePuzzle, d: Deduction, vars: number[], target: unknown) =>
  typeof target === "number" && (edgeCells(p, vars).includes(target) || d.because.includes(target));

const base = { puzzle: "palisade", read, changes, aim };
const NORMAL = { width: 6, height: 5, size: 5, difficulty: "normal" };

export const done: PalisadeTechnique = technique<PalisadePuzzle, PalisadeState, PalisadeAction>({
  ...base,
  id: "palisade.done",
  name: "number complete",
  level: 1,
  kinds: ["clue-done"],
  description: "a number that already has that many walls round its cell (the grid edge counts) gets no more: its other sides have no wall.",
  explain: (p, _s, d, vars) => step(p, d, vars, `the ${p.clues[d.because[0]!]} on ${cellName(p, d.because[0]!)} already has its walls`, `look at the ${p.clues[d.because[0]!]} on ${cellName(p, d.because[0]!)}`, { cells: [], because: d.because }),
  practice: { params: NORMAL },
});

export const full: PalisadeTechnique = technique<PalisadePuzzle, PalisadeState, PalisadeAction>({
  ...base,
  id: "palisade.full",
  name: "needs every wall",
  level: 2,
  kinds: ["clue-full"],
  description: "a number that needs a wall on every side it has left: they're all walls. a 4 is walled in completely, and a 3 on the edge has walls on both its other sides.",
  explain: (p, _s, d, vars) => step(p, d, vars, `the ${p.clues[d.because[0]!]} on ${cellName(p, d.because[0]!)} needs every side it has left`, `look at the ${p.clues[d.because[0]!]} on ${cellName(p, d.because[0]!)}`, { cells: [], because: d.because }),
  practice: { params: NORMAL },
});

export const regionFull: PalisadeTechnique = technique<PalisadePuzzle, PalisadeState, PalisadeAction>({
  ...base,
  id: "palisade.region-full",
  name: "region complete",
  level: 3,
  kinds: ["region-full"],
  description: "a region that already has its full number of cells can't grow: every open edge round it is a wall.",
  explain: (p, _s, d, vars) => step(p, d, vars, `the region through ${cellList(p, d.because)} is already full`, `which regions are already full?`, { cells: [], because: [] }),
  practice: { params: NORMAL },
});

export const joined: PalisadeTechnique = technique<PalisadePuzzle, PalisadeState, PalisadeAction>({
  ...base,
  id: "palisade.joined",
  name: "same region",
  level: 4,
  kinds: ["region-joined"],
  description: "two cells already joined into one region another way can't have a wall between them: every wall has to separate two regions.",
  explain: (p, _s, d, vars) => step(p, d, vars, `${cellList(p, d.because)} are already in the same region`, `which neighbors are already in the same region?`, { cells: [], because: [] }),
  practice: { params: NORMAL },
});

export const tooBig: PalisadeTechnique = technique<PalisadePuzzle, PalisadeState, PalisadeAction>({
  ...base,
  id: "palisade.too-big",
  name: "too big together",
  level: 5,
  kinds: ["region-merge"],
  description: "two pieces that together have more cells than a region can hold must stay apart: there's a wall between them.",
  explain(p, _s, d, vars) {
    const [a, b] = (d.data as { sizes: [number, number] }).sizes;
    return step(p, d, vars, `the pieces through ${cellList(p, d.because)} have ${a} and ${b} cells, more than ${p.k} together`, `which pieces would be too big together?`, { cells: [], because: [] });
  },
  practice: { params: NORMAL },
});

export const dangling: PalisadeTechnique = technique<PalisadePuzzle, PalisadeState, PalisadeAction>({
  ...base,
  id: "palisade.dangling",
  name: "walls don't stop",
  level: 6,
  kinds: ["dangling"],
  description: "a wall can't just end at a corner: where the other three edges round a corner are settled, the last one is a wall if exactly one of them is, and open otherwise.",
  explain: (p, _s, d, vars) => step(p, d, vars, `walls can't stop at a corner, and the other three edges at one end of this one are settled`, `look at the corners where walls meet`, { cells: [], because: [] }, { related: edgeCells(p, d.related ?? []) }),
  practice: { params: NORMAL },
});

export const exit: PalisadeTechnique = technique<PalisadePuzzle, PalisadeState, PalisadeAction>({
  ...base,
  id: "palisade.exit",
  name: "only way to grow",
  level: 7,
  kinds: ["region-exit"],
  description: "a piece that's too small to be a region on its own, and can only grow into one neighboring piece, joins it: no walls between them.",
  explain: (p, _s, d, vars) => step(p, d, vars, `the piece through ${cellList(p, d.because)} has ${(d.data as { size: number }).size} of ${p.k} cells and only one piece to grow into`, `which piece has only one way to grow?`, { cells: [], because: [] }),
  practice: { params: NORMAL },
});

export const trial: PalisadeTechnique = technique<PalisadePuzzle, PalisadeState, PalisadeAction>({
  ...base,
  id: "palisade.trial",
  name: "try it both ways",
  level: 8,
  kinds: ["trial"],
  description: "pretend an edge is a wall (or open) and follow the other techniques from there. if that breaks a rule, the edge must be the other way.",
  explain(p, _s, d, vars) {
    const tried = (d.data as { value: number }).value === OPEN ? "open" : "a wall";
    const cells = edgeCells(p, vars);
    return step(p, d, vars, `if the edge between ${cellList(p, cells)} were ${tried}, following the other techniques would break a rule`, `try the edge between ${cellList(p, cells)} both ways`, { cells, because: [] });
  },
  practice: { params: { width: 8, height: 6, size: 6, difficulty: "hard" } },
});

export const palisadeTechniques: PalisadeTechnique[] = [done, full, regionFull, joined, tooBig, dangling, exit, trial];
