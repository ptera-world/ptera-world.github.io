import type { Step, Technique } from "../../core/types";
import { ALL, GHOST, VAMPIRE, ZOMBIE, bit, geometry } from "./grid";
import {
  undead, MONSTER_NAMES, MONSTER_PLURALS, cellList, cellName, clueName, monstersText,
  type UndeadAction, type UndeadFocus, type UndeadPuzzle, type UndeadState,
} from "./logic";
import { analyze, freshKnowledge, scanSteps, type Knowledge, type Step as SolverStep, type StepKind } from "./solver";

type UndeadTechnique = Technique<UndeadPuzzle, UndeadState, UndeadAction>;

/** What a technique can be aimed at: a cell, or an edge clue. */
export type UndeadTarget = { cell: number } | { clue: number };

const knowledgeCache = new WeakMap<UndeadState, Knowledge>();

/**
 * Candidates per cell from the board: a placed monster or pencil marks count only when they
 * agree with the unique solution (all of them when there isn't one); anything else is unknown.
 */
export function knowledge(p: UndeadPuzzle, s: UndeadState): Knowledge {
  const hit = knowledgeCache.get(s);
  if (hit) return hit;
  const a = analyze(p);
  const sol = a.count === 1 ? a.solution : null;
  const k = freshKnowledge(p);
  for (const c of geometry(p).empties) {
    if (p.given[c]) continue;
    const m = s.monsters[c]!;
    if (m && (!sol || sol[c] === m)) k[c] = bit(m);
    else if (!m && s.marks[c] && (!sol || s.marks[c]! & bit(sol[c]!))) k[c] = s.marks[c]!;
  }
  knowledgeCache.set(s, k);
  return k;
}

const single = (mask: number): number => (mask === 1 ? GHOST : mask === 2 ? VAMPIRE : mask === 4 ? ZOMBIE : 0);

/** Board changes a solver step makes: cells left with one candidate get the monster, others get pencil marks. */
function changes(p: UndeadPuzzle, s: UndeadState, st: SolverStep): { cells: number[]; actions: UndeadAction[] } {
  const sets = new Map<number, number[]>(), marks = new Map<number, number[]>();
  const cells: number[] = [];
  st.cells.forEach((c, i) => {
    if (p.given[c] || s.monsters[c]) return;
    const shown = s.marks[c] || ALL;
    const next = shown & ~st.remove[i]!;
    if (next === shown || next === 0) return;
    cells.push(c);
    const m = single(next);
    const into = m ? sets : marks;
    const key = m || next;
    into.set(key, [...(into.get(key) ?? []), c]);
  });
  const actions: UndeadAction[] = [
    ...[...sets].map(([value, list]): UndeadAction => ({ type: "set", cells: list, value })),
    ...[...marks].map(([mask, list]): UndeadAction => ({ type: "marks", cells: list, marks: mask })),
  ];
  return { cells, actions };
}

function touches(st: SolverStep, target: UndeadTarget): boolean {
  if ("clue" in target) return st.clue === target.clue;
  return st.cells.includes(target.cell);
}

type Hit = { raw: SolverStep; cells: number[]; actions: UndeadAction[] };

function each(p: UndeadPuzzle, s: UndeadState, kinds: readonly StepKind[], visit: (hit: Hit) => boolean | void, target?: UndeadTarget): void {
  const k = knowledge(p, s);
  scanSteps(p, k, kinds, (raw) => {
    if (target && !touches(raw, target)) return false;
    const ch = changes(p, s, raw);
    return ch.cells.length > 0 && visit({ raw, ...ch }) === true;
  });
}

/** "C3 is a ghost, D4 can't be a vampire". */
function outcome(p: UndeadPuzzle, s: UndeadState, raw: SolverStep, cells: readonly number[]): string {
  return cells.map((c) => {
    const i = raw.cells.indexOf(c);
    const left = (s.marks[c] || ALL) & ~raw.remove[i]!;
    const m = single(left);
    return m ? `${cellName(p, c)} is a ${MONSTER_NAMES[m]}` : `${cellName(p, c)} can't be ${monstersText(raw.remove[i]! & (s.marks[c] || ALL))}`;
  }).join(", ");
}

type Make = (p: UndeadPuzzle, s: UndeadState, hit: Hit) => Step<UndeadAction>;

function technique(def: Omit<UndeadTechnique, "instances" | "findAt" | "puzzles">, kinds: readonly StepKind[], make: Make): UndeadTechnique {
  return {
    ...def,
    puzzles: [undead],
    instances: (p, s, visit) => each(p, s, kinds, (hit) => visit(make(p, s, hit)) === true),
    findAt: (p, s, t) => {
      let found: Step<UndeadAction> | null = null;
      each(p, s, kinds, (hit) => { found = make(p, s, hit); return true; }, t as UndeadTarget);
      return found;
    },
  };
}

