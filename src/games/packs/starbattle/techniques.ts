import type { Technique } from "../../core/types";
import type { Deduction } from "../../lib/grid-kit/csp";
import { cellList, cellName, technique, type Focus, type Reading } from "../../lib/grid-kit/names";
import { B, BLACK, DOT, NONE, type Mark, type ShadeAction, type ShadeState } from "../../lib/shade-kit/state";
import { geometry, model, readMarks, starbattle, unitName, type StarBattlePuzzle } from "./logic";

type StarBattleTechnique = Technique<StarBattlePuzzle, ShadeState, ShadeAction>;

const readings = new WeakMap<ShadeState, Reading>();

/** Every mark on the board counts. */
function read(p: StarBattlePuzzle, s: ShadeState): Reading {
  let r = readings.get(s);
  if (!r) readings.set(s, r = { model: model(p), k: readMarks(p, s) });
  return r;
}

const changes = (_p: StarBattlePuzzle, s: ShadeState, d: Deduction): number[] => d.vars.filter((c) => s.marks[c] === NONE);

function step(p: StarBattlePuzzle, d: Deduction, vars: number[], why: string, nudge: string, nudgeFocus: Focus, related: number[] = d.related ?? []) {
  const star = d.keep === B;
  const one = vars.length === 1;
  return {
    message: `${why}, so ${cellList(p, vars)} ${star ? (one ? "has a star" : "have stars") : (one ? "has no star" : "have no stars")}`,
    nudge,
    focus: { cells: vars, because: d.because, related } satisfies Focus,
    nudgeFocus,
    actions: [{ type: "set" as const, cells: vars, value: (star ? BLACK : DOT) as Mark }],
  };
}

const unitOf = (p: StarBattlePuzzle, d: Deduction, key = "unit") => geometry(p).units[(d.data as Record<string, number>)[key]!]!;
const stars = (p: StarBattlePuzzle) => (p.k === 1 ? "its star" : `its ${p.k} stars`);

const base = { puzzle: starbattle, read, changes };
const EASY = { size: 7, stars: "1", difficulty: "easy" };
const NORMAL = { size: 8, stars: "1", difficulty: "normal" };
const HARD = { size: 8, stars: "1", difficulty: "hard" };

export const unitFull: StarBattleTechnique = technique<StarBattlePuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "starbattle.unit-full",
  name: "row, column or region full",
  level: 1,
  kinds: ["unit-full"],
  description: "a row, column or region that already has all its stars has no more: its other cells are empty.",
  explain: (p, _s, d, vars) => {
    const u = unitOf(p, d);
    return step(p, d, vars, `${unitName(p, u)} already has ${stars(p)}`, `count the stars in ${unitName(p, u)}`, { cells: [], because: [], related: u.cells }, u.cells);
  },
  practice: { params: EASY },
});

export const unitFill: StarBattleTechnique = technique<StarBattlePuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "starbattle.unit-fill",
  name: "every spot needed",
  level: 2,
  kinds: ["unit-fill"],
  description: "a row, column or region with exactly as many open cells as stars it still needs: every one of them has a star.",
  explain: (p, _s, d, vars) => {
    const u = unitOf(p, d);
    return step(p, d, vars, `${unitName(p, u)} needs every open cell it has left`, `how many open cells does ${unitName(p, u)} have left?`, { cells: [], because: [], related: u.cells }, u.cells);
  },
  practice: { params: EASY },
});

export const touch: StarBattleTechnique = technique<StarBattlePuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "starbattle.touch",
  name: "next to a star",
  level: 3,
  kinds: ["touch"],
  description: "stars never touch, not even at a corner, so the eight cells around a star are empty.",
  explain: (p, _s, d, vars) => step(p, d, vars, `the star on ${cellName(p, d.because[0]!)} can't touch another`, `look around the star on ${cellName(p, d.because[0]!)}`, { cells: [], because: d.because }),
  practice: { params: EASY },
});

export const confined: StarBattleTechnique = technique<StarBattlePuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "starbattle.confined",
  name: "stuck in one line",
  level: 4,
  kinds: ["confined"],
  description: "when every open cell of a region lies in one row or column, and both still need the same number of stars, those stars come from the region: the rest of that row or column is empty. it works the other way round too, for a row or column inside one region.",
  explain: (p, _s, d, vars) => {
    const a = unitOf(p, d), b = unitOf(p, d, "other");
    return step(p, d, vars, `the stars ${unitName(p, a)} still needs all lie in ${unitName(p, b)}, which needs just as many`, `where can the stars of ${unitName(p, a)} go?`, { cells: [], because: d.because, related: a.cells }, [...a.cells, ...b.cells]);
  },
  practice: { params: NORMAL },
});

export const blocks: StarBattleTechnique = technique<StarBattlePuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "starbattle.blocks",
  name: "would block a region",
  level: 5,
  kinds: ["blocks"],
  description: "a star rules out the cells around it. if that would leave some row, column or region without room for its stars, the cell can't have one.",
  explain: (p, _s, d, vars) => {
    const u = unitOf(p, d);
    return step(p, d, vars, `a star on ${cellName(p, vars[0]!)} would leave ${unitName(p, u)} without room for ${stars(p)}`, `what would a star on ${cellName(p, vars[0]!)} rule out?`, { cells: [vars[0]!], because: [], related: u.cells }, u.cells);
  },
  practice: { params: NORMAL },
});

export const trial: StarBattleTechnique = technique<StarBattlePuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "starbattle.trial",
  name: "try it both ways",
  level: 9,
  kinds: ["trial"],
  description: "pretend a cell has a star (or doesn't) and follow the other techniques from there. if that breaks a rule, the cell must be the other way.",
  explain(p, _s, d, vars) {
    const c = vars[0]!;
    const tried = (d.data as { value: number }).value === 1 ? "had a star" : "had no star";
    return step(p, d, vars, `if ${cellName(p, c)} ${tried}, following the other techniques would break a rule`, `try ${cellName(p, c)} both ways`, { cells: [c], because: [] });
  },
  practice: { params: HARD },
});

export const starbattleTechniques: StarBattleTechnique[] = [unitFull, unitFill, touch, confined, blocks, trial];
