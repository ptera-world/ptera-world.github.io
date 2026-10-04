import type { GamesApi } from "../../api";
import { dominosa } from "./logic";
import { dominosaPlugins } from "./plugins";
import { dominosaTechniques } from "./techniques";
import { dominosaView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(dominosa);
  registry.view(dominosaView(games.board));
  for (const t of dominosaTechniques) registry.technique(t);
  for (const p of dominosaPlugins) registry.plugin(p);
}
