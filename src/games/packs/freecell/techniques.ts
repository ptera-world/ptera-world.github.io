import type { Plugin, Technique } from "../../core/types";
import { cardName, safeHomeReason } from "../../lib/cards/deck";
import { planner } from "../../lib/plan";
import type { CardFocus } from "../../lib/cards/table";
import { freecell, whereTo, fromPos, pileName, toPos, type FreecellAction, type FreecellInteraction, type FreecellPuzzle, type FreecellState } from "./logic";
import { applyMove, clonePos, eachSafeHomeMove, isSafeHome, solve, type Move } from "./solver";

type FreecellTechnique = Technique<FreecellPuzzle, FreecellState, FreecellAction>;

/** Nodes the hint search may expand before giving up (a few hundred milliseconds at worst). */
const HINT_BUDGET = 40_000;

const stateKey = (s: FreecellState) => s.piles.map((pl) => pl.c.join(".")).join("|");

export const plan = planner<FreecellPuzzle, FreecellState, Move>({
  key: stateKey,
  init: (p) => ({ piles: fromPos({ cols: p.cols, cells: p.cells, found: p.found }), moves: 0 }),
  step: (p, s, m) => {
    const pos = toPos(s, p.cells.length);
    applyMove(pos, m);
    return { piles: fromPos(pos), moves: s.moves + 1 };
  },
  search: (p, s) => solve(toPos(s, p.cells.length), HINT_BUDGET),
  known: (p) => p.solution,
});

const lead = (s: FreecellState, m: Move) => s.piles[m.from]!.c[s.piles[m.from]!.c.length - m.n]!;

/** Why the first move of `path` helps, from what the next few moves of the same line do. */
function reason(p: FreecellPuzzle, s: FreecellState, path: readonly Move[]): string {
  const m = path[0]!;
  const C = p.cells.length;
  const pos = toPos(s, C);
  const card = lead(s, m);
  if (m.to >= C && m.to < C + 4) {
    return isSafeHome(pos.found, card)
      ? safeHomeReason(card)
      : "the winning line sends it home now";
  }
  const after = clonePos(pos);
  applyMove(after, m);
  const src = s.piles[m.from]!.c;
  const exposed = m.from >= C + 4 && src.length > m.n ? src[src.length - m.n - 1]! : -1;
  const movedTop = src[src.length - 1];
  for (const next of path.slice(1, 6)) {
    const st = { piles: fromPos(after), moves: 0 };
    const moved = lead(st, next);
    if (moved === exposed) return `this frees ${cardName(exposed)} under it, which then goes ${whereTo(p, st, next)}`;
    const dst = st.piles[next.to]!.c;
    if (next.to >= C + 4 && dst[dst.length - 1] === movedTop) return `so that ${cardName(moved)} can go on it next`;
    applyMove(after, next);
  }
  if (m.from >= C + 4 && src.length === m.n) return `this empties ${pileName(p, m.from)}, room to sort out another column`;
  if (m.from < C) return "this frees a cell";
  if (exposed >= 0) return `this gets at ${cardName(exposed)} under it`;
  return "it keeps the winning line going";
}

export const safeHome: FreecellTechnique = {
  id: "freecell.safe-home",
  name: "safe home",
  puzzles: [freecell],
  level: 1,
  color: "#3fa34d",
  description: "a card can go home for good once nothing could ever need to sit on it: aces and twos always, and any other card once both foundations of the other color have reached one rank below it.",
  instances(p, s, visit) {
    eachSafeHomeMove(toPos(s, p.cells.length), (m) => {
      const card = lead(s, m);
      return visit({
        message: `${cardName(card)} home: ${reason(p, s, [m])}.`,
        nudge: `a card in ${pileName(p, m.from)} can go home`,
        focus: { cards: [card], to: m.to } satisfies CardFocus,
        nudgeFocus: { piles: [m.from] } satisfies CardFocus,
        actions: [{ type: "move", ...m }],
      });
    });
  },
};

export const freecellTechniques: FreecellTechnique[] = [safeHome];

/** Runs ahead of technique hints: a position no line of play can win any more is pointed out first. */
export const checkWinnable: Plugin<FreecellPuzzle, FreecellState, FreecellAction, FreecellInteraction> = {
  id: "freecell.check-winnable",
  name: "hints check the game can still be won",
  description: "asking for a hint first says so if no sequence of moves can win from here any more",
  category: "assists",
  appliesTo: [freecell],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => {
      if (session.finished) return undefined;
      return plan(puzzle, state).impossible ? { message: "no sequence of moves wins from here any more. undo to get back to a winnable position." } : undefined;
    }, { owner, priority: 90 });
  },
};

/** The moves of a winning line from `s`, or null if none is known. */
export function solveFrom(p: FreecellPuzzle, s: FreecellState): { moves: FreecellAction[] } | null {
  const path = plan(p, s).path;
  return path ? { moves: path.map((m): FreecellAction => ({ type: "move", ...m })) } : null;
}
