import type { GamesApi } from "../../api";
import { mines } from "./logic";
import { minesPlugins } from "./plugins";
import { minesHint, minesTechniques } from "./techniques";
import { minesView } from "./view";
import { minesWidgets } from "./widgets";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle({ ...mines, hint: minesHint });
  registry.view(minesView(games.look, games.board.labelSides));
  for (const t of minesTechniques) registry.technique(t);
  for (const p of minesPlugins) registry.plugin(p);
  for (const w of minesWidgets) registry.widget(w);
}
