import type { GamesApi } from "../../api";
import type { Registry } from "../../core/registry";
import { defineSchema } from "../../core/schema";
import { definePlugins } from "../../core/define";
import { flip, solvePresses, type FlipAction, type FlipInteraction, type FlipPuzzle, type FlipState } from "./logic";
import { SOLUTION_KEY, flipView } from "./view";

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

export function register(registry: Registry): void {
  registry.puzzle(flip);
  registry.view(flipView);
  registry.plugin(solutionAssist);
}

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  register(games.registry);
}
