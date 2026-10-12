import type { Plugin, Technique } from "../../core/types";
import { planner } from "../../lib/plan";
import { mahjong, type MahjongAction, type MahjongFocus, type MahjongInteraction, type MahjongPuzzle, type MahjongState } from "./logic";
import { boardOf, eachSafePair, remaining, solve, stuckPair } from "./solver";
import { groupName, matchKey } from "./tiles";

type MahjongTechnique = Technique<MahjongPuzzle, MahjongState, MahjongAction>;

const HINT_BUDGET = 60_000;

export const plan = planner<MahjongPuzzle, MahjongState, [number, number]>({
  key: (s) => s.gone.join(""),
  init: (p) => mahjong.init(p),
  step: (_p, s, [a, b]) => {
    const gone = s.gone.slice();
    gone[a] = 1;
    gone[b] = 1;
    return { gone, moves: s.moves + 1 };
  },
  search: (p, s) => solve(p.spots, p.tiles, s.gone, HINT_BUDGET),
  known: (p) => p.solution,
});

const groupOf = (p: MahjongPuzzle, s: MahjongState, i: number) => remaining(p.tiles, s.gone).get(matchKey(p.tiles[i]!)) ?? [];

export const safe: MahjongTechnique = {
  id: "mahjong.safe-pair",
  name: "all of a kind free",
  puzzles: [mahjong],
  level: 1,
  color: "#3fa34d",
  description: "when every tile left of a kind is free (both of the last two, or all four), pairing them any way can't go wrong: nothing else will ever need them.",
  instances(p, s, visit) {
    eachSafePair(boardOf(p.spots), p.tiles, s.gone, ([a, b]) => {
      const all = groupOf(p, s, a);
      return visit({
        message: `every ${groupName(p.tiles[a]!)} left (${all.length === 2 ? "both" : `all ${all.length}`}) is free, so pairing them can't go wrong.`,
        nudge: `look at the ${groupName(p.tiles[a]!)}`,
        focus: { tiles: [a, b] } satisfies MahjongFocus,
        nudgeFocus: { look: all } satisfies MahjongFocus,
        actions: [{ type: "match", a, b }],
      });
    });
  },
};

export const mahjongTechniques: MahjongTechnique[] = [safe];

/** Runs ahead of technique hints: a board that can't be cleared any more is pointed out first. */
export const checkClearable: Plugin<MahjongPuzzle, MahjongState, MahjongAction, MahjongInteraction> = {
  id: "mahjong.check-clearable",
  name: "hints check the board can still be cleared",
  description: "asking for a hint first says so if no order of matches can clear the board any more",
  category: "assists",
  appliesTo: [mahjong],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => {
      if (session.finished) return undefined;
      const stuck = stuckPair(boardOf(puzzle.spots), puzzle.tiles, state.gone);
      if (stuck) {
        return {
          message: `the last two ${groupName(puzzle.tiles[stuck[0]]!)} lie one above the other, so they can never both be free. undo to get back to a clearable board.`,
          focus: { look: stuck } satisfies MahjongFocus,
        };
      }
      return plan(puzzle, state).impossible ? { message: "no order of matches clears the board any more. undo to get back to a clearable one." } : undefined;
    }, { owner, priority: 90 });
  },
};

/** One match per pair of a clearing order from `s`, or null if none is known. */
export function solveFrom(p: MahjongPuzzle, s: MahjongState): { moves: MahjongAction[] } | null {
  const path = plan(p, s).path;
  return path ? { moves: path.map(([a, b]): MahjongAction => ({ type: "match", a, b })) } : null;
}
