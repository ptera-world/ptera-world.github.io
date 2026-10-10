import type { Plugin, Technique } from "../../core/types";
import { inertia, DIR_NAMES, canCollectAll, cellAt, gemCount, nextGemRoute, unreachableGems, type InertiaAction, type InertiaFocus, type InertiaInteraction, type InertiaPuzzle, type InertiaState } from "./logic";

type InertiaTechnique = Technique<InertiaPuzzle, InertiaState, InertiaAction>;

export const nextGem: InertiaTechnique = {
  id: "inertia.next-gem",
  name: "nearest safe gem",
  puzzles: [inertia],
  level: 1,
  description: "some rolls lead to places you can never roll back from, cutting gems off for good. head for the nearest gem by the fewest rolls, only ever stopping where every remaining gem can still be reached.",
  instances(p, s, visit) {
    if (s.dead || !gemCount(s.gems)) return;
    const r = nextGemRoute(p, s);
    if (!r) return;
    const d = r.dirs[0]!;
    const n = r.dirs.length;
    const target = r.gems[0]!;
    const what = r.gems.length === 1 ? `the gem at ${cellAt(p, target)}` : `${r.gems.length} gems`;
    visit({
      message: n === 1
        ? `roll ${DIR_NAMES[d]}: it picks up ${what}, and every other gem can still be reached afterward.`
        : `roll ${DIR_NAMES[d]}: ${n} rolls reach ${what}, never stopping anywhere that cuts a gem off.`,
      nudge: `head for the gem at ${cellAt(p, target)}`,
      focus: { path: r.paths[0], gems: r.gems } satisfies InertiaFocus,
      nudgeFocus: { gems: [target] } satisfies InertiaFocus,
      actions: [{ type: "move", dir: d }],
    });
  },
  practice: { params: { width: 8, height: 7 } },
};

export const inertiaTechniques: InertiaTechnique[] = [nextGem];

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
