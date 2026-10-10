import type { GamesApi } from "../../api";
import { spider } from "./logic";
import { checkWinnable, fallbackHint, solveFrom } from "./techniques";
import { spiderView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle({ ...spider, hint: fallbackHint, solve: solveFrom });
  registry.view(spiderView);
  registry.plugin(checkWinnable);
}
