import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, PuzzleDef, Rating } from "../../core/types";
import { cardCode, cardName, parseCards, shuffledDeck } from "../../lib/cards/deck";
import type { Pile } from "../../lib/cards/piles";
import type { CardCursor } from "../../lib/cards/table";
import { canDraw, canPlay, COVERS, DRAW, draw, isWon, moves, play, SPOTS, solve, type Move, type Pos, type Rules } from "./solver";

export const params = defineSchema({
  connect: { type: "bool", label: "aces and kings connect", default: true, description: "a king can be played on an ace and an ace on a king, so ranks wrap around" },
  recycles: { type: "int", label: "turn-overs of the waste", default: 0, min: 0, max: 3, description: "how many times the waste may go back into the stock (0 = none)" },
  winnable: { type: "bool", label: "always winnable", default: true, description: "deal again until the solver finds a win" },
});

export interface TriPeaksPuzzle {
  /** 52 cards in dealing order: the 28 tableau spots (row by row from the apexes down, left to right), then the stock, first card drawn first. */
  deck: number[];
  connect: boolean;
  recycles: number;
  /** A win from the start (spots played, −1 for a stock click), found when the deal was made. */
  solution?: Move[];
}

/** Piles: 0 stock, 1 waste, 2…29 tableau spots (apex row first), one card each. */
export interface TriPeaksState {
  piles: Pile[];
  moves: number;
  score: number;
  /** Tableau plays in a row since the last stock click. */
  streak: number;
  /** Peaks whose apex has been played. */
  peaks: number;
  recycles: number;
}

export type TriPeaksAction = { type: "draw" } | { type: "play"; spot: number };

export interface TriPeaksInteraction {
  cursor: CardCursor;
}

export const STOCK = 0, WASTE = 1, TABLE = 2;

export const rulesOf = (p: TriPeaksPuzzle): Rules => ({ connect: p.connect, recycles: p.recycles });

export const PLAY_POINTS = 5, PEAK_POINTS = 15;

export function toPos(s: TriPeaksState): Pos {
  return {
    spots: s.piles.slice(TABLE).map((pl) => pl.c[0] ?? -1),
    stock: s.piles[STOCK]!.c.slice(),
    waste: s.piles[WASTE]!.c.slice(),
    used: s.recycles,
  };
}

export function fromPos(p: Pos, meta: Omit<TriPeaksState, "piles" | "recycles">): TriPeaksState {
  return {
    piles: [
      { c: p.stock.slice(), d: p.stock.length },
      { c: p.waste.slice(), d: 0 },
      ...p.spots.map((c, i): Pile => ({ c: c >= 0 ? [c] : [], d: c >= 0 && COVERS[i]!.some((u) => p.spots[u]! >= 0) ? 1 : 0 })),
    ],
    recycles: p.used,
    ...meta,
  };
}

export function startPos(p: TriPeaksPuzzle): Pos {
  const pos: Pos = { spots: p.deck.slice(0, SPOTS), stock: p.deck.slice(SPOTS).reverse(), waste: [], used: 0 };
  pos.waste.push(pos.stock.pop()!);
  return pos;
}

export const pileName = (pile: number): string => (pile === STOCK ? "the stock" : pile === WASTE ? "the waste" : `tableau card ${pile - TABLE + 1}`);

export const actionOf = (m: Move): TriPeaksAction => (m === DRAW ? { type: "draw" } : { type: "play", spot: m });

const GEN_BUDGET = 30_000;

async function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<TriPeaksPuzzle> {
  let last: TriPeaksPuzzle | null = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const puzzle: TriPeaksPuzzle = { deck: shuffledDeck(rng), connect: v.connect, recycles: v.recycles };
    if (!v.winnable) return puzzle;
    const r = solve(rulesOf(puzzle), startPos(puzzle), GEN_BUDGET);
    if (r.path) return { ...puzzle, solution: r.path };
    last = puzzle;
    await ctx.yield();
  }
  return last!;
}

// --- formats ---

const HEAD_RE = /^\s*aces\s+(connect|apart)(?:\s*[,;]\s*turn-?overs?\s*(\d+))?\s*$/im;

/**
 * Plain deal: an optional "aces connect, turnovers 1" line (or "aces apart"), then the 52 cards as
 * codes (like TH or 5c) in dealing order: the 28 tableau cards, then the stock, first card drawn first.
 */
export const dealFormat: Format<TriPeaksPuzzle> = {
  id: "deal",
  label: "deal (aces line, then 52 cards in dealing order)",
  detect: (t) => /^(?:\s*aces\s+(?:connect|apart).*\n)?(?:\s*(?:10|[A2-9TJQK])[CDHS♣♦♥♠]\s*,?){52}\s*$/i.test(t),
  parse(text) {
    const head = HEAD_RE.exec(text);
    const deck = parseCards(text.replace(HEAD_RE, ""));
    if (deck.length !== 52) throw new Error(`expected 52 cards, got ${deck.length}`);
    const dup = deck.find((c, i) => deck.indexOf(c) !== i);
    if (dup !== undefined) throw new Error(`${cardName(dup)} appears twice`);
    const recycles = Number(head?.[2] ?? 0);
    if (recycles > 9) throw new Error("turn-overs run from 0 to 9");
    return { deck, connect: (head?.[1] ?? "connect").toLowerCase() === "connect", recycles };
  },
  serialize: (p) => `aces ${p.connect ? "connect" : "apart"}, turnovers ${p.recycles}\n${p.deck.slice(0, SPOTS).map(cardCode).join(" ")}\n${p.deck.slice(SPOTS).map(cardCode).join(" ")}`,
};

