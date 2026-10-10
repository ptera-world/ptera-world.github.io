import type { GamesApi } from "../../api";
import { blackbox } from "./logic";
import { blackboxPlugins } from "./plugins";
import { blackboxHint, blackboxTechniques } from "./techniques";
import { blackboxView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle({ ...blackbox, hint: blackboxHint });
  registry.view(blackboxView(games.board));
  for (const t of blackboxTechniques) registry.technique(t);
  for (const p of blackboxPlugins) registry.plugin(p);
}
