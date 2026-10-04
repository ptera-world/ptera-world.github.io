import type { Registry } from "../../core/registry";
import { assists } from "./assists";
import { net } from "./logic";
import { netView } from "./view";

export function register(registry: Registry): void {
  registry.puzzle(net);
  registry.view(netView);
  for (const p of assists) registry.plugin(p);
}
