import type { Step, Technique } from "../../core/types";
import { bit, isSingle, valueOf, type Deduction } from "../../lib/grid-kit/csp";
import { cellList, cellName, technique, type Focus, type Reading } from "../../lib/grid-kit/names";
import {
  filling, analyze, model, readMasks,
  type FillingAction, type FillingPuzzle, type FillingState,
} from "./logic";

type FillingTechnique = Technique<FillingPuzzle, FillingState, FillingAction>;

const readings = new WeakMap<FillingState, Reading>();

/** Givens plus board numbers and notes that agree with the unique solution (all of them when there isn't one). */
function read(p: FillingPuzzle, s: FillingState): Reading {
  let r = readings.get(s);
  if (!r) readings.set(s, r = { model: model(p), k: readMasks(p, s) });
  return r;
}

/** Cells whose board mask the deduction narrows; masks that rule out the solution are left alone. */
function changes(p: FillingPuzzle, s: FillingState, d: Deduction): number[] {
  const a = analyze(p);
  const sol = a.count === 1 ? a.solution : null;
  return d.vars.filter((c) => {
    if (p.clues[c]! > 0) return false;
    const m = s.doms[c]!;
    if (sol && !(m & bit(sol[c]!))) return false;
    const next = m & d.keep;
    return next !== 0 && next !== m;
  });
}

function step(p: FillingPuzzle, s: FillingState, d: Deduction, vars: number[], why: string, nudge: string, nudgeFocus: Focus): Step<FillingAction> {
  const v = (d.data as { value: number }).value;
  const placed = vars.filter((c) => isSingle(s.doms[c]! & d.keep));
  const rest = vars.filter((c) => !placed.includes(c));
  const parts = [
    ...placed.slice(0, 3).map((c) => `${cellName(p, c)} is ${valueOf(s.doms[c]! & d.keep)}`),
    ...(rest.length ? [`${cellList(p, rest)} can't be ${v}`] : []),
  ];
  return {
    message: `${why}, so ${parts.join(", and ")}`,
    nudge,
    focus: { cells: vars, because: d.because, related: d.related ?? [] } satisfies Focus,
    nudgeFocus,
    actions: [{ type: "narrow", cells: vars, keep: d.keep }],
  };
}

const valueOfDeduction = (d: Deduction) => (d.data as { value: number }).value;
const base = { puzzle: filling, read, changes };
const EASY = { width: 7, height: 6, difficulty: "easy" };

export const complete: FillingTechnique = technique<FillingPuzzle, FillingState, FillingAction>({
  ...base,
  id: "filling.complete",
  name: "region complete",
  level: 1,
  kinds: ["complete"],
  description: "a group of n joined n's is a whole region: no cell touching it can be another n, or the region would grow too big.",
  explain(p, s, d, vars) {
    const v = valueOfDeduction(d);
    return step(p, s, d, vars, `the ${v}s on ${cellList(p, d.because)} already make a whole region`, `which regions are already complete?`, { cells: [], because: d.because });
  },
  practice: { params: EASY },
});

export const onlyExit: FillingTechnique = technique<FillingPuzzle, FillingState, FillingAction>({
  ...base,
  id: "filling.only-exit",
  name: "only way out",
  level: 2,
  kinds: ["only-exit"],
  description: "a group of n's that's still too small has to grow. if only one cell next to it could take an n, that cell is an n.",
  explain(p, s, d, vars) {
    const v = valueOfDeduction(d);
    return step(p, s, d, vars, `the ${v}s on ${cellList(p, d.because)} need more cells and ${cellName(p, vars[0]!)} is their only way to grow`, `which group of numbers can only grow one way?`, { cells: [], because: d.because });
  },
  practice: { params: EASY },
});

export const tooBig: FillingTechnique = technique<FillingPuzzle, FillingState, FillingAction>({
  ...base,
  id: "filling.too-big",
  name: "too big together",
  level: 3,
  kinds: ["too-big"],
  description: "an n in a cell would join every group of n's next to it. if that makes more than n cells, the cell can't be n.",
  explain(p, s, d, vars) {
    const { value, size } = d.data as { value: number; size: number };
    return step(p, s, d, vars, `a ${value} on ${cellName(p, vars[0]!)} would join the ${value}s on ${cellList(p, d.because)} into ${size} cells`, `look at the numbers around ${cellName(p, vars[0]!)}`, { cells: [vars[0]!], because: [] });
  },
  practice: { params: EASY },
});

export const noRoom: FillingTechnique = technique<FillingPuzzle, FillingState, FillingAction>({
  ...base,
  id: "filling.no-room",
  name: "no room",
  level: 4,
  kinds: ["no-room"],
  description: "an n needs n joined cells that could all be n. if there aren't that many reachable from a cell, it can't be n.",
  explain(p, s, d, vars) {
    const v = valueOfDeduction(d);
    return step(p, s, d, vars, `there isn't room for a region of ${v} through ${cellName(p, vars[0]!)}`, `how big a region fits through ${cellName(p, vars[0]!)}?`, { cells: [vars[0]!], because: [] });
  },
  practice: { params: EASY },
});

export const critical: FillingTechnique = technique<FillingPuzzle, FillingState, FillingAction>({
  ...base,
  id: "filling.critical",
  name: "must pass through",
  level: 5,
  kinds: ["critical"],
  description: "a group of n's that's still too small, and can't reach n cells without going through one particular cell: that cell is an n.",
  explain(p, s, d, vars) {
    const v = valueOfDeduction(d);
    return step(p, s, d, vars, `the ${v}s on ${cellList(p, d.because)} can't reach ${v} cells without ${cellName(p, vars[0]!)}`, `where must the ${v}s on ${cellList(p, d.because)} grow?`, { cells: [], because: d.because });
  },
  practice: { params: { width: 7, height: 6, difficulty: "medium" } },
});

export const trial: FillingTechnique = technique<FillingPuzzle, FillingState, FillingAction>({
  ...base,
  id: "filling.trial",
  name: "try it both ways",
  level: 6,
  kinds: ["trial"],
  description: "pretend a cell holds a number and follow the other techniques from there. if that breaks a rule, it can't hold that number.",
  explain(p, s, d, vars) {
    const c = vars[0]!;
    const v = (d.data as { value: number }).value;
    const shaped = { ...d, data: { value: v } };
    return step(p, s, shaped, vars, `if ${cellName(p, c)} were ${v}, following the other techniques would break a rule`, `try numbers in ${cellName(p, c)}`, { cells: [c], because: [] });
  },
  practice: { params: { width: 7, height: 6, difficulty: "hard" } },
});

export const fillingTechniques: FillingTechnique[] = [complete, onlyExit, tooBig, noRoom, critical, trial];

