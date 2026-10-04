import { defineSchema } from "../../core/schema";
import type { Plugin } from "../../core/types";
import {
  findConflicts, wrongMarksHint,
  type Conflicts, type UndeadAction, type UndeadFocus, type UndeadInteraction, type UndeadPuzzle, type UndeadState,
} from "./logic";
import { CONFLICTS_KEY } from "./view";

type UndeadPlugin = Plugin<UndeadPuzzle, UndeadState, UndeadAction, UndeadInteraction>;

/** Shows visible rule breaks, and reports the ones a player move just made as a mistake fx. */
export const conflicts: UndeadPlugin = {
  id: "undead.conflicts",
  name: "show conflicts",
  description: "marks rule breaks you can see without knowing the answer in red: sight counts already too high or out of reach, and monster totals that can't come out right",
  category: "assists",
  appliesTo: ["undead"],
  enabledByDefault: true,
  settings: defineSchema({
    clues: { type: "bool", label: "sight counts that can't be met", default: true },
    totals: { type: "bool", label: "monster totals that can't be met", default: true },
  }),
  setup({ session, settings, owner }) {
    const shown = (s: UndeadState): Conflicts => {
      const c = findConflicts(session.puzzle, s);
      return { clues: settings.clues ? c.clues : [], totals: settings.totals ? c.totals : [] };
    };
    session.hooks.derive.tap((d, { state }) => ({ ...d, [CONFLICTS_KEY]: shown(state) }), { owner });
    session.hooks.change.tap(({ prev, state, cause, source }) => {
      if (cause !== "action" || source?.kind !== "player") return;
      const before = shown(prev), after = shown(state);
      const clues = after.clues.filter((c) => !before.clues.includes(c));
      const totals = after.totals.filter((c) => !before.totals.includes(c));
      if (clues.length || totals.length) session.hooks.fx.call({ kind: "mistake", focus: { cells: [], because: [], clues, totals } satisfies UndeadFocus });
    }, { owner });
  },
};

/** Runs ahead of technique hints (priority 100), so a wrong monster or mark is pointed out before any move. */
export const checkMarks: UndeadPlugin = {
  id: "undead.check-marks",
  name: "hints check your monsters first",
  description: "asking for a hint points out monsters and pencil marks that don't match the solution before suggesting anything else",
  category: "assists",
  appliesTo: ["undead"],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => wrongMarksHint(puzzle, state) ?? undefined, { owner, priority: 90 });
  },
};

export const undeadPlugins: UndeadPlugin[] = [conflicts, checkMarks];
