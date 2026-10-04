import type { GamesApi } from "../../api";
import { inertia } from "./logic";
import { checkReachable, inertiaTechniques } from "./techniques";
import { gemsWidget, inertiaView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(inertia);
  registry.view(inertiaView);
  for (const t of inertiaTechniques) registry.technique(t);
  registry.plugin(checkReachable);
  registry.widget(gemsWidget);
}
