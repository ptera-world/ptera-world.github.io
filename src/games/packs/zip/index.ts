import type { GamesApi } from "../../api";
import { zip } from "./logic";
import { zipPlugins } from "./plugins";
import { zipTechniques } from "./techniques";
import { zipView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(zip);
  registry.view(zipView(games.board));
  for (const t of zipTechniques) registry.technique(t);
  for (const p of zipPlugins) registry.plugin(p);
}
