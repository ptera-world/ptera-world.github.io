import { untapAll } from "./hooks";
import type { Registry } from "./registry";
import { resolve } from "./schema";
import type { Session } from "./session";
import { namespace } from "./storage";
import type { CommandHandler, Plugin, PluginApi, ViewHandle } from "./types";

const store = namespace("plugin");

export interface PluginConfig {
  enabled: boolean;
  settings: Record<string, unknown>;
}

export function loadPluginConfig(p: Plugin): PluginConfig {
  const raw = store.get<Partial<PluginConfig>>(p.id, {});
  return {
    enabled: raw.enabled ?? p.enabledByDefault ?? true,
    settings: p.settings ? resolve(p.settings, raw.settings) : {},
  };
}

export function savePluginConfig(p: Plugin, cfg: PluginConfig): void {
  store.set(p.id, cfg);
}

interface Active {
  plugin: Plugin;
  owner: string;
  teardown?: () => void;
  uiTeardown?: () => void;
  api: PluginApi<any, any, any, any>;
}

/**
 * Attaches every enabled plugin for a session's puzzle and keeps them in sync with config
 * changes. Each plugin's taps use a unique owner, so detaching is exact.
 */
export class PluginHost {
  private active = new Map<string, Active>();
  private view: { handle: ViewHandle; root: HTMLElement } | null = null;

  constructor(private registry: Registry, private session: Session<any, any, any, any>) {
    for (const p of registry.pluginsFor(session.def.id)) this.sync(p);
  }

  plugins(): Plugin[] {
    return this.registry.pluginsFor(this.session.def.id);
  }

  /** (Re)attach or detach one plugin to match its stored config. */
  sync(p: Plugin): void {
    this.detach(p.id);
    const cfg = loadPluginConfig(p);
    if (!cfg.enabled) {
      this.session.invalidateDerived();
      return;
    }
    const owner = `plugin:${p.id}`;
    const api: PluginApi<any, any, any, any> = { session: this.session, settings: cfg.settings, owner };
    const a: Active = { plugin: p, owner, api };
    try {
      a.teardown = p.setup?.(api) ?? undefined;
    } catch (e) {
      console.error(`[games] plugin ${p.id} setup failed`, e);
    }
    this.active.set(p.id, a);
    if (this.view) this.attachUi(a);
    this.session.invalidateDerived();
  }

  setConfig(p: Plugin, cfg: PluginConfig): void {
    savePluginConfig(p, cfg);
    this.sync(p);
  }

  attachView(handle: ViewHandle, root: HTMLElement): void {
    this.detachView();
    this.view = { handle, root };
    for (const a of this.active.values()) this.attachUi(a);
  }

  detachView(): void {
    for (const a of this.active.values()) {
      a.uiTeardown?.();
      a.uiTeardown = undefined;
    }
    this.view = null;
  }

  handlers(): Record<string, CommandHandler> {
    const out: Record<string, CommandHandler> = {};
    for (const a of this.active.values()) Object.assign(out, a.plugin.handlers?.(a.api));
    return out;
  }

  destroy(): void {
    this.detachView();
    for (const id of this.active.keys()) this.detach(id);
  }

  private attachUi(a: Active): void {
    if (!this.view || !a.plugin.ui) return;
    if (this.view.handle.hooks) untapAll(this.view.handle.hooks, a.owner);
    try {
      a.uiTeardown = a.plugin.ui({ ...a.api, view: this.view.handle, root: this.view.root }) ?? undefined;
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
