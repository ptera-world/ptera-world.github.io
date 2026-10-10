import { definePlugins } from "../../core/define";
import { defineSchema } from "../../core/schema";
import { mines, chordCells, numbers, openIn, wrongFlagHint, type MinesAction, type MinesInteraction, type MinesPuzzle, type MinesState } from "./logic";
import { provable } from "./techniques";
import { DEDUCED_KEY } from "./view";

const plugin = definePlugins<MinesPuzzle, MinesState, MinesAction, MinesInteraction>();

/** Runs ahead of technique hints (priority 100), so a wrong flag is pointed out before any move. */
export const checkFlags = plugin({
  id: "mines.check-flags",
  name: "hints check your flags first",
  description: "asking for a hint points out flags that aren't on mines before suggesting anything else",
  category: "assists",
  appliesTo: [mines],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => wrongFlagHint(puzzle, state) ?? undefined, { owner, priority: 90 });
  },
});

export const showDeducible = plugin({
  id: "mines.deducible",
  name: "highlight provable cells",
  description: "tint hidden cells that can already be proven safe (green) or mined (red)",
  category: "assists",
  appliesTo: [mines],
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
      if (state.dead >= 0 || session.finished) return d;
      return { ...d, [DEDUCED_KEY]: provable(puzzle, state, level) };
    }, { owner });
  },
});

/** Opens around every number that has all its flags, as part of the move that completed it (one undo step). */
export const autoChord = plugin({
  id: "mines.auto-chord",
  name: "open around finished numbers by themselves",
  description: "once a number touches as many flags as it shows, its other hidden neighbors open without clicking it. a wrong flag sets off a mine this way, just like clicking the number would",
  category: "assists",
  appliesTo: [mines],
  enabledByDefault: false,
  setup({ session, owner }) {
    session.hooks.apply.tap((next, { puzzle, note }) => {
      if (next.dead >= 0) return next;
      const nums = numbers(puzzle);
      const cells = new Set<number>();
      for (let c = 0; c < nums.length; c++) if (next.open[c] && nums[c]) for (const d of chordCells(puzzle, next, c)) cells.add(d);
      if (!cells.size) return next;
      const out = openIn(puzzle, next, [...cells]);
      if (out !== next) note({ kind: "assist", owner }, next, out);
      return out;
    }, { owner });
  },
});

export const minesPlugins = [checkFlags, showDeducible, autoChord];
