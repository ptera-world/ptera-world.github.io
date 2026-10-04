import { checkMarksPlugin, conflictsPlugin } from "../../lib/grid-kit/plugins";
import type { ShadeState } from "../../lib/shade-kit/state";
import { findConflicts, starbattle, wrongMarksHint, type StarBattlePuzzle } from "./logic";
import { CONFLICTS_KEY } from "./view";

export const conflicts = conflictsPlugin<StarBattlePuzzle, ShadeState>({
  id: "starbattle.conflicts",
  puzzle: starbattle,
  description: "marks rule breaks in red: stars that touch, and rows, columns or regions with too many stars",
  key: CONFLICTS_KEY,
  kinds: [
    { id: "touching", label: "stars that touch" },
    { id: "crowded", label: "too many stars in a row, column or region" },
  ],
  find: (p, s) => findConflicts(p, s.marks),
});

export const checkMarks = checkMarksPlugin({
  id: "starbattle.check-marks",
  puzzle: starbattle,
  description: "asking for a hint points out stars and dots that don't match the solution before suggesting anything else",
  wrong: wrongMarksHint,
});

export const starbattlePlugins = [conflicts, checkMarks];
