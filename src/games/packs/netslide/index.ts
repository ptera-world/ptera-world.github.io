import type { GamesApi } from "../../api";
import { netslide } from "./logic";
import { netslideTechniques } from "./techniques";
import { netslideView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(netslide);
  registry.view(netslideView);
  for (const t of netslideTechniques) registry.technique(t);
}
