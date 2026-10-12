import type { Plugin } from "../../core/types";
import { pegs, pegCount, type PegsAction, type PegsInteraction, type PegsPuzzle, type PegsState } from "./logic";
import { jumps, solveFrom } from "./solver";

/** Runs ahead of technique hints (priority 100): a board that can't end with one peg is pointed out first. */
export const checkFinishable: Plugin<PegsPuzzle, PegsState, PegsAction, PegsInteraction> = {
  id: "pegs.check-finishable",
  name: "hints check one peg can still be left",
  description: "asking for a hint first says so if no sequence of jumps can end with a single peg any more",
  category: "assists",
  appliesTo: [pegs],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => {
      if (pegCount(state.grid) <= 1 || !jumps(puzzle.w, puzzle.h, state.grid).length) return undefined;
      if (!solveFrom(puzzle, state.grid).impossible) return undefined;
      return { message: "no sequence of jumps leaves one peg from here any more. undo until hints come back." };
    }, { owner, priority: 90 });
  },
};
