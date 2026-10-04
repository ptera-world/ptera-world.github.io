import { BindingsStore, keybinds, registerComponents, validateCommands, type KeybindCheatsheet, type KeybindSettings } from "keybinds";
import { generate } from "../core/generate";
import { Event as HookEvent, Waterfall } from "../core/hooks";
import { listMods, saveMods, type ModEntry, type ModLoadResult } from "../core/mods";
import { PluginHost, loadPluginConfig } from "../core/plugins";
import type { Registry } from "../core/registry";
import { randomSeed } from "../core/rng";
import { canonical, fromQuery, resolve, toQuery } from "../core/schema";
import { Session, type Origin, type Snapshot } from "../core/session";
import { namespace } from "../core/storage";
import type { AnyPuzzleDef, BindingSchema, CommandHandler, Plugin, View, ViewHandle } from "../core/types";
import { clear, formatTime, h } from "./dom";
import { schemaForm } from "./form";

export interface ToolbarItem {
  id: string;
  label: string;
  title?: string;
  disabled?: boolean;
  run(): void;
}

export interface PanelTab {
  id: string;
  label: string;
  render(): HTMLElement;
}

const saves = namespace("save");
const prefs = namespace("prefs");

const SHELL_BINDINGS: BindingSchema = {
  undo: { label: "Undo", category: "Game", keys: ["$mod+z", "u"] },
  redo: { label: "Redo", category: "Game", keys: ["$mod+shift+z", "$mod+y", "r"] },
  hint: { label: "Hint", category: "Game", keys: ["shift+/"] },
  "new-game": { label: "New game", category: "Game", keys: ["$mod+Enter"] },
  pause: { label: "Pause / resume", category: "Game", keys: ["p"] },
  "show-keys": { label: "Show shortcuts", category: "Help", keys: ["$mod+/"] },
};

/** Identity of a puzzle source, used to decide whether a save belongs to the requested puzzle. */
function originKey(def: AnyPuzzleDef, origin: Origin): string {
  if (origin.kind === "generated") {
    return `g|${origin.generatorVersion}|${canonical(def.params, resolve(def.params, origin.params))}|${origin.seed}`;
  }
  return `i|${origin.source ?? ""}`;
}

/**
 * The page: puzzle picker, game chrome, settings, import/export, mods.
 * Owns URL sync, autosave, keybindings and the lifecycle of session + plugins + view.
 */
export class Shell {
  readonly hooks = {
    toolbar: new Waterfall<ToolbarItem[], { shell: Shell }>("toolbar"),
    panels: new Waterfall<PanelTab[], { shell: Shell }>("panels"),
    sessionStart: new HookEvent<{ session: Session<any, any, any, any> }>("sessionStart"),
    sessionEnd: new HookEvent<{ session: Session<any, any, any, any> }>("sessionEnd"),
  };

  session: Session<any, any, any, any> | null = null;
  host: PluginHost | null = null;
  private view: { def: View; handle: ViewHandle } | null = null;
  private unbindKeys: (() => void) | null = null;
  private sessionCleanup: (() => void)[] = [];
  private generating: AbortController | null = null;
  private saveTimer = 0;
  private activeTab = prefs.get("tab", "game");

  private els!: {
    header: HTMLElement;
    title: HTMLElement;
    meta: HTMLElement;
    timer: HTMLElement;
    board: HTMLElement;
    status: HTMLElement;
    toolbar: HTMLElement;
    tabs: HTMLElement;
    panel: HTMLElement;
    cheatsheet: KeybindCheatsheet;
    keySettings: KeybindSettings;
  };

  constructor(readonly root: HTMLElement, readonly registry: Registry, readonly modResults: ModLoadResult[]) {
    registerComponents();
  }

  async start(): Promise<void> {
    window.addEventListener("popstate", () => void this.fromUrl());
    document.addEventListener("visibilitychange", () => {
      if (!this.session) return;
      if (document.hidden) {
        this.session.pause();
        this.saveNow();
      } else if (!prefs.get("paused", false)) this.session.resume();
    });
    window.addEventListener("pagehide", () => this.saveNow());
    setInterval(() => this.tick(), 250);
    await this.fromUrl();
  }

