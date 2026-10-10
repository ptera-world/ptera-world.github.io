import type { GamesApi } from "../../api";
import { netslide } from "./logic";
import { hint, netslideTechniques } from "./techniques";
import { netslideView } from "./view";
import { movesWidget } from "./widgets";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle({ ...netslide, hint });
  registry.view(netslideView);
  for (const t of netslideTechniques) registry.technique(t);
  registry.widget(movesWidget);
}
