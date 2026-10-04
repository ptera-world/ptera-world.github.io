import type { GamesApi } from "../../api";
import { magnets } from "./logic";
import { magnetsPlugins } from "./plugins";
import { magnetsTechniques } from "./techniques";
import { magnetsView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(magnets);
  registry.view(magnetsView(games.board));
  for (const t of magnetsTechniques) registry.technique(t);
  for (const p of magnetsPlugins) registry.plugin(p);
}
