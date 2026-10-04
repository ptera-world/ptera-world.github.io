import { defineSchema } from "../../core/schema";
import type { Plugin } from "../../core/types";
import { EMPTY, geometry, litCounts, type Geometry } from "./grid";
import { BULB, DOT, NONE, type LightupAction, type LightupInteraction, type LightupPuzzle, type LightupState } from "./logic";
import { CONFLICTS_KEY, SATISFIED_KEY, type Conflicts } from "./view";

type LightupPlugin = Plugin<LightupPuzzle, LightupState, LightupAction, LightupInteraction>;

const bulbsAround = (g: Geometry, marks: readonly number[], q: number) => g.adj[q]!.filter((a) => marks[a] === BULB).length;

export function findConflicts(p: LightupPuzzle, marks: readonly number[]): Conflicts {
  const g = geometry(p);
  const lit = litCounts(g, marks);
  const lights = g.empties.filter((c) => marks[c] === BULB && lit[c]! > 1);
  const open = (c: number) => marks[c] === NONE && lit[c] === 0;
  const clues = g.clues.filter((q) => {
    const n = p.cells[q]!, have = bulbsAround(g, marks, q);
    return have > n || have + g.adj[q]!.filter(open).length < n;
  });
  const dark = g.empties.filter((c) => lit[c] === 0 && ![c, ...g.sees[c]!].some(open));
  return { lights, clues, dark };
}

const conflicts: LightupPlugin = {
  id: "lightup.conflicts",
  name: "show conflicts",
  description: "flags rule breaks you can see without knowing the answer.",
  category: "assists",
  appliesTo: ["lightup"],
  enabledByDefault: true,
  settings: defineSchema({
    lights: { type: "bool", label: "lights that see each other", default: true },
    clues: { type: "bool", label: "numbers that can't be met", default: true },
    dark: { type: "bool", label: "cells nothing can light any more", default: true },
  }),
  setup({ session, settings, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const c = findConflicts(puzzle, state.marks);
      const out: Conflicts = {
        lights: settings.lights ? c.lights : [],
        clues: settings.clues ? c.clues : [],
        dark: settings.dark ? c.dark : [],
      };
      return { ...d, [CONFLICTS_KEY]: out };
    }, { owner });
  },
};

const satisfied: LightupPlugin = {
  id: "lightup.satisfied",
  name: "dim finished numbers",
  description: "numbers with exactly enough lights fade out.",
  category: "assists",
  appliesTo: ["lightup"],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const g = geometry(puzzle);
      return { ...d, [SATISFIED_KEY]: g.clues.filter((q) => bulbsAround(g, state.marks, q) === puzzle.cells[q]) };
    }, { owner });
  },
};

const autoDot: LightupPlugin = {
  id: "lightup.auto-dot",
  name: "auto-mark around finished numbers",
  description: "when a light completes a number, its other neighbours get a no-light mark (same undo step).",
  category: "assists",
  appliesTo: ["lightup"],
  enabledByDefault: false,
  settings: defineSchema({
    litToo: { type: "bool", label: "also mark neighbours that are already lit", default: false },
  }),
  setup({ session, settings, owner }) {
    session.hooks.apply.tap((next, { puzzle, prev, reduce }) => {
      const g = geometry(puzzle);
      const placed = g.empties.filter((c) => next.marks[c] === BULB && prev.marks[c] !== BULB);
      if (!placed.length) return next;
      const lit = litCounts(g, next.marks);
      const cells = new Set<number>();
      for (const c of placed) {
        for (const q of g.nbrs[c]!) {
          if (puzzle.cells[q]! < 0 || bulbsAround(g, next.marks, q) !== puzzle.cells[q]) continue;
          for (const a of g.adj[q]!) {
            if (next.marks[a] === NONE && puzzle.cells[a] === EMPTY && (settings.litToo || lit[a] === 0)) cells.add(a);
          }
        }
      }
      return cells.size ? reduce(next, { type: "set", cells: [...cells], value: DOT }) : next;
    }, { owner });
  },
};

export const lightupPlugins: LightupPlugin[] = [conflicts, satisfied, autoDot];
