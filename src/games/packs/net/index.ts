import type { GamesApi } from "../../api";
import type { Registry } from "../../core/registry";
import { assists } from "./assists";
import { net } from "./logic";
import { techniques } from "./techniques";
import { netView, type AssetLookup } from "./view";
import { scrollPad } from "./widgets";

export function register(registry: Registry, look: AssetLookup = (_id, fallback) => fallback): void {
  for (const t of techniques) registry.technique(t);
  registry.puzzle(net);
  registry.view(netView(look));
  registry.widget(scrollPad);
  for (const p of assists) registry.plugin(p);
}

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  register(games.registry, games.look.asset);
}
