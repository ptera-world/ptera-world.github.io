import { createRng } from "../../core/rng";
import type { DataAttribute, DataValue } from "../../core/types";
import { formatValue, type Bands, type Feedback } from "../../lib/dataset/compare";
import { kindOf, type Entry, type Kind } from "./kinds";
import { ABSENT, ELSEWHERE, RIGHT, markAttributes, markPositions } from "./marks";
import { LOOKS, POSITIONAL, RANK, SOUND_STEPS, spelled, type DataSource, type Look, type Settings } from "./params";

/** What a board tells about its answer up front: attribute id → value (sets: one member it has). */
export type Given = Record<string, string | boolean>;

export interface WordleBoard {
  /** The hidden entries (two when answers come in pairs); empty when the answer dodges. */
  answers: Entry[];
  /** Boards split by attribute: the values the answer has, which the player is told. */
  given?: Given;
  /** Target-form equations: the number the answer comes to, which the player is told. */
  target?: number;
  /** What the answer is shown by: a clue id (media:… or text:…), and for pictures how and where it looks first (0..1). */
  clue?: { id: string; look?: Look; spot: number };
}

export interface WordlePuzzle {
  s: Settings;
  /** Symbols per spelling (0 when spelling isn't compared). */
  length: number;
  /** Attribute ids the boards are split by. */
  split: string[];
  boards: WordleBoard[];
  /** Guesses filled in at the start. */
  starters: Entry[];
  /** Seeds the false marks. */
  seed: string;
}

export interface WordleState {
  guesses: Entry[];
  /** The spelling being typed, one symbol per position ("" for empty). */
  row: string[];
  /** Rounds: where each round's guesses start (an index into guesses); the last is the round being played. */
  starts?: number[];
  /** Rounds given up on. */
  passed?: number[];
}

export type WordleAction =
  | { type: "guess"; entry: Entry }
  | { type: "type"; sym: string }
  | { type: "back" }
  | { type: "row"; row: string[] }
  | { type: "submit" }
  | { type: "next" }
  | { type: "pass" };

export interface WordleInteraction {
  /** Board shown in full. */
  board: number;
}

/** Hint highlight: a board, and optionally some of its rows (indices into state.guesses). */
export interface WordleFocus {
  board: number;
  rows?: number[];
}

/**
 * How one guess is marked on one board:
 * - pos: per position. positions: ABSENT / ELSEWHERE / RIGHT; greens and killer: ABSENT / RIGHT;
 *   order: RIGHT, EARLIER (the answer's symbol comes before) or LATER; warm: RIGHT, NEAR or ABSENT.
 * - counts: counts: [right, elsewhere]; shared: [shared]; exact: [right].
 * - attrs: per compared attribute; slots: per member of an ordered list, RIGHT / ELSEWHERE / ABSENT.
 */
export interface Mark {
  pos?: number[];
  counts?: number[];
  attrs?: Feedback[];
  slots?: (number[] | null)[];
  /** Likeness: the guess's rank among all (1: the answer) and warmth (100: the answer, 0: middling). */
  rank?: { rank: number; temp: number };
  /** The guess is (one of) the board's answer(s). */
  found: boolean;
}

export const EARLIER = 3, LATER = 4, NEAR = 1;

export const kind = (data: DataSource, p: WordlePuzzle): Kind => kindOf(data, p.s, p.length, p);

const bandsOf = (s: Settings): Bands =>
  Object.fromEntries(s.close.map((id) => [id, s.by === "percent" ? { rel: s.within / 100 } : { abs: s.within }]));

/** Symbol order for order and warm marks: the keyboard's symbols sorted (letters a–z, digits 0–9). */
function rankOf(k: Kind): (c: string) => number {
  const all = [...new Set(k.keys.flat())].filter((c) => c !== "_").sort((a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) - Number(b) : a < b ? -1 : a > b ? 1 : 0));
  const at = new Map(all.map((c, i) => [c, i]));
  return (c) => at.get(c) ?? -1;
}

