import type { GamesApi } from "../../api";
import type { Registry } from "../../core/registry";
import { assists } from "./assists";
import { net } from "./logic";
import { netView } from "./view";

export function register(registry: Registry): void {
  registry.puzzle(net);
  registry.view(netView);
  for (const p of assists) registry.plugin(p);
}

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  register(games.registry);
}
