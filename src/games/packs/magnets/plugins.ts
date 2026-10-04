import { checkMarksPlugin, conflictsPlugin } from "./kit/plugins";
import { findConflicts, geometry, wrongHint, type MagnetsPuzzle, type MagnetsState } from "./logic";
import { CONFLICTS_KEY } from "./view";

/** Count conflicts are reported by line; the mistake fx points at that line's cells. */
export const conflicts = conflictsPlugin<MagnetsPuzzle, MagnetsState>({
  id: "magnets.conflicts",
  puzzle: "magnets",
  description: "marks rule breaks in red: like poles touching, and numbers that are passed or can't be reached any more",
  key: CONFLICTS_KEY,
  kinds: [
    { id: "poles", label: "like poles touching" },
    { id: "counts", label: "numbers passed or out of reach" },
  ],
  find: (p, s) => findConflicts(p, s.doms),
  cells: (p, kind, items) => (kind === "counts" ? items.flatMap((i) => geometry(p).lines[i >> 1]!) : items),
});

export const checkMarks = checkMarksPlugin({
  id: "magnets.check-marks",
  puzzle: "magnets",
  description: "asking for a hint points out dominoes marked in a way that rules out the solution before suggesting anything else",
  wrong: wrongHint,
});

export const magnetsPlugins = [conflicts, checkMarks];
