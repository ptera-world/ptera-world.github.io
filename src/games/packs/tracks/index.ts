import type { GamesApi } from "../../api";
import { tracks } from "./logic";
import { tracksPlugins } from "./plugins";
import { tracksTechniques } from "./techniques";
import { tracksView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(tracks);
  registry.view(tracksView(games.board));
  for (const t of tracksTechniques) registry.technique(t);
  for (const p of tracksPlugins) registry.plugin(p);
}