// --- rules for the table ---

export function canLift(_p: TriPeaksPuzzle, s: TriPeaksState, pile: number, index: number): boolean {
  if (pile < TABLE || index !== 0) return false;
  const pl = s.piles[pile]!;
  return pl.c.length === 1 && pl.d === 0;
}

export function playAction(p: TriPeaksPuzzle, s: TriPeaksState, pile: number): TriPeaksAction | null {
  return pile >= TABLE && canPlay(rulesOf(p), toPos(s), pile - TABLE) ? { type: "play", spot: pile - TABLE } : null;
}

export function dropAction(p: TriPeaksPuzzle, s: TriPeaksState, from: number, _index: number, to: number): TriPeaksAction | null {
  return to === WASTE ? playAction(p, s, from) : null;
}

/** Clicking: the stock draws; a free card that fits the waste goes onto it. */
export function tapAction(p: TriPeaksPuzzle, s: TriPeaksState, pile: number): TriPeaksAction[] | null {
  if (pile === STOCK) return canDraw(rulesOf(p), toPos(s)) ? [{ type: "draw" }] : null;
  const a = playAction(p, s, pile);
  return a ? [a] : null;
}

function describeAction(_p: TriPeaksPuzzle, a: TriPeaksAction, before: TriPeaksState, after: TriPeaksState): string {
  if (a.type === "draw") {
    if (!before.piles[STOCK]!.c.length) return "turn the waste over";
    const top = after.piles[WASTE]!.c[after.piles[WASTE]!.c.length - 1]!;
    return `draw ${cardName(top)}`;
  }
  const card = before.piles[TABLE + a.spot]!.c[0]!;
  const peak = after.peaks > before.peaks ? ", clearing a peak" : "";
  return `${cardName(card)} to the waste${after.streak > 1 ? ` (run of ${after.streak})` : ""}${peak}`;
}

function rate(p: TriPeaksPuzzle): Rating | null {
  if (!p.solution) return null;
  const draws = p.solution.filter((m) => m === DRAW).length;
  return { label: draws < 6 ? "easy" : draws < 12 ? "medium" : "hard", score: draws };
}

export const tripeaks: PuzzleDef<TriPeaksPuzzle, TriPeaksState, TriPeaksAction, TriPeaksInteraction, typeof params> = {
  id: "tripeaks",
  name: "TriPeaks",
  aliases: ["tri peaks", "three peaks", "solitaire"],
  tags: ["cards", "solitaire", "moves"],
  description: "three peaks of cards: play any free card that is one rank above or below the waste card, and clear all 28 before the stock runs out.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "classic", params: { connect: true, recycles: 0 } },
    { label: "aces and kings apart", params: { connect: false, recycles: 0 } },
    { label: "one turn-over", params: { connect: true, recycles: 1 } },
  ],
  generate,
  formats: [dealFormat],
  init: (p) => fromPos(startPos(p), { moves: 0, score: 0, streak: 0, peaks: 0 }),
  initInteraction: () => ({ cursor: { pile: TABLE + 27, index: 0, held: null } }),
  reduce(p, s, a) {
    const r = rulesOf(p);
    const pos = toPos(s);
    if (a.type === "draw") {
      if (!draw(r, pos)) return s;
      return fromPos(pos, { moves: s.moves + 1, score: s.score, streak: 0, peaks: s.peaks });
    }
    if (a.type !== "play" || !Number.isInteger(a.spot) || a.spot < 0 || a.spot >= SPOTS || !canPlay(r, pos, a.spot)) return s;
    play(pos, a.spot);
    const streak = s.streak + 1;
    const peak = a.spot < 3;
    const peaks = s.peaks + (peak ? 1 : 0);
    return fromPos(pos, { moves: s.moves + 1, score: s.score + PLAY_POINTS * streak + (peak ? PEAK_POINTS * peaks : 0), streak, peaks });
  },
  isSolved: (_p, s) => isWon(toPos(s)),
  isLost: (p, s) => {
    const pos = toPos(s);
    return !isWon(pos) && moves(rulesOf(p), pos).length === 0;
  },
  aims: (_p, step, target) => {
    const pile = (target as { pile?: number } | null)?.pile;
    return step.actions.some((a) => a.type === "play" && a.spot + TABLE === pile);
  },
  rate,
  rules: (p) => [
    "the 28 cards of the three peaks start with only the bottom row face up. a card is free once nothing overlaps it any more; the cards it was under turn face up when both are gone.",
    `play a free card onto the waste when it is one rank higher or lower than the waste card, whatever the suit${p.connect ? ". an ace and a king count as neighbours" : ". an ace and a king are not neighbours"}.`,
    "click the stock to turn a new card onto the waste. clear all 28 cards to win.",
    p.recycles ? `when the stock runs out, click it to turn the waste back over (${p.recycles === 1 ? "once" : `${p.recycles} times`} in all).` : "there's no second pass through the stock.",
    "score: each card played in a run (no stock click between) is worth 5 times its place in the run; the first, second and third peak cleared are worth 15, 30 and 45.",
  ],
  describe: (p) => `${p.connect ? "aces and kings connect" : "aces and kings apart"}${p.recycles ? `, ${p.recycles === 1 ? "one turn-over" : `${p.recycles} turn-overs`}` : ""}`,
  describeAction,
};
