import { checkMarksPlugin, conflictsPlugin } from "../../lib/grid-kit/plugins";
import { findConflicts, kakuro, wrongHint, type KakuroPuzzle, type KakuroState } from "./logic";
import { CONFLICTS_KEY } from "./view";

export const conflicts = conflictsPlugin<KakuroPuzzle, KakuroState>({
  id: "kakuro.conflicts",
  puzzle: kakuro,
  description: "marks digits in red that repeat in a run, or runs whose digits can't add up to their sum",
  key: CONFLICTS_KEY,
  kinds: [
    { id: "repeats", label: "digits repeated in a run" },
    { id: "sums", label: "runs that overshoot or miss their sum" },
  ],
  find: (p, s) => findConflicts(p, s.doms),
});

export const checkMarks = checkMarksPlugin({
  id: "kakuro.check-marks",
  puzzle: kakuro,
  description: "asking for a hint points out digits and notes that rule out the solution before suggesting anything else",
  wrong: wrongHint,
});

export const kakuroPlugins = [conflicts, checkMarks];
