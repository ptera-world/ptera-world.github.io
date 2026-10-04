import type { GamesApi } from "../../api";
import { twiddle } from "./logic";
import { twiddleTechniques } from "./techniques";
import { twiddleView } from "./view";
import { movesWidget } from "./widgets";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(twiddle);
  registry.view(twiddleView);
  for (const t of twiddleTechniques) registry.technique(t);
  registry.widget(movesWidget);
}
