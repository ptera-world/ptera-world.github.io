import type { GamesApi } from "../../api";
import type { Registry } from "../../core/registry";
import { defineSchema } from "../../core/schema";
import { definePlugins } from "../../core/define";
import { chaseDirectionName, chaseMoves, flip, solvePresses, type FlipAction, type FlipInteraction, type FlipPuzzle, type FlipState } from "./logic";
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
 * Light chasing along a direction where one offset of the pattern reaches furthest back: a lit
 * cell whose press (the cell minus that offset) exists is turned off by it, and the press touches
 * only cells further along. Instances are those presses for the chasable lights nearest the start.
 * Presses overlap, so a lesson could not tell one press from another: no practice.
 */
const chase: Technique<FlipPuzzle, FlipState, FlipAction> = {
  id: "flip.chase",
  name: "chase the lights",
  puzzles: [flip],
  requires: ["chase-direction"],
  level: 1,
  description: "pick a direction where only one cell of the press pattern reaches furthest back. a light that has a cell behind it in that spot can be turned off by pressing that cell, and the press only touches cells further along. keep pushing the lights forward like that, and only the far end of the board stays lit.",
  practice: false,
  instances(p, s, visit) {
    const dir = chaseDirectionName(p);
    for (const m of chaseMoves(p, s.lights)) {
      if (visit({
        message: `${cellName(p, m.light)} is the first light along the chase; pressing ${cellName(p, m.press)} turns it off without touching anything behind it`,
        nudge: `a light on the first line along the chase (${dir}) can be pushed further`,
        focus: [m.light, m.press],
        nudgeFocus: m.line,
        actions: [{ type: "press", cell: m.press }],
      })) return;
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
