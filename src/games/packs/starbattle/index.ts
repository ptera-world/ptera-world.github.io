import type { GamesApi } from "../../api";
import { starbattle } from "./logic";
import { starbattlePlugins } from "./plugins";
import { starbattleTechniques } from "./techniques";
import { starbattleView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(starbattle);
  registry.view(starbattleView(games.board));
  for (const t of starbattleTechniques) registry.technique(t);
  for (const p of starbattlePlugins) registry.plugin(p);
}
