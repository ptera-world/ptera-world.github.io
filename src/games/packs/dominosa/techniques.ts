import type { Step, Technique } from "../../core/types";
import { geometry } from "./grid";
import {
  dominosa, DOMINO, LINE, NONE, cellList, cellName, coveredBy, dominoName, placementList, placementName,
  type DominosaAction, type DominosaFocus, type DominosaPuzzle, type DominosaState,
} from "./logic";
import { NO, YES, analyze, assign, freshKnowledge, scanSteps, type Knowledge, type Step as SolverStep, type StepKind } from "./solver";

type DominosaTechnique = Technique<DominosaPuzzle, DominosaState, DominosaAction>;

/** What a technique can be aimed at: a cell, or the edge between two cells. */
export type DominosaTarget = { cell: number } | { placement: number };

const knowledgeCache = new WeakMap<DominosaState, Knowledge | null>();

/**
 * Dominoes and lines on the board, each read as a fact only when it agrees with the unique
 * solution (every mark counts when there isn't one). Null when the counted marks contradict.
 */
export function knowledge(p: DominosaPuzzle, s: DominosaState): Knowledge | null {
  if (knowledgeCache.has(s)) return knowledgeCache.get(s)!;
  const g = geometry(p);
  const a = analyze(p);
  const sol = a.count === 1 ? a.solution : null;
  let k: Knowledge | null = freshKnowledge(g);
  for (let q = 0; q < g.np && k; q++) {
    if (s.marks[q] === DOMINO && (!sol || sol[q] === 1) && !assign(g, k, q, YES)) k = null;
  }
  for (let q = 0; q < g.np && k; q++) {
    if (s.marks[q] === LINE && (!sol || sol[q] === 0) && !assign(g, k, q, NO)) k = null;
  }
  knowledgeCache.set(s, k);
  return k;
}

/** Placements of a step that would change the board: unmarked, with neither cell under a domino. */
function effective(p: DominosaPuzzle, s: DominosaState, st: SolverStep): number[] {
  const g = geometry(p);
  return st.placements.filter((q) => s.marks[q] === NONE && coveredBy(p, s.marks, g.pa[q]!) < 0 && coveredBy(p, s.marks, g.pb[q]!) < 0);
}

function touches(p: DominosaPuzzle, st: SolverStep, target: DominosaTarget): boolean {
  const g = geometry(p);
  if ("placement" in target) return st.placements.includes(target.placement);
  return st.because.includes(target.cell) || st.placements.some((q) => g.pa[q] === target.cell || g.pb[q] === target.cell);
}

function first(p: DominosaPuzzle, s: DominosaState, kinds: readonly StepKind[], target?: DominosaTarget): { raw: SolverStep; placements: number[] } | null {
  const k = knowledge(p, s);
  if (!k) return null;
  let placements: number[] = [];
  const raw = scanSteps(geometry(p), k, kinds, (st) => (!target || touches(p, st, target)) && (placements = effective(p, s, st)).length > 0);
  return raw ? { raw, placements } : null;
}

function outcome(p: DominosaPuzzle, qs: readonly number[], value: number): string {
  const one = qs.length === 1;
  if (value === YES) return `${placementList(p, qs)} ${one ? "is a domino" : "are dominoes"}`;
  return `${placementList(p, qs)} ${one ? "isn't a domino" : "aren't dominoes"}`;
}

const cellsOf = (p: DominosaPuzzle, qs: readonly number[]) => {
  const g = geometry(p);
  return [...new Set(qs.flatMap((q) => [g.pa[q]!, g.pb[q]!]))];
};

function step(raw: SolverStep, placements: number[], message: string, nudge: string, nudgeFocus: DominosaFocus, because = raw.because): Step<DominosaAction> {
  return {
    message,
    nudge,
    focus: { placements, because } satisfies DominosaFocus,
    nudgeFocus,
    actions: [{ type: "set", placements, value: raw.value === YES ? DOMINO : LINE }],
  };
}

const EASY = { max: 5, difficulty: "easy" };
const MEDIUM = { max: 5, difficulty: "medium" };
const HARD = { max: 5, difficulty: "hard" };

type Finder = (p: DominosaPuzzle, s: DominosaState, target?: DominosaTarget) => Step<DominosaAction> | null;

function technique(def: Omit<DominosaTechnique, "find" | "findAt" | "puzzles">, find: Finder): DominosaTechnique {
  return {
    ...def,
    puzzles: [dominosa],
    find: (p, s) => find(p, s),
    findAt: (p, s, target) => find(p, s, target as DominosaTarget),
  };
}

