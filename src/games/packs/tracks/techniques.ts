import type { Step, Technique } from "../../core/types";
import { LINE, NO, UNK, edgeGrid } from "../../lib/edges";
import { CROSS, EMPTY, NONE, TRACK, cellList, cellName, countName, edgeList, type TracksAction, type TracksFocus, type TracksPuzzle, type TracksState } from "./logic";
import { analyze, closeObvious, freshKnowledge, scanSteps, sides, target, type Knowledge, type Step as SolverStep, type StepKind } from "./solver";

type TracksTechnique = Technique<TracksPuzzle, TracksState, TracksAction>;

/** What a technique can be aimed at: a cell. */
export type TracksTarget = { cell: number };

const knowledgeCache = new WeakMap<TracksState, Knowledge | null>();

/**
 * Lines, crosses and cell marks on the board, each counted only when it agrees with the unique
 * solution (all of them when there isn't one), plus what they make obvious. Null on a clash.
 */
export function knowledge(p: TracksPuzzle, s: TracksState): Knowledge | null {
  if (knowledgeCache.has(s)) return knowledgeCache.get(s)!;
  const g = edgeGrid(p.w, p.h);
  const a = analyze(p);
  const sol = a.count === 1 ? a.solution : null;
  const on = new Set<number>();
  if (sol) sol.forEach((v, e) => { if (v) { on.add(g.ea[e]!); on.add(g.eb[e]!); } });
  const k = freshKnowledge(p);
  s.edges.forEach((v, e) => {
    if (k.e[e] !== UNK) return;
    if (v === LINE && (!sol || sol[e])) k.e[e] = LINE;
    else if (v === CROSS && (!sol || !sol[e])) k.e[e] = NO;
  });
  s.cells.forEach((v, c) => {
    if (k.c[c] !== 0 || p.given[c]) return;
    if (v === TRACK && (!sol || on.has(c))) k.c[c] = TRACK;
    else if (v === EMPTY && (!sol || !on.has(c))) k.c[c] = EMPTY;
  });
  const out = closeObvious(p, g, k) ? k : null;
  knowledgeCache.set(s, out);
  return out;
}

/** Board changes of a step: only on unmarked edges and cells, skipping what the board already makes obvious. */
function changes(p: TracksPuzzle, s: TracksState, st: SolverStep) {
  const g = edgeGrid(p.w, p.h);
  const lines = Int8Array.from(s.edges, (v) => (v === LINE ? LINE : UNK));
  const k = freshKnowledge(p);
  lines.forEach((v, e) => { if (v === LINE) k.e[e] = LINE; });
  const drawnAt = (c: number) => sides(p, g, k, c).lines;
  const fixed = (c: number) => p.given[c] !== 0;
  const free = (e: number) => s.edges[e] === NONE && !fixed(g.ea[e]!) && !fixed(g.eb[e]!);
  const quiet = (c: number) => s.cells[c] !== EMPTY && drawnAt(c) < 2;
  return {
    lines: st.lines.filter(free),
    crosses: st.nos.filter((e) => free(e) && quiet(g.ea[e]!) && quiet(g.eb[e]!)),
    tracks: st.tracks.filter((c) => !fixed(c) && s.cells[c] === NONE && drawnAt(c) === 0),
    empties: st.empties.filter((c) => !fixed(c) && s.cells[c] === NONE && drawnAt(c) === 0),
  };
}

type Changes = ReturnType<typeof changes>;
const size = (ch: Changes) => ch.lines.length + ch.crosses.length + ch.tracks.length + ch.empties.length;

