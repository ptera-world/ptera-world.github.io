import type { GamesApi } from "../../api";
import { scoreWidget } from "../../lib/cards/score";
import { scoreOf, setsOf, spider, type SpiderPuzzle, type SpiderState } from "./logic";
import { checkWinnable, solveFrom } from "./techniques";
import { spiderView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle({ ...spider, solve: solveFrom });
  registry.view(spiderView);
  registry.widget(scoreWidget<SpiderPuzzle, SpiderState>({
    id: "spider.score",
    name: "score and moves",
    description: "500 to start, a point off per move, a hundred per finished run",
    puzzles: [spider],
    read: (p, s) => `score ${scoreOf(s, setsOf(p))} · ${s.moves} ${s.moves === 1 ? "move" : "moves"}`,
  }));
  registry.plugin(checkWinnable);
}
