import type { Plugin } from "../../core/types";
import { inertia, canCollectAll, cellAt, gemCount, unreachableGems, type InertiaAction, type InertiaFocus, type InertiaInteraction, type InertiaPuzzle, type InertiaState } from "./logic";

/** Runs ahead of technique hints (priority 100): gems that can no longer be reached are pointed out first. */
export const checkReachable: Plugin<InertiaPuzzle, InertiaState, InertiaAction, InertiaInteraction> = {
  id: "inertia.check-reachable",
  name: "hints check every gem can still be reached",
  description: "asking for a hint first says so if some gems can no longer be collected from where the ball is",
  category: "assists",
  appliesTo: [inertia],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => {
      if (state.dead) return { message: "the ball hit a mine. undo to step back.", focus: { path: [state.pos] } satisfies InertiaFocus };
      if (!gemCount(state.gems) || canCollectAll(puzzle, state.pos, state.gems)) return undefined;
      const lost = unreachableGems(puzzle, state.pos, state.gems);
      return {
        message: lost.length
          ? `from here the ball can never reach ${lost.length === 1 ? `the gem at ${cellAt(puzzle, lost[0]!)}` : `${lost.length} of the gems`}. undo until hints come back.`
          : "from here no single route can pick up every gem left: going after some cuts off others. undo until hints come back.",
        focus: { gems: lost } satisfies InertiaFocus,
      };
    }, { owner, priority: 90 });
  },
};
