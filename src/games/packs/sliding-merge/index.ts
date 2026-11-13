import type { GamesApi } from "../../api";
import { gameMerge } from "./logic";
import { techniquesMerge } from "./techniques";
import { scoreWidget, viewMerge } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(gameMerge);
  registry.view(viewMerge);
  for (const t of techniquesMerge) registry.technique(t);
  registry.widget(scoreWidget);
}
