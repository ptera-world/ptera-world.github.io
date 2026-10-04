import type { Step, Technique } from "../../core/types";
import { geometry } from "./grid";
import { cellList, cellName, stateChains, type SignpostAction, type SignpostFocus, type SignpostPuzzle, type SignpostState } from "./logic";
import { analyze, freshKnowledge, link, look, scanSteps, type Knowledge, type Step as SolverStep, type StepKind } from "./solver";

type SignpostTechnique = Technique<SignpostPuzzle, SignpostState, SignpostAction>;

/** What a technique can be aimed at: a cell. */
export type SignpostTarget = { cell: number };

const knowledgeCache = new WeakMap<SignpostState, Knowledge | null>();

/** Player links that agree with the unique solution (every link when there isn't one). Null if they contradict. */
export function knowledge(p: SignpostPuzzle, s: SignpostState): Knowledge | null {
  if (knowledgeCache.has(s)) return knowledgeCache.get(s)!;
  const g = geometry(p);
  const a = analyze(p);
  const sol = a.count === 1 ? a.solution : null;
  let k: Knowledge | null = freshKnowledge(g);
  for (let c = 0; c < g.n && k; c++) {
    const t = s.next[c]!;
    if (t >= 0 && (!sol || sol[c] === t) && !link(k, c, t)) k = null;
  }
  if (k && !look(g, k).ok) k = null;
  knowledgeCache.set(s, k);
  return k;
}

/** A step changes the board only if neither end is linked that way already. */
function effective(s: SignpostState, st: SolverStep): boolean {
  if (s.next[st.from] !== -1) return false;
  return !s.next.includes(st.to);
}

function first(p: SignpostPuzzle, s: SignpostState, kinds: readonly StepKind[], target?: SignpostTarget): SolverStep | null {
  const k = knowledge(p, s);
  if (!k) return null;
  return scanSteps(geometry(p), k, kinds, (st) => (!target || st.from === target.cell || st.to === target.cell) && effective(s, st));
}

/** The number a cell shows (given or from its chain), as text, or its name when it has none. */
function label(p: SignpostPuzzle, s: SignpostState, c: number): string {
  const v = stateChains(p, s).num[c]!;
  return v ? `the ${v} at ${cellName(p, c)}` : cellName(p, c);
}

function step(st: SolverStep, message: string, nudge: string, nudgeFocus: SignpostFocus, because: number[]): Step<SignpostAction> {
  return {
    message,
    nudge,
    focus: { links: [[st.from, st.to]], because, related: st.ruled } satisfies SignpostFocus,
    nudgeFocus,
    actions: [{ type: "link", from: st.from, to: st.to }],
  };
}

type Finder = (p: SignpostPuzzle, s: SignpostState, target?: SignpostTarget) => Step<SignpostAction> | null;

function technique(def: Omit<SignpostTechnique, "find" | "findAt" | "puzzles">, find: Finder): SignpostTechnique {
  return { ...def, puzzles: ["signpost"], find: (p, s) => find(p, s), findAt: (p, s, t) => find(p, s, t as SignpostTarget) };
}

const EASY = { width: 5, height: 5, difficulty: "easy" };
const MEDIUM = { width: 5, height: 5, difficulty: "medium" };
const HARD = { width: 6, height: 6, difficulty: "hard" };

export const consecutive = technique({
  id: "signpost.consecutive",
  name: "next number in sight",
  level: 1,
  description: "a number whose arrow points at the cell holding the next number links straight to it.",
  practice: { params: EASY },
}, (p, s, target) => {
  const st = first(p, s, ["consecutive"], target);
  if (!st) return null;
  return step(st,
    `${label(p, s, st.from)} points at ${label(p, s, st.to)}, so they link`,
    `where is the number after ${label(p, s, st.from)}?`, { links: [], because: [st.from] }, [st.from, st.to]);
});

export const onlyNext = technique({
  id: "signpost.only-next",
  name: "only one way out",
  level: 2,
  description: "a cell whose arrow reaches only one cell that can still come next (the others are the start, already have something linked in, are in its own chain, or have the wrong number) links to that one.",
  practice: { params: EASY },
}, (p, s, target) => {
  const st = first(p, s, ["only-next"], target);
  if (!st) return null;
  return step(st,
    `the only cell ${label(p, s, st.from)} can still point to is ${cellName(p, st.to)}${st.ruled.length ? ` (${cellList(p, st.ruled)} can't come next)` : ""}, so they link`,
    `where can ${cellName(p, st.from)} lead?`, { links: [], because: [st.from] }, [st.from]);
});

export const onlyPrev = technique({
  id: "signpost.only-prev",
  name: "only one way in",
  level: 3,
  description: "a cell that only one arrow can still lead into (the others already lead elsewhere, are the end, are in its own chain, or have the wrong number) is linked from that one.",
  practice: { params: EASY },
}, (p, s, target) => {
  const st = first(p, s, ["only-prev"], target);
  if (!st) return null;
  return step(st,
    `only ${cellName(p, st.from)} can still lead into ${label(p, s, st.to)}${st.ruled.length ? ` (${cellList(p, st.ruled)} can't)` : ""}, so they link`,
    `what can lead into ${cellName(p, st.to)}?`, { links: [], because: [st.to] }, [st.to]);
});

export const numbersFit = technique({
  id: "signpost.numbers-fit",
  name: "numbers must fit",
  level: 4,
  description: "linking a numbered chain to an unnumbered one numbers every cell in it. if one of those numbers is already on the board somewhere else, that link is impossible; once only one link is left for a cell, make it.",
  practice: { params: MEDIUM },
}, (p, s, target) => {
  const st = first(p, s, ["fit-next", "fit-prev"], target);
  if (!st) return null;
  const out = st.kind === "fit-next";
  const at = out ? st.from : st.to;
  return step(st,
    out
      ? `linking ${label(p, s, st.from)} to ${cellList(p, st.ruled)} would give some cell a number that's already on the board, so it can only link to ${cellName(p, st.to)}`
      : `linking ${cellList(p, st.ruled)} into ${label(p, s, st.to)} would give some cell a number that's already on the board, so only ${cellName(p, st.from)} can lead into it`,
    `which numbers would ${cellName(p, at)}'s links give out?`, { links: [], because: [at] }, [at]);
});

export const trial = technique({
  id: "signpost.trial",
  name: "try each option",
  level: 5,
  description: "try each place a cell could link to (or from) in turn and follow the easier techniques. if every option but one runs into a clash, the one left is right.",
  practice: { params: HARD },
}, (p, s, target) => {
  const st = first(p, s, ["trial-next", "trial-prev"], target);
  if (!st) return null;
  const out = st.kind === "trial-next";
  const at = out ? st.from : st.to;
  return step(st,
    out
      ? `linking ${cellName(p, st.from)} to ${cellList(p, st.ruled)} each leads to a clash, so it links to ${cellName(p, st.to)}`
      : `linking ${cellList(p, st.ruled)} into ${cellName(p, st.to)} each leads to a clash, so ${cellName(p, st.from)} links into it`,
    `try each link ${out ? "out of" : "into"} ${cellName(p, at)}`, { links: [], because: [at] }, [at]);
});

export const signpostTechniques: SignpostTechnique[] = [consecutive, onlyNext, onlyPrev, numbersFit, trial];
