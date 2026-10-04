import { defineSchema } from "../../core/schema";
import { definePlugins } from "../../core/define";
import {
  dominosa, findConflicts, wrongMarksHint,
  type Conflicts, type DominosaAction, type DominosaFocus, type DominosaInteraction, type DominosaPuzzle, type DominosaState,
} from "./logic";
import { CONFLICTS_KEY } from "./view";

const plugin = definePlugins<DominosaPuzzle, DominosaState, DominosaAction, DominosaInteraction>();

/** Shows visible rule breaks, and reports the ones a player move just made as a mistake fx. */
export const conflicts = plugin({
  id: "dominosa.conflicts",
  name: "show conflicts",
  description: "marks rule breaks you can see without knowing the answer in red: a domino placed twice, and cells nothing can cover any more",
  category: "assists",
  appliesTo: [dominosa],
  enabledByDefault: true,
  settings: defineSchema({
    duplicates: { type: "bool", label: "dominoes placed twice", default: true },
    stuck: { type: "bool", label: "cells nothing can cover", default: true },
  }),
  setup({ session, settings, owner }) {
    const shown = (marks: readonly number[]): Conflicts => {
      const c = findConflicts(session.puzzle, marks);
      return { duplicates: settings.duplicates ? c.duplicates : [], stuck: settings.stuck ? c.stuck : [] };
    };
    session.hooks.derive.tap((d, { state }) => ({ ...d, [CONFLICTS_KEY]: shown(state.marks) }), { owner });
    session.hooks.change.tap(({ prev, state, cause, source }) => {
      if (cause !== "action" || source?.kind !== "player") return;
      const before = shown(prev.marks), after = shown(state.marks);
      const placements = after.duplicates.filter((q) => !before.duplicates.includes(q));
      const because = after.stuck.filter((c) => !before.stuck.includes(c));
      if (placements.length || because.length) session.hooks.fx.call({ kind: "mistake", focus: { placements, because } satisfies DominosaFocus });
    }, { owner });
  },
});

/** Runs ahead of technique hints (priority 100), so a wrong mark is pointed out before any move. */
export const checkMarks = plugin({
  id: "dominosa.check-marks",
  name: "hints check your marks first",
  description: "asking for a hint points out dominoes and lines that don't match the solution before suggesting anything else",
  category: "assists",
  appliesTo: [dominosa],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => wrongMarksHint(puzzle, state) ?? undefined, { owner, priority: 90 });
  },
});

export const dominosaPlugins = [conflicts, checkMarks];
