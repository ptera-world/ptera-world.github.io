import { defineSchema } from "../../core/schema";
import type { Plugin } from "../../core/types";
import {
  LEVELS, mineCount, numbers, visibleKnowledge,
  type MinesAction, type MinesInteraction, type MinesPuzzle, type MinesState,
} from "./logic";
import { deduceAt, deduceCount, deduceGlobal, deducePairs, neighbourTable } from "./solver";
import { DEDUCED_KEY, REMAINING_KEY } from "./view";

type MinesPlugin = Plugin<MinesPuzzle, MinesState, MinesAction, MinesInteraction>;

export const remainingCount: MinesPlugin = {
  id: "mines.remaining",
  name: "mines left counter",
  description: "total mines minus flags placed",
  category: "assists",
  appliesTo: ["mines"],
  enabledByDefault: true,
  setup({ session, owner }) {
    const total = mineCount(session.puzzle);
    session.hooks.derive.tap((d, { state }) => ({
      ...d, [REMAINING_KEY]: total - state.flags.reduce((a, b) => a + b, 0),
    }), { owner });
  },
};

/** Flags every hidden neighbour of a number whose hidden-neighbour count equals it. Uses no flags as input, so it can't compound a wrong flag. */
export const autoFlag: MinesPlugin = {
  id: "mines.auto-flag",
  name: "auto-flag obvious mines",
  description: "when a number has exactly that many hidden neighbours, flag them",
  category: "assists",
  appliesTo: ["mines"],
  enabledByDefault: false,
  setup({ session, owner }) {
    const p = session.puzzle;
    const nb = neighbourTable(p.w, p.h);
    const nums = numbers(p);
    session.hooks.apply.tap((next, { prev, action, reduce }) => {
      if ((action && Object.is(next, prev)) || next.dead >= 0) return next;
      const cells: number[] = [];
      for (let c = 0; c < nums.length; c++) {
        if (!next.open[c] || !nums[c]) continue;
        const hidden = nb[c]!.filter((d) => !next.open[d]);
        if (hidden.length === nums[c]) for (const d of hidden) if (!next.flags[d]) cells.push(d);
      }
      return cells.length ? reduce(next, { type: "flag", cells, on: true }) : next;
    }, { owner, priority: 10 });
  },
};

/** Repeatedly chords every number whose flag count matches it. Trusts the player's flags. */
export const autoOpen: MinesPlugin = {
  id: "mines.auto-open",
  name: "auto-open around satisfied numbers",
  description: "when a number has all its flags, open its other neighbours (trusts your flags)",
  category: "assists",
  appliesTo: ["mines"],
  enabledByDefault: false,
  setup({ session, owner }) {
    const p = session.puzzle;
    const nb = neighbourTable(p.w, p.h);
    const nums = numbers(p);
    session.hooks.apply.tap((next, { prev, action, reduce }) => {
      if (action && Object.is(next, prev)) return next;
      let s = next;
      for (let changed = true; changed && s.dead < 0;) {
        changed = false;
        for (let c = 0; c < nums.length && s.dead < 0; c++) {
          if (!s.open[c] || !nb[c]!.some((d) => !s.open[d] && !s.flags[d])) continue;
          const after = reduce(s, { type: "chord", cell: c });
          if (!Object.is(after, s)) { s = after; changed = true; }
        }
      }
      return s;
    }, { owner, priority: 20 });
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
      type: "enum", label: "logic used", default: "easy",
      options: [
        { value: "easy", label: "one number at a time" },
        { value: "normal", label: "pairs of numbers" },
        { value: "hard", label: "regions and mine count" },
      ],
    },
  }),
  setup({ session, settings, owner }) {
    const level = LEVELS[settings.level as string] ?? 1;
    const p = session.puzzle;
    const nb = neighbourTable(p.w, p.h);
    const total = mineCount(p);
    session.hooks.derive.tap((d, { state }) => {
      if (state.dead >= 0 || session.solved) return d;
      const K = visibleKnowledge(p, state);
      const found = [];
      for (let c = 0; c < K.length; c++) {
        const x = deduceAt(K, nb, c);
        if (x) found.push(x);
      }
      const g = deduceCount(K, total);
      if (g) found.push(g);
      if (!found.length && level >= 2) found.push(...deducePairs(K, p.w, p.h, nb));
      if (!found.length && level >= 3) {
        const x = deduceGlobal(K, nb, total);
        if (x) found.push(x);
      }
      return {
        ...d,
        [DEDUCED_KEY]: {
          safe: [...new Set(found.flatMap((x) => x.safe))],
          mines: [...new Set(found.flatMap((x) => x.mines))].filter((c) => !state.flags[c]),
        },
      };
    }, { owner });
  },
};

export const minesPlugins = [remainingCount, autoFlag, autoOpen, showDeducible];