function markSeq(s: Settings, k: Kind, g: readonly string[], a: readonly string[]): Pick<Mark, "pos" | "counts"> {
  const m = markPositions(g, a);
  switch (s.marks) {
    case "positions": return { pos: m };
    case "greens": return { pos: m.map((x) => (x === RIGHT ? RIGHT : ABSENT)) };
    case "killer": return { pos: m.map((x) => (x === RIGHT ? RIGHT : ABSENT)) };
    case "counts": return { counts: [m.filter((x) => x === RIGHT).length, m.filter((x) => x === ELSEWHERE).length] };
    case "shared": return { counts: [m.filter((x) => x !== ABSENT).length] };
    case "exact": return { counts: [m.filter((x) => x === RIGHT).length] };
    case "order": {
      const r = rankOf(k);
      return { pos: g.map((c, i) => (c === a[i] ? RIGHT : r(a[i]!) < r(c) ? EARLIER : LATER)) };
    }
    case "warm": {
      const r = rankOf(k);
      return { pos: g.map((c, i) => (c === a[i] ? RIGHT : c !== "" && Math.abs(r(a[i]!) - r(c)) <= s.near ? NEAR : ABSENT)) };
    }
  }
  return { pos: m };
}

function slotMarks(a: DataAttribute, g: DataValue, ans: DataValue): number[] | null {
  if (a.kind !== "set" || !a.ordered || !Array.isArray(g)) return null;
  const as = Array.isArray(ans) ? (ans as string[]) : [];
  return (g as string[]).map((x, i) => (as[i] === x ? RIGHT : as.includes(x) ? ELSEWHERE : ABSENT));
}

/** The true mark of `guess` against one answer. */
export function markOne(p: WordlePuzzle, k: Kind, guess: Entry, answer: Entry): Mark {
  const s = p.s;
  const out: Mark = { found: k.same(guess, answer) };
  if (spelled(s)) {
    const g = k.seqOf(guess), a = k.seqOf(answer);
    if (g && a) {
      // a rearranged equation that counts as the answer is marked all right
      Object.assign(out, markSeq(s, k, g, out.found ? g : a));
    }
  }
  if (k.attrs.length) {
    const gv = k.valuesOf(guess) ?? {}, av = k.valuesOf(answer) ?? {};
    out.attrs = markAttributes(k.attrs, gv, av, bandsOf(s));
    if (s.slots) out.slots = k.attrs.map((a) => slotMarks(a, gv[a.id] ?? null, av[a.id] ?? null));
  }
  const l = k.likeness?.(answer);
  if (l && guess.item) {
    const c = l.close[l.index.get(guess.item) ?? -1];
    if (c) out.rank = c;
  }
  return out;
}

/** Pairs: each position's mark is the better of the two answers' (right over elsewhere over absent). */
function better(x: Mark, y: Mark): Mark {
  const rank = (v: number) => (v === RIGHT ? 3 : v === ELSEWHERE || v === NEAR ? 2 : v === ABSENT ? 0 : 1);
  return { ...x, pos: x.pos?.map((v, i) => (rank(y.pos![i]!) > rank(v) ? y.pos![i]! : v)), found: x.found || y.found };
}

/** The outcomes a position can show under the marks in play. */
function outcomes(s: Settings): number[] {
  switch (s.marks) {
    case "greens": case "killer": return [ABSENT, RIGHT];
    case "order": return [RIGHT, EARLIER, LATER];
    default: return [ABSENT, ELSEWHERE, RIGHT];
  }
}

/** One mark in the row turned false, seeded per puzzle, board and row (Fibble's lie: another of the outcomes). */
function lie(p: WordlePuzzle, m: Mark, b: number, row: number): Mark {
  if (!m.pos?.length) return m;
  const rng = createRng(`${p.seed}|lie|${b}|${row}`);
  const i = rng.int(m.pos.length);
  const others = outcomes(p.s).filter((o) => o !== m.pos![i]);
  const pos = m.pos.slice();
  pos[i] = rng.pick(others);
  return { ...m, pos };
}