const EASY = { width: 5, height: 5, difficulty: "easy" };
const MEDIUM = { width: 5, height: 5, difficulty: "medium" };
const HARD = { width: 5, height: 5, difficulty: "hard" };

export const totalsFull = technique({
  id: "undead.totals-full",
  name: "all of them placed",
  level: 1,
  description: "once every monster of one kind is on the board, no other cell can be that kind.",
  practice: { params: EASY },
}, ["count-full"], (p, s, hit) => {
  const m = hit.raw.monster!;
  const n = p.counts[m - 1]!;
  return {
    message: `all ${n} ${n === 1 ? MONSTER_NAMES[m] : MONSTER_PLURALS[m]} are already placed, so ${outcome(p, s, hit.raw, hit.cells)}`,
    nudge: `count the ${MONSTER_PLURALS[m]}`,
    focus: { cells: hit.cells, because: [], totals: [m] } satisfies UndeadFocus,
    nudgeFocus: { cells: [], because: [], totals: [m] } satisfies UndeadFocus,
    actions: hit.actions,
  };
});

export const totalsNeedAll = technique({
  id: "undead.totals-need-all",
  name: "every spot is needed",
  level: 2,
  description: "if a kind of monster has only as many cells left that could be it as there are still to place, every one of those cells is that monster.",
  practice: { params: EASY },
}, ["count-needs-all"], (p, s, hit) => {
  const m = hit.raw.monster!;
  return {
    message: `only ${cellList(p, hit.raw.cells)} can still hold the ${MONSTER_PLURALS[m]} that are left, so ${outcome(p, s, hit.raw, hit.cells)}`,
    nudge: `where can the remaining ${MONSTER_PLURALS[m]} go?`,
    focus: { cells: hit.cells, because: hit.raw.cells.filter((c) => !hit.cells.includes(c)), totals: [m] } satisfies UndeadFocus,
    nudgeFocus: { cells: [], because: [], totals: [m] } satisfies UndeadFocus,
    actions: hit.actions,
  };
});

export const sightLimits = technique({
  id: "undead.sight-limits",
  name: "too many or too few",
  level: 3,
  description: "add up the fewest and the most monsters a line of sight could still see. a monster that would push it past its number, or leave it short however the rest turn out, can't be there. a 0 sees no zombies at all, no vampires before the first mirror and no ghosts after it.",
  practice: { params: EASY },
}, ["bounds"], (p, s, hit) => {
  const i = hit.raw.clue!;
  return {
    message: `looking in from ${clueName(p, i)}, anything else would see too many or too few, so ${outcome(p, s, hit.raw, hit.cells)}`,
    nudge: `look along the sight line from ${clueName(p, i)}`,
    focus: { cells: hit.cells, because: [], clues: [i] } satisfies UndeadFocus,
    nudgeFocus: { cells: [], because: [], clues: [i] } satisfies UndeadFocus,
    actions: hit.actions,
  };
});

export const wholeLine = technique({
  id: "undead.whole-line",
  name: "every way to fill a line",
  level: 4,
  description: "work through every way to fill the open cells on one line of sight that gives its number, using only the monsters still left to place. a monster that turns up in none of them can't be there.",
  practice: { params: MEDIUM },
}, ["line"], (p, s, hit) => {
  const i = hit.raw.clue!;
  return {
    message: `of all the ways to fill the line from ${clueName(p, i)} with the monsters still left, none fits unless ${outcome(p, s, hit.raw, hit.cells)}`,
    nudge: `try every way to fill the line from ${clueName(p, i)}`,
    focus: { cells: hit.cells, because: [], clues: [i] } satisfies UndeadFocus,
    nudgeFocus: { cells: [], because: [], clues: [i] } satisfies UndeadFocus,
    actions: hit.actions,
  };
});

export const trial = technique({
  id: "undead.trial",
  name: "try it",
  level: 5,
  description: "pretend a cell holds a particular monster and follow the easier techniques from there. if that breaks a number or a total, the cell can't hold that monster.",
  practice: { params: HARD },
}, ["trial"], (p, s, hit) => {
  const c = hit.raw.cells[0]!;
  const m = hit.raw.monster!;
  return {
    message: `if ${cellName(p, c)} were a ${MONSTER_NAMES[m]}, the easier techniques would break a number or a total, so ${outcome(p, s, hit.raw, hit.cells)}`,
    nudge: `try a ${MONSTER_NAMES[m]} on ${cellName(p, c)}`,
    focus: { cells: hit.cells, because: [] } satisfies UndeadFocus,
    nudgeFocus: { cells: [c], because: [] } satisfies UndeadFocus,
    actions: hit.actions,
  };
});

export const undeadTechniques: UndeadTechnique[] = [totalsFull, totalsNeedAll, sightLimits, wholeLine, trial];
