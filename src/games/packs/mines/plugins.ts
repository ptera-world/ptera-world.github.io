import { defineSchema } from "../../core/schema";
import type { Plugin } from "../../core/types";
import { wrongFlagHint, type MinesAction, type MinesInteraction, type MinesPuzzle, type MinesState } from "./logic";
import { provable } from "./techniques";
import { DEDUCED_KEY } from "./view";

type MinesPlugin = Plugin<MinesPuzzle, MinesState, MinesAction, MinesInteraction>;

/** Runs ahead of technique hints (priority 100), so a wrong flag is pointed out before any move. */
export const checkFlags: MinesPlugin = {
  id: "mines.check-flags",
  name: "hints check your flags first",
  description: "asking for a hint points out flags that aren't on mines before suggesting anything else",
  category: "assists",
  appliesTo: ["mines"],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => wrongFlagHint(puzzle, state) ?? undefined, { owner, priority: 90 });
  },
};

export const showDeducible: MinesPlugin = {
  id: "mines.deducible",
  name: "highlight provable cells",
  description: "tint hidden cells that can already be proven safe (green) or mined (red)",
  category: "assists",
  appliesTo: ["mines"],
  enabledByDefault: false,
  settings: defineSchema({
    level: {
      type: "enum", label: "logic used", default: "3",
      options: [
        { value: "3", label: "one number at a time, and the mine count" },
        { value: "4", label: "also overlapping numbers" },
        { value: "5", label: "also whole regions" },
      ],
    },
  }),
  setup({ session, settings, owner }) {
    const level = Number(settings.level) || 3;
    session.hooks.derive.tap((d, { puzzle, state }) => {
      if (state.dead >= 0 || session.solved) return d;
      return { ...d, [DEDUCED_KEY]: provable(puzzle, state, level) };
    }, { owner });
  },
};

export const minesPlugins = [checkFlags, showDeducible];
