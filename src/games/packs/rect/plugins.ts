import { checkMarksPlugin, conflictsPlugin } from "../../lib/grid-kit/plugins";
import { findConflicts, wrongHint, type RectPuzzle, type RectState } from "./logic";
import { CONFLICTS_KEY } from "./view";

export const conflicts = conflictsPlugin<RectPuzzle, RectState>({
  id: "rect.conflicts",
  puzzle: "rect",
  description: "marks walled-in rectangles in red that hold no number, two numbers, or a number that isn't their area",
  key: CONFLICTS_KEY,
  kinds: [{ id: "wrong", label: "wrong rectangles" }],
  find: (p, s) => findConflicts(p, s.walls),
});

export const checkMarks = checkMarksPlugin({
  id: "rect.check-marks",
  puzzle: "rect",
  description: "asking for a hint points out walls that aren't in the solution before suggesting anything else",
  wrong: wrongHint,
});

export const rectPlugins = [conflicts, checkMarks];