const keyOf = (m: Mark): string => JSON.stringify([m.pos, m.counts, m.attrs?.map((f) => [f.verdict, f.dir, f.shared]), m.slots, m.rank?.rank]);

/** Everything a board shows, worked out from the guesses so far. */
export interface BoardView {
  /** Marks of the guesses shown on this board, in order (up to and including the one that solved it). */
  marks: Mark[];
  /** Index of the guess that solved the board, or -1. */
  solvedAt: number;
  /** Pairs: the indices of the guesses that found each answer (-1: not yet). */
  foundAt: number[];
  /** Answers that dodge: what could still be the answer. */
  left?: Entry[];
}

const viewCache = new WeakMap<WordleState, Map<number, BoardView>>();

/** Boards played one after another, each with its own guesses. */
export const inRounds = (p: WordlePuzzle): boolean => p.s.open === "rounds";

/** Rounds: the round being played (0 otherwise). */
export const currentRound = (p: WordlePuzzle, st: WordleState): number => (inRounds(p) ? Math.min(p.boards.length - 1, (st.starts?.length ?? 1) - 1) : 0);

/** The guesses board `b` is marked on: every guess, or (rounds) the ones made in its round. */
export function guessesOf(p: WordlePuzzle, st: WordleState, b: number): readonly Entry[] {
  if (!inRounds(p)) return st.guesses;
  const starts = st.starts ?? [0];
  if (b >= starts.length) return [];
  return st.guesses.slice(starts[b], starts[b + 1] ?? st.guesses.length);
}

/** True if the board shows marks yet: always, in sequence once every board before it is solved, in rounds once its round comes. */
export function isOpen(data: DataSource, p: WordlePuzzle, st: WordleState, b: number): boolean {
  if (inRounds(p)) return b <= currentRound(p, st);
  if (p.s.open !== "sequence") return true;
  for (let i = 0; i < b; i++) if (board(data, p, st, i).solvedAt < 0) return false;
  return true;
}

/** A board worked out up to some guesses; extended as guesses are added (states only ever append). */
interface Progress {
  guesses: readonly Entry[];
  marks: Mark[];
  solvedAt: number;
  foundAt: number[];
  left?: Entry[];
}
const progressCache = new WeakMap<WordlePuzzle, Map<number, Progress>>();

/** Absurdle's choice among the marks a guess could get: most answers left; then fewer right, fewer elsewhere, a fixed order. */
function dodge(p: WordlePuzzle, k: Kind, g: Entry, left: readonly Entry[]): { mark: Mark; list: Entry[] } | undefined {
  const buckets = new Map<string, { mark: Mark; list: Entry[] }>();
  for (const e of left) {
    const m = markOne(p, k, g, e);
    const key = keyOf(m);
    const x = buckets.get(key);
    if (x) x.list.push(e); else buckets.set(key, { mark: m, list: [e] });
  }
  const greens = (m: Mark) => (m.pos ?? []).filter((v) => v === RIGHT).length + (m.counts?.[0] ?? 0) + (m.attrs ?? []).filter((f) => f.verdict === "match").length;
  const yellows = (m: Mark) => (m.pos ?? []).filter((v) => v === ELSEWHERE).length + (m.counts?.[1] ?? 0) + (m.attrs ?? []).filter((f) => f.verdict !== "match" && f.verdict !== "miss").length;
  return [...buckets.entries()].sort(([ka, x], [kb, y]) =>
    y.list.length - x.list.length || greens(x.mark) - greens(y.mark) || yellows(x.mark) - yellows(y.mark) || (ka < kb ? -1 : ka > kb ? 1 : 0))[0]?.[1];
}

