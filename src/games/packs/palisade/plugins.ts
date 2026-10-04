import { checkMarksPlugin, conflictsPlugin } from "../../lib/grid-kit/plugins";
import { findConflicts, wrongMarksHint, type PalisadePuzzle, type PalisadeState } from "./logic";
import { CONFLICTS_KEY } from "./view";

export const conflicts = conflictsPlugin<PalisadePuzzle, PalisadeState>({
  id: "palisade.conflicts",
  puzzle: "palisade",
  description: "marks rule breaks in red: numbers that are passed or out of reach, regions walled off too small, and cells joined by gaps into a region too big",
  key: CONFLICTS_KEY,
  kinds: [
    { id: "clues", label: "numbers that can't be met" },
    { id: "regions", label: "regions of the wrong size" },
  ],
  find: (p, s) => findConflicts(p, s.marks),
});

export const checkMarks = checkMarksPlugin({
  id: "palisade.check-marks",
  puzzle: "palisade",
  description: "asking for a hint points out walls and gaps that don't match the solution before suggesting anything else",
  wrong: wrongMarksHint,
});

export const palisadePlugins = [conflicts, checkMarks];
