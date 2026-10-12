import type { Step, Technique } from "../../core/types";
import { game2048, DIR_NAMES, best, canSlide, slide, tileValue, type Action2048, type Focus2048, type Puzzle2048, type State2048 } from "./logic";

type Technique2048 = Technique<Puzzle2048, State2048, Action2048>;

function step(p: Puzzle2048, s: State2048, d: number, message: string, nudge: string): Step<Action2048> {
  const r = slide(p.size, s.grid, d);
  const cells = r.moves.filter((m) => m.merged).flatMap((m) => [m.from, m.to]);
  return { message, nudge, actions: [{ type: "slide", dir: d }], focus: { dir: d, cells: [...new Set(cells)] } satisfies Focus2048, nudgeFocus: { dir: d } satisfies Focus2048 };
}

export const onlyMove: Technique2048 = {
  id: "2048.only-move",
  name: "only move",
  puzzles: [game2048],
  level: 1,
  description: "when sliding just one way moves anything, that's the move.",
  instances(p, s, visit) {
    const ways = [0, 1, 2, 3].filter((d) => canSlide(p.size, s.grid, d));
    if (ways.length !== 1) return;
    const d = ways[0]!;
    visit(step(p, s, d, `only sliding ${DIR_NAMES[d]} moves any tile.`, "which slide moves anything at all?"));
  },
  practice: false,
};

export const reachGoal: Technique2048 = {
  id: "2048.goal",
  name: "make the goal tile",
  puzzles: [game2048],
  level: 2,
  description: "when a slide merges two tiles into the goal tile, make it.",
  instances(p, s, visit) {
    if (best(s.grid) >= p.target) return;
    for (let d = 0; d < 4; d++) {
      const r = slide(p.size, s.grid, d);
      if (r.changed && best(r.grid) >= p.target && visit(step(p, s, d, `slide ${DIR_NAMES[d]}: it makes the ${tileValue(p.target)}.`, `can two tiles make ${tileValue(p.target)}?`))) return;
    }
  },
  practice: false,
};

export const techniques2048: Technique2048[] = [onlyMove, reachGoal];
