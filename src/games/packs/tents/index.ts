import type { GamesApi } from "../../api";
import { tents } from "./logic";
import { tentsPlugins } from "./plugins";
import { tentsTechniques } from "./techniques";
import { tentsView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(tents);
  registry.view(tentsView(games.board));
  for (const t of tentsTechniques) registry.technique(t);
  for (const p of tentsPlugins) registry.plugin(p);
}
