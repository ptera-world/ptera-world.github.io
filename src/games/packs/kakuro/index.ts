import type { GamesApi } from "../../api";
import { kakuro } from "./logic";
import { kakuroPlugins } from "./plugins";
import { kakuroTechniques } from "./techniques";
import { kakuroView } from "./view";
import { kakuroWidgets } from "./widgets";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(kakuro);
  registry.view(kakuroView(games.board));
  for (const t of kakuroTechniques) registry.technique(t);
  for (const p of kakuroPlugins) registry.plugin(p);
  for (const w of kakuroWidgets) registry.widget(w);
}