export const onlyPlace = technique({
  id: "dominosa.only-place",
  name: "only place for a domino",
  level: 1,
  description: "a domino that has just one pair of neighboring cells left showing its two numbers goes there.",
  practice: { params: EASY },
}, (p, s, target) => {
  const hit = first(p, s, ["domino-one"], target);
  if (!hit) return null;
  const d = hit.raw.domino!;
  const q = hit.placements[0]!;
  return step(hit.raw, hit.placements,
    `the only place left for the ${dominoName(d)} domino is ${placementName(p, q)}, so it goes there`,
    `where can the ${dominoName(d)} domino go?`, { placements: [], because: [] }, cellsOf(p, [q]));
});

export const onlyNeighbour = technique({
  id: "dominosa.only-neighbour",
  name: "only one partner",
  level: 2,
  description: "a cell that can only pair with one of its neighbors (the others are taken, lined off, or would repeat a domino) is a domino with that neighbor.",
  practice: { params: EASY },
}, (p, s, target) => {
  const hit = first(p, s, ["cell-one"], target);
  if (!hit) return null;
  const x = hit.raw.because[0]!;
  const q = hit.placements[0]!;
  const g = geometry(p);
  const y = g.pa[q] === x ? g.pb[q]! : g.pa[q]!;
  return step(hit.raw, hit.placements,
    `${cellName(p, x)} can only pair with ${cellName(p, y)}, so ${outcome(p, hit.placements, YES)}`,
    `which neighbor can ${cellName(p, x)} still pair with?`, { placements: [], because: [x] }, [x, y]);
});

export const oneDomino = technique({
  id: "dominosa.one-domino",
  name: "every option is the same domino",
  level: 3,
  description: "if every way to cover a cell makes the same domino, that domino is used up there, so it can't go anywhere else.",
  practice: { params: MEDIUM },
}, (p, s, target) => {
  const hit = first(p, s, ["cell-domino"], target);
  if (!hit) return null;
  const x = hit.raw.because[0]!;
  const d = hit.raw.domino!;
  return step(hit.raw, hit.placements,
    `every way to cover ${cellName(p, x)} makes the ${dominoName(d)} domino, so it's used there and ${outcome(p, hit.placements, NO)}`,
    `what domino does ${cellName(p, x)} make?`, { placements: [], because: [x] });
});

export const sharedCell = technique({
  id: "dominosa.shared-cell",
  name: "every option overlaps",
  level: 4,
  description: "if every place a domino can still go overlaps some other pair of cells, that pair can't be a domino: placing it would leave nowhere for the first one.",
  practice: { params: MEDIUM },
}, (p, s, target) => {
  const hit = first(p, s, ["overlap"], target);
  if (!hit) return null;
  const d = hit.raw.domino!;
  return step(hit.raw, hit.placements,
    `every place the ${dominoName(d)} domino can still go overlaps ${placementList(p, hit.placements)}, so ${outcome(p, hit.placements, NO)}`,
    `where can the ${dominoName(d)} domino go?`, { placements: [], because: hit.raw.because });
});

export const oddArea = technique({
  id: "dominosa.odd-area",
  name: "odd area",
  level: 5,
  description: "dominoes cover cells two at a time, so a domino that would wall off an odd number of uncovered cells can't go there.",
  practice: { params: MEDIUM },
}, (p, s, target) => {
  const hit = first(p, s, ["parity"], target);
  if (!hit) return null;
  const q = hit.placements[0]!;
  const n = hit.raw.because.length;
  return step(hit.raw, hit.placements,
    `a domino on ${placementName(p, q)} would cut off ${cellList(p, hit.raw.because)}: ${n} cells, an odd number, so they couldn't all be covered. ${outcome(p, hit.placements, NO)}`,
    `look for a domino that would wall off an odd number of cells`, { placements: [], because: cellsOf(p, [q]) });
});

export const trial = technique({
  id: "dominosa.trial",
  name: "try it",
  level: 6,
  description: "pretend a domino goes somewhere and follow the first two techniques from there. if that leaves a domino or a cell with nowhere to go, it can't go there.",
  practice: { params: HARD },
}, (p, s, target) => {
  const hit = first(p, s, ["probe"], target);
  if (!hit) return null;
  const q = hit.placements[0]!;
  return step(hit.raw, hit.placements,
    `if ${placementName(p, q)} were a domino, following only place for a domino and only one partner from there would leave something with nowhere to go, so ${outcome(p, hit.placements, NO)}`,
    `try a domino on ${placementName(p, q)}`, { placements: [q], because: [] }, cellsOf(p, [q]));
});

export const dominosaTechniques: DominosaTechnique[] = [onlyPlace, onlyNeighbour, oneDomino, sharedCell, oddArea, trial];
