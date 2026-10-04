import type { Registry } from "../../core/registry";
import { pattern } from "./logic";
import { plugins } from "./plugins";
import { patternView } from "./view";

export function register(registry: Registry): void {
  registry.puzzle(pattern);
  registry.view(patternView);
  for (const p of plugins) registry.plugin(p);
}
