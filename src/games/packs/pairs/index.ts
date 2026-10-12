import type { GamesApi } from "../../api";
import { pairs } from "./logic";
import { pairsTechniques } from "./techniques";
import { pairsView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(pairs);
  registry.view(pairsView);
  for (const t of pairsTechniques) registry.technique(t);
}
