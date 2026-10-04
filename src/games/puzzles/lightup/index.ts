import type { Registry } from "../../core/registry";
import { lightup } from "./logic";
import { lightupPlugins } from "./plugins";
import { lightupView } from "./view";

export function register(registry: Registry): void {
  registry.puzzle(lightup);
  registry.view(lightupView);
  for (const p of lightupPlugins) registry.plugin(p);
}
