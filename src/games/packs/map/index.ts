import type { GamesApi } from "../../api";
import { map } from "./logic";
import { mapPlugins } from "./plugins";
import { mapTechniques } from "./techniques";
import { mapView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(map);
  registry.view(mapView(games.board));
  for (const t of mapTechniques) registry.technique(t);
  for (const p of mapPlugins) registry.plugin(p);
}
