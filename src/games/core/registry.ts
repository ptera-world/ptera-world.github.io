import { Event, Waterfall } from "./hooks";
import type { AnyPuzzleDef, Frontend, Plugin, Technique, Theme, View, WidgetDef } from "./types";

/**
 * Global catalogue of puzzles, plugins and views. Registering an existing id replaces it,
 * which is how mods override built-ins. Lookups go through `resolve*` waterfalls so mods can
 * wrap a definition without replacing it.
 */
export class Registry {
  private puzzles = new Map<string, AnyPuzzleDef>();
  private plugins = new Map<string, Plugin>();
  private views = new Map<string, View>();
  private techniques = new Map<string, Technique>();
  private widgets = new Map<string, WidgetDef>();
  private themes = new Map<string, Theme>();
  private frontends = new Map<string, Frontend>();

  readonly hooks = {
    resolvePuzzle: new Waterfall<AnyPuzzleDef, void>("resolvePuzzle"),
    resolvePlugin: new Waterfall<Plugin, void>("resolvePlugin"),
    resolveView: new Waterfall<View, void>("resolveView"),
    resolveTechnique: new Waterfall<Technique, void>("resolveTechnique"),
    resolveWidget: new Waterfall<WidgetDef, void>("resolveWidget"),
    /** Fired after any registration change. */
    changed: new Event<{ kind: "puzzle" | "plugin" | "view" | "technique" | "widget" | "theme" | "frontend"; id: string }>("changed"),
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

  technique(t: Technique): void {
    this.techniques.set(t.id, t);
    this.hooks.changed.call({ kind: "technique", id: t.id });
  }

  frontend(f: Frontend): void {
    this.frontends.delete(f.id);
    this.frontends.set(f.id, f);
    this.hooks.changed.call({ kind: "frontend", id: f.id });
  }

  /** Registration order; the last one is the default. */
  listFrontends(): Frontend[] {
    return [...this.frontends.values()];
  }

  theme(th: Theme): void {
    this.themes.set(th.id, th);
    this.hooks.changed.call({ kind: "theme", id: th.id });
  }

  listThemes(): Theme[] {
    return [...this.themes.values()];
  }

  widget(w: WidgetDef): void {
    this.widgets.set(w.id, w);
    this.hooks.changed.call({ kind: "widget", id: w.id });
  }

  /** True if `requires` is satisfied by the loaded puzzle (always true when no puzzle is given). */
  private has(puzzleId: string, puzzle: unknown, requires: readonly string[] | undefined): boolean {
    if (!requires?.length || puzzle === undefined) return true;
    const def = this.puzzles.get(puzzleId);
    let features: readonly string[] = [];
    try {
      features = def?.features?.(puzzle) ?? [];
    } catch (e) {
      console.error(`[games] ${puzzleId}.features threw`, e);
    }
    return requires.every((r) => features.includes(r));
  }

  /** Techniques for a puzzle, easiest first (ties by id, so order is stable). */
  techniquesFor(puzzleId: string, puzzle?: unknown): Technique[] {
    return [...this.techniques.values()]
      .filter((t) => t.puzzles.includes(puzzleId) && this.has(puzzleId, puzzle, t.requires))
      .map((t) => this.hooks.resolveTechnique.call(t))
      .sort((a, b) => a.level - b.level || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  widgetsFor(puzzleId: string, puzzle?: unknown): WidgetDef[] {
    return [...this.widgets.values()]
      .filter((w) => (w.puzzles === "*" || w.puzzles.includes(puzzleId)) && this.has(puzzleId, puzzle, w.requires))
      .map((w) => this.hooks.resolveWidget.call(w));
  }

  getPuzzle(id: string): AnyPuzzleDef | undefined {
    const d = this.puzzles.get(id);
    return d && this.hooks.resolvePuzzle.call(d);
  }

  listPuzzles(): AnyPuzzleDef[] {
    return [...this.puzzles.keys()].map((id) => this.getPuzzle(id)!);
  }

  pluginsFor(puzzleId: string, puzzle?: unknown): Plugin[] {
    return [...this.plugins.values()]
      .filter((p) => (p.appliesTo === "*" || p.appliesTo.includes(puzzleId)) && this.has(puzzleId, puzzle, p.requires))
      .map((p) => this.hooks.resolvePlugin.call(p));
  }

  viewsFor(puzzleId: string): View[] {
    return [...this.views.values()]
      .filter((v) => v.puzzle === puzzleId)
      .map((v) => this.hooks.resolveView.call(v));
  }
}

export const registry = new Registry();
