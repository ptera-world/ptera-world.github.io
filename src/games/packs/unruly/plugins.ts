import { checkMarksPlugin, conflictsPlugin } from "../../lib/grid-kit/plugins";
import { findConflicts, wrongMarksHint, type UnrulyPuzzle, type UnrulyState } from "./logic";
import { CONFLICTS_KEY } from "./view";

export const conflicts = conflictsPlugin<UnrulyPuzzle, UnrulyState>({
  id: "unruly.conflicts",
  puzzle: "unruly",
  description: "marks rule breaks in red: three of a color in a row, lines with more than half of one color, and (with all lines different) two lines that are the same",
  key: CONFLICTS_KEY,
  kinds: [
    { id: "runs", label: "three in a row" },
    { id: "counts", label: "too many of one color in a line" },
    { id: "repeats", label: "two lines the same" },
  ],
  find: (p, s) => findConflicts(p, s.marks),
});

export const checkMarks = checkMarksPlugin({
  id: "unruly.check-marks",
  puzzle: "unruly",
  description: "asking for a hint points out pieces that don't match the solution before suggesting anything else",
  wrong: wrongMarksHint,
});

export const unrulyPlugins = [conflicts, checkMarks];
