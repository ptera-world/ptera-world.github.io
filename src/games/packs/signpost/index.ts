import type { GamesApi } from "../../api";
import { signpost } from "./logic";
import { signpostPlugins } from "./plugins";
import { signpostTechniques } from "./techniques";
import { signpostView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(signpost);
  registry.view(signpostView(games.board));
  for (const t of signpostTechniques) registry.technique(t);
  for (const p of signpostPlugins) registry.plugin(p);
}
