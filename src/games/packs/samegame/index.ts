import type { GamesApi } from "../../api";
import { samegame } from "./logic";
import { checkClearable, hint } from "./techniques";
import { samegameView, scoreWidget } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle({ ...samegame, hint });
  registry.view(samegameView);
  registry.plugin(checkClearable);
  registry.widget(scoreWidget);
}
