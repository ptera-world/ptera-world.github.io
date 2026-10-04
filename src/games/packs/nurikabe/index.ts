import type { GamesApi } from "../../api";
import { nurikabe } from "./logic";
import { nurikabePlugins } from "./plugins";
import { nurikabeTechniques } from "./techniques";
import { nurikabeView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(nurikabe);
  registry.view(nurikabeView(games.board));
  for (const t of nurikabeTechniques) registry.technique(t);
  for (const p of nurikabePlugins) registry.plugin(p);
}
