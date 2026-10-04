import { defineSchema } from "../../core/schema";
import { definePlugins } from "../../core/define";
import { map, findConflicts, wrongMarksHint, type Conflicts, type MapAction, type MapFocus, type MapInteraction, type MapPuzzle, type MapState } from "./logic";
import { CONFLICTS_KEY } from "./view";

const plugin = definePlugins<MapPuzzle, MapState, MapAction, MapInteraction>();

/** Shows visible rule breaks, and reports the ones a player move just made as a mistake fx. */
export const conflicts = plugin({
  id: "map.conflicts",
  name: "show conflicts",
  description: "marks rule breaks you can see without knowing the answer in red: neighboring regions with the same color, and regions whose neighbors use all four colors",
  category: "assists",
  appliesTo: [map],
  enabledByDefault: true,
  settings: defineSchema({
    clashes: { type: "bool", label: "neighbors with the same color", default: true },
    stuck: { type: "bool", label: "regions with no color left", default: true },
  }),
  setup({ session, settings, owner }) {
    const shown = (s: MapState): Conflicts => {
      const c = findConflicts(session.puzzle, s);
      return { clashes: settings.clashes ? c.clashes : [], stuck: settings.stuck ? c.stuck : [] };
    };
    session.hooks.derive.tap((d, { state }) => ({ ...d, [CONFLICTS_KEY]: shown(state) }), { owner });
    session.hooks.change.tap(({ prev, state, cause, source }) => {
      if (cause !== "action" || source?.kind !== "player") return;
      const before = shown(prev), after = shown(state);
      const regions = [...after.clashes.filter((r) => !before.clashes.includes(r)), ...after.stuck.filter((r) => !before.stuck.includes(r))];
      if (regions.length) session.hooks.fx.call({ kind: "mistake", focus: { regions, because: [] } satisfies MapFocus });
    }, { owner });
  },
});

/** Runs ahead of technique hints (priority 100), so a wrong color is pointed out before any move. */
export const checkMarks = plugin({
  id: "map.check-marks",
  name: "hints check your colors first",
  description: "asking for a hint points out colors and pencil marks that don't match the solution before suggesting anything else",
  category: "assists",
  appliesTo: [map],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => wrongMarksHint(puzzle, state) ?? undefined, { owner, priority: 90 });
  },
});

export const mapPlugins = [conflicts, checkMarks];
