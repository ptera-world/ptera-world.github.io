import type { GamesApi } from "../../api";
import { gameThrees } from "./logic";
import { techniquesThrees } from "./techniques";
import { scoreWidget, viewThrees } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(gameThrees);
  registry.view(viewThrees);
  for (const t of techniquesThrees) registry.technique(t);
  registry.widget(scoreWidget);
}
