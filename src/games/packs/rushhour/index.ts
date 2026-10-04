import type { GamesApi } from "../../api";
import { rushhour } from "./logic";
import { rushTechniques } from "./techniques";
import { movesWidget, rushView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(rushhour);
  registry.view(rushView);
  for (const t of rushTechniques) registry.technique(t);
  registry.widget(movesWidget);
}
