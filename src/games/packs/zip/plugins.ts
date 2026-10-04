import { checkMarksPlugin, conflictsPlugin } from "../../lib/grid-kit/plugins";
import { findConflicts, wrongPathHint, type ZipPuzzle, type ZipState } from "./logic";

/** Derived: Conflicts to flag on the board. */
export const CONFLICTS_KEY = "zip.conflicts";

export const zipPlugins = [
  conflictsPlugin<ZipPuzzle, ZipState>({
    id: "zip.conflicts",
    puzzle: "zip",
    description: "marks in red what you can see won't work: the path's end when it can't go on, cells left with too few ways in, and cells cut off from the path",
    key: CONFLICTS_KEY,
    kinds: [
      { id: "stuck", label: "a path that can't go on" },
      { id: "dead", label: "cells with too few ways in" },
      { id: "cut", label: "cells cut off from the path" },
    ],
    find: (p, s) => ({ ...findConflicts(p, s) }),
  }),
  checkMarksPlugin({
    id: "zip.check-path",
    puzzle: "zip",
    description: "asking for a hint first says where the path went wrong, if it has, before suggesting anything else",
    wrong: wrongPathHint,
  }),
];
