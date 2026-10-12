import type { GamesApi } from "../../api";
import { klondike } from "./logic";
import { checkWinnable, klondikeTechniques, solveFrom } from "./techniques";
import { klondikeView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle({ ...klondike, solve: solveFrom });
  registry.view(klondikeView);
  for (const t of klondikeTechniques) registry.technique(t);
  registry.plugin(checkWinnable);
}
