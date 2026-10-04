import type { Registry } from "../../core/registry";
import { mines } from "./logic";
import { minesPlugins } from "./plugins";
import { minesView } from "./view";

export function register(registry: Registry): void {
  registry.puzzle(mines);
  registry.view(minesView);
  for (const p of minesPlugins) registry.plugin(p);
}
