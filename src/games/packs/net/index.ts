import type { GamesApi } from "../../api";
import type { Registry } from "../../core/registry";
import { assists } from "./assists";
import { net } from "./logic";
import { techniques } from "./techniques";
import { netView, type NetViewDeps } from "./view";
import { scrollPad, tapModes } from "./widgets";

export function register(registry: Registry, deps: NetViewDeps = {}): void {
  for (const t of techniques) registry.technique(t);
  registry.puzzle(net);
  registry.view(netView(deps));
  registry.widget(tapModes);
  registry.widget(scrollPad);
  for (const p of assists) registry.plugin(p);
}

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  register(games.registry, { look: games.look.asset, labelSides: games.board.labelSides, holdMs: games.HOLD_MS });
}