function advance(p: WordlePuzzle, k: Kind, b: number, pr: Progress, guesses: readonly Entry[]): void {
  const bd = p.boards[b]!;
  for (let r = pr.guesses.length; r < guesses.length && pr.solvedAt < 0; r++) {
    const g = guesses[r]!;
    if (pr.left) {
      const best = dodge(p, k, g, pr.left);
      if (!best) break;
      pr.marks.push(best.mark);
      pr.left = best.list;
      if (best.mark.found) { pr.solvedAt = r; pr.foundAt = [r]; }
      continue;
    }
    let m = bd.answers.map((a) => markOne(p, k, g, a)).reduce((x, y) => better(x, y));
    bd.answers.forEach((a, i) => { if (pr.foundAt[i]! < 0 && k.same(g, a)) pr.foundAt[i] = r; });
    if (p.s.lies === "one" && !m.found) m = lie(p, m, b, r);
    pr.marks.push(m);
    if (pr.foundAt.every((x) => x >= 0)) pr.solvedAt = r;
  }
  pr.guesses = guesses;
}

export function board(data: DataSource, p: WordlePuzzle, st: WordleState, b: number): BoardView {
  let cache = viewCache.get(st);
  if (!cache) viewCache.set(st, cache = new Map());
  const hit = cache.get(b);
  if (hit) return hit;
  const k = kind(data, p);
  let per = progressCache.get(p);
  if (!per) progressCache.set(p, per = new Map());
  let pr = per.get(b);
  const gs = guessesOf(p, st, b);
  const n = pr?.guesses.length ?? 0;
  // the saved progress still holds if these guesses extend the ones it was worked out for
  const extends_ = pr && n <= gs.length && (n === 0 || pr.guesses[n - 1] === gs[n - 1]);
  if (!pr || !extends_) {
    const bd = p.boards[b]!;
    pr = { guesses: [], marks: [], solvedAt: -1, foundAt: bd.answers.length ? bd.answers.map(() => -1) : [-1], ...(p.s.answer === "dodge" ? { left: [...(k.universe() ?? [])].filter((e) => fitsGiven(k, e, bd.given)) } : {}) };
    per.set(b, pr);
  }
  advance(p, k, b, pr, gs);
  // a view for exactly these guesses: rows up to and including the one that solved the board
  const rows = pr.solvedAt >= 0 ? pr.solvedAt + 1 : Math.min(pr.marks.length, gs.length);
  const solvedAt = pr.solvedAt >= 0 && pr.solvedAt < gs.length ? pr.solvedAt : -1;
  const v: BoardView = {
    marks: pr.marks.slice(0, solvedAt >= 0 ? solvedAt + 1 : rows),
    solvedAt,
    foundAt: pr.foundAt.map((x) => (x < gs.length ? x : -1)),
    ...(pr.left ? { left: pr.left } : {}),
  };
  cache.set(b, v);
  return v;
}

/** True if `e` has every value the board gives. */
export function fitsGiven(k: Kind, e: Entry, given: Given | undefined): boolean {
  if (!given) return true;
  const vals = k.valuesOf(e) ?? {};
  return Object.entries(given).every(([id, v]) => {
    const x = vals[id] ?? null;
    if (Array.isArray(x)) return x.includes(v as string);
    if (typeof v === "boolean") return x === v;
    return x !== null && String(x) === v;
  });
}

/** True if `cand` as the answer would have shown `shown` for guess `g` (with one false mark, if marks lie and the row didn't find it). */
function agrees(p: WordlePuzzle, k: Kind, g: Entry, shown: Mark, cand: Entry): boolean {
  const m = markOne(p, k, g, cand);
  if (p.s.lies !== "one" || shown.found) return keyOf(m) === keyOf(shown);
  if (m.found || !m.pos || !shown.pos) return false;
  let diff = 0;
  m.pos.forEach((v, i) => { if (v !== shown.pos![i]) diff++; });
  return diff === 1 && keyOf({ ...m, pos: shown.pos }) === keyOf(shown);
}

/**
 * What could still be board `b`'s answer from what the player has seen: possible answers agreeing
 * with every mark shown on it and not found on another board. null when the answers can't be listed.
 */
