import type { GamesApi } from "../../api";
import { unruly } from "./logic";
import { unrulyPlugins } from "./plugins";
import { unrulyTechniques } from "./techniques";
import { unrulyView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(unruly);
  registry.view(unrulyView(games.board));
  for (const t of unrulyTechniques) registry.technique(t);
  for (const p of unrulyPlugins) registry.plugin(p);
}
