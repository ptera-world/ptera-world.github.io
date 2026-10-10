import type { Step, Technique } from "../../core/types";
import { LINE, NO, edgeGrid } from "../../lib/edges";
import { cellName } from "../../lib/grid-kit/names";
import { numberlink, CROSS, edgeList, pairName, type NumberlinkAction, type NumberlinkFocus, type NumberlinkPuzzle, type NumberlinkState } from "./logic";
import { EMPTY_BIT, closeObvious, eachStep, freshKnowledge, pairOf, type Knowledge, type Step as SolverStep, type StepKind } from "./solver";

type NumberlinkTechnique = Technique<NumberlinkPuzzle, NumberlinkState, NumberlinkAction>;

/** What a technique can be aimed at: a cell. */
export type NumberlinkTarget = { cell: number };

const knowledgeCache = new WeakMap<NumberlinkState, Knowledge | null>();

/**
 * Lines and crosses on the board, all counted, plus what they make obvious. Null on a clash.
 */
export function knowledge(p: NumberlinkPuzzle, s: NumberlinkState): Knowledge | null {
  if (knowledgeCache.has(s)) return knowledgeCache.get(s)!;
  const k = freshKnowledge(p);
  s.edges.forEach((v, e) => {
    if (v === LINE) k.e[e] = LINE;
    else if (v === CROSS) k.e[e] = NO;
  });
  const out = closeObvious(p, edgeGrid(p.w, p.h), k) ? k : null;
  knowledgeCache.set(s, out);
  return out;
}

type Hit = { st: SolverStep; k: Knowledge };

function each(p: NumberlinkPuzzle, s: NumberlinkState, kinds: readonly StepKind[], visit: (hit: Hit) => boolean | void, target?: NumberlinkTarget): void {
  const k = knowledge(p, s);
  if (!k) return;
  const g = edgeGrid(p.w, p.h);
  const touches = (st: SolverStep) => !target || st.because.includes(target.cell)
    || [...st.lines, ...st.nos].some((e) => g.ea[e] === target.cell || g.eb[e] === target.cell);
  const changes = (st: SolverStep) => st.lines.some((e) => s.edges[e] !== LINE) || st.nos.some((e) => s.edges[e] !== CROSS);
  eachStep(p, k, kinds, (st) => touches(st) && changes(st) && visit({ st, k }) === true);
}

const colorName = (m: number): string => {
  const pairs = m & ~EMPTY_BIT;
  return pairs && (pairs & (pairs - 1)) === 0 ? pairName(pairOf(pairs)) : "";
};

