import type { Step, Technique } from "../../core/types";
import { LINE, NO, UNK, edgeGrid } from "../../lib/edges";
import { tracks, CROSS, EMPTY, NONE, TRACK, cellList, cellName, countName, edgeList, type TracksAction, type TracksFocus, type TracksPuzzle, type TracksState } from "./logic";
import { closeObvious, freshKnowledge, scanSteps, sides, target, type Knowledge, type Step as SolverStep, type StepKind } from "./solver";

type TracksTechnique = Technique<TracksPuzzle, TracksState, TracksAction>;

/** A cell, a cell narrowed to its row or column count (see ViewHandle.targetAlong), or an edge. */
export type TracksTarget = { cell: number; count?: number } | { edge: number };

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

/** The count a step reasons about (a column below w, else a row), or null for a step about one cell. */
const countOf = (st: SolverStep): number | null => (lineKinds.includes(st.kind) && st.count !== undefined ? st.count : null);

/** Kinds whose every step tests one cell or one edge on its own. */
const perEdgeKinds: readonly StepKind[] = ["trial"];

/**
 * The hits in scan order, stopping when `visit` returns true. Aimed at an edge: only hits that
 * change it. Aimed at a cell: hits that reason from or touch it, except that a step testing one
 * cell or edge counts only when it tests that cell; narrowed to a count, only hits about it.
 */
function each(p: TracksPuzzle, s: TracksState, kinds: readonly StepKind[], visit: (hit: Hit) => boolean | void, target?: TracksTarget): void {
  const k = knowledge(p, s);
  if (!k) return;
  const g = edgeGrid(p.w, p.h);
  const keep = (raw: SolverStep, ch: Changes): boolean => {
    if (!target) return true;
    if ("edge" in target) return ch.lines.includes(target.edge) || ch.crosses.includes(target.edge);
    const c = target.cell;
    if (target.count !== undefined && countOf(raw) !== target.count) return false;
    if (perEdgeKinds.includes(raw.kind)) return !raw.lines.length && !raw.nos.length && (raw.tracks.includes(c) || raw.empties.includes(c));
    return raw.because.includes(c) || raw.tracks.includes(c) || raw.empties.includes(c)
      || [...raw.lines, ...raw.nos].some((e) => g.ea[e] === c || g.eb[e] === c);
  };
  scanSteps(p, k, kinds, (raw) => {
    const ch = changes(p, s, raw);
    return size(ch) > 0 && keep(raw, ch) && visit({ raw, ch }) === true;
  });
}

const asTarget = (t: unknown): TracksTarget | null =>
  t && typeof t === "object" && (typeof (t as { cell?: unknown }).cell === "number" || typeof (t as { edge?: unknown }).edge === "number") ? t as TracksTarget : null;

/** Hits at `target`: at an edge in scan order; at a cell those changing it or one of its edges first, then the rest, each group in scan order. */
function hitsAt(p: TracksPuzzle, s: TracksState, kinds: readonly StepKind[], target: TracksTarget): Hit[] {
  if ("edge" in target) {
    const all: Hit[] = [];
    each(p, s, kinds, (hit) => { all.push(hit); }, target);
    return all;
  }
  const g = edgeGrid(p.w, p.h);
  const c = target.cell;
  const own = (h: Hit) => h.ch.tracks.includes(c) || h.ch.empties.includes(c) || [...h.ch.lines, ...h.ch.crosses].some((e) => g.ea[e] === c || g.eb[e] === c);
  const first: Hit[] = [], later: Hit[] = [];
  each(p, s, kinds, (hit) => { (own(hit) ? first : later).push(hit); }, target);
  return [...first, ...later];
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

function technique(def: Omit<TracksTechnique, "instances" | "findAt" | "instancesAt" | "cellAt" | "puzzles">, kinds: readonly StepKind[], make: Make): TracksTechnique {
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
    cellAt: (p, s, t) => {
      const target = asTarget(t);
      const hit = target && hitsAt(p, s, kinds, target)[0];
      if (!hit || !target) return null;
      if ("edge" in target) return make(p, hit);
      const g = edgeGrid(p.w, p.h);
      const c = target.cell;
      const at = (e: number) => g.ea[e] === c || g.eb[e] === c;
      const ch = { lines: hit.ch.lines.filter(at), crosses: hit.ch.crosses.filter(at), tracks: hit.ch.tracks.filter((x) => x === c), empties: hit.ch.empties.filter((x) => x === c) };
      return size(ch) ? make(p, { ...hit, ch }) : null;
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
