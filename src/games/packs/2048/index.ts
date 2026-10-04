import type { GamesApi } from "../../api";
import { game2048 } from "./logic";
import { techniques2048 } from "./techniques";
import { scoreWidget, view2048 } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(game2048);
  registry.view(view2048);
  for (const t of techniques2048) registry.technique(t);
  registry.widget(scoreWidget);
}
