import type { GamesApi } from "../../api";
import type { Registry } from "../../core/registry";
import { assists } from "./assists";
import { loopy } from "./def";
import { techniques } from "./techniques";
import { makeLoopyView, type Labels, type Look } from "./view";

export { registerTiling } from "./grid";
export { passes } from "./solver";
export { techniques } from "./techniques";
export { KEYS } from "./keys";

export function register(registry: Registry, look?: Look, labels?: Labels, holdMs?: number): void {
  registry.puzzle(loopy);
  registry.view(makeLoopyView(look, labels, holdMs));
  for (const t of techniques) registry.technique(t);
  for (const p of assists) registry.plugin(p);
}

/** Old assist ids whose job is now done by auto-applied techniques. */
const RETIRED: Record<string, (settings: Record<string, unknown>) => string[]> = {
  "loopy.auto-cross-clues": () => ["loopy.clue-full"],
  "loopy.auto-cross-dots": (s) => ["loopy.dot-full", ...(s.deadEnds ? ["loopy.dot-dead-end"] : [])],
};

/** Carries switched-on retired assists over to their techniques, once. */
function migrate(games: GamesApi): void {
  const plugins = games.storage("plugin");
  const techs = games.storage("technique");
  for (const [id, to] of Object.entries(RETIRED)) {
    const old = plugins.get<{ enabled?: boolean; settings?: Record<string, unknown> } | null>(id, null);
    if (!old) continue;
    plugins.remove(id);
    if (!old.enabled) continue;
    for (const t of to(old.settings ?? {})) {
      const cur = techs.get<{ hints?: boolean; auto?: boolean }>(t, {});
      techs.set(t, { ...cur, auto: true });
    }
  }
}

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  try {
    migrate(games);
  } catch (e) {
    console.error("[games] loopy settings migration failed", e);
  }
  register(games.registry, games.look, games.board, games.HOLD_MS);
}
