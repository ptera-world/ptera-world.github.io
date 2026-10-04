import type { GamesApi } from "../../api";
import { singles } from "./logic";
import { singlesPlugins } from "./plugins";
import { singlesTechniques } from "./techniques";
import { singlesView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(singles);
  registry.view(singlesView(games.board));
  for (const t of singlesTechniques) registry.technique(t);
  for (const p of singlesPlugins) registry.plugin(p);
}
