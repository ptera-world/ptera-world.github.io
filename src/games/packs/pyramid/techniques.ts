import type { Plugin, Step, Technique } from "../../core/types";
import { cardName } from "../../lib/cards/deck";
import { planner } from "../../lib/plan";
import type { CardFocus } from "../../lib/cards/table";
import { actionOf, dealState, pileName, pyramid, pyrOf, rulesOf, toPos, type PyramidAction, type PyramidInteraction, type PyramidPuzzle, type PyramidState } from "./logic";
import { cardAt, freedBy, PYR, removals, solve, type Move } from "./solver";

type PyramidTechnique = Technique<PyramidPuzzle, PyramidState, PyramidAction>;

const HINT_BUDGET = 30_000;

const stateKey = (s: PyramidState) => `${s.recycles}|${s.piles.map((pl) => pl.c.join(".")).join("|")}`;

export const plan = planner<PyramidPuzzle, PyramidState, Move>({
  key: stateKey,
  init: dealState,
  step: (p, s, m) => pyramid.reduce(p, s, actionOf(m)),
  search: (p, s) => solve(pyrOf(p), toPos(s), rulesOf(p), HINT_BUDGET),
  known: (p) => p.solution,
});

const plural = (n: number) => (n === 1 ? "1 card" : `${n} cards`);

function pairStep(p: PyramidPuzzle, s: PyramidState, m: Extract<Move, { t: "pair" }>, lead: string, nudge: string): Step<PyramidAction> {
  const pos = toPos(s);
  const a = cardAt(pyrOf(p), pos, m.a), b = cardAt(pyrOf(p), pos, m.b);
  const frees = freedBy(pos, [m.a, m.b]);
  return {
    message: `${lead} ${cardName(a)} and ${cardName(b)} add up to 13${frees ? `, and taking them frees ${plural(frees)}` : ""}.`,
    nudge,
    focus: { cards: [a, b] } satisfies CardFocus,
    nudgeFocus: { piles: [m.a, m.b] } satisfies CardFocus,
    actions: [actionOf(m)],
  };
}

export const king: PyramidTechnique = {
  id: "pyramid.king",
  name: "free king",
  puzzles: [pyramid],
  level: 1,
  color: "#3fa34d",
  description: "a king is worth 13 on its own, so a free king never waits for a partner: take it as soon as it is free.",
  instances(p, s, visit) {
    for (const m of removals(pyrOf(p), toPos(s))) {
      if (m.t !== "take") continue;
      const card = cardAt(pyrOf(p), toPos(s), m.a);
      if (visit({
        message: `${cardName(card)} is free and a king, so it goes on its own.`,
        nudge: "a king is free",
        focus: { cards: [card] } satisfies CardFocus,
        nudgeFocus: { piles: [m.a] } satisfies CardFocus,
        actions: [actionOf(m)],
      })) return;
    }
  },
};

export const freePair: PyramidTechnique = {
  id: "pyramid.free-pair",
  name: "free pair",
  puzzles: [pyramid],
  level: 2,
  color: "#3a7bd5",
  description: "two free cards in the pyramid that add up to 13 can go together. when there are several pairs, start with the one that frees the most cards underneath.",
  instances(p, s, visit) {
    for (const m of removals(pyrOf(p), toPos(s))) {
      if (m.t !== "pair" || m.a < PYR) continue;
      if (visit(pairStep(p, s, m, "both free in the pyramid:", "two free cards in the pyramid add up to 13"))) return;
    }
  },
};

export const wasteMatch: PyramidTechnique = {
  id: "pyramid.waste-match",
  name: "waste match",
  puzzles: [pyramid],
  level: 3,
  color: "#d5873a",
  description: "before drawing, check the top card of the waste against the free cards in the pyramid: if they add up to 13, use it. every draw you skip is a card you keep for later.",
  instances(p, s, visit) {
    for (const m of removals(pyrOf(p), toPos(s))) {
      if (m.t !== "pair" || m.a >= PYR) continue;
      if (visit(pairStep(p, s, m, `the waste's top card and a free card in ${pileName(m.b)}:`, "the top of the waste matches a free card"))) return;
    }
  },
};

export const pyramidTechniques: PyramidTechnique[] = [king, freePair, wasteMatch];

/** True if `step` removes the card the cursor is on. */
export function aims(_p: PyramidPuzzle, step: Step<PyramidAction>, target: unknown): boolean {
  const pile = (target as { pile?: number } | null)?.pile;
  return step.actions.some((a) => (a.type === "take" ? a.pile === pile : a.type === "pair" ? a.a === pile || a.b === pile : false));
}

/** Runs ahead of technique hints: a position no line of play can win any more is pointed out first. */
export const checkWinnable: Plugin<PyramidPuzzle, PyramidState, PyramidAction, PyramidInteraction> = {
  id: "pyramid.check-winnable",
  name: "hints check the game can still be won",
  description: "asking for a hint first says so if no sequence of moves can win from here any more",
  category: "assists",
  appliesTo: [pyramid],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => {
      if (session.finished) return undefined;
      return plan(puzzle, state).impossible ? { message: "no sequence of moves wins from here any more. undo to get back to a winnable position." } : undefined;
    }, { owner, priority: 90 });
  },
};

/** The actions of a winning line from `s`, or null if none is known. */
export function solveFrom(p: PyramidPuzzle, s: PyramidState): { moves: PyramidAction[] } | null {
  const path = plan(p, s).path;
  return path ? { moves: path.map(actionOf) } : null;
}

