import { checkMarksPlugin, conflictsPlugin } from "../../lib/grid-kit/plugins";
import type { ShadeState } from "../../lib/shade-kit/state";
import { findConflicts, norinori, wrongMarksHint, type NorinoriPuzzle } from "./logic";
import { CONFLICTS_KEY } from "./view";

export const conflicts = conflictsPlugin<NorinoriPuzzle, ShadeState>({
  id: "norinori.conflicts",
  puzzle: norinori,
  description: "marks rule breaks in red: regions with more than two shaded cells, and three or more shaded cells touching",
  key: CONFLICTS_KEY,
  kinds: [
    { id: "regions", label: "regions with too many shaded cells" },
    { id: "clumps", label: "three or more shaded cells touching" },
  ],
  find: (p, s) => findConflicts(p, s.marks),
});

export const checkMarks = checkMarksPlugin({
  id: "norinori.check-marks",
  puzzle: norinori,
  description: "asking for a hint points out shaded cells and dots that don't match the solution before suggesting anything else",
  wrong: wrongMarksHint,
});

export const norinoriPlugins = [conflicts, checkMarks];
