import type { GamesApi } from "../../api";
import { tripeaks } from "./logic";
import { solveFrom, tripeaksTechniques } from "./techniques";
import { tripeaksScore, tripeaksView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle({ ...tripeaks, solve: solveFrom });
  registry.view(tripeaksView);
  registry.widget(tripeaksScore);
  for (const t of tripeaksTechniques) registry.technique(t);
}
