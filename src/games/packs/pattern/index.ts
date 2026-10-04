import type { GamesApi } from "../../api";
import type { Registry } from "../../core/registry";
import { pattern } from "./logic";
import { plugins } from "./plugins";
import { patternView } from "./view";

export function register(registry: Registry): void {
  registry.puzzle(pattern);
  registry.view(patternView);
  for (const p of plugins) registry.plugin(p);
}

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  register(games.registry);
}
