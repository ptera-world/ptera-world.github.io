import { untapAll } from "./hooks";
import type { Registry } from "./registry";
import { resolve, type Schema, type Values } from "./schema";
import type { Session } from "./session";
import { namespace } from "./storage";
import type { AnyPlugin, CommandDef, PluginApi, ViewHandle } from "./types";

const store = namespace("plugin");

export interface PluginConfig {
  enabled: boolean;
  settings: Record<string, unknown>;
}

export function loadPluginConfig(p: AnyPlugin): PluginConfig {
  const raw = store.get<Partial<PluginConfig>>(p.id, {});
  return {
    enabled: raw.enabled ?? p.enabledByDefault ?? true,
    settings: p.settings ? resolve(p.settings, raw.settings) : {},
  };
}

export function savePluginConfig(p: AnyPlugin, cfg: PluginConfig): void {
  store.set(p.id, cfg);
}

interface Active {
  plugin: AnyPlugin;
  owner: string;
  teardown?: () => void;
  uiTeardown?: () => void;
  api: PluginApi<any, any, any, any, Schema>;
}

/**
 * Attaches every enabled plugin for a session's puzzle and keeps them in sync with config
 * changes. Each plugin's taps use a unique owner, so detaching is exact.
 */
export class PluginHost {
  private active = new Map<string, Active>();
  private view: { handle: ViewHandle; root: HTMLElement; frame: HTMLElement } | null = null;

  private ready = false;

  /** Attaches enabled plugins, then settles the opening state with all of them (no undo step). */
  constructor(private registry: Registry, private session: Session<any, any, any, any>) {
    for (const p of registry.pluginsFor(session.def, session.puzzle)) this.sync(p);
    this.ready = true;
    session.settle(false);
  }

  plugins(): AnyPlugin[] {
    return this.registry.pluginsFor(this.session.def, this.session.puzzle);
  }

  /** (Re)attach or detach one plugin to match its stored config. */
  sync(p: AnyPlugin): void {
    this.detach(p.id);
    const cfg = loadPluginConfig(p);
    if (!cfg.enabled) {
      this.session.invalidateDerived();
      return;
    }
    const owner = `plugin:${p.id}`;
    const api: PluginApi<any, any, any, any, Schema> = { session: this.session, settings: cfg.settings as Values<Schema>, owner };
    const a: Active = { plugin: p, owner, api };
    try {
      a.teardown = p.setup?.(api) ?? undefined;
    } catch (e) {
      console.error(`[games] plugin ${p.id} setup failed`, e);
    }
    this.active.set(p.id, a);
    if (this.view) this.attachUi(a);
    this.session.invalidateDerived();
    // an enabled plugin's apply taps take effect immediately, as one undoable step
    if (this.ready) this.session.settle(true, owner);
  }

  setConfig(p: AnyPlugin, cfg: PluginConfig): void {
    savePluginConfig(p, cfg);
    this.sync(p);
  }

  attachView(handle: ViewHandle, root: HTMLElement, frame: HTMLElement = root): void {
    this.detachView();
    this.view = { handle, root, frame };
    for (const a of this.active.values()) this.attachUi(a);
  }

  detachView(): void {
    for (const a of this.active.values()) {
      a.uiTeardown?.();
      a.uiTeardown = undefined;
    }
    this.view = null;
  }

  /** Commands from every enabled plugin. */
  commands(): CommandDef[] {
    return [...this.active.values()].flatMap((a) => {
      try {
        return a.plugin.commands?.(a.api) ?? [];
      } catch (e) {
        console.error(`[games] plugin ${a.plugin.id} commands failed`, e);
        return [];
      }
    });
  }

  destroy(): void {
    this.detachView();
    for (const id of this.active.keys()) this.detach(id);
  }

  private attachUi(a: Active): void {
    if (!this.view || !a.plugin.ui) return;
    if (this.view.handle.hooks) untapAll(this.view.handle.hooks, a.owner);
    try {
      a.uiTeardown = a.plugin.ui({ ...a.api, view: this.view.handle, root: this.view.root, frame: this.view.frame }) ?? undefined;
    } catch (e) {
      console.error(`[games] plugin ${a.plugin.id} ui failed`, e);
    }
  }

  private detach(id: string): void {
    const a = this.active.get(id);
    if (!a) return;
    a.uiTeardown?.();
    a.teardown?.();
    untapAll(this.session.hooks, a.owner);
    if (this.view?.handle.hooks) untapAll(this.view.handle.hooks, a.owner);
    this.active.delete(id);
  }
}
