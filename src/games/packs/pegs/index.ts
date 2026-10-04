import type { GamesApi } from "../../api";
import { pegs } from "./logic";
import { checkFinishable, pegsTechniques } from "./techniques";
import { countWidget, pegsView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(pegs);
  registry.view(pegsView);
  for (const t of pegsTechniques) registry.technique(t);
  registry.plugin(checkFinishable);
  registry.widget(countWidget);
}
