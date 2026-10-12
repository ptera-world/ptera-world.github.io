import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, PuzzleDef, Rating } from "../../core/types";
import { cardCode, cardName, parseCards, rankOf, shuffledDeck } from "../../lib/cards/deck";
import { moveCards, type Pile } from "../../lib/cards/piles";
import type { CardCursor } from "../../lib/cards/table";
import { canDraw, cardAt, isFree, isGone, pairs, PYR, removable, ROW, solve, SPOTS, STOCK, WASTE, type Move, type Pos, type Rules } from "./solver";

export const params = defineSchema({
  passes: {
    type: "enum", label: "passes through the stock", default: "3",
    options: [{ value: "3", label: "three" }, { value: "2", label: "two" }, { value: "1", label: "one" }, { value: "0", label: "no limit" }],
  },
  winnable: { type: "bool", label: "always winnable", default: true, description: "deal again until the solver finds a win; with one pass that can take a moment, and some deals can't be told" },
});

export interface PyramidPuzzle {
  /** All 52 cards in dealing order: the first 28 are the pyramid row by row from the apex, the rest the stock, first card drawn first. */
  deck: number[];
  /** Passes through the stock allowed; 0 for no limit. */
  passes: number;
  /** A win from the start, found when the deal was made. */
  solution?: Move[];
}

/** Piles: 0 stock, 1 waste, 2–29 the pyramid spots row by row from the apex, one card each. */
export interface PyramidState {
  piles: Pile[];
  /** The pile whose card is picked and waits for a partner, or -1. */
  pick: number;
  /** Times the waste has gone back into the stock. */
  recycles: number;
  score: number;
  moves: number;
}

export type PyramidAction =
  | { type: "draw" }
  | { type: "pick"; pile: number }
  | { type: "take"; pile: number }
  | { type: "pair"; a: number; b: number };

export interface PyramidInteraction {
  cursor: CardCursor;
}

export const PAIR_POINTS = 10, KING_POINTS = 5, RECYCLE_POINTS = -20;
/** Clearing row r (0 is the apex) is worth ROW_POINTS × (7 − r). */
export const ROW_POINTS = 10;

export const rulesOf = (p: PyramidPuzzle): Rules => ({ passes: p.passes });
export const pyrOf = (p: PyramidPuzzle): number[] => p.deck.slice(0, SPOTS);

export function toPos(s: PyramidState): Pos {
  let gone = 0;
  for (let i = 0; i < SPOTS; i++) if (!s.piles[PYR + i]!.c.length) gone |= 1 << i;
  return { gone, stock: s.piles[STOCK]!.c.slice(), waste: s.piles[WASTE]!.c.slice(), recycles: s.recycles };
}

export function pileName(pile: number): string {
  if (pile === STOCK) return "the stock";
  if (pile === WASTE) return "the waste";
  const i = pile - PYR, r = ROW[i]!;
  return `row ${r + 1}, card ${i - (r * (r + 1)) / 2 + 1}`;
}

export const actionOf = (m: Move): PyramidAction => (m.t === "draw" ? { type: "draw" } : m.t === "take" ? { type: "take", pile: m.a } : { type: "pair", a: m.a, b: m.b });

export const isRemovable = (s: PyramidState, pile: number): boolean =>
  pile === WASTE ? s.piles[WASTE]!.c.length > 0 : pile >= PYR && pile < PYR + SPOTS && isFree(toPos(s).gone, pile - PYR);

const topCard = (s: PyramidState, pile: number): number => s.piles[pile]!.c[s.piles[pile]!.c.length - 1]!;

function rowBonus(before: number, after: number, piles: readonly number[]): number {
  let bonus = 0;
  for (const r of new Set(piles.filter((x) => x >= PYR).map((x) => ROW[x - PYR]!))) {
    const spots = Array.from({ length: SPOTS }, (_, i) => i).filter((i) => ROW[i] === r);
    if (spots.some((i) => !isGone(before, i)) && spots.every((i) => isGone(after, i))) bonus += ROW_POINTS * (7 - r);
  }
  return bonus;
}

function remove(s: PyramidState, piles: readonly number[], points: number): PyramidState {
  const out = s.piles.slice();
  for (const pile of piles) out[pile] = { c: s.piles[pile]!.c.slice(0, -1), d: 0 };
  const next = { ...s, piles: out, pick: -1, moves: s.moves + 1 };
  return { ...next, score: s.score + points + rowBonus(toPos(s).gone, toPos(next).gone, piles) };
}

