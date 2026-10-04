import { checkMarksPlugin, conflictsPlugin } from "../../lib/grid-kit/plugins";
import type { ShadeState } from "../../lib/shade-kit/state";
import { findConflicts, nurikabe, wrongMarksHint, type NurikabePuzzle } from "./logic";
import { CONFLICTS_KEY } from "./view";

export const conflicts = conflictsPlugin<NurikabePuzzle, ShadeState>({
  id: "nurikabe.conflicts",
  puzzle: nurikabe,
  description: "marks rule breaks in red: 2×2 blocks of sea, sea cut off from the rest, islands with two numbers or too many cells, and numbers that can't get their island any more",
  key: CONFLICTS_KEY,
  kinds: [
    { id: "pools", label: "2×2 blocks of sea" },
    { id: "sea", label: "sea cut off from the rest" },
    { id: "islands", label: "islands with two numbers, too many cells, or none" },
    { id: "clues", label: "numbers that can't get their island" },
  ],
  find: (p, s) => findConflicts(p, s.marks),
});

export const checkMarks = checkMarksPlugin({
  id: "nurikabe.check-marks",
  puzzle: nurikabe,
  description: "asking for a hint points out shaded cells and dots that don't match the solution before suggesting anything else",
  wrong: wrongMarksHint,
});

export const nurikabePlugins = [conflicts, checkMarks];
