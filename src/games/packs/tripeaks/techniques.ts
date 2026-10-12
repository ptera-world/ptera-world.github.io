import type { Technique } from "../../core/types";
import { cardName } from "../../lib/cards/deck";
import { planner } from "../../lib/plan";
import type { CardFocus } from "../../lib/cards/table";
import { actionOf, rulesOf, tripeaks, toPos, WASTE, type TriPeaksAction, type TriPeaksPuzzle, type TriPeaksState } from "./logic";
import { canPlay, isFree, neighbours, solve, SPOTS, uncovers, type Move, type Pos } from "./solver";

type TriPeaksTechnique = Technique<TriPeaksPuzzle, TriPeaksState, TriPeaksAction>;

const HINT_BUDGET = 30_000;

export const plan = planner<TriPeaksPuzzle, TriPeaksState, Move>({
  key: (s) => s.piles.map((pl) => pl.c.join(".")).join("|"),
  init: (p) => tripeaks.init(p),
  step: (p, s, m) => tripeaks.reduce(p, s, actionOf(m)),
  search: (p, s) => solve(rulesOf(p), toPos(s), HINT_BUDGET),
  known: (p) => p.solution,
});

/** The moves of a winning line from `s` (for revealing), or null if none is known. */
export function solveFrom(p: TriPeaksPuzzle, s: TriPeaksState): { moves: TriPeaksAction[] } | null {
  const path = plan(p, s).path;
  return path ? { moves: path.map(actionOf) } : null;
}

const playable = (p: TriPeaksPuzzle, pos: Pos): number[] => Array.from({ length: SPOTS }, (_, i) => i).filter((i) => canPlay(rulesOf(p), pos, i));

export const uncover: TriPeaksTechnique = {
  id: "tripeaks.uncover",
  name: "uncover",
  puzzles: [tripeaks],
  level: 1,
  color: "#3fa34d",
  description: "when more than one free card fits the waste, play the one that sits on top of the most face-down cards. turning cards over is the only way new cards come into play without using up the stock.",
  instances(p, s, visit) {
    const pos = toPos(s);
    const options = playable(p, pos)
      .map((spot) => ({ spot, freed: uncovers(pos, spot).length }))
      .filter((o) => o.freed > 0)
      .sort((a, b) => b.freed - a.freed || a.spot - b.spot);
    for (const o of options) {
      const card = pos.spots[o.spot]!;
      if (visit({
        message: `${cardName(card)} fits the waste and turns over ${o.freed === 1 ? "a face-down card" : `${o.freed} face-down cards`}.`,
        nudge: "a card you can play is lying on top of face-down cards",
        focus: { cards: [card], to: WASTE } satisfies CardFocus,
        nudgeFocus: { piles: [WASTE] } satisfies CardFocus,
        actions: [{ type: "play", spot: o.spot }],
      })) return;
    }
  },
};

/** The longest chain of plays starting at `first`, using only the cards that are free now. */
function chainFrom(p: TriPeaksPuzzle, pos: Pos, first: number): number[] {
  const free = Array.from({ length: SPOTS }, (_, i) => i).filter((i) => isFree(pos, i));
  const memo = new Map<string, number[]>();
  const best = (top: number, used: number): number[] => {
    const k = `${top}|${used}`;
    const hit = memo.get(k);
    if (hit) return hit;
    let out: number[] = [];
    free.forEach((spot, bit) => {
      if (used & (1 << bit) || !neighbours(pos.spots[spot]!, top, p.connect)) return;
      const rest = [spot, ...best(pos.spots[spot]!, used | (1 << bit))];
      if (rest.length > out.length) out = rest;
    });
    memo.set(k, out);
    return out;
  };
  const bit = free.indexOf(first);
  return [first, ...best(pos.spots[first]!, 1 << bit)];
}

export const longestRun: TriPeaksTechnique = {
  id: "tripeaks.longest-run",
  name: "longest run",
  puzzles: [tripeaks],
  level: 2,
  color: "#d98a2b",
  description: "look at the free cards you can already see and find the order that plays the most of them one after another from the waste card. starting with the wrong one can strand cards that the right start would have kept in the chain.",
  instances(p, s, visit) {
    const pos = toPos(s);
    const starts = playable(p, pos).map((spot) => chainFrom(p, pos, spot));
    if (starts.length < 2) return;
    const most = Math.max(...starts.map((c) => c.length));
    if (most < 2 || starts.every((c) => c.length === most)) return;
    for (const chain of starts.filter((c) => c.length === most)) {
      const cards = chain.map((spot) => pos.spots[spot]!);
      if (visit({
        message: `starting with ${cardName(cards[0]!)} plays ${most} cards in a row from what's face up: ${cards.map(cardName).join(", ")}.`,
        nudge: "the free cards you can play don't all lead to equally long runs",
        focus: { cards: [cards[0]!], to: WASTE } satisfies CardFocus,
        nudgeFocus: { piles: [WASTE] } satisfies CardFocus,
        actions: [{ type: "play", spot: chain[0]! }],
      })) return;
    }
  },
};

export const tripeaksTechniques: TriPeaksTechnique[] = [uncover, longestRun];
