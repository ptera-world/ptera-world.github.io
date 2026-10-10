import type { Technique } from "../../core/types";
import { valueOf, type Deduction } from "../../lib/grid-kit/csp";
import { cellName, technique, type Focus, type Reading } from "../../lib/grid-kit/names";
import {
  slant, BACK, NONE, markOf, model, pointCell, pointName, readMarks,
  type SlantAction, type SlantPuzzle, type SlantState,
} from "./logic";

type SlantTechnique = Technique<SlantPuzzle, SlantState, SlantAction>;

const readings = new WeakMap<SlantState, Reading>();

/** Every line on the board counts. */
function read(p: SlantPuzzle, s: SlantState): Reading {
  let r = readings.get(s);
  if (!r) readings.set(s, r = { model: model(p), k: readMarks(p, s) });
  return r;
}

const changes = (_p: SlantPuzzle, s: SlantState, d: Deduction): number[] => d.vars.filter((c) => s.marks[c] === NONE);
const glyph = (v: number) => (v === BACK ? "\\" : "/");

function step(p: SlantPuzzle, d: Deduction, vars: number[], why: string, nudge: string, nudgeFocus: Focus, extra: Partial<Focus> = {}) {
  const v = valueOf(d.keep);
  return {
    message: `${why}, so ${vars.map((c) => cellName(p, c)).join(" and ")} ${vars.length === 1 ? "takes" : "take"} ${glyph(v)}`,
    nudge,
    focus: { cells: vars, because: extra.because ?? [], related: extra.related ?? [], ...(extra.points ? { points: extra.points } : {}) } satisfies Focus,
    nudgeFocus,
    actions: [{ type: "set" as const, cells: vars, value: markOf(v) }],
  };
}

/** Deductions from a point's number are aimed at the cells around it. */
const aim = (p: SlantPuzzle, d: Deduction, vars: number[], target: unknown) =>
  typeof target === "number" && (vars.includes(target) || d.because.some((pt) => pointCell(p, pt) === target));

const base = { puzzle: slant, read, changes, aim };
const at = (p: SlantPuzzle, d: Deduction) => ({ because: [pointCell(p, d.because[0]!)], points: [d.because[0]!] });

export const full: SlantTechnique = technique<SlantPuzzle, SlantState, SlantAction>({
  ...base,
  id: "slant.full",
  name: "number complete",
  level: 1,
  kinds: ["clue-full"],
  description: "a number that already has that many lines touching its point gets no more: every other cell around the point slants away from it. a 0 is complete from the start.",
  explain(p, _s, d, vars) {
    const pt = d.because[0]!;
    return step(p, d, vars, `the ${p.clues[pt]} at ${pointName(p, pt)} already has its lines`, `look at the ${p.clues[pt]} at ${pointName(p, pt)}`, { cells: [], ...at(p, d) }, at(p, d));
  },
  practice: { params: { width: 6, height: 6, difficulty: "easy" } },
});

export const all: SlantTechnique = technique<SlantPuzzle, SlantState, SlantAction>({
  ...base,
  id: "slant.all",
  name: "needs every line",
  level: 2,
  kinds: ["clue-all"],
  description: "a number that needs a line from every cell around its point still undecided: they all slant into the point. a 4 always does, and so does a 2 on the edge or a 1 in a corner.",
  explain(p, _s, d, vars) {
    const pt = d.because[0]!;
    return step(p, d, vars, `the ${p.clues[pt]} at ${pointName(p, pt)} needs a line from every cell it has left`, `look at the ${p.clues[pt]} at ${pointName(p, pt)}`, { cells: [], ...at(p, d) }, at(p, d));
  },
  practice: { params: { width: 6, height: 6, difficulty: "easy" } },
});

export const loop: SlantTechnique = technique<SlantPuzzle, SlantState, SlantAction>({
  ...base,
  id: "slant.loop",
  name: "would close a loop",
  level: 3,
  kinds: ["loop"],
  description: "if the two corners one diagonal of a cell would join are already joined by other lines, that diagonal would close a loop: the cell takes the other one.",
  explain(p, _s, d, vars) {
    const c = vars[0]!;
    const tried = glyph((d.data as { value: number }).value);
    return step(p, d, vars, `a ${tried} in ${cellName(p, c)} would join two corners that are already joined, closing a loop`, `would a line in ${cellName(p, c)} close a loop?`, { cells: [c], because: [] });
  },
  practice: { params: { width: 8, height: 8, difficulty: "easy" } },
});

export const trial: SlantTechnique = technique<SlantPuzzle, SlantState, SlantAction>({
  ...base,
  id: "slant.trial",
  name: "try it both ways",
  level: 4,
  kinds: ["trial"],
  description: "pretend a cell slants one way and follow the other techniques from there. if that breaks a number or closes a loop, the cell must slant the other way.",
  explain(p, _s, d, vars) {
    const c = vars[0]!;
    const tried = glyph((d.data as { value: number }).value);
    return step(p, d, vars, `if ${cellName(p, c)} took ${tried}, following the other techniques would break a rule`, `try ${cellName(p, c)} both ways`, { cells: [c], because: [] });
  },
  practice: { params: { width: 8, height: 8, difficulty: "hard" } },
});

export const slantTechniques: SlantTechnique[] = [full, all, loop, trial];
