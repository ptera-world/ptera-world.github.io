import type { GamesApi } from "../../api";
import { palisade } from "./logic";
import { palisadePlugins } from "./plugins";
import { palisadeTechniques } from "./techniques";
import { palisadeView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(palisade);
  registry.view(palisadeView(games.board));
  for (const t of palisadeTechniques) registry.technique(t);
  for (const p of palisadePlugins) registry.plugin(p);
}
