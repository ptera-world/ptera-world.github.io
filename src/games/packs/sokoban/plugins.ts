import type { Plugin } from "../../core/types";
import { sokoban, hint, type SokoAction, type SokoFocus, type SokoInteraction, type SokoPuzzle, type SokoState } from "./logic";
import { stuckBoxes } from "./solver";

type SokoPlugin = Plugin<SokoPuzzle, SokoState, SokoAction, SokoInteraction>;

/** Derived: boxes (cells) that can never reach a goal. */
export const STUCK_KEY = "sokoban.stuck";

export const showStuck: SokoPlugin = {
  id: "sokoban.stuck",
  name: "show stuck boxes",
  description: "marks boxes in red once they can never be pushed onto a goal (in a corner, along a wall with no goal, or jammed against other boxes)",
  category: "assists",
  appliesTo: [sokoban],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => ({ ...d, [STUCK_KEY]: stuckBoxes(puzzle, state.boxes) }), { owner });
    session.hooks.change.tap(({ prev, state, cause, source }) => {
      if (cause !== "action" || source?.kind !== "player") return;
      const before = new Set(stuckBoxes(session.puzzle, prev.boxes));
      const fresh = stuckBoxes(session.puzzle, state.boxes).filter((b) => !before.has(b));
      if (fresh.length) session.hooks.fx.call({ kind: "mistake", focus: { boxes: fresh } satisfies SokoFocus });
    }, { owner });
  },
};

/** Runs ahead of technique hints (priority 100): a stuck box is pointed out first. */
export const checkStuck: SokoPlugin = {
  id: "sokoban.check-stuck",
  name: "hints check every box can still get home",
  description: "asking for a hint says so if a box is stuck",
  category: "assists",
  appliesTo: [sokoban],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => hint(puzzle, state) ?? undefined, { owner, priority: 90 });
  },
};

export const sokoPlugins: SokoPlugin[] = [showStuck, checkStuck];
