import type { GamesApi } from "../../api";
import type { Registry } from "../../core/registry";
import { defineSchema } from "../../core/schema";
import type { Plugin, Technique } from "../../core/types";
import { flip, solvePresses, type FlipAction, type FlipInteraction, type FlipPuzzle, type FlipState } from "./logic";
import { SOLUTION_KEY, flipView } from "./view";

const solutionAssist: Plugin<FlipPuzzle, FlipState, FlipAction, FlipInteraction> = {
  id: "flip.show-solution",
  name: "show solution presses",
  category: "assists",
  appliesTo: ["flip"],
  enabledByDefault: false,
  settings: defineSchema({
    count: { type: "int", label: "how many to show (0 = all)", default: 0, min: 0, max: 144 },
  }),
  setup({ session, settings, owner }) {
    const count = settings.count as number;
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const x = solvePresses(puzzle, state.lights);
      if (!x) return d;
      let cells = x.flatMap((v, i) => (v ? [i] : []));
      if (count > 0) cells = cells.slice(0, count);
      return { ...d, [SOLUTION_KEY]: cells };
    }, { owner });
  },
};

/** Press a cell that the minimal solution needs. The only deduction flip has, so it doubles as the guide entry. */
const solutionPress: Technique<FlipPuzzle, FlipState, FlipAction> = {
  id: "flip.solution-press",
  name: "solution press",
  puzzles: ["flip"],
  level: 1,
  description: "every board has a set of presses that turns everything off, and pressing a cell twice cancels out, so each cell is pressed once or not at all. working out that set is linear algebra over on/off; this picks one cell from the smallest such set.",
  find(p, s) {
    const x = solvePresses(p, s.lights);
    const cell = x ? x.indexOf(1) : -1;
    if (cell < 0) return null;
    const at = `(${(cell % p.w) + 1}, ${Math.floor(cell / p.w) + 1})`;
    return {
      message: `press ${at}: it's part of the smallest set of presses that clears the board`,
      nudge: "one press in the highlighted row helps",
      focus: [cell],
      nudgeFocus: Array.from({ length: p.w }, (_, i) => Math.floor(cell / p.w) * p.w + i),
      actions: [{ type: "press", cell }],
    };
  },
};

export function register(registry: Registry): void {
  registry.technique(solutionPress);
  registry.puzzle(flip);
  registry.view(flipView);
  registry.plugin(solutionAssist);
}

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  register(games.registry);
}
