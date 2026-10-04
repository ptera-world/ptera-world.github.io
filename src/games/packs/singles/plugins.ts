import { checkMarksPlugin, conflictsPlugin } from "./kit/plugins";
import { findConflicts, wrongMarksHint, type SinglesPuzzle, type SinglesState } from "./logic";
import { CONFLICTS_KEY } from "./view";

export const conflicts = conflictsPlugin<SinglesPuzzle, SinglesState>({
  id: "singles.conflicts",
  puzzle: "singles",
  description: "marks rule breaks you can see without knowing the answer in red: blacks that touch, circled numbers repeated in a line, and cells walled off from the other white cells",
  key: CONFLICTS_KEY,
  kinds: [
    { id: "touching", label: "blacks that touch" },
    { id: "repeats", label: "circled numbers repeated in a line" },
    { id: "cut", label: "cells cut off from the other whites" },
  ],
  find: (p, s) => findConflicts(p, s.marks),
});

export const checkMarks = checkMarksPlugin({
  id: "singles.check-marks",
  puzzle: "singles",
  description: "asking for a hint points out blacks and circles that don't match the solution before suggesting anything else",
  wrong: wrongMarksHint,
});

export const singlesPlugins = [conflicts, checkMarks];
