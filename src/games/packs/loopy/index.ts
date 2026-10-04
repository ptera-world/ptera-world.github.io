import type { GamesApi } from "../../api";
import type { Registry } from "../../core/registry";
import { assists } from "./assists";
import { loopy } from "./def";
import { loopyView } from "./view";

export { registerTiling } from "./grid";
export { techniques } from "./solver";
export { KEYS } from "./keys";

export function register(registry: Registry): void {
  registry.puzzle(loopy);
  registry.view(loopyView);
  for (const p of assists) registry.plugin(p);
}

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  register(games.registry);
}
