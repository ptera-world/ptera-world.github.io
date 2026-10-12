import type { Step, Technique } from "../../core/types";
import { LINE, NO, UNK, around, edgeGrid } from "../../lib/edges";
import { pearl, CROSS, NONE, cellList, cellName, edgeList, type PearlAction, type PearlFocus, type PearlPuzzle, type PearlState } from "./logic";
import { freshKnowledge, scanSteps, type Knowledge, type Step as SolverStep, type StepKind } from "./solver";

type PearlTechnique = Technique<PearlPuzzle, PearlState, PearlAction>;

/** What a technique can be aimed at: a cell. */
export type PearlTarget = { cell: number };

const knowledgeCache = new WeakMap<PearlState, Knowledge>();

/**
 * Lines and crosses on the board, all counted, plus the edges a cell with two lines rules out.
 */
export function knowledge(p: PearlPuzzle, s: PearlState): Knowledge {
  const hit = knowledgeCache.get(s);
  if (hit) return hit;
  const g = edgeGrid(p.w, p.h);
  const k = freshKnowledge(g);
  s.edges.forEach((v, e) => {
    if (v === LINE) k[e] = LINE;
    else if (v === CROSS) k[e] = NO;
  });
  for (let c = 0; c < g.n; c++) {
    const { lines, unk } = around(g, k, c);
    if (lines === 2) for (const e of unk) k[e] = NO;
  }
  knowledgeCache.set(s, k);
  return k;
}

/** Board changes of a solver step: lines on edges with nothing drawn, crosses on edges a full cell doesn't already rule out. */
function changes(p: PearlPuzzle, s: PearlState, st: SolverStep): { lines: number[]; crosses: number[] } {
  const g = edgeGrid(p.w, p.h);
  const drawn = Int8Array.from(s.edges, (v) => (v === LINE ? LINE : UNK));
  const full = (c: number) => around(g, drawn, c).lines >= 2;
  return {
    lines: st.lines.filter((e) => s.edges[e] === NONE),
    crosses: st.nos.filter((e) => s.edges[e] === NONE && !full(g.ea[e]!) && !full(g.eb[e]!)),
  };
}

type Hit = { raw: SolverStep; lines: number[]; crosses: number[] };

function each(p: PearlPuzzle, s: PearlState, kinds: readonly StepKind[], visit: (hit: Hit) => boolean | void, target?: PearlTarget): void {
  const k = knowledge(p, s);
  const g = edgeGrid(p.w, p.h);
  const touches = (st: SolverStep) => !target || st.because.includes(target.cell)
    || [...st.lines, ...st.nos].some((e) => g.ea[e] === target.cell || g.eb[e] === target.cell);
  scanSteps(p, k, kinds, (raw) => {
    if (!touches(raw)) return false;
    const ch = changes(p, s, raw);
    return ch.lines.length + ch.crosses.length > 0 && visit({ raw, ...ch }) === true;
  });
}

function step(raw: SolverStep, lines: number[], crosses: number[], message: string, nudge: string, nudgeFocus: PearlFocus): Step<PearlAction> {
  const actions: PearlAction[] = [];
  if (lines.length) actions.push({ type: "set", edges: lines, value: LINE });
  if (crosses.length) actions.push({ type: "set", edges: crosses, value: CROSS });
  return { message, nudge, focus: { edges: [...lines, ...crosses], because: raw.because } satisfies PearlFocus, nudgeFocus, actions };
}

/** "the loop runs C5-D5, and not D5-D6". */
function outcome(p: PearlPuzzle, lines: readonly number[], crosses: readonly number[]): string {
  const parts: string[] = [];
  if (lines.length) parts.push(`the loop runs ${edgeList(p, lines)}`);
  if (crosses.length) parts.push(`${lines.length ? "and " : "the loop "}doesn't run ${edgeList(p, crosses)}`);
  return parts.join(", ");
}

type Make = (p: PearlPuzzle, hit: Hit) => Step<PearlAction>;

