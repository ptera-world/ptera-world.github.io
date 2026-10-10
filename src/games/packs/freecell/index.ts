import type { GamesApi } from "../../api";
import { freecell } from "./logic";
import { checkWinnable, fallbackHint, freecellTechniques, solveFrom } from "./techniques";
import { freecellView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle({ ...freecell, hint: fallbackHint, solve: solveFrom });
  registry.view(freecellView);
  for (const t of freecellTechniques) registry.technique(t);
  registry.plugin(checkWinnable);
}
