import { checkMarksPlugin, conflictsPlugin } from "../../lib/grid-kit/plugins";
import { numberlink, findConflicts, wrongMarksHint, type NumberlinkPuzzle, type NumberlinkState } from "./logic";

/** Derived: Conflicts to flag on the board. */
export const CONFLICTS_KEY = "numberlink.conflicts";

export const numberlinkPlugins = [
  conflictsPlugin<NumberlinkPuzzle, NumberlinkState>({
    id: "numberlink.conflicts",
    puzzle: numberlink,
    description: "marks rule breaks you can see without knowing the answer in red: cells with too many lines or a line that can't go on, lines joining two colors, and loops",
    key: CONFLICTS_KEY,
    kinds: [
      { id: "cells", label: "cells with too many lines, or a stuck line" },
      { id: "mixed", label: "lines joining two colors" },
      { id: "loop", label: "loops" },
    ],
    find: (p, s) => ({ ...findConflicts(p, s) }),
  }),
  checkMarksPlugin({
    id: "numberlink.check-marks",
    puzzle: numberlink,
    description: "asking for a hint points out lines and crosses that don't match the solution before suggesting anything else",
    wrong: wrongMarksHint,
  }),
];
