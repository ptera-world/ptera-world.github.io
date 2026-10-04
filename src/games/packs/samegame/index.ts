import type { GamesApi } from "../../api";
import { samegame } from "./logic";
import { checkClearable, samegameTechniques } from "./techniques";
import { samegameView, scoreWidget } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(samegame);
  registry.view(samegameView);
  for (const t of samegameTechniques) registry.technique(t);
  registry.plugin(checkClearable);
  registry.widget(scoreWidget);
}
