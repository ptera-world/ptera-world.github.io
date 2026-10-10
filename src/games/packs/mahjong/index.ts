import type { GamesApi } from "../../api";
import { mahjong } from "./logic";
import { checkClearable, fallbackHint, mahjongTechniques, solveFrom } from "./techniques";
import { mahjongView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle({ ...mahjong, hint: fallbackHint, solve: solveFrom });
  registry.view(mahjongView);
  for (const t of mahjongTechniques) registry.technique(t);
  registry.plugin(checkClearable);
}
