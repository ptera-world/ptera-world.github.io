import type { GamesApi } from "../../api";
import { pattern } from "./logic";
import { patternPlugins } from "./plugins";
import { patternTechniques } from "./techniques";
import { patternView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(pattern);
  registry.view(patternView(games.look, games.board, games.HOLD_MS));
  for (const t of patternTechniques) registry.technique(t);
  for (const p of patternPlugins) registry.plugin(p);
}