const asTarget = (t: unknown): PearlTarget | null => (t && typeof (t as PearlTarget).cell === "number" ? t as PearlTarget : null);

/** Hits at `target`, those changing an edge of the pointed cell first, each group in scan order. */
function hitsAt(p: PearlPuzzle, s: PearlState, kinds: readonly StepKind[], target: PearlTarget): Hit[] {
  const g = edgeGrid(p.w, p.h);
  const first: Hit[] = [], later: Hit[] = [];
  each(p, s, kinds, (hit) => {
    const own = [...hit.lines, ...hit.crosses].some((e) => g.ea[e] === target.cell || g.eb[e] === target.cell);
    (own ? first : later).push(hit);
  }, target);
  return [...first, ...later];
}

function technique(def: Omit<PearlTechnique, "instances" | "findAt" | "instancesAt" | "cellAt" | "puzzles">, kinds: readonly StepKind[], make: Make): PearlTechnique {
  return {
    ...def,
    puzzles: [pearl],
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
      const g = edgeGrid(p.w, p.h);
      const at = (e: number) => g.ea[e] === target.cell || g.eb[e] === target.cell;
      const lines = hit.lines.filter(at), crosses = hit.crosses.filter(at);
      return lines.length || crosses.length ? make(p, { ...hit, lines, crosses }) : null;
    },
  };
}

const EASY = { width: 6, height: 6, difficulty: "easy" };
const HARD = { width: 6, height: 6, difficulty: "hard" };

/** A technique built from one solver step kind whose explanation only needs the cell(s) behind it. */
function simple(id: string, name: string, level: number, description: string, kind: StepKind, why: (p: PearlPuzzle, cells: number[]) => string, nudge: (p: PearlPuzzle, cells: number[]) => string, practice = EASY): PearlTechnique {
  return technique({ id, name, level, description, practice: { params: practice } }, [kind], (p, hit) => {
    const cells = hit.raw.because;
    return step(hit.raw, hit.lines, hit.crosses, `${why(p, cells)}, so ${outcome(p, hit.lines, hit.crosses)}`, nudge(p, cells), { edges: [], because: cells.slice(0, 1) });
  });
}

export const onlyWayOn = simple("pearl.only-way-on", "only way on", 1,
  "a line that reaches a cell has to leave it again. if only one way out is left, the line goes that way.",
  "continue", (p, [c]) => `the line into ${cellName(p, c!)} has only one way out`, (p, [c]) => `where can the line at ${cellName(p, c!)} go?`);

export const deadEnd = simple("pearl.dead-end", "dead end", 2,
  "a cell with only one way in or out can't be on the loop (it would be a dead end), so that way is crossed off.",
  "dead-end", (p, [c]) => `${cellName(p, c!)} has only one open side, so the loop can't pass through it`, (p, [c]) => `could the loop pass through ${cellName(p, c!)}?`);

export const pearlTwoWays = simple("pearl.two-ways", "pearl with two ways", 3,
  "the loop has to pass through every pearl. a pearl with only two open sides uses both.",
  "pearl-two", (p, [c]) => `the pearl at ${cellName(p, c!)} has only two open sides and the loop must pass through it`, (p, [c]) => `how can the loop reach the pearl at ${cellName(p, c!)}?`);

export const blackPearl = technique({
  id: "pearl.black",
  name: "black pearl",
  level: 4,
  description: "the loop turns on a black pearl and runs straight for two cells each way. a direction without room for two straight cells (the edge, a cross, another black pearl, or a cell that turns) can't be used, so the opposite one is, all the way.",
  practice: { params: EASY },
}, ["black"], (p, hit) => {
  const c = hit.raw.because[0]!;
  return step(hit.raw, hit.lines, hit.crosses,
    `the black pearl at ${cellName(p, c)} turns, and leaves straight for two cells on each side, so ${outcome(p, hit.lines, hit.crosses)}`,
    `which ways can the black pearl at ${cellName(p, c)} leave?`, { edges: [], because: [c] });
});

