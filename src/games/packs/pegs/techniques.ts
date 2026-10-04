import type { Plugin, Technique } from "../../core/types";
import { cellAt, pegCount, type PegsAction, type PegsFocus, type PegsInteraction, type PegsPuzzle, type PegsState } from "./logic";
import { jumps, solveFrom } from "./solver";

type PegsTechnique = Technique<PegsPuzzle, PegsState, PegsAction>;

export const oneLeft: PegsTechnique = {
  id: "pegs.one-left",
  name: "still one to go",
  puzzles: ["pegs"],
  level: 1,
  description: "most jumps that look fine leave pegs stranded where nothing can reach them. this searches ahead for a whole sequence of jumps that ends with one peg, and suggests its first jump.",
  find(p, s) {
    if (pegCount(s.grid) <= 1) return null;
    const path = solveFrom(p, s.grid).path;
    const j = path?.[0];
    if (!j) return null;
    const after = path!.length - 1;
    return {
      message: `jump ${cellAt(p, j.from)} over ${cellAt(p, j.over)} into ${cellAt(p, j.to)}: one peg can still be left after that${after ? ` (${after} more ${after === 1 ? "jump" : "jumps"})` : ""}.`,
      nudge: `look at the peg at ${cellAt(p, j.from)}`,
      focus: { from: j.from, over: j.over, to: j.to } satisfies PegsFocus,
      nudgeFocus: { from: j.from } satisfies PegsFocus,
      actions: [{ type: "jump", from: j.from, to: j.to }],
    };
  },
  practice: { params: { board: "random", width: 5, height: 5 } },
};

export const pegsTechniques: PegsTechnique[] = [oneLeft];

/** Runs ahead of technique hints (priority 100): a board that can't end with one peg is pointed out first. */
export const checkFinishable: Plugin<PegsPuzzle, PegsState, PegsAction, PegsInteraction> = {
  id: "pegs.check-finishable",
  name: "hints check one peg can still be left",
  description: "asking for a hint first says so if no sequence of jumps can end with a single peg any more",
  category: "assists",
  appliesTo: ["pegs"],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => {
      if (pegCount(state.grid) <= 1 || !jumps(puzzle.w, puzzle.h, state.grid).length) return undefined;
      if (!solveFrom(puzzle, state.grid).impossible) return undefined;
      return { message: "no sequence of jumps leaves one peg from here any more. undo until hints come back." };
    }, { owner, priority: 90 });
  },
};
