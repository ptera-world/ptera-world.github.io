import { defineSchema } from "../../core/schema";
import { definePlugins } from "../../core/define";
import {
  findConflicts, lightup, wrongMarksHint,
  type Conflicts, type LightupAction, type LightupFocus, type LightupInteraction, type LightupPuzzle, type LightupState,
} from "./logic";
import { CONFLICTS_KEY } from "./view";

const plugin = definePlugins<LightupPuzzle, LightupState, LightupAction, LightupInteraction>();

/** Shows visible rule breaks, and reports the ones a player move just made as a mistake fx. */
export const conflicts = plugin({
  id: "lightup.conflicts",
  name: "show conflicts",
  description: "marks rule breaks you can see without knowing the answer in red: a ring around lights that shine on each other, numbers that can't get the right count any more, and cells nothing can light",
  category: "assists",
  appliesTo: [lightup],
  enabledByDefault: true,
  settings: defineSchema({
    lights: { type: "bool", label: "lights that see each other", default: true },
    clues: { type: "bool", label: "numbers that can't be met", default: true },
    dark: { type: "bool", label: "cells nothing can light any more", default: true },
  }),
  setup({ session, settings, owner }) {
    const shown = (marks: readonly number[]): Conflicts => {
      const c = findConflicts(session.puzzle, marks);
      return {
        lights: settings.lights ? c.lights : [],
        clues: settings.clues ? c.clues : [],
        dark: settings.dark ? c.dark : [],
      };
    };
    session.hooks.derive.tap((d, { state }) => ({ ...d, [CONFLICTS_KEY]: shown(state.marks) }), { owner });
    session.hooks.change.tap(({ prev, state, cause, source }) => {
      if (cause !== "action" || source?.kind !== "player") return;
      const before = shown(prev.marks), after = shown(state.marks);
      const fresh = (k: keyof Conflicts) => after[k].filter((c) => !before[k].includes(c));
      const cells = [...fresh("lights"), ...fresh("dark")], because = fresh("clues");
      if (cells.length || because.length) session.hooks.fx.call({ kind: "mistake", focus: { cells, because } satisfies LightupFocus });
    }, { owner });
  },
});

/** Runs ahead of technique hints (priority 100), so a wrong mark is pointed out before any move. */
export const checkMarks = plugin({
  id: "lightup.check-marks",
  name: "hints check your marks first",
  description: "asking for a hint points out lights and no-light marks that don't match the solution before suggesting anything else",
  category: "assists",
  appliesTo: [lightup],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => wrongMarksHint(puzzle, state) ?? undefined, { owner, priority: 90 });
  },
});

export const lightupPlugins = [conflicts, checkMarks];
