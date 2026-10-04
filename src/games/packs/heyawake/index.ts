import type { GamesApi } from "../../api";
import { heyawake } from "./logic";
import { heyawakePlugins } from "./plugins";
import { heyawakeTechniques } from "./techniques";
import { heyawakeView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(heyawake);
  registry.view(heyawakeView(games.board));
  for (const t of heyawakeTechniques) registry.technique(t);
  for (const p of heyawakePlugins) registry.plugin(p);
}
