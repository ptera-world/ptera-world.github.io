import { checkMarksPlugin, conflictsPlugin } from "../../lib/grid-kit/plugins";
import type { ShadeState } from "../../lib/shade-kit/state";
import { findConflicts, heyawake, wrongMarksHint, type HeyawakePuzzle } from "./logic";
import { CONFLICTS_KEY } from "./view";

export const conflicts = conflictsPlugin<HeyawakePuzzle, ShadeState>({
  id: "heyawake.conflicts",
  puzzle: heyawake,
  description: "marks rule breaks in red: shaded cells that touch, rooms that can't get their count, dotted runs across two walls, and cells cut off from the other unshaded cells",
  key: CONFLICTS_KEY,
  kinds: [
    { id: "touching", label: "shaded cells that touch" },
    { id: "rooms", label: "rooms that can't get their count" },
    { id: "runs", label: "dotted runs across two walls" },
    { id: "cut", label: "cells cut off from the other unshaded cells" },
  ],
  find: (p, s) => findConflicts(p, s.marks),
});

export const checkMarks = checkMarksPlugin({
  id: "heyawake.check-marks",
  puzzle: heyawake,
  description: "asking for a hint points out shaded cells and dots that don't match the solution before suggesting anything else",
  wrong: wrongMarksHint,
});

export const heyawakePlugins = [conflicts, checkMarks];