function first(p: TracksPuzzle, s: TracksState, kinds: readonly StepKind[], target?: TracksTarget) {
  const k = knowledge(p, s);
  if (!k) return null;
  const g = edgeGrid(p.w, p.h);
  let ch: Changes = { lines: [], crosses: [], tracks: [], empties: [] };
  const touches = (st: SolverStep) => !target || st.because.includes(target.cell) || st.tracks.includes(target.cell) || st.empties.includes(target.cell)
    || [...st.lines, ...st.nos].some((e) => g.ea[e] === target.cell || g.eb[e] === target.cell);
  const raw = scanSteps(p, k, kinds, (st) => touches(st) && size(ch = changes(p, s, st)) > 0);
  return raw ? { raw, ch } : null;
}

function outcome(p: TracksPuzzle, ch: Changes): string {
  const parts: string[] = [];
  if (ch.lines.length) parts.push(`the track runs ${edgeList(p, ch.lines)}`);
  if (ch.crosses.length) parts.push(`the track doesn't run ${edgeList(p, ch.crosses)}`);
  if (ch.tracks.length) parts.push(`${cellList(p, ch.tracks)} ${ch.tracks.length === 1 ? "has" : "have"} track`);
  if (ch.empties.length) parts.push(`${cellList(p, ch.empties)} ${ch.empties.length === 1 ? "has" : "have"} no track`);
  return parts.join(", ");
}

function build(raw: SolverStep, ch: Changes, message: string, nudge: string, nudgeFocus: TracksFocus): Step<TracksAction> {
  const actions: TracksAction[] = [];
  if (ch.lines.length) actions.push({ type: "edge", edges: ch.lines, value: LINE });
  if (ch.crosses.length) actions.push({ type: "edge", edges: ch.crosses, value: CROSS });
  if (ch.tracks.length) actions.push({ type: "cell", cells: ch.tracks, value: TRACK });
  if (ch.empties.length) actions.push({ type: "cell", cells: ch.empties, value: EMPTY });
  return {
    message, nudge, nudgeFocus, actions,
    focus: { edges: [...ch.lines, ...ch.crosses], cells: [...ch.tracks, ...ch.empties], because: raw.because, counts: raw.count === undefined ? [] : [raw.count] } satisfies TracksFocus,
  };
}

type Finder = (p: TracksPuzzle, s: TracksState, target?: TracksTarget) => Step<TracksAction> | null;

function technique(def: Omit<TracksTechnique, "find" | "findAt" | "puzzles">, find: Finder): TracksTechnique {
  return { ...def, puzzles: ["tracks"], find: (p, s) => find(p, s), findAt: (p, s, t) => find(p, s, t as TracksTarget) };
}

const EASY = { width: 6, height: 6, difficulty: "easy" };
const MEDIUM = { width: 7, height: 7, difficulty: "medium" };
const HARD = { width: 7, height: 7, difficulty: "hard" };
const cellFocus = (cells: number[]): TracksFocus => ({ edges: [], cells: [], because: cells });
const countFocus = (i: number): TracksFocus => ({ edges: [], cells: [], because: [], counts: [i] });

export const noRoom = technique({
  id: "tracks.no-room", name: "no room for track", level: 1, practice: { params: EASY },
  description: "track goes into a cell and out again, so a cell with only one open side (the rest are the board's edge, crosses or empty cells) has no track.",
}, (p, s, t) => {
  const hit = first(p, s, ["no-room"], t);
  if (!hit) return null;
  const c = hit.raw.because[0]!;
  return build(hit.raw, hit.ch, `${cellName(p, c)} has at most one open side, so ${outcome(p, hit.ch)}`, `could track pass through ${cellName(p, c)}?`, cellFocus([c]));
});

export const through = technique({
  id: "tracks.through", name: "only way through", level: 2, practice: { params: EASY },
  description: "a cell with track and only two open sides uses both of them.",
}, (p, s, t) => {
  const hit = first(p, s, ["through"], t);
  if (!hit) return null;
  const c = hit.raw.because[0]!;
  return build(hit.raw, hit.ch, `${cellName(p, c)} has track and only two open sides, so ${outcome(p, hit.ch)}`, `which way can the track leave ${cellName(p, c)}?`, cellFocus([c]));
});

