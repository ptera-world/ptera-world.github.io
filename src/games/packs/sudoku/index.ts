import type { GamesApi } from "../../api";
import type { Registry } from "../../core/registry";
import { latinDefs } from "./defs";
import { constraintTypes } from "./engine/registry";
import { techniques as gradingTechniques } from "./engine/human";
import { latinPlugins } from "./plugins";
import {
  clueTechnique, fullHouseTechnique, hiddenSingleTechnique, latinTechnique, latinTechniques, nakedSingleTechnique, otherClues,
} from "./techniques";
import { viewFor, type BoardPrefs } from "./view";
import { latinWidgets } from "./widgets";

/**
 * Engine handles for mods, reachable as `games.registry.getPuzzle("sudoku").engine`:
 * - `constraintTypes.register(t)`: a new clue type (its predicate rule gives solving, conflict
 *   checks and generation); register `clueTechnique(t)` too for hints and auto-apply.
 * - `latinTechnique(spec)`: a technique over the engine's grid, for `games.registry.technique`.
 * - `gradingTechniques`: the list difficulty ratings and generation targets are computed with.
 */
export const engine = { constraintTypes, latinTechnique, clueTechnique, gradingTechniques };

export function register(registry: Registry, board?: BoardPrefs): void {
  for (const def of latinDefs) {
    registry.puzzle(Object.assign(def, { engine }));
    registry.view(viewFor(def, board));
  }
  for (const p of latinPlugins) registry.plugin(p);
  for (const t of latinTechniques()) registry.technique(t);
  for (const w of latinWidgets) registry.widget(w);
}

/**
 * Players who had the old auto-fill assists on get the same singles auto-applied as techniques
 * (and clue techniques too if they ruled out by constraint arithmetic). Runs once: the old
 * entries are removed.
 */
function migrate(games: GamesApi): void {
  const plugins = games.storage("plugin");
  const tech = games.storage("technique");
  const auto = ({ id }: { id: string }) => {
    tech.set(id, { ...tech.get<Record<string, unknown>>(id, {}), auto: true });
  };
  for (const [kind, single] of [["naked", nakedSingleTechnique], ["hidden", hiddenSingleTechnique]] as const) {
    const old = plugins.get<{ enabled?: boolean; settings?: { depth?: string } } | null>(`sudoku.fill-${kind}`, null);
    if (!old) continue;
    plugins.remove(`sudoku.fill-${kind}`);
    if (!old.enabled) continue;
    auto(fullHouseTechnique);
    auto(single);
    if (old.settings?.depth !== "rules") continue;
    for (const t of constraintTypes.list()) {
      const c = clueTechnique(t);
      if (c) auto(c);
    }
    auto(otherClues);
  }
}

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  migrate(games);
  register(games.registry, games.board);
}
