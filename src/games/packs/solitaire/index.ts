import type { GamesApi } from "../../api";
import { scoreWidget } from "../../lib/cards/score";
import type { SolitairePuzzle, SolitaireState } from "./deal";
import { bankKey, scoreLine, solitaire } from "./logic";
import { bankPlugin } from "./score";
import { checkWinnable, solveFrom, techniques } from "./techniques";
import { solitaireView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle({ ...solitaire, solve: solveFrom });
  registry.view(solitaireView);
  registry.widget(scoreWidget<SolitairePuzzle, SolitaireState>({
    id: "solitaire.score",
    name: "score and moves",
    description: "the score or money, the moves, and the running vegas total when kept",
    puzzles: [solitaire],
    timed: (p) => p.timed,
    read: scoreLine,
  }));
  registry.plugin(bankPlugin<SolitairePuzzle>(solitaire, bankKey));
  for (const t of techniques) registry.technique(t);
  registry.plugin(checkWinnable);
}
