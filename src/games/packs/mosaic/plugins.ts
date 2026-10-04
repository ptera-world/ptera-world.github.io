import { checkMarksPlugin, conflictsPlugin } from "./kit/plugins";
import { findConflicts, wrongMarksHint, type MosaicPuzzle, type MosaicState } from "./logic";
import { CONFLICTS_KEY } from "./view";

export const conflicts = conflictsPlugin<MosaicPuzzle, MosaicState>({
  id: "mosaic.conflicts",
  puzzle: "mosaic",
  description: "marks numbers in red that have too many blacks around them, or too few cells left to reach their count",
  key: CONFLICTS_KEY,
  kinds: [{ id: "clues", label: "numbers that can't be met" }],
  find: (p, s) => findConflicts(p, s.marks),
});

export const checkMarks = checkMarksPlugin({
  id: "mosaic.check-marks",
  puzzle: "mosaic",
  description: "asking for a hint points out blacks and dots that don't match the solution before suggesting anything else",
  wrong: wrongMarksHint,
});

export const mosaicPlugins = [conflicts, checkMarks];
