import type { GamesApi } from "../../api";
import { pearl } from "./logic";
import { pearlPlugins } from "./plugins";
import { pearlTechniques } from "./techniques";
import { pearlView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(pearl);
  registry.view(pearlView(games.board));
  for (const t of pearlTechniques) registry.technique(t);
  for (const p of pearlPlugins) registry.plugin(p);
}
