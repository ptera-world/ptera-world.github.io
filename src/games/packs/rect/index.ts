import type { GamesApi } from "../../api";
import { rect } from "./logic";
import { rectPlugins } from "./plugins";
import { rectTechniques } from "./techniques";
import { rectView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(rect);
  registry.view(rectView(games.board));
  for (const t of rectTechniques) registry.technique(t);
  for (const p of rectPlugins) registry.plugin(p);
}