export const countFull = technique({
  id: "tracks.count-full", name: "count reached", level: 3, practice: { params: EASY },
  description: "once a row or column has as many track cells as its number, the rest of it is empty.",
}, (p, s, t) => {
  const hit = first(p, s, ["count-full"], t);
  if (!hit) return null;
  const i = hit.raw.count!;
  return build(hit.raw, hit.ch, `${countName(p, i)} already has its ${target(p, i)} track cells, so ${outcome(p, hit.ch)}`, `count the track in ${countName(p, i)}`, countFocus(i));
});

export const countNeeds = technique({
  id: "tracks.count-needs", name: "every spot is needed", level: 4, practice: { params: EASY },
  description: "if a row or column has only as many cells left that could hold track as its number still needs, they all do.",
}, (p, s, t) => {
  const hit = first(p, s, ["count-needs"], t);
  if (!hit) return null;
  const i = hit.raw.count!;
  return build(hit.raw, hit.ch, `${countName(p, i)} needs ${target(p, i)} track cells and has no more room than that, so ${outcome(p, hit.ch)}`, `where can the track in ${countName(p, i)} go?`, countFocus(i));
});

export const noLoop = technique({
  id: "tracks.no-loop", name: "no loop, no early finish", level: 5, practice: { params: EASY },
  description: "joining the two ends of one piece of track would make a loop; joining the entrance's piece to the exit's while other track or counts are still missing would end the track too early. either way that edge stays empty.",
}, (p, s, t) => {
  const hit = first(p, s, ["loop"], t);
  if (!hit) return null;
  const [a, b] = hit.raw.because as [number, number];
  return build(hit.raw, hit.ch, `joining ${cellName(p, a)} to ${cellName(p, b)} would close a loop or finish the track too early, so ${outcome(p, hit.ch)}`, `follow the track from ${cellName(p, a)}`, cellFocus([a]));
});

export const neighbours = technique({
  id: "tracks.neighbours", name: "dragged-in neighbor", level: 6, practice: { params: MEDIUM },
  description: "a cell whose only other open sides are blocked would, if it had track, have to carry it into its neighbor along the row or column. if that line has only one track cell left, the cell can't have track; if it has only one empty cell left, the neighbor must have track.",
}, (p, s, t) => {
  const hit = first(p, s, ["neighbours"], t);
  if (!hit) return null;
  const i = hit.raw.count!;
  const [x] = [...hit.raw.empties, ...hit.raw.tracks];
  const n = hit.raw.because[0]!;
  const fill = hit.raw.empties.length > 0;
  const message = fill
    ? `track in ${cellName(p, x!)} would have to run into ${cellName(p, n)} too, but ${countName(p, i)} has room for only one more track cell, so ${outcome(p, hit.ch)}`
    : `${cellName(p, n)} can only carry track by running into ${cellName(p, x!)}, so if ${cellName(p, x!)} were empty both would be, but ${countName(p, i)} can only leave one more cell empty: ${outcome(p, hit.ch)}`;
  return build(hit.raw, hit.ch, message, `look at ${countName(p, i)}`, countFocus(i));
});

export const trial = technique({
  id: "tracks.trial", name: "try it", level: 7, practice: { params: HARD },
  description: "pretend a cell has track (or doesn't), or an edge carries track (or doesn't), and follow the easier techniques. if that breaks a rule, it's the other way.",
}, (p, s, t) => {
  const hit = first(p, s, ["trial"], t);
  if (!hit) return null;
  return build(hit.raw, hit.ch, `trying the other way breaks a rule, so ${outcome(p, hit.ch)}`, `try ${cellList(p, hit.raw.because)} both ways`, cellFocus(hit.raw.because));
});

export const tracksTechniques: TracksTechnique[] = [noRoom, through, countFull, countNeeds, noLoop, neighbours, trial];
