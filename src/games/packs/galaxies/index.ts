import type { GamesApi } from "../../api";
import { galaxies } from "./logic";
import { galaxiesPlugins } from "./plugins";
import { galaxiesTechniques } from "./techniques";
import { galaxiesView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(galaxies);
  registry.view(galaxiesView(games.board));
  for (const t of galaxiesTechniques) registry.technique(t);
  for (const p of galaxiesPlugins) registry.plugin(p);
}
