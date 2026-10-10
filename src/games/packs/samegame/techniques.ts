import { hintFrom } from "../../core/define";
import type { Hint, Plugin, Step } from "../../core/types";
import { samegame, COLOUR_NAMES, cellAt, group, isEmpty, type SamegameAction, type SamegameFocus, type SamegameInteraction, type SamegamePuzzle, type SamegameState } from "./logic";
import { clearFrom, loneColour } from "./solver";

/** The first removal of a whole clearing order, else the puzzle's own hint. */
export function hint(p: SamegamePuzzle, s: SamegameState): Hint<SamegameAction> | null {
  if (isEmpty(s.grid)) return samegame.hint?.(p, s) ?? null;
  const path = clearFrom(p, s.grid).path;
  if (!path?.length) return samegame.hint?.(p, s) ?? null;
  const cell = path[0]!;
  const cells = group(p.w, p.h, s.grid, cell);
  const name = COLOUR_NAMES[s.grid[cell]!]!;
  const after = path.length - 1;
  const found: Step<SamegameAction> = {
    message: `remove the ${cells.length} ${name} tiles at ${cellAt(p, cell)}: the board can still be cleared after that${after ? ` (in ${after} more ${after === 1 ? "removal" : "removals"})` : ", and that clears it"}.`,
    nudge: `try the ${name} tiles in column ${cellAt(p, cell).replace(/\d+$/, "")}`,
    focus: { cells } satisfies SamegameFocus,
    nudgeFocus: { cells: Array.from({ length: p.h }, (_, y) => y * p.w + (cell % p.w)) } satisfies SamegameFocus,
    actions: [{ type: "remove", cell }],
  };
  return hintFrom(null, found, 1) as Hint<SamegameAction>;
}

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