function colorsIn(m: number): string {
  const names: string[] = [];
  for (let i = 1, b = 1; b <= (m & ~EMPTY_BIT); i++, b <<= 1) if (m & b) names.push(pairName(i));
  if (names.length <= 1) return names[0] ?? "no color";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

function outcome(p: NumberlinkPuzzle, st: SolverStep): string {
  const parts: string[] = [];
  if (st.lines.length) parts.push(`the line runs ${edgeList(p, st.lines)}`);
  if (st.nos.length) parts.push(`no line crosses ${edgeList(p, st.nos)}`);
  return parts.join(", and ");
}

function build(s: NumberlinkState, st: SolverStep, message: string, nudge: string): Step<NumberlinkAction> {
  const actions: NumberlinkAction[] = [];
  if (st.lines.length) actions.push({ type: "edge", edges: st.lines.filter((e) => s.edges[e] !== LINE), value: LINE });
  const crosses = st.nos.filter((e) => s.edges[e] !== CROSS);
  if (crosses.length) actions.push({ type: "edge", edges: crosses, value: CROSS });
  return {
    message, nudge, actions,
    focus: { cells: [], because: st.because, edges: [...st.lines, ...st.nos] } satisfies NumberlinkFocus,
    nudgeFocus: { cells: [], because: st.because.slice(0, 1) } satisfies NumberlinkFocus,
  };
}

type Make = (p: NumberlinkPuzzle, s: NumberlinkState, hit: Hit) => Step<NumberlinkAction>;

function technique(def: Omit<NumberlinkTechnique, "instances" | "findAt" | "puzzles">, kinds: readonly StepKind[], make: Make): NumberlinkTechnique {
  return {
    ...def,
    puzzles: [numberlink],
    instances: (p, s, visit) => each(p, s, kinds, (hit) => visit(make(p, s, hit)) === true),
    findAt: (p, s, t) => {
      let found: Step<NumberlinkAction> | null = null;
      each(p, s, kinds, (hit) => { found = make(p, s, hit); return true; }, t as NumberlinkTarget);
      return found;
    },
  };
}

const EASY = { width: 6, height: 6, difficulty: "easy" };
const MEDIUM = { width: 7, height: 7, difficulty: "medium" };
const HARD = { width: 8, height: 8, difficulty: "hard" };

export const oneWay = technique({
  id: "numberlink.one-way", name: "only one way to go", level: 1, practice: { params: EASY },
  description: "a dot with no line yet, or the loose end of a line, that has only one open side: the line has to leave through it.",
}, ["one-way"], (p, s, hit) => {
  const c = hit.st.because[0]!;
  const color = colorName(hit.k.col[c]!);
  const what = p.dots[c] ? `the ${color} dot at ${cellName(p, c)}` : `the ${color ? `${color} ` : ""}line ending at ${cellName(p, c)}`;
  return build(s, hit.st, `${what} has only one open side, so ${outcome(p, hit.st)}`, `where can the line from ${cellName(p, c)} go?`);
});

export const corridor = technique({
  id: "numberlink.corridor", name: "two ways in, two ways out", level: 2, requires: ["fill"], practice: { params: EASY },
  description: "every cell is on a line, and a line goes in and out of each cell it passes. so an empty cell with only two open sides uses both.",
}, ["corridor"], (p, s, hit) => {
  const c = hit.st.because[0]!;
  return build(s, hit.st, `${cellName(p, c)} needs a line through it and has only two open sides, so ${outcome(p, hit.st)}`, `which way can a line pass through ${cellName(p, c)}?`);
});

export const deadEnd = technique({
  id: "numberlink.dead-end", name: "dead end", level: 2, requires: ["gaps"], practice: false,
  description: "a line passing through a cell goes in one side and out another. a cell without a dot that has only one open side can't have a line, so it stays empty.",
}, ["dead-end"], (p, s, hit) => {
  const c = hit.st.because[0]!;
  return build(s, hit.st, `${cellName(p, c)} has only one open side, so no line can pass through it: ${outcome(p, hit.st)}`, `could a line pass through ${cellName(p, c)}?`);
});

export const colors = technique({
  id: "numberlink.colors", name: "colors don't mix", level: 3, practice: { params: EASY },
  description: "two cells already on lines of different colors can't be joined: that line would link two different dots.",
}, ["colors"], (p, s, hit) => {
  const [a, b] = hit.st.because as [number, number];
  return build(s, hit.st, `${cellName(p, a)} is on the ${colorName(hit.k.col[a]!)} line and ${cellName(p, b)} on the ${colorName(hit.k.col[b]!)} one, so ${outcome(p, hit.st)}`, `look at the lines meeting at ${cellName(p, a)}`);
});

export const noLoop = technique({
  id: "numberlink.no-loop", name: "no loops", level: 4, practice: false,
  description: "joining the two ends of the same piece of line would close it into a loop, which can't reach any dot. so that edge stays empty.",
}, ["loop"], (p, s, hit) => {
  const [a, b] = hit.st.because as [number, number];
  return build(s, hit.st, `${cellName(p, a)} and ${cellName(p, b)} are the two ends of one piece of line; joining them would close a loop, so ${outcome(p, hit.st)}`, `follow the line from ${cellName(p, a)}`);
});

export const reach = technique({
  id: "numberlink.reach", name: "who can reach it", level: 5, practice: { params: MEDIUM },
  description: "work out which colors can still get to each cell (a line can't pass through crosses or other colors' lines, and if every route between two dots runs through one cell, that cell is theirs). two cells with no color in common are never joined.",
}, ["reach"], (p, s, hit) => {
  const [a, b] = hit.st.because as [number, number];
  const [da, db] = hit.st.domains as [number, number];
  const can = (c: number, m: number) => `${cellName(p, c)} can only be ${m & EMPTY_BIT ? `empty or ${colorsIn(m)}` : colorsIn(m)}`;
  return build(s, hit.st, `${can(a, da)}, and ${can(b, db)}. no color fits both, so ${outcome(p, hit.st)}`, `which colors can still reach ${cellName(p, a)}?`);
});

export const trial = technique({
  id: "numberlink.trial", name: "try it", level: 6, practice: { params: HARD },
  description: "pretend a line crosses an edge (or doesn't) and follow the easier techniques. if that breaks a rule, it's the other way.",
}, ["trial"], (p, s, hit) => {
  const e = [...hit.st.lines, ...hit.st.nos][0]!;
  const tried = hit.st.lines.length ? "leaving it without a line" : "a line there";
  return build(s, hit.st, `${tried} breaks a rule a few steps later, so ${outcome(p, hit.st)}`, `try ${edgeList(p, [e])} both ways`);
});

export const numberlinkTechniques: NumberlinkTechnique[] = [oneWay, corridor, deadEnd, colors, noLoop, reach, trial];