  // --- navigation ---

  private async fromUrl(): Promise<void> {
    const q = new URLSearchParams(location.search);
    const id = q.get("p");
    const def = id ? this.registry.getPuzzle(id) : undefined;
    if (!def) {
      this.showIndex();
      return;
    }
    const data = q.get("d");
    if (data !== null) {
      const fmt = def.formats.find((f) => f.id === q.get("f")) ?? def.formats[0];
      try {
        const puzzle = fmt!.parse(data);
        this.loadPuzzle(def, puzzle, { kind: "imported", format: fmt!.id, source: data }, false);
      } catch (e) {
        this.showError(`couldn't read the puzzle in this link: ${e instanceof Error ? e.message : e}`);
      }
      return;
    }
    const seed = q.get("seed");
    if (seed) {
      const params = fromQuery(def.params, q);
      const v = Number(q.get("v") ?? def.generatorVersion);
      const origin: Origin = { kind: "generated", seed, params, generatorVersion: def.generatorVersion };
      if (this.resume(def, originKey(def, origin))) return;
      await this.newGame(def, params, seed, false);
      if (v !== def.generatorVersion) {
        this.setStatus("this link was made by an older generator, so it's a different puzzle now");
      }
      return;
    }
    if (this.resume(def, null)) return;
    await this.newGame(def, prefs.get(`params:${def.id}`, {}), randomSeed(), false);
  }

  /** Resume the autosave for def if it matches `key` (or unconditionally if key is null). */
  private resume(def: AnyPuzzleDef, key: string | null): boolean {
    const snap = saves.get<Snapshot | null>(def.id, null);
    if (!snap || snap.puzzleId !== def.id) return false;
    if (key !== null && originKey(def, snap.origin) !== key) return false;
    try {
      this.setSession(Session.restore(def, snap), false);
      return true;
    } catch (e) {
      console.error("[games] save restore failed", e);
      return false;
    }
  }

