import type { Registry } from "../../core/registry";
import { bridges } from "./logic";
import { plugins } from "./plugins";
import { bridgesView } from "./view";

export function register(registry: Registry): void {
  registry.puzzle(bridges);
  registry.view(bridgesView);
  for (const p of plugins) registry.plugin(p);
}
