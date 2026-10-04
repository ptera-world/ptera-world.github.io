import type { GamesApi } from "../../api";
import { lightup } from "./logic";
import { lightupPlugins } from "./plugins";
import { lightupTechniques } from "./techniques";
import { lightupView } from "./view";
import { lightupWidgets } from "./widgets";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(lightup);
  registry.view(lightupView(games.look));
  for (const t of lightupTechniques) registry.technique(t);
  for (const p of lightupPlugins) registry.plugin(p);
  for (const w of lightupWidgets) registry.widget(w);
}