export const whitePearl = technique({
  id: "pearl.white",
  name: "white pearl",
  level: 5,
  description: "the loop goes straight through a white pearl. if one direction is blocked (the edge, a cross, or a line coming in from the side), it goes straight the other way.",
  practice: { params: EASY },
}, ["white"], (p, hit) => {
  const c = hit.raw.because[0]!;
  return step(hit.raw, hit.lines, hit.crosses,
    `the loop goes straight through the white pearl at ${cellName(p, c)}, and only one direction is open, so ${outcome(p, hit.lines, hit.crosses)}`,
    `which way can the loop cross the white pearl at ${cellName(p, c)}?`, { edges: [], because: [c] });
});

export const whiteTurn = technique({
  id: "pearl.white-turn",
  name: "white pearl needs a turn",
  level: 6,
  description: "the loop must turn just before or just after a white pearl. if it runs straight on one side, it has to turn on the other.",
  practice: { params: EASY },
}, ["white-turn"], (p, hit) => {
  const [c, n1] = hit.raw.because as [number, number];
  return step(hit.raw, hit.lines, hit.crosses,
    `the loop goes straight on through ${cellName(p, n1)}, so it must turn on the other side of the white pearl at ${cellName(p, c)}: ${outcome(p, hit.lines, hit.crosses)}`,
    `where does the loop turn around the white pearl at ${cellName(p, c)}?`, { edges: [], because: [c] });
});

export const whiteNoRoom = technique({
  id: "pearl.white-no-room",
  name: "white pearl with no room to turn",
  level: 7,
  description: "if going one way through a white pearl would leave neither neighbor able to turn, the loop must cross it the other way.",
  practice: { params: EASY },
}, ["white-needs-turn"], (p, hit) => {
  const [c, ...ns] = hit.raw.because as [number, ...number[]];
  return step(hit.raw, hit.lines, hit.crosses,
    `going the other way, neither ${cellList(p, ns)} could turn, so the loop crosses the white pearl at ${cellName(p, c)} this way: ${outcome(p, hit.lines, hit.crosses)}`,
    `which way can the loop cross the white pearl at ${cellName(p, c)}?`, { edges: [], because: [c] });
});

export const noEarlyLoop = technique({
  id: "pearl.no-early-loop",
  name: "no early loop",
  level: 8,
  description: "joining the two ends of the same piece of line would close a loop. unless that loop would already be the whole answer (every pearl on it, nothing else drawn), the edge between the ends is crossed off.",
  practice: { params: EASY },
}, ["loop"], (p, hit) => {
  const [a, b] = hit.raw.because as [number, number];
  return step(hit.raw, hit.lines, hit.crosses,
    `${cellName(p, a)} and ${cellName(p, b)} are the two ends of one piece of line, and joining them would close a loop too early, so ${outcome(p, hit.lines, hit.crosses)}`,
    `follow the line from ${cellName(p, a)}`, { edges: [], because: [a] });
});

export const trial = technique({
  id: "pearl.trial",
  name: "try it",
  level: 9,
  description: "pretend an edge is part of the loop (or isn't) and follow the easier techniques. if that breaks a rule, the edge is the other way.",
  practice: { params: HARD },
}, ["trial"], (p, hit) => {
  const e = [...hit.raw.lines, ...hit.raw.nos][0]!;
  const tried = hit.raw.lines.length ? "weren't" : "were";
  return step(hit.raw, hit.lines, hit.crosses,
    `if ${edgeList(p, [e])} ${tried} part of the loop, the easier techniques would break a rule, so ${outcome(p, hit.lines, hit.crosses)}`,
    `try ${edgeList(p, [e])} both ways`, { edges: [e], because: [] });
});

export const pearlTechniques: PearlTechnique[] = [onlyWayOn, deadEnd, pearlTwoWays, blackPearl, whitePearl, whiteTurn, whiteNoRoom, noEarlyLoop, trial];
