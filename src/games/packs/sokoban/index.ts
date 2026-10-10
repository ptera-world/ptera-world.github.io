import type { GamesApi } from "../../api";
import { sokoban } from "./logic";
import { sokoPlugins } from "./plugins";
import { hint } from "./techniques";
import { countWidget, sokoView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle({ ...sokoban, hint });
  registry.view(sokoView);
  for (const p of sokoPlugins) registry.plugin(p);
  registry.widget(countWidget);
}
