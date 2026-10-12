import type { GamesApi } from "../../api";
import { pegs } from "./logic";
import { checkFinishable } from "./techniques";
import { countWidget, pegsView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(pegs);
  registry.view(pegsView);
  registry.plugin(checkFinishable);
  registry.widget(countWidget);
}