  async newGame(def: AnyPuzzleDef, params: Record<string, unknown>, seed: string, push = true): Promise<void> {
    this.generating?.abort();
    const ac = new AbortController();
    this.generating = ac;
    const values = resolve(def.params, params);
    prefs.set(`params:${def.id}`, values);
    this.ensureLayout();
    clear(this.els.board);
    this.els.board.append(h("div", { class: "generating" },
      h("span", null, "generating…"),
      h("button", { onclick: () => ac.abort() }, "cancel")));
    try {
      const puzzle = await generate(def, values, seed, ac.signal);
      if (ac.signal.aborted) return;
      this.loadPuzzle(def, puzzle, { kind: "generated", seed, params: values, generatorVersion: def.generatorVersion }, push);
    } catch (e) {
      if (ac.signal.aborted) {
        if (this.session) this.mountView();
        return;
      }
      console.error(e);
      this.showError(`generation failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      if (this.generating === ac) this.generating = null;
    }
  }

  loadPuzzle(def: AnyPuzzleDef, puzzle: unknown, origin: Origin, push = true): void {
    this.setSession(new Session(def, puzzle, origin), push);
  }

  private urlFor(session: Session<any, any, any, any>): string {
    const def = session.def;
    const q = new URLSearchParams({ p: def.id });
    const o = session.origin;
    if (o.kind === "generated") {
      q.set("seed", o.seed);
      toQuery(def.params, resolve(def.params, o.params), q);
      q.set("v", String(o.generatorVersion));
    } else {
      const fmt = def.formats.find((f) => f.serialize);
      if (fmt) {
        q.set("f", fmt.id);
        q.set("d", fmt.serialize!(session.puzzle));
      }
    }
    return `${location.pathname}?${q}`;
  }

  // --- session lifecycle ---

  private setSession(session: Session<any, any, any, any>, push: boolean): void {
    this.teardownSession();
    this.session = session;
    this.host = new PluginHost(this.registry, session);
    const url = this.urlFor(session);
    if (push) history.pushState(null, "", url);
    else history.replaceState(null, "", url);

    this.ensureLayout();
    this.sessionCleanup.push(
      session.hooks.change.tap(() => {
        this.scheduleSave();
        this.renderToolbar();
        this.syncSolvedStatus();
      }, { owner: "shell" }),
      session.hooks.solved.tap(({ elapsedMs }) => {
        this.setStatus(`solved in ${formatTime(elapsedMs)}`);
        this.root.dataset.solved = "";
        this.saveNow();
      }, { owner: "shell" }),
    );
    if (session.solved) this.root.dataset.solved = "";
    else delete this.root.dataset.solved;
    if (!prefs.get("paused", false) && !document.hidden) session.resume();
    this.mountView();
    this.renderHeader();
    this.renderToolbar();
    this.renderPanel();
    this.setStatus(session.solved ? `solved in ${formatTime(session.solvedAtMs!)}` : "");
    this.hooks.sessionStart.call({ session });
    session.checkSolved();
    this.saveNow();
  }

  /** Status line reflects the current board: a hint or solved message never outlives the state it was about. */
  private syncSolvedStatus(): void {
    const s = this.session;
    if (!s) return;
    if (s.solved) {
      this.root.dataset.solved = "";
      this.setStatus(`solved in ${formatTime(s.solvedAtMs!)}`);
    } else {
      delete this.root.dataset.solved;
      this.setStatus("");
    }
  }

  private teardownSession(): void {
    const s = this.session;
    if (!s) return;
    this.saveNow();
    this.hooks.sessionEnd.call({ session: s });
    this.unmountView();
    this.host?.destroy();
    for (const f of this.sessionCleanup) f();
    this.sessionCleanup = [];
    s.pause();
    this.session = null;
    this.host = null;
  }

  private chosenView(def: AnyPuzzleDef): View | undefined {
    const views = this.registry.viewsFor(def.id);
    const want = prefs.get<string | null>(`view:${def.id}`, null);
    return views.find((v) => v.id === want) ?? views[views.length - 1];
  }

  private viewSettings(v: View): Record<string, unknown> {
    return v.settings ? resolve(v.settings, prefs.get(`viewcfg:${v.id}`, {})) : {};
  }

  /** (Re)mount the chosen view for the current session. */
  mountView(): void {
    const session = this.session;
    if (!session) return;
    this.unmountView();
    clear(this.els.board);
    const v = this.chosenView(session.def);
    if (!v) {
      this.els.board.append(h("p", { class: "error" }, `no view registered for ${session.def.id}`));
      return;
    }
    const mount = h("div", { class: "view", "data-view": v.id });
    this.els.board.append(mount);
    try {
      const handle = v.mount(mount, {
        session,
        settings: this.viewSettings(v),
        storage: namespace(`view:${v.id}`),
      });
      this.view = { def: v, handle };
      this.host!.attachView(handle, mount);
    } catch (e) {
      console.error(e);
      this.els.board.append(h("p", { class: "error" }, `view failed: ${e instanceof Error ? e.message : e}`));
    }
    this.bindKeys();
  }

  private unmountView(): void {
    this.unbindKeys?.();
    this.unbindKeys = null;
    this.host?.detachView();
    if (this.view) {
      try {
        this.view.handle.destroy();
      } catch (e) {
        console.error(e);
      }
    }
    this.view = null;
  }

  // --- keybindings ---

  private bindingStore(): BindingsStore<BindingSchema> | null {
    const s = this.session;
    if (!s) return null;
    const schema: BindingSchema = { ...SHELL_BINDINGS };
    for (const p of this.host!.plugins()) if (loadPluginConfig(p).enabled) Object.assign(schema, p.bindings);
    Object.assign(schema, this.view?.def.bindings);
    return new BindingsStore(schema, `games:keys:${s.def.id}`);
  }

  private bindKeys(): void {
    this.unbindKeys?.();
    const store = this.bindingStore();
    if (!store) return;
    const bindings = store.get();
    // earlier sources win when two commands share a key: view, then plugins, then shell
    const sources: Record<string, CommandHandler>[] = [
      this.view?.handle.handlers ?? {},
      this.host!.handlers(),
      this.shellHandlers(),
    ];
    const seen = new Set<string>();
    const commands = sources.flatMap((src) => Object.entries(src))
      .filter(([id]) => bindings[id] && !seen.has(id) && seen.add(id))
      .map(([id, execute]) => ({ id, ...bindings[id]!, execute }))
      .filter((cmd) => {
        try {
          validateCommands([cmd]);
          return true;
        } catch (e) {
          console.error(`[games] dropping keybinding "${cmd.id}"`, e);
          return false;
        }
      });
    this.unbindKeys = keybinds(commands);
    this.els.cheatsheet.commands = commands;
    this.els.keySettings.store = store;
    const onChange = () => this.bindKeys();
    store.addEventListener("change", onChange);
  }

  private shellHandlers(): Record<string, CommandHandler> {
    return {
      undo: () => this.session?.undo(),
      redo: () => this.session?.redo(),
      hint: () => this.showHint(),
      "new-game": () => this.newGameSame(),
      pause: () => this.togglePause(),
      "show-keys": () => {
        this.els.cheatsheet.open = !this.els.cheatsheet.open;
      },
    };
  }

  private newGameSame(): void {
    const s = this.session;
    if (!s) return;
    void this.newGame(s.def, prefs.get(`params:${s.def.id}`, {}), randomSeed());
  }

  private togglePause(): void {
    const s = this.session;
    if (!s || s.solved) return;
    const paused = !prefs.get("paused", false);
    prefs.set("paused", paused);
    if (paused) s.pause();
    else s.resume();
    this.root.toggleAttribute("data-paused", paused);
    this.renderToolbar();
  }

  private showHint(): void {
    const s = this.session;
    if (!s) return;
    const hint = s.showHint();
    if (!hint) {
      this.setStatus("no hint available");
      return;
    }
    this.setStatus(hint.message);
  }

  // --- persistence ---

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 400);
  }

  private saveNow(): void {
    clearTimeout(this.saveTimer);
    if (this.session) saves.set(this.session.def.id, this.session.snapshot());
  }

  // --- rendering ---

  private ensureLayout(): void {
    if (this.els) return;
    clear(this.root);
    const cheatsheet = document.createElement("keybind-cheatsheet") as KeybindCheatsheet;
    const keySettings = document.createElement("keybind-settings") as KeybindSettings;
    this.els = {
      header: h("header", { class: "bar" }),
      title: h("span", { class: "title" }),
      meta: h("span", { class: "meta" }),
      timer: h("span", { class: "timer", "aria-label": "elapsed time" }),
      board: h("main", { class: "board" }),
      status: h("div", { class: "status", "aria-live": "polite" }),
      toolbar: h("nav", { class: "toolbar" }),
      tabs: h("div", { class: "tabs", role: "tablist" }),
      panel: h("div", { class: "panel-body" }),
      cheatsheet,
      keySettings,
    };
    const e = this.els;
    e.header.append(
      h("a", { href: "/", class: "home", title: "ptera.world" }, "ptera"),
      h("a", { href: location.pathname, class: "crumb", onclick: (ev: MouseEvent) => { ev.preventDefault(); this.goIndex(); } }, "games"),
      e.title, e.meta, h("span", { class: "spacer" }), e.timer);
    this.root.append(
      e.header,
      h("div", { class: "layout" },
        h("div", { class: "play" }, e.board, e.status, e.toolbar),
        h("aside", { class: "panel" }, e.tabs, e.panel)),
      cheatsheet, keySettings);
  }

  private goIndex(): void {
    history.pushState(null, "", location.pathname);
    this.showIndex();
  }

  private showIndex(): void {
    this.teardownSession();
    this.ensureLayout();
    this.root.dataset.mode = "index";
    this.els.title.textContent = "";
    this.els.meta.textContent = "";
    this.els.timer.textContent = "";
    clear(this.els.toolbar);
    this.setStatus("");
    clear(this.els.board);
    this.els.board.append(h("ul", { class: "index" }, this.registry.listPuzzles().map((def) =>
      h("li", null, h("a", {
        href: `?p=${encodeURIComponent(def.id)}`,
        onclick: (ev: MouseEvent) => {
          ev.preventDefault();
          history.pushState(null, "", `?p=${encodeURIComponent(def.id)}`);
          void this.fromUrl();
        },
      }, h("strong", null, def.name), def.description ? h("span", null, def.description) : null)))));
    this.renderPanel();
  }

  private renderHeader(): void {
    const s = this.session;
    if (!s) return;
    delete this.root.dataset.mode;
    this.els.title.textContent = s.def.name;
    const bits: string[] = [];
    const desc = s.def.describe?.(s.puzzle);
    if (desc) bits.push(desc);
    try {
      const r = s.def.rate?.(s.puzzle);
      if (r) bits.push(r.label);
    } catch (e) {
      console.error(e);
    }
    this.els.meta.textContent = bits.join(" · ");
    document.title = `${s.def.name} · games · ptera.world`;
  }

  private tick(): void {
    const s = this.session;
    if (!s || !this.els) return;
    const hide = prefs.get("hideTimer", false);
    this.els.timer.textContent = hide ? "" : formatTime(s.elapsedMs()) + (s.running || s.solved ? "" : " ⏸");
  }

  renderToolbar(): void {
    const s = this.session;
    if (!s) return;
    const paused = prefs.get("paused", false);
    const items: ToolbarItem[] = [
      { id: "undo", label: "undo", disabled: !s.canUndo, run: () => s.undo() },
      { id: "redo", label: "redo", disabled: !s.canRedo, run: () => s.redo() },
      { id: "restart", label: "restart", disabled: !s.canUndo, run: () => s.restart() },
      { id: "hint", label: "hint", disabled: s.solved, run: () => this.showHint() },
      {
        id: "reveal", label: "reveal", disabled: s.solved || !s.def.solve, run: () => {
          if (!confirm("reveal the solution?")) return;
          const sol = s.def.solve?.(s.puzzle);
          if (sol) s.replaceState(sol);
          else this.setStatus("no solution available");
        },
      },
      { id: "pause", label: paused ? "resume" : "pause", disabled: s.solved, run: () => this.togglePause() },
      { id: "new", label: "new", run: () => this.newGameSame() },
    ];
    const final = this.hooks.toolbar.call(items, { shell: this });
    clear(this.els.toolbar);
    for (const it of final) {
      this.els.toolbar.append(h("button", {
        "data-id": it.id, title: it.title, disabled: it.disabled,
        onclick: () => it.run(),
      }, it.label));
    }
  }

  setStatus(text: string): void {
    if (this.els) this.els.status.textContent = text;
  }

  private showError(text: string): void {
    this.ensureLayout();
    clear(this.els.board);
    this.els.board.append(h("p", { class: "error" }, text));
  }

  renderPanel(): void {
    const tabs = this.hooks.panels.call(this.builtinTabs(), { shell: this });
    if (!tabs.some((t) => t.id === this.activeTab)) this.activeTab = tabs[0]?.id ?? "";
    clear(this.els.tabs);
    for (const t of tabs) {
      this.els.tabs.append(h("button", {
        role: "tab", "aria-selected": String(t.id === this.activeTab),
        onclick: () => {
          this.activeTab = t.id;
          prefs.set("tab", t.id);
          this.renderPanel();
        },
      }, t.label));
    }
    clear(this.els.panel);
    const active = tabs.find((t) => t.id === this.activeTab);
    if (active) this.els.panel.append(active.render());
  }

  private builtinTabs(): PanelTab[] {
    const tabs: PanelTab[] = [];
    if (this.session) {
      tabs.push(
        { id: "game", label: "new", render: () => this.gameTab() },
        { id: "assists", label: "settings", render: () => this.settingsTab() },
        { id: "share", label: "share", render: () => this.shareTab() },
      );
    }
    tabs.push({ id: "mods", label: "mods", render: () => this.modsTab() });
    return tabs;
  }

  private gameTab(): HTMLElement {
    const s = this.session!;
    const def = s.def;
    let params: Record<string, unknown> = prefs.get(`params:${def.id}`, {});
    params = resolve(def.params, params);
    const seedInput = h("input", { type: "text", placeholder: "random", spellcheck: "false", "aria-label": "seed" });
    const start = () => void this.newGame(def, params, seedInput.value.trim() || randomSeed());
    const presets = def.presets?.length
      ? h("div", { class: "presets" }, def.presets.map((p) =>
        h("button", {
          onclick: () => void this.newGame(def, { ...params, ...p.params }, randomSeed()),
        }, p.label)))
      : null;
    const seedNow = s.origin.kind === "generated" ? s.origin.seed : null;
    return h("div", { class: "tab-game" },
      presets,
      schemaForm(def.params, params, (v) => {
        params = v;
        prefs.set(`params:${def.id}`, v);
      }),
      h("div", { class: "row" }, h("label", null, "seed"), seedInput),
      h("button", { class: "primary", onclick: start }, "generate"),
      seedNow ? h("p", { class: "dim" }, "current seed: ", h("code", null, seedNow)) : null);
  }

  private settingsTab(): HTMLElement {
    const s = this.session!;
    const host = this.host!;
    const wrap = h("div", { class: "tab-settings" });
    const byCat = new Map<string, Plugin[]>();
    for (const p of host.plugins()) {
      const c = p.category ?? "other";
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c)!.push(p);
    }
    for (const [cat, plugins] of byCat) {
      wrap.append(h("h3", null, cat));
      for (const p of plugins) {
        const cfg = loadPluginConfig(p);
        const body = p.settings ? schemaForm(p.settings, cfg.settings, (v) => {
          host.setConfig(p, { ...loadPluginConfig(p), settings: v });
          this.bindKeys();
        }) : null;
        if (body) body.hidden = !cfg.enabled;
        wrap.append(h("div", { class: "plugin" },
          h("label", { class: "plugin-toggle", title: p.description },
            h("input", {
              type: "checkbox", checked: cfg.enabled,
              onchange: (e: Event) => {
                const enabled = (e.target as HTMLInputElement).checked;
                host.setConfig(p, { ...loadPluginConfig(p), enabled });
                if (body) body.hidden = !enabled;
                this.bindKeys();
              },
            }),
            h("span", null, p.name)),
          p.description ? h("small", null, p.description) : null,
          body));
      }
    }

    const views = this.registry.viewsFor(s.def.id);
    const v = this.view?.def;
    wrap.append(h("h3", null, "display"));
    if (views.length > 1) {
      wrap.append(h("div", { class: "row" }, h("label", null, "view"),
        h("select", {
          onchange: (e: Event) => {
            prefs.set(`view:${s.def.id}`, (e.target as HTMLSelectElement).value);
            this.mountView();
            this.renderPanel();
          },
        }, views.map((x) => h("option", { value: x.id, selected: x.id === v?.id }, x.name)))));
    }
    if (v?.settings) {
      wrap.append(schemaForm(v.settings, this.viewSettings(v), (vals) => {
        prefs.set(`viewcfg:${v.id}`, vals);
        this.mountView();
      }));
    }
    wrap.append(
      h("label", { class: "plugin-toggle" },
        h("input", {
          type: "checkbox", checked: prefs.get("hideTimer", false),
          onchange: (e: Event) => prefs.set("hideTimer", (e.target as HTMLInputElement).checked),
        }),
        h("span", null, "hide timer")),
      h("h3", null, "keys"),
      h("div", { class: "row" },
        h("button", { onclick: () => { this.els.cheatsheet.open = true; } }, "shortcuts"),
        h("button", { onclick: () => { this.els.keySettings.open = true; } }, "rebind")));
    return wrap;
  }

  private shareTab(): HTMLElement {
    const s = this.session!;
    const def = s.def;
    const out = h("textarea", { rows: 4, readonly: true, spellcheck: "false", "aria-label": "export" });
    const exportable = def.formats.filter((f) => f.serialize);
    const fmtSelect = h("select", { "aria-label": "export format" }, exportable.map((f) => h("option", { value: f.id }, f.label)));
    const refresh = () => {
      const f = exportable.find((x) => x.id === fmtSelect.value);
      out.value = f ? f.serialize!(s.puzzle) : "";
    };
    fmtSelect.addEventListener("change", refresh);
    refresh();

    const input = h("textarea", { rows: 4, spellcheck: "false", placeholder: "paste a puzzle", "aria-label": "import" });
    const importFmt = h("select", { "aria-label": "import format" },
      h("option", { value: "" }, "auto-detect"),
      def.formats.map((f) => h("option", { value: f.id }, f.label)));
    const err = h("p", { class: "error" });
    const doImport = () => {
      const text = input.value.trim();
      if (!text) return;
      const candidates = importFmt.value
        ? def.formats.filter((f) => f.id === importFmt.value)
        : [...def.formats.filter((f) => f.detect?.(text)), ...def.formats.filter((f) => !f.detect)];
      const errors: string[] = [];
      for (const f of candidates) {
        try {
          const puzzle = f.parse(text);
          const source = f.serialize ? f.serialize(puzzle) : text;
          this.loadPuzzle(def, puzzle, { kind: "imported", format: f.id, source });
          return;
        } catch (e) {
          errors.push(`${f.label}: ${e instanceof Error ? e.message : e}`);
        }
      }
      err.textContent = errors.length ? errors.join("\n") : "no format recognised this";
    };

    const link = new URL(this.urlFor(s), location.href).href;
    return h("div", { class: "tab-share" },
      h("h3", null, "link"),
      h("div", { class: "row" },
        h("input", { type: "text", readonly: true, value: link, "aria-label": "share link" }),
        h("button", { onclick: () => void navigator.clipboard?.writeText(link) }, "copy")),
      exportable.length ? [
        h("h3", null, "export"),
        fmtSelect, out,
        h("button", { onclick: () => void navigator.clipboard?.writeText(out.value) }, "copy"),
      ] : null,
      h("h3", null, "import"),
      importFmt, input,
      h("button", { class: "primary", onclick: doImport }, "load"),
      err);
  }

  private modsTab(): HTMLElement {
    const wrap = h("div", { class: "tab-mods" });
    const render = () => {
      clear(wrap);
      const mods = listMods();
      for (const r of this.modResults) {
        if (r.error) wrap.append(h("p", { class: "error" }, `${r.mod.name}: ${r.error}`));
      }
      for (const m of mods) {
        wrap.append(h("div", { class: "plugin" },
          h("label", { class: "plugin-toggle" },
            h("input", {
              type: "checkbox", checked: m.enabled,
              onchange: (e: Event) => {
                m.enabled = (e.target as HTMLInputElement).checked;
                saveMods(mods);
              },
            }),
            h("span", null, m.name)),
          h("button", {
            onclick: () => {
              saveMods(mods.filter((x) => x.id !== m.id));
              render();
            },
          }, "remove")));
      }
      const name = h("input", { type: "text", placeholder: "name", "aria-label": "mod name" });
      const src = h("textarea", {
        rows: 6, spellcheck: "false", "aria-label": "mod url or code",
        placeholder: "module URL, or code:\nexport default (games) => { … }",
      });
      wrap.append(
        h("h3", null, "add mod"),
        name, src,
        h("button", {
          class: "primary",
          onclick: () => {
            const text = src.value.trim();
            if (!text) return;
            const isUrl = /^(https?:|\/|\.\/)\S*$/.test(text);
            if (!confirm("mods run with full access to this page. only add code you trust. add it?")) return;
            const entry: ModEntry = {
              id: crypto.randomUUID(),
              name: name.value.trim() || (isUrl ? text : "inline mod"),
              enabled: true,
              source: isUrl ? { url: text } : { code: text },
            };
            saveMods([...mods, entry]);
            render();
          },
        }, "add"),
        h("button", { onclick: () => location.reload() }, "reload to apply"));
    };
    render();
    return wrap;
  }
}