const GEN_BUDGET = 40_000;

async function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<PyramidPuzzle> {
  const passes = Number(v.passes);
  const attempts = passes === 1 ? 200 : 40;
  let last: PyramidPuzzle | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const puzzle: PyramidPuzzle = { deck: shuffledDeck(rng), passes };
    if (!v.winnable) return puzzle;
    const start: Pos = { gone: 0, stock: puzzle.deck.slice(SPOTS).reverse(), waste: [], recycles: 0 };
    const r = solve(pyrOf(puzzle), start, rulesOf(puzzle), passes === 1 ? GEN_BUDGET / 2 : GEN_BUDGET);
    if (r.path) return { ...puzzle, solution: r.path };
    last = puzzle;
    await ctx.yield();
  }
  return last!;
}

// --- formats ---

const HEAD_RE = /^\s*passes\s*(\d+)\s*$/im;

/**
 * Plain deal: an optional "passes 3" line (0 for no limit), then the 52 cards as codes (like TH
 * or 5c) in dealing order: the 28 of the pyramid row by row from the apex, then the stock,
 * first card drawn first.
 */
export const dealFormat: Format<PyramidPuzzle> = {
  id: "deal",
  label: "deal (passes line, then 52 cards in dealing order)",
  detect: (t) => /^(?:\s*passes\s*\d+.*\n)?(?:\s*(?:10|[A2-9TJQK])[CDHS♣♦♥♠]\s*,?){52}\s*$/i.test(t),
  parse(text) {
    const head = HEAD_RE.exec(text);
    const deck = parseCards(text.replace(HEAD_RE, ""));
    if (deck.length !== 52) throw new Error(`expected 52 cards, got ${deck.length}`);
    const dup = deck.find((c, i) => deck.indexOf(c) !== i);
    if (dup !== undefined) throw new Error(`${cardName(dup)} appears twice`);
    const passes = Number(head?.[1] ?? 3);
    if (passes > 99) throw new Error("passes run from 0 (no limit) to 99");
    return { deck, passes };
  },
  serialize: (p) => `passes ${p.passes}\n${Array.from({ length: 7 }, (_, r) => p.deck.slice((r * (r + 1)) / 2, ((r + 1) * (r + 2)) / 2).map(cardCode).join(" ")).join("\n")}\n${p.deck.slice(SPOTS).map(cardCode).join(" ")}`,
};

// --- rules for the table ---

export function canLift(_p: PyramidPuzzle, s: PyramidState, pile: number, index: number): boolean {
  return pile !== STOCK && index === s.piles[pile]!.c.length - 1 && index >= 0 && isRemovable(s, pile);
}

export function moveAction(p: PyramidPuzzle, s: PyramidState, from: number, index: number, to: number): PyramidAction | null {
  if (!canLift(p, s, from, index)) return null;
  if (rankOf(topCard(s, from)) === 13) return { type: "take", pile: from };
  if (to === from || to === STOCK || !isRemovable(s, to) || rankOf(topCard(s, from)) + rankOf(topCard(s, to)) !== 13) return null;
  return { type: "pair", a: from, b: to };
}

/**
 * Tapping: the stock draws; a king goes at once; a card with a pick waiting pairs with it if it
 * can (tapping the pick puts it down), else becomes the pick.
 */
export function tapAction(p: PyramidPuzzle, s: PyramidState, pile: number, index: number): PyramidAction[] | null {
  if (pile === STOCK) return canDraw(toPos(s), rulesOf(p)) ? [{ type: "draw" }] : null;
  if (!canLift(p, s, pile, index)) return null;
  if (rankOf(topCard(s, pile)) === 13) return [{ type: "take", pile }];
  if (s.pick === pile) return [{ type: "pick", pile }];
  if (s.pick >= 0 && rankOf(topCard(s, pile)) + rankOf(topCard(s, s.pick)) === 13) return [{ type: "pair", a: s.pick, b: pile }];
  return [{ type: "pick", pile }];
}

function describeAction(_p: PyramidPuzzle, a: PyramidAction, before: PyramidState, after: PyramidState): string {
  switch (a.type) {
    case "draw": {
      if (!before.piles[STOCK]!.c.length) return "turn the waste over";
      return `draw ${cardName(topCard(after, WASTE))}`;
    }
    case "pick": return before.pick === a.pile ? `put ${cardName(topCard(before, a.pile))} down` : `pick up ${cardName(topCard(before, a.pile))}`;
    case "take": return `remove ${cardName(topCard(before, a.pile))}`;
    case "pair": return `remove ${cardName(topCard(before, a.a))} and ${cardName(topCard(before, a.b))}`;
  }
}

