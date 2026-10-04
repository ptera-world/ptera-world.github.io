import type { GamesApi } from "../../api";
import { range } from "./logic";
import { rangePlugins } from "./plugins";
import { rangeTechniques } from "./techniques";
import { rangeView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(range);
  registry.view(rangeView(games.board));
  for (const t of rangeTechniques) registry.technique(t);
  for (const p of rangePlugins) registry.plugin(p);
}
