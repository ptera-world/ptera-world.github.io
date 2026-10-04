import type { GamesApi } from "../../api";
import { fifteen } from "./logic";
import { fifteenTechniques } from "./techniques";
import { fifteenView } from "./view";
import { movesWidget } from "./widgets";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(fifteen);
  registry.view(fifteenView);
  for (const t of fifteenTechniques) registry.technique(t);
  registry.widget(movesWidget);
}
