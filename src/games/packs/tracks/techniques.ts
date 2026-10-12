import type { Step, Technique } from "../../core/types";
import { LINE, NO, UNK, edgeGrid } from "../../lib/edges";
import { tracks, CROSS, EMPTY, NONE, TRACK, cellList, cellName, countName, edgeList, type TracksAction, type TracksFocus, type TracksPuzzle, type TracksState } from "./logic";
import { closeObvious, countCells, freshKnowledge, scanSteps, sides, target, type Knowledge, type Step as SolverStep, type StepKind } from "./solver";

type TracksTechnique = Technique<TracksPuzzle, TracksState, TracksAction>;

/** What a technique can be aimed at: a cell. */
export type TracksTarget = { cell: number };

const knowledgeCache = new WeakMap<TracksState, Knowledge | null>();

/**
 * Lines, crosses and cell marks on the board, all counted, plus what they make obvious. Null on a clash.
 */
export function knowledge(p: TracksPuzzle, s: TracksState): Knowledge | null {
  if (knowledgeCache.has(s)) return knowledgeCache.get(s)!;
  const g = edgeGrid(p.w, p.h);
  const k = freshKnowledge(p);
  s.edges.forEach((v, e) => {
    if (k.e[e] !== UNK) return;
    if (v === LINE) k.e[e] = LINE;
    else if (v === CROSS) k.e[e] = NO;
  });
  s.cells.forEach((v, c) => {
    if (k.c[c] !== 0 || p.given[c]) return;
    if (v === TRACK) k.c[c] = TRACK;
    else if (v === EMPTY) k.c[c] = EMPTY;
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

type Hit = { raw: SolverStep; ch: Changes };

const lineKinds: readonly StepKind[] = ["count-full", "count-needs", "neighbours"];

/** The count (a column below w, else a row) a line-based step reasons about, if `c` is in that line. */
function lineOf(p: TracksPuzzle, st: SolverStep, c: number): number | null {
  if (!lineKinds.includes(st.kind) || st.count === undefined) return null;
  return countCells(p, st.count).includes(c) ? st.count : null;
}

/** The hits in scan order, stopping when `visit` returns true; with a target, only hits that reason from or touch the target's cell. */
function each(p: TracksPuzzle, s: TracksState, kinds: readonly StepKind[], visit: (hit: Hit) => boolean | void, target?: TracksTarget): void {
  const k = knowledge(p, s);
  if (!k) return;
  const g = edgeGrid(p.w, p.h);
  const touches = (st: SolverStep) => !target || st.because.includes(target.cell) || st.tracks.includes(target.cell) || st.empties.includes(target.cell)
    || [...st.lines, ...st.nos].some((e) => g.ea[e] === target.cell || g.eb[e] === target.cell);
  scanSteps(p, k, kinds, (raw) => {
    if (!touches(raw)) return false;
    const ch = changes(p, s, raw);
    return size(ch) > 0 && visit({ raw, ch }) === true;
  });
}

const asTarget = (t: unknown): TracksTarget | null => (t && typeof (t as TracksTarget).cell === "number" ? t as TracksTarget : null);

/**
 * Hits at `target`: those changing the pointed cell or one of its edges first, then the rest, each
 * group in scan order except that when the group opens with a column's hit holding the cell, the
 * first row's hit holding it moves ahead of it.
 */
function hitsAt(p: TracksPuzzle, s: TracksState, kinds: readonly StepKind[], target: TracksTarget): Hit[] {
  const g = edgeGrid(p.w, p.h);
  const c = target.cell;
  const own = (h: Hit) => h.ch.tracks.includes(c) || h.ch.empties.includes(c) || [...h.ch.lines, ...h.ch.crosses].some((e) => g.ea[e] === c || g.eb[e] === c);
  const first: Hit[] = [], later: Hit[] = [];
  each(p, s, kinds, (hit) => { (own(hit) ? first : later).push(hit); }, target);
  const rowsFirst = (group: Hit[]): Hit[] => {
    const lead = group[0] && lineOf(p, group[0].raw, c);
    if (lead === null || lead === undefined || lead >= p.w) return group;
    const row = group.findIndex((h) => { const l = lineOf(p, h.raw, c); return l !== null && l >= p.w; });
    return row < 0 ? group : [group[row]!, ...group.filter((_, i) => i !== row)];
  };
  return [...rowsFirst(first), ...rowsFirst(later)];
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

type Make = (p: TracksPuzzle, hit: Hit) => Step<TracksAction>;

function technique(def: Omit<TracksTechnique, "instances" | "findAt" | "instancesAt" | "puzzles">, kinds: readonly StepKind[], make: Make): TracksTechnique {
  return {
    ...def,
    puzzles: [tracks],
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
  };
}

const EASY = { width: 6, height: 6, difficulty: "easy" };
const MEDIUM = { width: 7, height: 7, difficulty: "medium" };
const HARD = { width: 7, height: 7, difficulty: "hard" };
const cellFocus = (cells: number[]): TracksFocus => ({ edges: [], cells: [], because: cells });
const countFocus = (i: number): TracksFocus => ({ edges: [], cells: [], because: [], counts: [i] });

export const noRoom = technique({
  id: "tracks.no-room", name: "no room for track", level: 1, practice: { params: EASY },
  description: "track goes into a cell and out again, so a cell with only one open side (the rest are the board's edge, crosses or empty cells) has no track.",
}, ["no-room"], (p, hit) => {
  const c = hit.raw.because[0]!;
  return build(hit.raw, hit.ch, `${cellName(p, c)} has at most one open side, so ${outcome(p, hit.ch)}`, `could track pass through ${cellName(p, c)}?`, cellFocus([c]));
});

export const through = technique({
  id: "tracks.through", name: "only way through", level: 2, practice: { params: EASY },
  description: "a cell with track and only two open sides uses both of them.",
}, ["through"], (p, hit) => {
  const c = hit.raw.because[0]!;
  return build(hit.raw, hit.ch, `${cellName(p, c)} has track and only two open sides, so ${outcome(p, hit.ch)}`, `which way can the track leave ${cellName(p, c)}?`, cellFocus([c]));
});

export const countFull = technique({
  id: "tracks.count-full", name: "count reached", level: 3, practice: { params: EASY },
  description: "once a row or column has as many track cells as its number, the rest of it is empty.",
}, ["count-full"], (p, hit) => {
  const i = hit.raw.count!;
  return build(hit.raw, hit.ch, `${countName(p, i)} already has its ${target(p, i)} track cells, so ${outcome(p, hit.ch)}`, `count the track in ${countName(p, i)}`, countFocus(i));
});

export const countNeeds = technique({
  id: "tracks.count-needs", name: "every spot is needed", level: 4, practice: { params: EASY },
  description: "if a row or column has only as many cells left that could hold track as its number still needs, they all do.",
}, ["count-needs"], (p, hit) => {
  const i = hit.raw.count!;
  return build(hit.raw, hit.ch, `${countName(p, i)} needs ${target(p, i)} track cells and has no more room than that, so ${outcome(p, hit.ch)}`, `where can the track in ${countName(p, i)} go?`, countFocus(i));
});

export const noLoop = technique({
  id: "tracks.no-loop", name: "no loop, no early finish", level: 5, practice: { params: EASY },
  description: "joining the two ends of one piece of track would make a loop; joining the entrance's piece to the exit's while other track or counts are still missing would end the track too early. either way that edge stays empty.",
}, ["loop"], (p, hit) => {
  const [a, b] = hit.raw.because as [number, number];
  return build(hit.raw, hit.ch, `joining ${cellName(p, a)} to ${cellName(p, b)} would close a loop or finish the track too early, so ${outcome(p, hit.ch)}`, `follow the track from ${cellName(p, a)}`, cellFocus([a]));
});

export const neighbours = technique({
  id: "tracks.neighbours", name: "dragged-in neighbor", level: 6, practice: { params: MEDIUM },
  description: "a cell whose only other open sides are blocked would, if it had track, have to carry it into its neighbor along the row or column. if that line has only one track cell left, the cell can't have track; if it has only one empty cell left, the neighbor must have track.",
}, ["neighbours"], (p, hit) => {
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
}, ["trial"], (p, hit) => {
  return build(hit.raw, hit.ch, `trying the other way breaks a rule, so ${outcome(p, hit.ch)}`, `try ${cellList(p, hit.raw.because)} both ways`, cellFocus(hit.raw.because));
});

export const tracksTechniques: TracksTechnique[] = [noRoom, through, countFull, countNeeds, noLoop, neighbours, trial];
