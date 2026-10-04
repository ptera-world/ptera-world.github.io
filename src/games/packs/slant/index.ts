import type { GamesApi } from "../../api";
import { slant } from "./logic";
import { slantPlugins } from "./plugins";
import { slantTechniques } from "./techniques";
import { slantView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(slant);
  registry.view(slantView(games.board));
  for (const t of slantTechniques) registry.technique(t);
  for (const p of slantPlugins) registry.plugin(p);
}
