import type { Plugin } from "../../core/types";
import { samegame, COLOUR_NAMES, cellAt, isEmpty, type SamegameAction, type SamegameFocus, type SamegameInteraction, type SamegamePuzzle, type SamegameState } from "./logic";
import { clearFrom, loneColour } from "./solver";

/** Runs ahead of technique hints (priority 100): a board that can no longer be cleared is pointed out first. */
export const checkClearable: Plugin<SamegamePuzzle, SamegameState, SamegameAction, SamegameInteraction> = {
  id: "samegame.check-clearable",
  name: "hints check the board can still be cleared",
  description: "asking for a hint first says so if no order of removals can clear the board any more",
  category: "assists",
  appliesTo: [samegame],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => {
      if (isEmpty(state.grid)) return undefined;
      const lone = loneColour(state.grid);
      if (lone) {
        const cell = state.grid.indexOf(lone);
        return { message: `only one ${COLOUR_NAMES[lone]} tile is left (at ${cellAt(puzzle, cell)}), and a lone tile can never be removed. undo to get back to a clearable board.`, focus: { cells: [cell] } satisfies SamegameFocus };
      }
      if (clearFrom(puzzle, state.grid).impossible) return { message: "no order of removals clears this board any more. undo to get back to a clearable one." };
      return undefined;
    }, { owner, priority: 90 });
  },
};
