import type { Plugin } from "../../core/types";
import { cellList, type BlackboxAction, type BlackboxFocus, type BlackboxInteraction, type BlackboxPuzzle, type BlackboxState } from "./logic";
import { certain } from "./techniques";

type BlackboxPlugin = Plugin<BlackboxPuzzle, BlackboxState, BlackboxAction, BlackboxInteraction>;

/** Runs ahead of technique hints (priority 100): balls and locks the lasers already rule out come first. */
export const checkMarks: BlackboxPlugin = {
  id: "blackbox.check-marks",
  name: "hints check your balls first",
  description: "asking for a hint first points out balls you've placed where the lasers so far rule a ball out, and locks on cells the lasers prove hold one (judged only from the lasers you've fired)",
  category: "assists",
  appliesTo: ["blackbox"],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => {
      if (state.solved) return undefined;
      const c = certain(puzzle, state);
      if (!c) return undefined;
      const badBalls = c.empty.filter((x) => state.guesses[x]);
      const badLocks = c.balls.filter((x) => state.locks[x]);
      if (!badBalls.length && !badLocks.length) return undefined;
      const parts: string[] = [];
      if (badBalls.length) parts.push(`the lasers so far rule out a ball at ${cellList(puzzle, badBalls)}`);
      if (badLocks.length) parts.push(`the lasers so far prove there's a ball at ${cellList(puzzle, badLocks)}, which you locked`);
      const actions: BlackboxAction[] = [];
      if (badBalls.length) actions.push({ type: "ball", cells: badBalls, value: false });
      if (badLocks.length) actions.push({ type: "lock", cells: badLocks, value: false });
      return { message: parts.join(", and "), focus: { cells: [...badBalls, ...badLocks], entries: [] } satisfies BlackboxFocus, actions };
    }, { owner, priority: 90 });
  },
};

export const blackboxPlugins: BlackboxPlugin[] = [checkMarks];
