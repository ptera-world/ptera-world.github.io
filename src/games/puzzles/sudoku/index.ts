import type { Registry } from "../../core/registry";
import { latinDefs } from "./defs";
import { constraintTypes } from "./engine/registry";
import { techniques } from "./engine/human";
import { latinPlugins } from "./plugins";
import { viewFor } from "./view";

/**
 * Engine handles for mods, reachable as `games.registry.getPuzzle("sudoku").engine`:
 * register a constraint type (with a predicate rule it gets solving, hints, conflict checks
 * and generation), or push a technique into the human solver.
 */
export const engine = { constraintTypes, techniques };

export function register(registry: Registry): void {
  for (const def of latinDefs) {
    registry.puzzle(Object.assign(def, { engine }));
    registry.view(viewFor(def.id));
  }
  for (const p of latinPlugins) registry.plugin(p);
}
