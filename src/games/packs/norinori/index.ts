import type { GamesApi } from "../../api";
import { norinori } from "./logic";
import { norinoriPlugins } from "./plugins";
import { norinoriTechniques } from "./techniques";
import { norinoriView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(norinori);
  registry.view(norinoriView(games.board));
  for (const t of norinoriTechniques) registry.technique(t);
  for (const p of norinoriPlugins) registry.plugin(p);
}
