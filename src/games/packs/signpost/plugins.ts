import { definePlugins } from "../../core/define";
import { defineSchema } from "../../core/schema";
import {
  signpost, findConflicts, wrongLinksHint,
  type Conflicts, type SignpostAction, type SignpostFocus, type SignpostInteraction, type SignpostPuzzle, type SignpostState,
} from "./logic";
import { CONFLICTS_KEY } from "./view";

const plugin = definePlugins<SignpostPuzzle, SignpostState, SignpostAction, SignpostInteraction>();

/** Shows visible rule breaks, and reports the ones a player move just made as a mistake fx. */
export const conflicts = plugin({
  id: "signpost.conflicts",
  name: "show conflicts",
  description: "marks rule breaks you can see without knowing the answer in red: numbers that appear twice or fall outside the board's range, and cells left with no way out or no way in",
  category: "assists",
  appliesTo: [signpost],
  enabledByDefault: true,
  settings: defineSchema({
    numbers: { type: "bool", label: "clashing numbers", default: true },
    stuck: { type: "bool", label: "cells with no way out or in", default: true },
  }),
  setup({ session, settings, owner }) {
    const shown = (s: SignpostState): Conflicts => {
      const c = findConflicts(session.puzzle, s);
      return { numbers: settings.numbers ? c.numbers : [], stuckOut: settings.stuck ? c.stuckOut : [], stuckIn: settings.stuck ? c.stuckIn : [] };
    };
    session.hooks.derive.tap((d, { state }) => ({ ...d, [CONFLICTS_KEY]: shown(state) }), { owner });
    session.hooks.change.tap(({ prev, state, cause, source }) => {
      if (cause !== "action" || source?.kind !== "player") return;
      const before = shown(prev), after = shown(state);
      const fresh = (k: keyof Conflicts) => after[k].filter((c) => !before[k].includes(c));
      const because = [...new Set([...fresh("numbers"), ...fresh("stuckOut"), ...fresh("stuckIn")])];
      if (because.length) session.hooks.fx.call({ kind: "mistake", focus: { links: [], because } satisfies SignpostFocus });
    }, { owner });
  },
});

/** Runs ahead of technique hints (priority 100), so a wrong link is pointed out before any move. */
export const checkLinks = plugin({
  id: "signpost.check-links",
  name: "hints check your links first",
  description: "asking for a hint points out links that don't match the solution before suggesting anything else",
  category: "assists",
  appliesTo: [signpost],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => wrongLinksHint(puzzle, state) ?? undefined, { owner, priority: 90 });
  },
});

export const signpostPlugins = [conflicts, checkLinks];
