import { defineSchema } from "../../core/schema";
import { definePlugins } from "../../core/define";
import { pearl, findConflicts, wrongMarksHint, type Conflicts, type PearlAction, type PearlFocus, type PearlInteraction, type PearlPuzzle, type PearlState } from "./logic";
import { CONFLICTS_KEY } from "./view";

const plugin = definePlugins<PearlPuzzle, PearlState, PearlAction, PearlInteraction>();

/** Shows visible rule breaks, and reports the ones a player move just made as a mistake fx. */
export const conflicts = plugin({
  id: "pearl.conflicts",
  name: "show conflicts",
  description: "marks rule breaks you can see without knowing the answer in red: cells with three lines or a dead end, pearls the lines break, and a closed loop that isn't the whole answer",
  category: "assists",
  appliesTo: [pearl],
  enabledByDefault: true,
  settings: defineSchema({
    cells: { type: "bool", label: "cells with too many lines or a dead end", default: true },
    pearls: { type: "bool", label: "broken pearls", default: true },
    loop: { type: "bool", label: "a loop closed too early", default: true },
  }),
  setup({ session, settings, owner }) {
    const shown = (s: PearlState): Conflicts => {
      const c = findConflicts(session.puzzle, s);
      return { cells: settings.cells ? c.cells : [], pearls: settings.pearls ? c.pearls : [], loop: settings.loop ? c.loop : [] };
    };
    session.hooks.derive.tap((d, { state }) => ({ ...d, [CONFLICTS_KEY]: shown(state) }), { owner });
    session.hooks.change.tap(({ prev, state, cause, source }) => {
      if (cause !== "action" || source?.kind !== "player") return;
      const before = shown(prev), after = shown(state);
      const fresh = (k: keyof Conflicts) => after[k].filter((c) => !before[k].includes(c));
      const because = [...new Set([...fresh("cells"), ...fresh("pearls"), ...fresh("loop")])];
      if (because.length) session.hooks.fx.call({ kind: "mistake", focus: { edges: [], because } satisfies PearlFocus });
    }, { owner });
  },
});

/** Runs ahead of technique hints (priority 100), so a wrong line or cross is pointed out before any move. */
export const checkMarks = plugin({
  id: "pearl.check-marks",
  name: "hints check your lines first",
  description: "asking for a hint points out lines and crosses that don't match the solution before suggesting anything else",
  category: "assists",
  appliesTo: [pearl],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => wrongMarksHint(puzzle, state) ?? undefined, { owner, priority: 90 });
  },
});

export const pearlPlugins = [conflicts, checkMarks];
