import { Event, Waterfall } from "./hooks";
import type { AnyPuzzleDef, Plugin, View } from "./types";

/**
 * Global catalogue of puzzles, plugins and views. Registering an existing id replaces it,
 * which is how mods override built-ins. Lookups go through `resolve*` waterfalls so mods can
 * wrap a definition without replacing it.
 */
export class Registry {
  private puzzles = new Map<string, AnyPuzzleDef>();
  private plugins = new Map<string, Plugin>();
  private views = new Map<string, View>();

  readonly hooks = {
    resolvePuzzle: new Waterfall<AnyPuzzleDef, void>("resolvePuzzle"),
    resolvePlugin: new Waterfall<Plugin, void>("resolvePlugin"),
    resolveView: new Waterfall<View, void>("resolveView"),
    /** Fired after any registration change. */
    changed: new Event<{ kind: "puzzle" | "plugin" | "view"; id: string }>("changed"),
  };

  puzzle(def: AnyPuzzleDef): void {
    this.puzzles.set(def.id, def);
    this.hooks.changed.call({ kind: "puzzle", id: def.id });
  }

  plugin(p: Plugin): void {
    this.plugins.set(p.id, p);
    this.hooks.changed.call({ kind: "plugin", id: p.id });
  }

  view(v: View): void {
    this.views.set(v.id, v);
    this.hooks.changed.call({ kind: "view", id: v.id });
  }

  getPuzzle(id: string): AnyPuzzleDef | undefined {
    const d = this.puzzles.get(id);
    return d && this.hooks.resolvePuzzle.call(d);
  }

  listPuzzles(): AnyPuzzleDef[] {
    return [...this.puzzles.keys()].map((id) => this.getPuzzle(id)!);
  }

  pluginsFor(puzzleId: string): Plugin[] {
    return [...this.plugins.values()]
      .filter((p) => p.appliesTo === "*" || p.appliesTo.includes(puzzleId))
      .map((p) => this.hooks.resolvePlugin.call(p));
  }

  viewsFor(puzzleId: string): View[] {
    return [...this.views.values()]
      .filter((v) => v.puzzle === puzzleId)
      .map((v) => this.hooks.resolveView.call(v));
  }
}

export const registry = new Registry();
