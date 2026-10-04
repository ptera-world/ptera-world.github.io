import { defineSchema } from "../../core/schema";
import { definePlugins } from "../../core/define";
import { tracks, findConflicts, wrongMarksHint, type Conflicts, type TracksAction, type TracksFocus, type TracksInteraction, type TracksPuzzle, type TracksState } from "./logic";
import { CONFLICTS_KEY } from "./view";

const plugin = definePlugins<TracksPuzzle, TracksState, TracksAction, TracksInteraction>();

/** Shows visible rule breaks, and reports the ones a player move just made as a mistake fx. */
export const conflicts = plugin({
  id: "tracks.conflicts",
  name: "show conflicts",
  description: "marks rule breaks you can see without knowing the answer in red: cells whose track can't be right, counts already passed or out of reach, and loops of track",
  category: "assists",
  appliesTo: [tracks],
  enabledByDefault: true,
  settings: defineSchema({
    cells: { type: "bool", label: "cells whose track can't be right", default: true },
    counts: { type: "bool", label: "counts that can't be met", default: true },
    loop: { type: "bool", label: "loops of track", default: true },
  }),
  setup({ session, settings, owner }) {
    const shown = (s: TracksState): Conflicts => {
      const c = findConflicts(session.puzzle, s);
      return { cells: settings.cells ? c.cells : [], counts: settings.counts ? c.counts : [], loop: settings.loop ? c.loop : [] };
    };
    session.hooks.derive.tap((d, { state }) => ({ ...d, [CONFLICTS_KEY]: shown(state) }), { owner });
    session.hooks.change.tap(({ prev, state, cause, source }) => {
      if (cause !== "action" || source?.kind !== "player") return;
      const before = shown(prev), after = shown(state);
      const fresh = (k: keyof Conflicts) => after[k].filter((c) => !before[k].includes(c));
      const because = [...new Set([...fresh("cells"), ...fresh("loop")])], counts = fresh("counts");
      if (because.length || counts.length) session.hooks.fx.call({ kind: "mistake", focus: { edges: [], cells: [], because, counts } satisfies TracksFocus });
    }, { owner });
  },
});

/** Runs ahead of technique hints (priority 100), so a wrong mark is pointed out before any move. */
export const checkMarks = plugin({
  id: "tracks.check-marks",
  name: "hints check your marks first",
  description: "asking for a hint points out track, crosses and cell marks that don't match the solution before suggesting anything else",
  category: "assists",
  appliesTo: [tracks],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => wrongMarksHint(puzzle, state) ?? undefined, { owner, priority: 90 });
  },
});

export const tracksPlugins = [conflicts, checkMarks];
