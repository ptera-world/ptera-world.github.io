import type { Technique } from "../../core/types";
import { bit, type Deduction } from "../../lib/grid-kit/csp";
import { cellList, cellName, technique, type Focus, type Reading } from "../../lib/grid-kit/names";
import {
  tents, GRASS, NONE, TENT, TREE, YES, lineName, model, readMarks,
  type Mark, type TentsAction, type TentsPuzzle, type TentsState,
} from "./logic";

type TentsTechnique = Technique<TentsPuzzle, TentsState, TentsAction>;

const readings = new WeakMap<TentsState, Reading>();

/** Tents and grass on the board. */
function read(p: TentsPuzzle, s: TentsState): Reading {
  let r = readings.get(s);
  if (!r) readings.set(s, r = { model: model(p), k: readMarks(p, s) });
  return r;
}

const changes = (p: TentsPuzzle, s: TentsState, d: Deduction): number[] => d.vars.filter((c) => p.cells[c] !== TREE && s.marks[c] === NONE);

const isTent = (d: Deduction) => d.keep === bit(YES);

function step(p: TentsPuzzle, d: Deduction, vars: number[], why: string, nudge: string, nudgeFocus: Focus, extra: Partial<Focus> = {}) {
  const tent = isTent(d);
  const one = vars.length === 1;
  return {
    message: `${why}, so ${cellList(p, vars)} ${tent ? (one ? "is a tent" : "are tents") : (one ? "has no tent" : "have no tents")}`,
    nudge,
    focus: { cells: vars, because: extra.because ?? d.because, related: extra.related ?? d.related ?? [] } satisfies Focus,
    nudgeFocus,
    actions: [{ type: "set" as const, cells: vars, value: (tent ? TENT : GRASS) as Mark }],
  };
}

const lineOf = (p: TentsPuzzle, d: Deduction) => lineName(p, (d.data as { line: number }).line);
const base = { puzzle: tents, read, changes };
const EASY = { width: 8, height: 8, difficulty: "easy" };
const TRICKY = { width: 8, height: 8, difficulty: "tricky" };

export const noTree: TentsTechnique = technique<TentsPuzzle, TentsState, TentsAction>({
  ...base,
  id: "tents.no-tree",
  name: "no tree nearby",
  level: 1,
  kinds: ["no-tree"],
  description: "a tent always sits right next to its tree, so a cell with no tree above, below, left or right of it can't hold one.",
  explain: (p, _s, d, vars) => step(p, d, vars, `${vars.length === 1 ? `${cellName(p, vars[0]!)} has` : `${cellList(p, vars)} have`} no tree beside ${vars.length === 1 ? "it" : "them"}`, `which cells have no tree beside them?`, { cells: [], because: [] }),
  practice: { params: EASY },
});

export const touch: TentsTechnique = technique<TentsPuzzle, TentsState, TentsAction>({
  ...base,
  id: "tents.touch",
  name: "next to a tent",
  level: 2,
  kinds: ["touch"],
  description: "tents never touch, not even at a corner, so the eight cells around a tent have no tents.",
  explain: (p, _s, d, vars) => step(p, d, vars, `the tent on ${cellName(p, d.because[0]!)} can't touch another`, `look around the tent on ${cellName(p, d.because[0]!)}`, { cells: [], because: d.because }),
  practice: { params: EASY },
});

export const countFull: TentsTechnique = technique<TentsPuzzle, TentsState, TentsAction>({
  ...base,
  id: "tents.count-full",
  name: "line full",
  level: 3,
  kinds: ["count-full"],
  description: "a row or column that already has as many tents as its number has no more: the rest of it is grass. a 0 is full from the start.",
  explain: (p, _s, d, vars) => step(p, d, vars, `${lineOf(p, d)} already has all its tents`, `count the tents in ${lineOf(p, d)}`, { cells: [], because: [], related: d.related }),
  practice: { params: EASY },
});

export const countAll: TentsTechnique = technique<TentsPuzzle, TentsState, TentsAction>({
  ...base,
  id: "tents.count-all",
  name: "every spot needed",
  level: 4,
  kinds: ["count-all"],
  description: "a row or column with exactly as many open cells as tents it still needs: every one of them is a tent.",
  explain: (p, _s, d, vars) => step(p, d, vars, `${lineOf(p, d)} needs a tent in every cell it has left`, `count the open cells in ${lineOf(p, d)}`, { cells: [], because: [], related: d.related }),
  practice: { params: EASY },
});

