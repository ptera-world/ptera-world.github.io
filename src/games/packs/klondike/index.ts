import type { GamesApi } from "../../api";
import { scoreWidget } from "../../lib/cards/score";
import { klondike, scoreLine, type KlondikePuzzle, type KlondikeState } from "./logic";
import { bankPlugin } from "./score";
import { checkWinnable, klondikeTechniques, solveFrom } from "./techniques";
import { klondikeView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle({ ...klondike, solve: solveFrom });
  registry.view(klondikeView);
  registry.widget(scoreWidget<KlondikePuzzle, KlondikeState>({
    id: "klondike.score",
    name: "score and moves",
    description: "the score or money, the moves, and the running vegas total when kept",
    puzzles: [klondike],
    timed: (p) => !!p.timed,
    read: scoreLine,
  }));
  registry.plugin(bankPlugin(klondike));
  for (const t of klondikeTechniques) registry.technique(t);
  registry.plugin(checkWinnable);
}
