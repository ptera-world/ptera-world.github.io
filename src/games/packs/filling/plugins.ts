import { checkMarksPlugin, conflictsPlugin } from "../../lib/grid-kit/plugins";
import { filling, findConflicts, wrongHint, type FillingPuzzle, type FillingState } from "./logic";
import { CONFLICTS_KEY } from "./view";

export const conflicts = conflictsPlugin<FillingPuzzle, FillingState>({
  id: "filling.conflicts",
  puzzle: filling,
  description: "marks groups of equal numbers in red that are too big, or walled in too small",
  key: CONFLICTS_KEY,
  kinds: [{ id: "regions", label: "regions of the wrong size" }],
  find: (p, s) => findConflicts(p, s.doms),
});

export const checkMarks = checkMarksPlugin({
  id: "filling.check-marks",
  puzzle: filling,
  description: "asking for a hint points out numbers and notes that rule out the solution before suggesting anything else",
  wrong: wrongHint,
});

export const fillingPlugins = [conflicts, checkMarks];
