import type { GamesApi } from "../../api";
import { filling } from "./logic";
import { fillingPlugins } from "./plugins";
import { fillingTechniques } from "./techniques";
import { fillingView } from "./view";
import { fillingWidgets } from "./widgets";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(filling);
  registry.view(fillingView(games.board));
  for (const t of fillingTechniques) registry.technique(t);
  for (const p of fillingPlugins) registry.plugin(p);
  for (const w of fillingWidgets) registry.widget(w);
}
