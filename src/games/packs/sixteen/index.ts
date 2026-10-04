import type { GamesApi } from "../../api";
import { sixteen } from "./logic";
import { sixteenTechniques } from "./techniques";
import { sixteenView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(sixteen);
  registry.view(sixteenView);
  for (const t of sixteenTechniques) registry.technique(t);
}
