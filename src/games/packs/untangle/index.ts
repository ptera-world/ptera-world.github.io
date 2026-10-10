import type { GamesApi } from "../../api";
import { untangle } from "./logic";
import { untangleHint, untangleTechniques } from "./techniques";
import { untangleView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle({ ...untangle, hint: untangleHint });
  registry.view(untangleView());
  for (const t of untangleTechniques) registry.technique(t);
}
