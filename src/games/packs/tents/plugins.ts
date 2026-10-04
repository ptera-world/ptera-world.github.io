import { checkMarksPlugin, conflictsPlugin } from "../../lib/grid-kit/plugins";
import { findConflicts, geometry, wrongMarksHint, type TentsPuzzle, type TentsState } from "./logic";
import { CONFLICTS_KEY } from "./view";

export const conflicts = conflictsPlugin<TentsPuzzle, TentsState>({
  id: "tents.conflicts",
  puzzle: "tents",
  description: "marks rule breaks in red: tents that touch, numbers that are passed or out of reach, tents with no tree beside them and trees with no spot left",
  key: CONFLICTS_KEY,
  kinds: [
    { id: "touching", label: "tents that touch" },
    { id: "counts", label: "numbers passed or out of reach" },
    { id: "lonely", label: "tents or trees that can't be paired" },
  ],
  find: (p, s) => findConflicts(p, s.marks),
  cells: (p, kind, items) => (kind === "counts" ? items.flatMap((li) => geometry(p).lines[li]!) : items),
});

export const checkMarks = checkMarksPlugin({
  id: "tents.check-marks",
  puzzle: "tents",
  description: "asking for a hint points out tents and grass that don't match the solution before suggesting anything else",
  wrong: wrongMarksHint,
});

export const tentsPlugins = [conflicts, checkMarks];