export function candidates(data: DataSource, p: WordlePuzzle, st: WordleState, b: number): Entry[] | null {
  const k = kind(data, p);
  const v = board(data, p, st, b);
  if (v.left) return v.left;
  // ranks would need every candidate's likeness to everything: too slow to list
  if (p.s.compare.includes(RANK)) return null;
  const all = k.universe();
  if (!all) return null;
  const found = p.boards.flatMap((o, ob) => (ob !== b ? o.answers.filter((_, i) => board(data, p, st, ob).foundAt[i]! >= 0) : []));
  const gs = guessesOf(p, st, b);
  return all.filter((e) => fitsGiven(k, e, p.boards[b]!.given) && !found.some((f) => k.same(f, e)) && v.marks.every((m, r) => agrees(p, k, gs[r]!, m, e)));
}

/** Why hard mode refuses `guess` on board `b`, or null. */
export function hardError(data: DataSource, p: WordlePuzzle, st: WordleState, b: number, guess: Entry): string | null {
  const s = p.s;
  if (!s.hard.length) return null;
  const k = kind(data, p);
  const v = board(data, p, st, b);
  if (!v.marks.length || v.solvedAt >= 0) return null;
  const rows = s.hardRows === "all" ? v.marks.map((_, r) => r) : [v.marks.length - 1];
  const gs = k.seqOf(guess);
  const count = (q: readonly string[], c: string) => q.filter((x) => x === c).length;
  for (const r of rows) {
    const m = v.marks[r]!;
    const prev = guessesOf(p, st, b)[r]!;
    const ps = k.seqOf(prev);
    if (s.hard.includes("keep")) {
      if (gs && ps && m.pos) for (let i = 0; i < m.pos.length; i++) if (m.pos[i] === RIGHT && gs[i] !== ps[i]) return `place ${i + 1} must be ${ps[i]}`;
      if (m.attrs) {
        const gv = k.valuesOf(guess) ?? {}, pv = k.valuesOf(prev) ?? {};
        for (const [i, f] of m.attrs.entries()) {
          const a = k.attrs[i]!;
          if (f.verdict === "match" && JSON.stringify(gv[a.id] ?? null) !== JSON.stringify(pv[a.id] ?? null)) return `${a.label} must be ${formatValue(a, pv[a.id] ?? null)}`;
        }
      }
    }
    if (gs && ps && m.pos && s.marks === "positions") {
      const found = (c: string) => ps.filter((x, i) => x === c && m.pos![i] !== ABSENT).length;
      for (const c of new Set(ps)) {
        if (s.hard.includes("use") && count(gs, c) < found(c)) return found(c) > 1 ? `it needs ${found(c)} ${c}s` : `it needs ${c}`;
        const absent = ps.some((x, i) => x === c && m.pos![i] === ABSENT);
        if (s.hard.includes("exact") && absent && count(gs, c) !== found(c)) return found(c) ? `it has exactly ${found(c)} ${c}${found(c) > 1 ? "s" : ""}` : `it has no ${c}`;
        if (s.hard.includes("drop") && absent && found(c) === 0 && count(gs, c) > 0) return `${c} is out`;
      }
      if (s.hard.includes("move")) for (let i = 0; i < ps.length; i++) if (m.pos[i] !== RIGHT && gs[i] === ps[i]) return `${ps[i]} can't go in place ${i + 1}`;
    }
    if (s.hard.includes("fit") && !agrees(p, k, prev, m, guess)) return `it doesn't agree with guess ${r + 1}'s marks`;
  }
  return null;
}

// --- endings ---

export const allSolved = (data: DataSource, p: WordlePuzzle, st: WordleState): boolean => p.boards.every((_, b) => board(data, p, st, b).solvedAt >= 0);
/** Avoiding: a guess found an answer. */
export const hit = (data: DataSource, p: WordlePuzzle, st: WordleState): boolean => p.s.goal === "avoid" && p.boards.some((_, b) => board(data, p, st, b).foundAt.some((x) => x >= 0));
export const outOfGuesses = (p: WordlePuzzle, st: WordleState): boolean => !inRounds(p) && p.s.limit > 0 && st.guesses.length >= p.s.limit;