function rate(p: PyramidPuzzle): Rating | null {
  if (!p.solution) return null;
  const draws = p.solution.filter((m) => m.t === "draw").length;
  return { label: draws < 25 ? "easy" : draws < 45 ? "medium" : "hard", score: draws };
}

const describePasses = (n: number) => (n === 0 ? "no limit on passes" : n === 1 ? "one pass" : `${n} passes`);

export function dealState(p: PyramidPuzzle): PyramidState {
  const stock = p.deck.slice(SPOTS).reverse();
  return {
    piles: [{ c: stock, d: stock.length }, { c: [], d: 0 }, ...p.deck.slice(0, SPOTS).map((c) => ({ c: [c], d: 0 }))],
    pick: -1,
    recycles: 0,
    score: 0,
    moves: 0,
  };
}

export const pyramid: PuzzleDef<PyramidPuzzle, PyramidState, PyramidAction, PyramidInteraction, typeof params> = {
  id: "pyramid",
  name: "Pyramid",
  aliases: ["pyramid solitaire", "patience", "thirteens"],
  tags: ["cards", "solitaire", "moves"],
  description: "take apart the pyramid: remove free cards in pairs that add up to 13, or a king alone, with a stock and waste to help.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "three passes", params: { passes: "3" } },
    { label: "one pass", params: { passes: "1" } },
    { label: "no limit on passes", params: { passes: "0" } },
  ],
  generate,
  formats: [dealFormat],
  init: dealState,
  initInteraction: () => ({ cursor: { pile: PYR + 21, index: 0, held: null } }),
  reduce(p, s, a) {
    const pos = toPos(s);
    switch (a.type) {
      case "draw": {
        if (!canDraw(pos, rulesOf(p))) return s;
        if (s.piles[STOCK]!.c.length) {
          return { ...s, piles: moveCards(s.piles, STOCK, WASTE, 1, false), pick: -1, moves: s.moves + 1 };
        }
        const stock = s.piles[WASTE]!.c.slice().reverse();
        const piles = s.piles.slice();
        piles[STOCK] = { c: stock, d: stock.length };
        piles[WASTE] = { c: [], d: 0 };
        return { ...s, piles, pick: -1, recycles: s.recycles + 1, score: Math.max(0, s.score + RECYCLE_POINTS), moves: s.moves + 1 };
      }
      case "pick": {
        if (!isRemovable(s, a.pile) || rankOf(topCard(s, a.pile)) === 13) return s;
        return { ...s, pick: s.pick === a.pile ? -1 : a.pile };
      }
      case "take": {
        if (!isRemovable(s, a.pile) || rankOf(topCard(s, a.pile)) !== 13) return s;
        return remove(s, [a.pile], KING_POINTS);
      }
      case "pair": {
        if (!isRemovable(s, a.a) || !isRemovable(s, a.b) || !pairs(pyrOf(p), pos, a.a, a.b)) return s;
        return remove(s, [a.a, a.b], PAIR_POINTS);
      }
    }
  },
  isSolved: (_p, s) => s.piles.slice(PYR).every((pl) => !pl.c.length),
  isLost: (p, s) => {
    const pos = toPos(s);
    if (pos.gone === (1 << SPOTS) - 1 || canDraw(pos, rulesOf(p))) return false;
    return !removable(pos).some((a) => rankOf(cardAt(pyrOf(p), pos, a)) === 13 || removable(pos).some((b) => pairs(pyrOf(p), pos, a, b)));
  },
  rate,
  rules: (p) => [
    "the pyramid has seven rows; a card is free once both cards overlapping it from below are gone. the top card of the waste is free too.",
    "remove two free cards that add up to 13 (ace 1, jack 11, queen 12), or a free king on its own. clear all 28 pyramid cards to win.",
    "click the stock to turn over one card onto the waste; only the top waste card plays.",
    `when the stock runs out, click it to turn the waste back over (${describePasses(p.passes)} in all).`,
    "click a card to pick it, then click its partner. click the picked card again to put it down.",
  ],
  describe: (p) => `${describePasses(p.passes)}${p.solution ? "" : ", not known winnable"}`,
  describeAction,
};
