import type { GamesApi } from "../../api";
import { numberlink } from "./logic";
import { numberlinkPlugins } from "./plugins";
import { numberlinkTechniques } from "./techniques";
import { numberlinkView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(numberlink);
  registry.view(numberlinkView(games.board));
  for (const t of numberlinkTechniques) registry.technique(t);
  for (const p of numberlinkPlugins) registry.plugin(p);
}
