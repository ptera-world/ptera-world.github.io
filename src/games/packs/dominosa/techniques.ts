import type { Step, Technique } from "../../core/types";
import { geometry } from "./grid";
import {
  dominosa, DOMINO, LINE, NONE, cellList, cellName, coveredBy, dominoName, placementList, placementName,
  type DominosaAction, type DominosaFocus, type DominosaPuzzle, type DominosaState,
} from "./logic";
import { NO, YES, assign, freshKnowledge, scanSteps, type Knowledge, type Step as SolverStep, type StepKind } from "./solver";

type DominosaTechnique = Technique<DominosaPuzzle, DominosaState, DominosaAction>;

/** What a technique can be aimed at: a cell, or the edge between two cells. */
export type DominosaTarget = { cell: number } | { placement: number };

const knowledgeCache = new WeakMap<DominosaState, Knowledge | null>();

/**
 * Dominoes and lines on the board, each read as a fact. Null when the marks contradict.
 */
export function knowledge(p: DominosaPuzzle, s: DominosaState): Knowledge | null {
  if (knowledgeCache.has(s)) return knowledgeCache.get(s)!;
  const g = geometry(p);
  let k: Knowledge | null = freshKnowledge(g);
  for (let q = 0; q < g.np && k; q++) {
    if (s.marks[q] === DOMINO && !assign(g, k, q, YES)) k = null;
  }
  for (let q = 0; q < g.np && k; q++) {
    if (s.marks[q] === LINE && !assign(g, k, q, NO)) k = null;
  }
  knowledgeCache.set(s, k);
  return k;
}

/** Placements of a step that would change the board: unmarked, with neither cell under a domino. */
function effective(p: DominosaPuzzle, s: DominosaState, st: SolverStep): number[] {
  const g = geometry(p);
  return st.placements.filter((q) => s.marks[q] === NONE && coveredBy(p, s.marks, g.pa[q]!) < 0 && coveredBy(p, s.marks, g.pb[q]!) < 0);
}

/** Kinds whose every step tests one placement on its own. */
const perPlacementKinds: readonly StepKind[] = ["parity", "probe"];

/**
 * True if a step whose board changes are `placements` is at `target`: at a placement, it changes
 * it; at a cell, it reasons from the cell or changes a placement covering it, except that a step
 * testing one placement is never at a cell.
 */
function touches(p: DominosaPuzzle, st: SolverStep, placements: readonly number[], target: DominosaTarget): boolean {
  const g = geometry(p);
  if ("placement" in target) return placements.includes(target.placement);
  if (perPlacementKinds.includes(st.kind)) return false;
  return st.because.includes(target.cell) || st.placements.some((q) => g.pa[q] === target.cell || g.pb[q] === target.cell);
}

type Hit = { raw: SolverStep; placements: number[] };

function each(p: DominosaPuzzle, s: DominosaState, kinds: readonly StepKind[], visit: (hit: Hit) => boolean | void, target?: DominosaTarget): void {
  const k = knowledge(p, s);
  if (!k) return;
  scanSteps(geometry(p), k, kinds, (raw) => {
    const placements = effective(p, s, raw);
    if (!placements.length || (target && !touches(p, raw, placements, target))) return false;
    return visit({ raw, placements }) === true;
  });
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

type Make = (p: DominosaPuzzle, hit: Hit) => Step<DominosaAction>;

/** True if the hit changes what `target` points at: that placement, or a placement covering that cell. */
function changes(p: DominosaPuzzle, hit: Hit, target: DominosaTarget): boolean {
  const g = geometry(p);
  if ("placement" in target) return hit.placements.includes(target.placement);
  return hit.placements.some((q) => g.pa[q] === target.cell || g.pb[q] === target.cell);
}

const asTarget = (t: unknown): DominosaTarget | null =>
  t && typeof t === "object" && (typeof (t as { placement?: unknown }).placement === "number" || typeof (t as { cell?: unknown }).cell === "number") ? t as DominosaTarget : null;

/** Hits at `target`, those changing what it points at first, each group in scan order. */
function hitsAt(p: DominosaPuzzle, s: DominosaState, kinds: readonly StepKind[], target: DominosaTarget): Hit[] {
  const first: Hit[] = [], later: Hit[] = [];
  each(p, s, kinds, (hit) => { (changes(p, hit, target) ? first : later).push(hit); }, target);
  return [...first, ...later];
}

function technique(def: Omit<DominosaTechnique, "instances" | "findAt" | "instancesAt" | "cellAt" | "puzzles">, kinds: readonly StepKind[], make: Make): DominosaTechnique {
  return {
    ...def,
    puzzles: [dominosa],
    instances: (p, s, visit) => each(p, s, kinds, (hit) => visit(make(p, hit)) === true),
    findAt: (p, s, t) => {
      const target = asTarget(t);
      const hit = target && hitsAt(p, s, kinds, target)[0];
      return hit ? make(p, hit) : null;
    },
    instancesAt: (p, s, t, visit) => {
      const target = asTarget(t);
      if (target) for (const hit of hitsAt(p, s, kinds, target)) if (visit(make(p, hit)) === true) return;
    },
    cellAt: (p, s, t) => {
      const target = asTarget(t);
      const hit = target && hitsAt(p, s, kinds, target)[0];
      if (!hit || !target) return null;
      if ("placement" in target) return make(p, hit);
      const g = geometry(p);
      const placements = hit.placements.filter((q) => g.pa[q] === target.cell || g.pb[q] === target.cell);
      return placements.length ? make(p, { ...hit, placements }) : null;
    },
  };
}

export const onlyPlace = technique({
  id: "dominosa.only-place",
  name: "only place for a domino",
  level: 1,
  description: "a domino that has just one pair of neighboring cells left showing its two numbers goes there.",
  practice: { params: EASY },
}, ["domino-one"], (p, hit) => {
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
}, ["cell-one"], (p, hit) => {
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
}, ["cell-domino"], (p, hit) => {
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
}, ["overlap"], (p, hit) => {
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
}, ["parity"], (p, hit) => {
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
}, ["probe"], (p, hit) => {
  const q = hit.placements[0]!;
  return step(hit.raw, hit.placements,
    `if ${placementName(p, q)} were a domino, following only place for a domino and only one partner from there would leave something with nowhere to go, so ${outcome(p, hit.placements, NO)}`,
    `try a domino on ${placementName(p, q)}`, { placements: [q], because: [] }, cellsOf(p, [q]));
});

export const dominosaTechniques: DominosaTechnique[] = [onlyPlace, onlyNeighbour, oneDomino, sharedCell, oddArea, trial];
