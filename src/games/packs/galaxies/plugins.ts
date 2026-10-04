import type { Plugin } from "../../core/types";
import { findConflicts, wrongMarksHint, type Conflicts, type GalaxiesAction, type GalaxiesFocus, type GalaxiesInteraction, type GalaxiesPuzzle, type GalaxiesState } from "./logic";
import { CONFLICTS_KEY } from "./view";

type GalaxiesPlugin = Plugin<GalaxiesPuzzle, GalaxiesState, GalaxiesAction, GalaxiesInteraction>;

/** Shows visible rule breaks, and reports the ones a player move just made as a mistake fx. */
export const conflicts: GalaxiesPlugin = {
  id: "galaxies.conflicts",
  name: "show conflicts",
  description: "marks tiles in red when their galaxy can't be right as drawn: their mirror image through the dot is off the board or in another galaxy, or they aren't joined to their dot",
  category: "assists",
  appliesTo: ["galaxies"],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { state }) => ({ ...d, [CONFLICTS_KEY]: findConflicts(session.puzzle, state) }), { owner });
    session.hooks.change.tap(({ prev, state, cause, source }) => {
      if (cause !== "action" || source?.kind !== "player") return;
      const before: Conflicts = findConflicts(session.puzzle, prev), after = findConflicts(session.puzzle, state);
      const was = new Set([...before.asymmetric, ...before.detached]);
      const because = [...new Set([...after.asymmetric, ...after.detached])].filter((t) => !was.has(t));
      if (because.length) session.hooks.fx.call({ kind: "mistake", focus: { tiles: [], because, dots: [] } satisfies GalaxiesFocus });
    }, { owner });
  },
};

/** Runs ahead of technique hints (priority 100), so a tile in the wrong galaxy is pointed out before any move. */
export const checkMarks: GalaxiesPlugin = {
  id: "galaxies.check-marks",
  name: "hints check your galaxies first",
  description: "asking for a hint points out tiles you put in the wrong galaxy before suggesting anything else",
  category: "assists",
  appliesTo: ["galaxies"],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => wrongMarksHint(puzzle, state) ?? undefined, { owner, priority: 90 });
  },
};

export const galaxiesPlugins: GalaxiesPlugin[] = [conflicts, checkMarks];
