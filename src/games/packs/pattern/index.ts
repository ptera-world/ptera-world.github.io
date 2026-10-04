import type { GamesApi } from "../../api";
import { pattern } from "./logic";
import { patternPlugins } from "./plugins";
import { patternTechniques } from "./techniques";
import { patternView } from "./view";
import { patternWidgets } from "./widgets";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(pattern);
  registry.view(patternView(games.look, games.board));
  for (const t of patternTechniques) registry.technique(t);
  for (const p of patternPlugins) registry.plugin(p);
  for (const w of patternWidgets) registry.widget(w);
}
