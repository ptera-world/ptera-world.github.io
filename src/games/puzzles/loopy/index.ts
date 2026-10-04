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
