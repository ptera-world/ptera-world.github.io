import type { GamesApi } from "../../api";
import { flood } from "./logic";
import { behindPace, floodTechniques, hint } from "./techniques";
import { floodView, movesWidget } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle({ ...flood, hint });
  registry.view(floodView);
  for (const t of floodTechniques) registry.technique(t);
  registry.plugin(behindPace);
  registry.widget(movesWidget);
}
