import { checkMarksPlugin, conflictsPlugin } from "../../lib/grid-kit/plugins";
import { range, findConflicts, wrongMarksHint, type RangePuzzle, type RangeState } from "./logic";
import { CONFLICTS_KEY } from "./view";

export const conflicts = conflictsPlugin<RangePuzzle, RangeState>({
  id: "range.conflicts",
  puzzle: range,
  description: "marks rule breaks in red: blacks that touch, numbers that see too many cells or can't see enough, and cells walled off from the other whites",
  key: CONFLICTS_KEY,
  kinds: [
    { id: "touching", label: "blacks that touch" },
    { id: "clues", label: "numbers that can't be met" },
    { id: "cut", label: "cells cut off from the other whites" },
  ],
  find: (p, s) => findConflicts(p, s.marks),
});

export const checkMarks = checkMarksPlugin({
  id: "range.check-marks",
  puzzle: range,
  description: "asking for a hint points out blacks and dots that don't match the solution before suggesting anything else",
  wrong: wrongMarksHint,
});

export const rangePlugins = [conflicts, checkMarks];
