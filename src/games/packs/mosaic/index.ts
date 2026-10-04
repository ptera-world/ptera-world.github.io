import type { GamesApi } from "../../api";
import { mosaic } from "./logic";
import { mosaicPlugins } from "./plugins";
import { mosaicTechniques } from "./techniques";
import { mosaicView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(mosaic);
  registry.view(mosaicView(games.board));
  for (const t of mosaicTechniques) registry.technique(t);
  for (const p of mosaicPlugins) registry.plugin(p);
}
