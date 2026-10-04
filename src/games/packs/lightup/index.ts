import type { GamesApi } from "../../api";
import type { Registry } from "../../core/registry";
import { lightup } from "./logic";
import { lightupPlugins } from "./plugins";
import { lightupView } from "./view";

export function register(registry: Registry): void {
  registry.puzzle(lightup);
  registry.view(lightupView);
  for (const p of lightupPlugins) registry.plugin(p);
}

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  register(games.registry);
}
