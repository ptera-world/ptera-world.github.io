import type { GamesApi } from "../../api";
import type { Registry } from "../../core/registry";
import { mines } from "./logic";
import { minesPlugins } from "./plugins";
import { minesView } from "./view";

export function register(registry: Registry): void {
  registry.puzzle(mines);
  registry.view(minesView);
  for (const p of minesPlugins) registry.plugin(p);
}

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  register(games.registry);
}
