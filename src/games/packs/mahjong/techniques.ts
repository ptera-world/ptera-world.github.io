import { hintFrom } from "../../core/define";
import type { Hint, Plugin, Step, Technique } from "../../core/types";
import { planner } from "../../lib/plan";
import { mahjong, type MahjongAction, type MahjongFocus, type MahjongInteraction, type MahjongPuzzle, type MahjongState } from "./logic";
import { boardOf, freeTiles, isFree, eachSafePair, remaining, solve, stuckPair } from "./solver";
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

/** Tiles that become free once a and b are gone. */
function freedBy(p: MahjongPuzzle, s: MahjongState, a: number, b: number): number[] {
  const board = boardOf(p.spots);
  const before = new Set(freeTiles(board, s.gone));
  const gone = s.gone.slice();
  gone[a] = 1;
  gone[b] = 1;
  return freeTiles(board, gone).filter((i) => !before.has(i));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function solverStep(p: MahjongPuzzle, s: MahjongState, path: readonly [number, number][], why: string): Step<MahjongAction> {
  const [a, b] = path[0]!;
  const rest = path.length - 1;
  const freed = freedBy(p, s, a, b);
  const opens = freed.length ? ` taking them frees ${plural(freed.length, "tile", "tiles")}.` : "";
  const tail = rest ? ` the solver clears the board in ${plural(rest, "more match", "more matches")} from there.` : " that clears the board.";
  return {
    message: `match the ${groupName(p.tiles[a]!)} shown: ${why}.${opens}${tail}`,
    nudge: `look at the ${groupName(p.tiles[a]!)}`,
    focus: { tiles: [a, b], look: freed } satisfies MahjongFocus,
    nudgeFocus: { look: groupOf(p, s, a).filter((i) => isFree(boardOf(p.spots), s.gone, i)) } satisfies MahjongFocus,
    actions: [{ type: "match", a, b }],
  };
}

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

function freeCount(p: MahjongPuzzle, s: MahjongState, i: number): number {
  const board = boardOf(p.spots);
  return groupOf(p, s, i).filter((j) => isFree(board, s.gone, j)).length;
}

export const mahjongTechniques: MahjongTechnique[] = [safe];

/** The first step of a whole clearing order, explained by how many of its kind are free. */
function orderStep(p: MahjongPuzzle, s: MahjongState): Step<MahjongAction> | null {
  const path = plan(p, s).path;
  if (!path?.length) return null;
  const [a] = path[0]!;
  const free = freeCount(p, s, a);
  if (free === 2) return solverStep(p, s, path, "they are the only free pair of their kind, and a whole clearing order takes them now");
  if (free >= 3) return solverStep(p, s, path, `${free} are free but ${groupOf(p, s, a).length === free ? "they" : "one more is buried, so"} which two go first matters, and these keep the board clearable`);
  return null;
}

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

export function fallbackHint(p: MahjongPuzzle, s: MahjongState): Hint<MahjongAction> | null {
  const step = orderStep(p, s);
  if (step) return hintFrom(null, step, 1) as Hint<MahjongAction>;
  const r = plan(p, s);
  if (r.path || r.impossible) return null;
  return { message: "the search for a clearing order ran out of time from here, so there's no suggestion. undoing a match or two may help." };
}

/** One match per pair of a clearing order from `s`, or null if none is known. */
export function solveFrom(p: MahjongPuzzle, s: MahjongState): { moves: MahjongAction[] } | null {
  const path = plan(p, s).path;
  return path ? { moves: path.map(([a, b]): MahjongAction => ({ type: "match", a, b })) } : null;
}
