import type { GamesApi } from "../../api";
import { pyramid } from "./logic";
import { aims, checkWinnable, pyramidTechniques, solveFrom } from "./techniques";
import { pyramidView } from "./view";
import { pyramidScore } from "./widgets";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle({ ...pyramid, solve: solveFrom, aims });
  registry.view(pyramidView);
  registry.widget(pyramidScore);
  for (const t of pyramidTechniques) registry.technique(t);
  registry.plugin(checkWinnable);
}
