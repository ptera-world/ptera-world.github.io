import { checkMarksPlugin, conflictsPlugin } from "../../lib/grid-kit/plugins";
import { findConflicts, pointCell, wrongMarksHint, type SlantPuzzle, type SlantState } from "./logic";
import { CONFLICTS_KEY } from "./view";

export const conflicts = conflictsPlugin<SlantPuzzle, SlantState>({
  id: "slant.conflicts",
  puzzle: "slant",
  description: "marks rule breaks in red: lines that close a loop, and numbers that are passed or can't be reached any more",
  key: CONFLICTS_KEY,
  kinds: [
    { id: "loops", label: "closed loops" },
    { id: "clues", label: "numbers passed or out of reach" },
  ],
  find: (p, s) => findConflicts(p, s.marks),
  cells: (p, kind, items) => (kind === "clues" ? items.map((pt) => pointCell(p, pt)) : items),
});

export const checkMarks = checkMarksPlugin({
  id: "slant.check-marks",
  puzzle: "slant",
  description: "asking for a hint points out lines drawn the wrong way before suggesting anything else",
  wrong: wrongMarksHint,
});

export const slantPlugins = [conflicts, checkMarks];
