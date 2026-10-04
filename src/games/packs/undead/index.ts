import type { GamesApi } from "../../api";
import { undead } from "./logic";
import { undeadPlugins } from "./plugins";
import { undeadTechniques } from "./techniques";
import { undeadView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(undead);
  registry.view(undeadView(games.look, games.board));
  for (const t of undeadTechniques) registry.technique(t);
  for (const p of undeadPlugins) registry.plugin(p);
}