/** Rounds: round `b` is over: found, given up on, or out of guesses. */
export function roundOver(data: DataSource, p: WordlePuzzle, st: WordleState, b: number): boolean {
  return board(data, p, st, b).solvedAt >= 0 || !!st.passed?.includes(b) || (p.s.limit > 0 && guessesOf(p, st, b).length >= p.s.limit);
}

/** Rounds: boards found. */
export const foundCount = (data: DataSource, p: WordlePuzzle, st: WordleState): number => p.boards.filter((_, b) => board(data, p, st, b).solvedAt >= 0).length;

function roundsOver(data: DataSource, p: WordlePuzzle, st: WordleState): boolean {
  const c = currentRound(p, st);
  if (!roundOver(data, p, st, c)) return false;
  return c === p.boards.length - 1 || (p.s.streak && board(data, p, st, c).solvedAt < 0);
}

export function isOver(data: DataSource, p: WordlePuzzle, st: WordleState): boolean {
  if (inRounds(p)) return roundsOver(data, p, st);
  if (p.s.goal === "avoid") return hit(data, p, st) || outOfGuesses(p, st);
  if (allSolved(data, p, st)) return true;
  return outOfGuesses(p, st) && !p.s.overtime;
}

export function isSolved(data: DataSource, p: WordlePuzzle, st: WordleState): boolean {
  // a run is played out whatever you find (its score says how many); a streak is won only by finding them all
  if (inRounds(p)) return roundsOver(data, p, st) && (!p.s.streak || allSolved(data, p, st));
  if (p.s.goal === "avoid") return !hit(data, p, st) && outOfGuesses(p, st);
  if (!allSolved(data, p, st)) return false;
  const last = Math.max(...p.boards.map((_, b) => board(data, p, st, b).solvedAt));
  return p.s.limit === 0 || last < p.s.limit;
}

export const isLost = (data: DataSource, p: WordlePuzzle, st: WordleState): boolean => isOver(data, p, st) && !isSolved(data, p, st);

/** The board's answer for display: its answers, or (dodging) the one it settled on, if any. */
export function shownAnswers(data: DataSource, p: WordlePuzzle, st: WordleState, b: number): Entry[] {
  const bd = p.boards[b]!;
  if (bd.answers.length) return bd.answers;
  const v = board(data, p, st, b);
  return v.solvedAt >= 0 ? [st.guesses[v.solvedAt]!] : v.left?.length ? [v.left[0]!] : [];
}

// --- clues ---

/** Wrong guesses on board `b`. */
export const wrongOn = (data: DataSource, p: WordlePuzzle, st: WordleState, b: number): number => board(data, p, st, b).marks.filter((m) => !m.found).length;

/** Steps a clue eases through. */
export function clueSteps(data: DataSource, p: WordlePuzzle, b: number): number {
  const c = p.boards[b]?.clue;
  if (!c) return 0;
  if (c.look) return LOOKS.find((l) => l.value === c.look)?.steps ?? 0;
  const m = c.id.startsWith("media:") ? kind(data, p).data?.media?.[c.id.slice(6)] : undefined;
  return m?.type === "audio" ? SOUND_STEPS.length - 1 : 0;
}

/** How far board `b`'s clue has eased: one step per wrong guess (when easing), capped. */
export function easeLevel(data: DataSource, p: WordlePuzzle, st: WordleState, b: number): number {
  return p.s.ease ? Math.min(clueSteps(data, p, b), wrongOn(data, p, st, b)) : 0;
}

/** Reveals showing on board `b`: one per wrong guess. */
export const revealsShown = (data: DataSource, p: WordlePuzzle, st: WordleState, b: number): string[] => p.s.reveals.slice(0, wrongOn(data, p, st, b));

export { POSITIONAL };
