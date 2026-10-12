import type { Plugin } from "../../core/types";
import { planner } from "../../lib/plan";
import { actionOf, dealPos, fromPos, spider, toPos, type SpiderAction, type SpiderInteraction, type SpiderPuzzle, type SpiderState } from "./logic";
import { applyMove, solve, type Move } from "./solver";

const HINT_BUDGET = 20_000;

const stateKey = (s: SpiderState) => s.piles.map((pl) => `${pl.d}:${pl.c.join(".")}`).join("|");

export const plan = planner<SpiderPuzzle, SpiderState, Move>({
  key: stateKey,
  init: (p) => fromPos(dealPos(p), 0),
  step: (p, s, m) => {
    const pos = toPos(p, s);
    applyMove(p.deck, pos, m);
    return fromPos(pos, s.moves + 1);
  },
  search: (p, s) => solve(p.deck, toPos(p, s), HINT_BUDGET),
  known: (p) => p.solution,
});

/** Runs ahead of technique hints: a position no line of play can win any more is pointed out first. */
export const checkWinnable: Plugin<SpiderPuzzle, SpiderState, SpiderAction, SpiderInteraction> = {
  id: "spider.check-winnable",
  name: "hints check the game can still be won",
  description: "asking for a hint first says so if no sequence of moves can win from here any more",
  category: "assists",
  appliesTo: [spider],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => {
      if (session.finished) return undefined;
      return plan(puzzle, state).impossible ? { message: "no sequence of moves wins from here any more. undo to get back to a winnable position." } : undefined;
    }, { owner, priority: 90 });
  },
};

/** The actions of a winning line from `s`, or null if none is known. */
export function solveFrom(p: SpiderPuzzle, s: SpiderState): { moves: SpiderAction[] } | null {
  const path = plan(p, s).path;
  return path ? { moves: path.map((m) => actionOf(m)) } : null;
}