export const treeSpot: TentsTechnique = technique<TentsPuzzle, TentsState, TentsAction>({
  ...base,
  id: "tents.tree-spot",
  name: "only spot for a tree",
  level: 5,
  kinds: ["tree-spot"],
  description: "a tree with only one cell left beside it where a tent could go has its tent there.",
  explain: (p, _s, d, vars) => step(p, d, vars, `the tree on ${cellName(p, d.because[0]!)} has nowhere else for its tent`, `where can the tree on ${cellName(p, d.because[0]!)} have its tent?`, { cells: [], because: d.because }),
  practice: { params: EASY },
});

export const lineCombos: TentsTechnique = technique<TentsPuzzle, TentsState, TentsAction>({
  ...base,
  id: "tents.line-combos",
  name: "try out a line",
  level: 7,
  kinds: ["line-combos"],
  description: "list every way to put a row's (or column's) remaining tents in its open cells without two touching. a cell that's a tent in all of them is a tent; one that's empty in all of them has none; and a cell in the next row that touches a tent in all of them has none either.",
  explain: (p, _s, d, vars) => step(p, d, vars, `every way of placing ${lineOf(p, d)}'s remaining tents agrees on it`, `try the ways ${lineOf(p, d)}'s tents could go`, { cells: [], because: [], related: d.related }),
  practice: { params: TRICKY },
});

export const sharedTouch: TentsTechnique = technique<TentsPuzzle, TentsState, TentsAction>({
  ...base,
  id: "tents.shared-touch",
  name: "touches every spot",
  level: 6,
  kinds: ["shared-touch"],
  description: "a cell that touches every spot a tree could have its tent on will touch that tent whichever it is, so it can't hold one. the classic case: a tree with its only two spots round a corner.",
  explain: (p, _s, d, vars) => step(p, d, vars, `the tree on ${cellName(p, d.because[0]!)} has its tent on ${cellList(p, d.related ?? [])}, and ${cellList(p, vars)} touch${vars.length === 1 ? "es" : ""} all of them`,
    `where can the tree on ${cellName(p, d.because[0]!)} have its tent?`, { cells: [], because: d.because }),
  practice: { params: TRICKY },
});

export const matching: TentsTechnique = technique<TentsPuzzle, TentsState, TentsAction>({
  ...base,
  id: "tents.matching",
  name: "pairing trees and tents",
  level: 8,
  kinds: ["matching"],
  description: "every tree gets its own tent. if a tent here would leave some tree without a tent of its own (or there'd be no tree left for it), there's no tent here; if no pairing works without a tent here, there is one.",
  explain(p, _s, d, vars) {
    const tent = (d.data as { tent: boolean }).tent;
    const c = vars[0]!;
    const why = tent ? `without a tent on ${cellName(p, c)} the trees couldn't each have their own tent` : `a tent on ${cellName(p, c)} would leave the trees unable to each have their own tent`;
    return step(p, d, vars, why, `pair trees with tents around ${cellName(p, c)}`, { cells: [c], because: [] });
  },
  practice: { params: TRICKY },
});

export const trial: TentsTechnique = technique<TentsPuzzle, TentsState, TentsAction>({
  ...base,
  id: "tents.trial",
  name: "try it both ways",
  level: 9,
  kinds: ["trial"],
  description: "pretend a cell has a tent (or doesn't) and follow the other techniques from there. if that breaks a rule, the cell must be the other way.",
  explain(p, _s, d, vars) {
    const c = vars[0]!;
    const tried = (d.data as { value: number }).value === YES ? "had a tent" : "had no tent";
    return step(p, d, vars, `if ${cellName(p, c)} ${tried}, following the other techniques would break a rule`, `try ${cellName(p, c)} both ways`, { cells: [c], because: [] });
  },
  practice: { params: { width: 10, height: 10, difficulty: "hard" } },
});

export const tentsTechniques: TentsTechnique[] = [noTree, touch, countFull, countAll, treeSpot, sharedTouch, lineCombos, matching, trial];

