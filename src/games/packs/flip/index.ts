import type { GamesApi } from "../../api";
import type { Registry } from "../../core/registry";
import { defineSchema } from "../../core/schema";
import { definePlugins } from "../../core/define";
import { flip, solvePresses, type FlipAction, type FlipInteraction, type FlipPuzzle, type FlipState } from "./logic";
import { SOLUTION_KEY, flipView } from "./view";
import type { Technique } from "../../core/types";
import { cellName } from "../../lib/grid-kit/names";

const solutionAssist = definePlugins<FlipPuzzle, FlipState, FlipAction, FlipInteraction>()({
  id: "flip.show-solution",
  name: "show solution presses",
  category: "assists",
  appliesTo: [flip],
  enabledByDefault: false,
  settings: defineSchema({
    count: { type: "int", label: "how many to show (0 = all)", default: 0, min: 0, max: 144 },
  }),
  setup({ session, settings, owner }) {
    const count = settings.count;
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const x = solvePresses(puzzle, state.lights);
      if (!x) return d;
      let cells = x.flatMap((v, i) => (v ? [i] : []));
      if (count > 0) cells = cells.slice(0, count);
      return { ...d, [SOLUTION_KEY]: cells };
    }, { owner });
  },
});

/**
 * Light chasing: a light in a row above the last is turned off by pressing the cell under it, which
 * changes nothing in the rows above. Instances are the lit cells of the topmost row that has any.
 * Presses next to each other share cells, so a lesson could not tell one press from another: no practice.
 */
const chase: Technique<FlipPuzzle, FlipState, FlipAction> = {
  id: "flip.chase",
  name: "chase the lights",
  puzzles: [flip],
  requires: ["cross-presses"],
  level: 1,
  description: "work down from the top: press the cell right under every lit light. that turns the light off and touches nothing above it, so each row you finish stays dark and only the bottom row is left lit.",
  practice: false,
  instances(p, s, visit) {
    for (let r = 0; r < p.h - 1; r++) {
      const row = Array.from({ length: p.w }, (_, c) => r * p.w + c);
      const lit = row.filter((c) => s.lights[c]);
      if (!lit.length) continue;
      for (const c of lit) {
        const below = c + p.w;
        if (visit({
          message: `${cellName(p, c)} is on in the highest row that still has lights. pressing ${cellName(p, below)} under it turns it off without touching anything above`,
          nudge: `row ${r + 1} still has a light on`,
          focus: [c, below],
          nudgeFocus: row,
          actions: [{ type: "press", cell: below }],
        })) return;
      }
      return;
    }
  },
};

export function register(registry: Registry): void {
  registry.technique(chase);
  registry.puzzle(flip);
  registry.view(flipView);
  registry.plugin(solutionAssist);
}

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  register(games.registry);
}
