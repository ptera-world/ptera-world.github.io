import { Event as HookEvent, untapAll } from "../../core/hooks";
import type { LoadedPack, ModLoadResult } from "../../core/mods";
import type { PluginHost } from "../../core/plugins";
import type { Registry } from "../../core/registry";
import { randomSeed } from "../../core/rng";
import { canonical, fromQuery, resolve, toQuery } from "../../core/schema";
import type { Origin, Session, SharedHistory, Snapshot } from "../../core/session";
import { PluginHostCtor, SessionCtor, TechniqueHostCtor, cycleLabels, findPracticePosition, generate, hintFrom, isPartOfStep, isStepDone, loadPluginConfig, onBoardPrefsChange, onThemeChange } from "./engine";
import { packJson, unpackJson, type Patch } from "../../core/patch";

/** What a share link carries beyond the puzzle itself. */
export type ShareLevel = "puzzle" | "state" | "history";

interface Shared {
  state?: Patch | null;
  history?: SharedHistory;
}
import { namespace } from "../../core/storage";
import type { TechniqueHost } from "../../core/techniques";
import type { AnyPuzzleDef, CommandDef, Format, Hint, Technique, View, ViewHandle, WidgetDef, SlotId } from "../../core/types";
import { CommandHub } from "./commands";
import { add, clear, formatTime, h, style } from "../../core/dom";
import { arrange, loadLayout, saveLayout, type LayoutConfig } from "./layout";
import { builtinWidgets } from "./widgets";
import { installTooltips } from "./tooltips";
import { SAVE_PREFIX, INDEX_KEY, findSession, listSessions, loadSession, newSessionId, removeSession, saveSession } from "./sessions";

const prefs = namespace("prefs");

export { HOLD_MS } from "../../core/gestures";
import { HOLD_MS } from "../../core/gestures";

/** Serialized text, or null if the format can't write or throws on this puzzle. */
export function trySerialize(fmt: Format<unknown>, puzzle: unknown): string | null {
  if (!fmt.serialize) return null;
  try {
    return fmt.serialize(puzzle);
  } catch (e) {
    console.error(`[games] ${fmt.id}.serialize failed`, e);
    return null;
  }
}

/** Identity of a puzzle source, used to decide whether a save belongs to the requested puzzle. */
function originKey(def: AnyPuzzleDef, origin: Origin): string {
  if (origin.kind === "generated") {
    return `g|${origin.generatorVersion}|${canonical(def.params, resolve(def.params, origin.params))}|${origin.seed}`;
  }
  if (origin.kind === "practice") return `p|${origin.technique}|${origin.seed}`;
  return `i|${origin.source ?? ""}`;
}


interface MountedWidget {
  def: WidgetDef;
  owner: string;
  el: HTMLElement;
  teardown?: () => void;
}

/**
 * The page. Owns URL sync, autosave, the session lifecycle (plugins, techniques, view), the
 * command hub, and the widget layout. Holds no puzzle-specific UI: everything around the board
 * is a widget, everything the player can do is a command.
 */
export class Shell {
  readonly hooks = {
    sessionStart: new HookEvent<{ session: Session<any, any, any, any> }>("sessionStart"),
    sessionEnd: new HookEvent<{ session: Session<any, any, any, any> }>("sessionEnd"),
    status: new HookEvent<{ text: string }>("status"),
    /** The saved-games list changed (here or in another tab). */
    sessions: new HookEvent<void>("sessions"),
  };

  session: Session<any, any, any, any> | null = null;
  /** Saved-game id of the current session. */
  sessionId = "";
  /** Player unlocked the current solved board for free play (not saved; a reopened solved board is locked again). */
  unlocked = false;
  private wasLost = false;
  /** Adopting another tab's save: don't write it back. */
  private reloading = false;
  host: PluginHost | null = null;
  techniques: TechniqueHost | null = null;
  readonly hub: CommandHub;
  view: { def: View; handle: ViewHandle } | null = null;
  private sessionCleanup: (() => void)[] = [];
  private generating: AbortController | null = null;
  private saveTimer = 0;
  private widgets: MountedWidget[] = [];
  private layout: LayoutConfig = {};
  private activeTab = prefs.get("tab", "game");
  private statusText = "";
  /** Skip the next status reset (a message about the change that is being undone automatically). */
  private keepStatus = false;
  /** Practice: the state the step was found in. */
  private practiceStart: unknown = null;
  private els: ReturnType<Shell["buildDom"]>;

  constructor(readonly root: HTMLElement, readonly registry: Registry, readonly modResults: ModLoadResult[], readonly packs: LoadedPack[] = [], readonly safe = false) {
    this.els = this.buildDom();
    this.hub = new CommandHub(root);
    this.hub.addContext(() => this.context());
    for (const w of builtinWidgets(this)) registry.widget(w);
  }

  async start(): Promise<void> {
    window.addEventListener("popstate", () => void this.fromUrl());
    document.addEventListener("visibilitychange", () => {
      if (!this.session) return;
      if (document.hidden) {
        this.session.pause();
        this.saveNow();
      } else if (!this.session.paused) this.session.resume();
    });
    window.addEventListener("pagehide", () => this.saveNow());
    // another tab saved: pick up its version of this game (last write wins), refresh the list
    window.addEventListener("storage", (e) => {
      if (e.key === INDEX_KEY) this.hooks.sessions.call();
      const s = this.session;
      if (s && e.key === SAVE_PREFIX + this.sessionId && e.newValue) {
        const snap = JSON.parse(e.newValue) as Snapshot;
        // only board/history changes count; time-only saves would otherwise bounce between tabs
        if (snap.past.length === s.depth && JSON.stringify(snap.state) === JSON.stringify(s.state)) return;
        this.reloading = true;
        try {
          this.setSession(SessionCtor.restore(s.def, snap), false, this.sessionId);
        } finally {
          this.reloading = false;
        }
        this.setStatus("updated from another tab");
      }
    });
    if (new URLSearchParams(location.search).has("debugLayout")) watchLayoutShifts();
    let raf = 0;
    window.addEventListener("resize", () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => this.relayout());
    });
    this.els.boardbox.addEventListener("contextmenu", (e) => {
      if (e.defaultPrevented || this.view?.handle.gestures?.secondaryClick || !this.hub.all().some((c) => [c.menu].flat().includes("board"))) return;
      e.preventDefault();
      this.hub.openMenu("board", e.clientX, e.clientY);
    });
    setInterval(() => this.tick(), 250);
    // keyboard-only affordances (cursors) show while the keyboard is in use; views style off [data-input]
    this.root.dataset.input = "pointer";
    document.addEventListener("keydown", (e) => {
      if (!["Shift", "Control", "Alt", "Meta"].includes(e.key)) this.root.dataset.input = "keyboard";
    }, { capture: true });
    document.addEventListener("pointerdown", () => { this.root.dataset.input = "pointer"; }, { capture: true });
    onThemeChange(() => { if (this.session) this.mountView(); });
    onBoardPrefsChange(() => { if (this.session) this.mountView(); });
    installTooltips(this.hub);
    this.installLongPress();
    this.hub.setSource("shell", () => this.shellCommands());
    await this.fromUrl();
  }

  /** Touch: holding on the board opens the same menu a right-click does. */
  private installLongPress(): void {
    let timer = 0;
    let start: { x: number; y: number } | null = null;
    const cancel = () => { clearTimeout(timer); start = null; };
    this.els.boardbox.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch" || this.view?.handle.gestures?.hold) return;
      start = { x: e.clientX, y: e.clientY };
      timer = window.setTimeout(() => {
        if (!start || !this.hub.all().some((c) => [c.menu].flat().includes("board"))) return;
        this.hub.openMenu("board", start.x, start.y);
        start = null;
        // the finger lifting after a hold must not count as a tap (on the board or the menu backdrop)
        const swallow = (ev: Event) => { ev.preventDefault(); ev.stopPropagation(); };
        window.addEventListener("click", swallow, { capture: true, once: true });
        window.addEventListener("pointerup", swallow, { capture: true, once: true });
        setTimeout(() => {
          window.removeEventListener("click", swallow, { capture: true });
          window.removeEventListener("pointerup", swallow, { capture: true });
        }, 800);
      }, HOLD_MS);
    });
    this.els.boardbox.addEventListener("pointermove", (e) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
    });
    for (const ev of ["pointerup", "pointercancel"]) this.els.boardbox.addEventListener(ev, cancel);
  }

  // --- context ---

  private context(): Record<string, unknown> {
    const s = this.session;
    return {
      hasSession: !!s,
      solved: s?.solved ?? false,
      locked: s?.locked ?? false,
      lost: s?.lost ?? false,
      canUndo: s?.canUndo ?? false,
      canRedo: s?.canRedo ?? false,
      hint: !!s?.activeHint,
      practice: s?.origin.kind === "practice",
      ...this.view?.handle.context?.(),
    };
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
    if (q.get("tab")) this.activeTab = q.get("tab")!;
    const practice = q.get("practice");
    if (practice) {
      const t = this.registry.techniquesFor(def.id).find((x) => x.id === practice);
      if (t) {
        await this.startPractice(def, t, q.get("seed") ?? randomSeed(), false);
        return;
      }
    }
    let shared: Shared | null = null;
    try {
      if (q.get("h")) shared = { history: (await unpackJson(q.get("h")!)) as SharedHistory };
      else if (q.get("st")) shared = { state: (await unpackJson(q.get("st")!)) as Patch };
    } catch (e) {
      this.setStatus(`couldn't read the saved position in this link: ${e instanceof Error ? e.message : e}`);
    }
    const data = q.get("d");
    if (data !== null) {
      const fmt = def.formats.find((f) => f.id === q.get("f")) ?? def.formats[0];
      try {
        const puzzle = fmt!.parse(data);
        this.loadPuzzle(def, puzzle, { kind: "imported", format: fmt!.id, source: data }, false, shared);
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
      if (!shared && this.resume(def, originKey(def, origin), false)) return;
      await this.newGame(def, params, seed, false, shared);
      if (v !== def.generatorVersion) this.setStatus("this link was made by an older generator, so it's a different puzzle now");
      return;
    }
    if (this.resume(def, null, false)) return;
    await this.newGame(def, prefs.get(`params:${def.id}`, {}), randomSeed(), false);
  }

  /** Reopen the saved game for (puzzle, source key), or the latest unfinished one when key is null. */
  private resume(def: AnyPuzzleDef, key: string | null, practice: boolean): boolean {
    const m = findSession(def.id, key, practice);
    return m ? this.openSession(m.id, false) : false;
  }

  /** Switch to a saved game by id. */
  openSession(id: string, push = true): boolean {
    const snap = loadSession(id);
    const def = snap ? this.registry.getPuzzle(snap.puzzleId) : undefined;
    if (!snap || !def) return false;
    try {
      this.setSession(SessionCtor.restore(def, snap), push, id);
      return true;
    } catch (e) {
      console.error("[games] save restore failed", e);
      return false;
    }
  }

  private showBusy(text: string, ac: AbortController): void {
    this.unmountView();
    clear(this.els.boardbox);
    this.els.boardbox.append(h("div", { class: "generating" }, h("span", null, text), h("button", { onclick: () => ac.abort() }, "cancel")));
  }

  async newGame(def: AnyPuzzleDef, params: Record<string, unknown>, seed: string, push = true, shared: Shared | null = null): Promise<void> {
    this.generating?.abort();
    const ac = new AbortController();
    this.generating = ac;
    const values = resolve(def.params, params);
    prefs.set(`params:${def.id}`, values);
    this.showBusy("generating…", ac);
    try {
      const puzzle = await generate(def, values, seed, ac.signal);
      if (ac.signal.aborted) return;
      this.loadPuzzle(def, puzzle, { kind: "generated", seed, params: values, generatorVersion: def.generatorVersion }, push, shared);
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

  /** A board where `t` is the next easiest deduction (deterministic in seed). */
  async startPractice(def: AnyPuzzleDef, t: Technique, seed: string, push = true): Promise<void> {
    const origin = { kind: "practice" as const, technique: t.id, seed };
    if (this.resume(def, originKey(def, { ...origin, step: { message: "", actions: [] } }), true)) return;
    this.generating?.abort();
    const ac = new AbortController();
    this.generating = ac;
    this.showBusy(`finding a ${t.name}…`, ac);
    try {
      const pos = await findPracticePosition(def, this.registry.techniquesFor(def.id), t, seed, ac.signal);
      if (ac.signal.aborted) return;
      if (!pos) {
        this.showError(`couldn't find a ${t.name} to practise in time. try again for a different board.`);
        return;
      }
      this.setSession(new SessionCtor(def, pos.puzzle, { ...origin, step: pos.step }, { state: pos.state }), push);
      this.setStatus(`find the ${t.name}`);
    } catch (e) {
      if (ac.signal.aborted) return;
      console.error(e);
      this.showError(`practice failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      if (this.generating === ac) this.generating = null;
    }
  }

  loadPuzzle(def: AnyPuzzleDef, puzzle: unknown, origin: Origin, push = true, shared: Shared | null = null): void {
    this.setSession(shared ? SessionCtor.fromShared(def, puzzle, origin, shared) : new SessionCtor(def, puzzle, origin), push);
  }

  /** Link to the current puzzle, optionally carrying the current position or the whole move history. */
  async shareUrl(level: ShareLevel): Promise<string> {
    const s = this.session;
    if (!s) return location.href;
    const url = new URL(this.urlFor(s), location.href);
    if (level === "state") {
      const p = s.exportState();
      if (p) url.searchParams.set("st", await packJson(p));
    } else if (level === "history" && s.depth > 0) {
      url.searchParams.set("h", await packJson(s.exportHistory()));
    }
    return url.href;
  }

  urlFor(session: Session<any, any, any, any>): string {
    const def = session.def;
    const q = new URLSearchParams({ p: def.id });
    const o = session.origin;
    if (o.kind === "generated") {
      q.set("seed", o.seed);
      toQuery(def.params, resolve(def.params, o.params), q);
      q.set("v", String(o.generatorVersion));
    } else if (o.kind === "practice") {
      q.set("practice", o.technique);
      q.set("seed", o.seed);
    } else {
      for (const fmt of def.formats) {
        const data = trySerialize(fmt, session.puzzle);
        if (data === null) continue;
        q.set("f", fmt.id);
        q.set("d", data);
        break;
      }
    }
    return `${location.pathname}?${q}`;
  }

  // --- session lifecycle ---

  private setSession(session: Session<any, any, any, any>, push: boolean, id: string = newSessionId()): void {
    this.teardownSession();
    this.session = session;
    this.sessionId = id;
    this.techniques = new TechniqueHostCtor(this.registry, session);
    this.practiceStart = session.origin.kind === "practice" ? session.state : null;
    this.host = new PluginHostCtor(this.registry, session);
    this.hub.setScope(session.def.id);
    const url = this.urlFor(session);
    if (push) history.pushState(null, "", url);
    else history.replaceState(null, "", url);

    delete this.root.dataset.mode;
    this.sessionCleanup.push(
      session.hooks.change.tap((ctx) => {
        const lost = session.lost;
        if (lost && !this.wasLost && ctx.cause === "action") {
          session.hooks.fx.call({ kind: "mistake", focus: session.lostFocus });
          session.hooks.fx.call({ kind: "lost" });
        }
        this.wasLost = lost;
        this.root.toggleAttribute("data-lost", lost);
        if (lost) session.pause();
        else if (!session.paused && !document.hidden && !session.solved) session.resume();
        this.scheduleSave();
        this.syncSolvedStatus();
        this.hub.syncContext();
        this.checkPractice(ctx);
      }, { owner: "shell" }),
      session.hooks.solved.tap(() => {
        this.syncSolvedStatus();
        this.saveNow();
      }, { owner: "shell" }),
      session.hooks.refresh.tap(() => this.hub.syncContext(), { owner: "shell" }),
      // a solved board is a finished thing: player moves are refused until it is unlocked
      session.hooks.solved.tap(() => this.syncLock(), { owner: "shell" }),
      session.hooks.action.tap((a, { source }) => {
        if (!a || !session.locked || source.kind !== "player") return a;
        this.setStatus(session.lost ? "game over. undo to step back, or start a new game" : "this board is solved. unlock it to keep playing with it");
        session.hooks.fx.call({ kind: "locked" });
        return null;
      }, { owner: "shell", priority: -100 }),
    );
    this.unlocked = false;
    this.wasLost = session.lost;
    this.root.toggleAttribute("data-lost", this.wasLost);
    this.syncLock();
    if (!session.paused && !document.hidden) session.resume();
    this.root.toggleAttribute("data-paused", session.paused);
    this.renderHeader();
    this.mountView();
    this.syncSolvedStatus();
    this.hooks.sessionStart.call({ session });
    session.checkSolved();
    this.saveNow();
  }

  private teardownSession(): void {
    const s = this.session;
    if (!s) return;
    this.saveNow();
    this.hooks.sessionEnd.call({ session: s });
    this.unmountWidgets();
    this.unmountView();
    this.host?.destroy();
    this.techniques?.destroy();
    for (const f of this.sessionCleanup) f();
    this.sessionCleanup = [];
    s.pause();
    this.session = null;
    this.host = null;
    this.techniques = null;
  }

  private chosenView(def: AnyPuzzleDef): View | undefined {
    const views = this.registry.viewsFor(def.id);
    const want = prefs.get<string | null>(`view:${def.id}`, null);
    return views.find((v) => v.id === want) ?? views[views.length - 1];
  }

  viewSettings(v: View): Record<string, unknown> {
    return v.settings ? resolve(v.settings, prefs.get(`viewcfg:${v.id}`, {})) : {};
  }

  setViewSettings(v: View, values: Record<string, unknown>): void {
    prefs.set(`viewcfg:${v.id}`, values);
    this.mountView();
  }

  setViewChoice(id: string): void {
    if (!this.session) return;
    prefs.set(`view:${this.session.def.id}`, id);
    this.mountView();
  }

  /** (Re)mount the chosen view and every widget, then lay out. */
  mountView(): void {
    const session = this.session;
    if (!session) return;
    this.unmountWidgets();
    this.unmountView();
    clear(this.els.boardbox);
    const v = this.chosenView(session.def);
    if (!v) {
      this.els.boardbox.append(h("p", { class: "error" }, `no view registered for ${session.def.id}`));
      return;
    }
    const mount = h("div", { class: "view", "data-view": v.id });
    this.els.boardbox.append(mount);
    try {
      const handle = v.mount(mount, { session, settings: this.viewSettings(v), storage: namespace(`view:${v.id}`) });
      this.view = { def: v, handle };
      this.host!.attachView(handle, mount);
    } catch (e) {
      console.error(e);
      this.els.boardbox.append(h("p", { class: "error" }, `view failed: ${e instanceof Error ? e.message : e}`));
    }
    this.hub.setSource("view", () => this.view?.handle.commands ?? []);
    this.hub.setSource("plugins", () => this.host?.commands() ?? []);
    this.hub.setSource("techniques", () => this.techniqueCommands());
    this.hub.setSource("widgets", () => this.widgetCommands());
    this.hub.refresh();
    this.mountWidgets();
  }

  private unmountView(): void {
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

  // --- widgets & layout ---

  widgetDefs(): WidgetDef[] {
    return this.session ? this.registry.widgetsFor(this.session.def.id, this.session.puzzle) : [];
  }

  layoutConfig(): LayoutConfig {
    return this.layout;
  }

  setPlacement(id: string, slot: SlotId, order?: number): void {
    if (!this.session) return;
    const cur = this.layout[id];
    this.layout = { ...this.layout, [id]: { slot, order: order ?? cur?.order ?? 50 } };
    saveLayout(this.session.def.id, this.layout);
    this.mountWidgets();
  }

  resetLayout(): void {
    if (!this.session) return;
    saveLayout(this.session.def.id, {});
    this.mountWidgets();
  }

  widgetSettings(w: WidgetDef): Record<string, unknown> {
    return w.settings ? resolve(w.settings, prefs.get(`widget:${w.id}`, {})) : {};
  }

  setWidgetSettings(w: WidgetDef, values: Record<string, unknown>): void {
    prefs.set(`widget:${w.id}`, values);
    this.mountWidgets();
  }

  private unmountWidgets(): void {
    for (const m of this.widgets) {
      try {
        m.teardown?.();
      } catch (e) {
        console.error(e);
      }
      if (this.session) untapAll(this.session.hooks, m.owner);
      if (this.view?.handle.hooks) untapAll(this.view.handle.hooks, m.owner);
      m.el.remove();
    }
    this.widgets = [];
    for (const el of [this.els.top, this.els.side, this.els.bottom, this.els.overlay, this.els.tabs, this.els.panelBody]) clear(el);
  }

  /** Mount every placed widget; panel widgets become tabs (only the active one is mounted). */
  mountWidgets(): void {
    const session = this.session;
    if (!session) return;
    this.unmountWidgets();
    const defs = this.widgetDefs();
    this.layout = loadLayout(session.def.id, defs);
    const placed = defs
      .map((d) => ({ d, p: this.layout[d.id]! }))
      .filter((x) => x.p.slot !== "off")
      .sort((a, b) => a.p.order - b.p.order || a.d.name.localeCompare(b.d.name));

    const tabs = placed.filter((x) => x.p.slot === "panel");
    if (!tabs.some((t) => t.d.id === this.activeTab)) this.activeTab = tabs[0]?.d.id ?? "";
    for (const t of tabs) {
      this.els.tabs.append(h("button", {
        role: "tab", "aria-selected": String(t.d.id === this.activeTab), "data-widget": t.d.id,
        onclick: () => this.openTab(t.d.id),
      }, t.d.name));
    }
    for (const { d, p } of placed) {
      if (p.slot === "panel" && d.id !== this.activeTab) continue;
      const target = p.slot === "top" ? this.els.top : p.slot === "side" ? this.els.side : p.slot === "bottom" ? this.els.bottom : p.slot === "overlay" ? this.els.overlay : this.els.panelBody;
      const el = h("div", { class: "widget", "data-widget": d.id });
      target.append(el);
      const owner = `widget:${d.id}`;
      const m: MountedWidget = { def: d, owner, el };
      try {
        m.teardown = d.mount(el, {
          session,
          settings: this.widgetSettings(d),
          run: (id) => this.hub.run(id),
          commands: () => this.hub.all(),
          view: this.view?.handle ?? null,
          slot: p.slot,
          owner,
        }) ?? undefined;
      } catch (e) {
        console.error(`[games] widget ${d.id} failed`, e);
        el.append(h("p", { class: "error" }, `${d.name} failed to load`));
      }
      this.widgets.push(m);
    }
    this.root.toggleAttribute("data-has-panel", tabs.length > 0);
    this.relayout();
  }

  /** Keep the session's lock in step with solved state, the unlock choice and the setting. */
  syncLock(): void {
    const s = this.session;
    s?.setLocked((s.solved && !this.unlocked && prefs.get("lockSolved", true)) || s.lost);
  }

  /** Zen: every slot but the board hidden, without touching the saved layout. */
  zen = false;

  toggleZen(): void {
    this.zen = !this.zen;
    this.root.toggleAttribute("data-zen", this.zen);
    this.relayout();
    this.hub.refresh();
  }

  /** Toggle the how-to card (placing its widget over the board if the player had hidden it). */
  showHowTo(): void {
    const w = this.widgets.find((m) => m.def.id === "howto");
    if (w) w.el.dispatchEvent(new CustomEvent("howto-toggle"));
    else this.setPlacement("howto", "overlay");
  }

  openTab(id: string): void {
    this.activeTab = id;
    prefs.set("tab", id);
    if (this.layout[id]?.slot !== "panel") this.setPlacement(id, "panel");
    else this.mountWidgets();
  }

  /**
   * Size the board as large as possible: try side slot / panel beside vs below the board and
   * keep the arrangement with the largest board. Runs on resize and when widgets or view change,
   * never on content changes, so nothing moves while playing.
   */
  relayout(): void {
    const e = this.els;
    if (!this.session) return;
    const stage = e.stage;
    const hasSide = !this.zen && e.side.childElementCount > 0;
    const hasPanel = !this.zen && this.root.hasAttribute("data-has-panel");
    stage.dataset.side = "below";
    stage.dataset.panel = "right";
    const sideBelowH = hasSide ? e.side.offsetHeight : 0;
    stage.dataset.side = "right";
    const measures = {
      width: this.root.clientWidth,
      height: window.innerHeight - e.header.offsetHeight,
      // a visible slot also costs the gap between it and the board row
      topH: !this.zen && e.top.offsetHeight ? e.top.offsetHeight + 12 : 0,
      bottomH: !this.zen && e.bottom.offsetHeight ? e.bottom.offsetHeight + 12 : 0,
      sideW: hasSide ? e.side.offsetWidth : 0,
      sideBelowH,
      panelW: 320,
      hasSide,
      hasPanel,
      aspect: this.view?.handle.aspect ?? 1,
      gap: 12,
    };
    const a = arrange(measures);
    stage.dataset.side = a.side;
    stage.dataset.panel = a.panel;
    stage.toggleAttribute("data-scroll", a.scroll);
    e.boardbox.style.width = `${Math.max(120, a.boardW)}px`;
    e.boardbox.style.height = `${Math.max(120, a.boardH)}px`;
  }

  // --- commands ---

  private shellCommands(): CommandDef[] {
    const s = this.session;
    const base: CommandDef[] = [
      { id: "shell.palette", label: "commands", category: "general", keys: ["$mod+k"], captureInput: true, run: () => this.hub.openPalette() },
      { id: "shell.shortcuts", label: "keyboard shortcuts", category: "general", keys: ["$mod+slash"], run: () => { this.hub.cheatsheet.open = !this.hub.cheatsheet.open; } },
      { id: "shell.rebind", label: "change key bindings", category: "general", run: () => { this.hub.settings.open = true; } },
      { id: "shell.howto", label: "how to play", category: "general", keys: ["f1"], description: "what this puzzle is, its rules, and how to play it", run: () => this.showHowTo() },
      { id: "shell.labels", label: "board labels", category: "view", keys: ["l"], description: "letters and numbers along the board edges, so cells named in hints (like C5) are easy to find. cycles off / top+left / all sides", run: () => cycleLabels() },
      { id: "shell.zen", label: "zen mode", category: "view", keys: ["z"], description: "just the board; press again to bring everything back", checked: () => this.zen, run: () => this.toggleZen() },
      { id: "shell.index", label: "all puzzles", category: "general", run: () => this.goIndex() },
    ];
    if (!s) return base;
    const def = s.def;
    const progress = () => s.canUndo && !s.solved;
    return [
      ...base,
      {
        id: "shell.unlock", label: "unlock solved board", category: "game",
        description: "keep playing with a finished board (moves, undo). the solve time is kept as it was",
        when: (c) => !!c.locked && !c.lost,
        run: () => { this.unlocked = true; this.syncLock(); this.setStatus("unlocked: the board is yours to play with"); this.hub.refresh(); },
      },
      { id: "shell.undo", label: "undo", category: "game", keys: ["$mod+z", "u"], description: "take back the last step", when: (c) => !!c.canUndo && (!c.locked || !!c.lost), run: () => s.undo() },
      { id: "shell.redo", label: "redo", category: "game", keys: ["$mod+shift+z", "$mod+y", "r"], description: "put back a step you undid", when: (c) => !!c.canRedo && !c.locked, run: () => s.redo() },
      {
        id: "shell.restart", label: "restart", category: "game", danger: true, when: (c) => !!c.canUndo || !!c.solved,
        confirm: () => (s.solved ? "this board is solved. restarting clears it. restart anyway?" : "restart this board from the beginning?"),
        run: () => s.restart(),
      },
      { id: "shell.hint", label: "hint", category: "game", keys: ["shift+slash"], description: "press again for more detail", when: (c) => !c.solved, run: () => this.showHint() },
      { id: "shell.apply-hint", label: "apply hint", category: "game", keys: ["shift+h"], when: (c) => !c.solved, run: () => this.applyHint() },
      {
        id: "shell.reveal", label: "reveal solution", category: "game", danger: true, when: (c) => !c.solved && !!def.solve,
        confirm: () => "show the whole solution?",
        run: () => {
          const sol = def.solve?.(s.puzzle);
          if (sol) s.replaceState(sol, { kind: "system", reason: "reveal" });
          else this.setStatus("no solution available");
        },
      },
      { id: "shell.pause", label: "pause", category: "game", keys: ["p"], when: (c) => !c.solved, checked: () => s.paused, run: () => this.togglePause() },
      {
        id: "shell.new", label: "new game", category: "game", keys: ["$mod+Enter"], danger: progress,
        confirm: () => (progress() ? "start a new game? this one's progress will be lost." : null),
        run: () => this.newGameSame(),
      },
      ...(def.presets ?? []).map((p, i): CommandDef => ({
        id: `shell.preset-${i}`, label: `new ${def.name}: ${p.label}`, category: "new game",
        confirm: () => (progress() ? "start a new game? this one's progress will be lost." : null),
        run: () => void this.newGame(def, { ...prefs.get(`params:${def.id}`, {}), ...p.params }, randomSeed()),
      })),
      ...(this.host?.plugins() ?? []).map((p): CommandDef => ({
        id: `toggle.${p.id}`, label: p.name, category: p.category ?? "assists", description: p.description,
        checked: () => loadPluginConfig(p).enabled,
        run: () => {
          this.host!.setConfig(p, { ...loadPluginConfig(p), enabled: !loadPluginConfig(p).enabled });
          this.hub.refresh();
        },
      })),
    ];
  }

  private techniqueCommands(): CommandDef[] {
    const th = this.techniques;
    const s = this.session;
    if (!th || !s) return [];
    return th.list.flatMap((t): CommandDef[] => [
      { id: `technique.find.${t.id}`, label: `find ${t.name}`, category: "techniques", description: t.description, run: () => this.findTechnique(t) },
      { id: `technique.apply.${t.id}`, label: `apply ${t.name}`, category: "techniques", run: () => { if (!th.apply(t)) this.setStatus(`no ${t.name} right now`); } },
      {
        id: `technique.auto.${t.id}`, label: `auto-apply ${t.name}`, category: "techniques",
        checked: () => th.config(t).auto,
        run: () => { th.setConfig(t, { ...th.config(t), auto: !th.config(t).auto }); this.hub.refresh(); },
      },
      { id: `technique.practice.${t.id}`, label: `practise ${t.name}`, category: "practice", run: () => void this.startPractice(s.def, t, randomSeed()) },
    ]);
  }

  private widgetCommands(): CommandDef[] {
    return this.widgetDefs().map((w): CommandDef => ({
      id: `widget.${w.id}`, label: `show ${w.name}`, category: "layout", description: w.description,
      checked: () => (this.layout[w.id]?.slot ?? w.defaultSlot) !== "off",
      run: () => {
        const cur = this.layout[w.id]?.slot ?? w.defaultSlot;
        this.setPlacement(w.id, cur === "off" ? (w.defaultSlot === "off" ? "panel" : w.defaultSlot) : "off");
        this.hub.refresh();
      },
    }));
  }

  findTechnique(t: Technique): void {
    const step = this.techniques?.find(t);
    if (!step) {
      this.setStatus(`no ${t.name} right now`);
      return;
    }
    const hint = hintFrom(t, step, 2);
    this.session!.showHint(hint as Hint<any>);
    this.session!.hooks.fx.call({ kind: "hint", focus: hint.focus });
    this.setStatus(hint.message);
  }

  private newGameSame(): void {
    const s = this.session;
    if (!s) return;
    void this.newGame(s.def, prefs.get(`params:${s.def.id}`, {}), randomSeed());
  }

  togglePause(): void {
    const s = this.session;
    if (!s || s.solved) return;
    s.setPaused(!s.paused);
    this.root.toggleAttribute("data-paused", s.paused);
    this.hub.refresh();
  }

  /** First press: nudge. Again: full explanation. Again: carry it out. */
  showHint(): void {
    const s = this.session;
    if (!s) return;
    const cur = s.activeHint;
    if (cur?.more) {
      s.showHint(cur.more);
      s.hooks.fx.call({ kind: "hint", focus: cur.more.focus });
      this.setStatus(cur.more.message);
      return;
    }
    if (cur && cur.actions?.length) {
      this.applyHint();
      return;
    }
    const hint = s.showHint();
    if (!hint) {
      this.setStatus("no hint available");
      return;
    }
    s.hooks.fx.call({ kind: "hint", focus: hint.focus });
    this.setStatus(hint.message);
  }

  applyHint(): void {
    const s = this.session;
    if (!s || s.solved) return;
    const hint = s.activeHint ?? s.hint();
    if (!hint) {
      this.setStatus("no hint available");
      return;
    }
    const actions = hint.actions ?? hint.more?.actions;
    if (!actions?.length) {
      this.setStatus(hint.message);
      return;
    }
    const t = hint.technique ? this.techniques?.list.find((x) => x.id === hint.technique) : undefined;
    const full = hint.more ?? hint;
    const source = t
      ? { kind: "technique" as const, technique: t.id, name: t.name, step: { message: full.message, focus: full.focus, actions }, auto: false, viaHint: true }
      : { kind: "hint" as const };
    let changed = false;
    s.batch(() => {
      for (const a of actions) changed = s.dispatch(a, { source }) || changed;
    });
    if (!changed) this.setStatus("that hint no longer applies");
  }

  // --- practice ---

  private checkPractice(ctx: { cause: string; source?: { kind: string }; prev: unknown; state: unknown }): void {
    const s = this.session;
    if (!s || s.origin.kind !== "practice" || ctx.cause !== "action" || ctx.source?.kind !== "player") return;
    const step = s.origin.step;
    // the step is judged from the position the practice started at
    const from = this.practiceStart ?? ctx.prev;
    if (isPartOfStep(s.def, s.puzzle, ctx.prev, ctx.state, step) && isPartOfStep(s.def, s.puzzle, from, ctx.state, step)) {
      const done = isStepDone(s.def, s.puzzle, from, ctx.state, step);
      s.hooks.fx.call({ kind: "practice", correct: true, done });
      this.setStatus(done ? "that's it!" : "yes, keep going");
    } else {
      s.hooks.fx.call({ kind: "practice", correct: false, done: false });
      this.keepStatus = true;
      queueMicrotask(() => s.undo());
      this.setStatus("not that one. look again");
    }
  }

  // --- persistence ---

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 400);
  }

  private saveNow(): void {
    clearTimeout(this.saveTimer);
    const s = this.session;
    if (!s || this.reloading) return;
    saveSession({
      id: this.sessionId,
      puzzleId: s.def.id,
      key: originKey(s.def, s.origin),
      title: s.def.name,
      detail: [s.origin.kind === "practice" ? "practice" : "", s.def.describe?.(s.puzzle) ?? ""].filter(Boolean).join(" · "),
      updatedAt: Date.now(),
      solved: s.solved,
      elapsedMs: s.solvedAtMs ?? s.elapsedMs(),
      practice: s.origin.kind === "practice",
    }, s.snapshot());
    this.hooks.sessions.call();
  }

  /** Forget a saved game; closing the open one returns to the game list. */
  closeSession(id: string): void {
    removeSession(id);
    if (id === this.sessionId) {
      this.session?.pause();
      this.session = null;
      this.goIndex();
    }
    this.hooks.sessions.call();
  }

  savedGames() {
    return listSessions();
  }

  // --- chrome ---

  private buildDom() {
    clear(this.root);
    style("shell", SHELL_CSS);
    const els = {
      header: h("header", { class: "bar" }),
      title: h("span", { class: "title" }),
      meta: h("span", { class: "meta" }),
      timer: h("span", { class: "timer", "aria-label": "elapsed time" }),
      pauseMark: h("span", { class: "pause-mark", "aria-hidden": "true" }, "paused"),
      stage: h("div", { class: "stage", "data-panel": "right", "data-side": "right" }),
      main: h("div", { class: "main" }),
      top: h("div", { class: "slot slot-top" }),
      middle: h("div", { class: "middle" }),
      boardbox: h("div", { class: "boardbox" }),
      overlay: h("div", { class: "slot slot-overlay" }),
      side: h("div", { class: "slot slot-side" }),
      bottom: h("div", { class: "slot slot-bottom" }),
      panel: h("aside", { class: "panel" }),
      tabs: h("div", { class: "tabs", role: "tablist" }),
      panelBody: h("div", { class: "panel-body" }),
      index: h("div", { class: "index-wrap" }),
    };
    add(els.header,
      h("a", { href: "/", class: "home", title: "ptera.world" }, "ptera"),
      h("a", { href: location.pathname, class: "crumb", onclick: (ev: MouseEvent) => { ev.preventDefault(); this.goIndex(); } }, "games"),
      els.title, els.meta, h("span", { class: "spacer" }),
      this.safe ? h("a", { class: "safe-mark", href: location.pathname, title: "safe mode: only the built-in packs are loaded, all switched on. your pack settings are untouched" }, "safe mode · leave") : null,
      els.pauseMark, els.timer,
      h("button", { class: "howto-btn", "data-command": "shell.howto", "aria-label": "how to play", onclick: () => this.hub.run("shell.howto") }, "?"),
      h("button", { class: "palette-btn", "data-command": "shell.palette", onclick: () => this.hub.openPalette() }, "commands"));
    els.middle.append(h("div", { class: "boardwrap" }, els.boardbox, els.overlay), els.side);
    els.main.append(els.top, els.middle, els.bottom);
    els.panel.append(els.tabs, els.panelBody);
    els.stage.append(els.main, els.panel);
    this.root.append(els.header, els.stage, els.index);
    return els;
  }

  goIndex(): void {
    history.pushState(null, "", location.pathname);
    this.showIndex();
  }

  private showIndex(): void {
    this.teardownSession();
    this.root.dataset.mode = "index";
    this.els.title.textContent = "";
    this.els.meta.textContent = "";
    this.els.timer.textContent = "";
    document.title = "games · ptera.world";
    clear(this.els.index);
    const go = (qs: string) => (ev: MouseEvent) => {
      ev.preventDefault();
      history.pushState(null, "", `?${qs}`);
      void this.fromUrl();
    };
    const all = this.registry.listPuzzles();
    const tags = [...new Set(all.flatMap((d) => d.tags ?? []))].sort();
    let active = prefs.get<string | null>("indexTag", null);
    if (active && !tags.includes(active)) active = null;
    const filters = h("div", { class: "index-tags", role: "group", "aria-label": "filter by tag" });
    const search = h("input", { type: "search", placeholder: "search games", "aria-label": "search games", class: "index-search", oninput: () => render() });
    const list = h("ul", { class: "index" });
    const render = () => {
      clear(filters);
      if (tags.length) {
        for (const tag of [null, ...tags]) {
          filters.append(h("button", {
            "aria-pressed": String(tag === active),
            onclick: () => { active = tag; prefs.set("indexTag", tag); render(); },
          }, tag ?? "all"));
        }
      }
      clear(list);
      const q = search.value.trim().toLowerCase();
      const hay = (d: AnyPuzzleDef) => [d.id, d.name, d.description ?? "", ...(d.aliases ?? []), ...(d.tags ?? [])].join(" ").toLowerCase();
      for (const li of items.filter((x) => (!active || (x.def.tags ?? []).includes(active)) && (!q || hay(x.def).includes(q)))) list.append(li.el);
    };
    const items = all.map((def) => {
      const n = this.registry.techniquesFor(def.id).length;
      const p = encodeURIComponent(def.id);
      return h("li", null,
        h("a", { href: `?p=${p}`, class: "card", onclick: go(`p=${p}`) },
          h("strong", null, def.name),
          def.aliases?.length ? h("em", { class: "aka" }, `also: ${def.aliases.join(", ")}`) : null,
          def.description ? h("span", null, def.description) : null),
        def.tags?.length ? h("span", { class: "tags" }, def.tags.join(" · ")) : null,
        n ? h("a", { href: `?p=${p}&tab=techniques`, class: "learn", onclick: go(`p=${p}&tab=techniques`) }, `learn · ${n} techniques`) : null);
    }).map((el, i) => ({ el, def: all[i]! }));
    const going = listSessions().filter((m) => !m.solved && !m.practice).slice(0, 6);
    const resumeRow = going.length
      ? h("div", { class: "index-continue" }, h("span", { class: "w-dim" }, "continue:"), going.map((m) =>
        h("button", { onclick: () => this.openSession(m.id) }, m.title, " ", h("span", { class: "w-dim" }, formatTime(m.elapsedMs)))))
      : null;
    this.els.index.append(h("div", { class: "index-inner" }, resumeRow, search, filters, list));
    render();
    this.hub.refresh();
  }

  private renderHeader(): void {
    const s = this.session;
    if (!s) return;
    this.els.title.textContent = s.def.name;
    const bits: string[] = [];
    if (s.origin.kind === "practice") {
      const t = this.registry.techniquesFor(s.def.id).find((x) => x.id === (s.origin as { technique: string }).technique);
      bits.push(`practice: ${t?.name ?? "technique"}`);
    }
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
    if (!s) return;
    const hide = prefs.get("hideTimer", false);
    const time = formatTime(s.solved ? s.solvedAtMs ?? 0 : s.elapsedMs());
    this.els.timer.textContent = hide && !s.solved ? "" : time;
    this.els.pauseMark.textContent = s.solved ? "solved" : "paused";
    this.els.pauseMark.classList.toggle("on", s.solved || !s.running);
  }

  get status(): string {
    return this.statusText;
  }

  setStatus(text: string): void {
    this.statusText = text;
    this.hooks.status.call({ text });
  }

  private syncSolvedStatus(): void {
    const s = this.session;
    if (!s) return;
    if (this.keepStatus) {
      this.keepStatus = false;
      return;
    }
    this.syncLock();
    if (s.lost) {
      delete this.root.dataset.solved;
      this.setStatus("game over. undo to step back, or start a new game");
      return;
    }
    if (s.solved) {
      this.root.dataset.solved = "";
      this.root.removeAttribute("data-paused");
      this.setStatus(s.origin.kind === "practice" ? "solved" : `solved in ${formatTime(s.solvedAtMs!)}`);
    } else {
      delete this.root.dataset.solved;
      this.setStatus("");
    }
  }

  private showError(text: string): void {
    this.unmountView();
    clear(this.els.boardbox);
    this.els.boardbox.append(h("p", { class: "error" }, text));
  }
}

const SHELL_CSS = `
#games { display: flex; flex-direction: column; min-height: 100%; height: 100%; }
.bar { display: flex; align-items: center; gap: 12px; padding: 8px 16px; border-bottom: 1px solid var(--border); white-space: nowrap; overflow: hidden; flex: none; }
.bar .home { font-weight: 600; }
.bar .crumb::before { content: "/ "; color: var(--text-dim); }
.bar .title { font-weight: 600; }
.bar .title:empty { display: none; }
.bar .meta { color: var(--text-dim); font-size: 13px; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.bar .spacer { flex: 1; }
/* fixed boxes: the timer and its state label never change the header layout */
.bar .timer { font-family: var(--mono); color: var(--text-dim); font-variant-numeric: tabular-nums; min-width: 7ch; text-align: right; }
.bar .pause-mark { font-size: 12px; color: var(--text-dim); min-width: 6ch; text-align: right; visibility: hidden; }
.bar .pause-mark.on { visibility: visible; }
[data-solved] .bar .pause-mark { color: var(--accent); }
[data-solved] .bar .timer { color: var(--accent); }
.bar .palette-btn { padding: 4px 10px; font-size: 13px; }
.bar .safe-mark { font-size: 12px; color: var(--warn); }
.bar .howto-btn { padding: 0; width: 28px; height: 28px; border-radius: 99px; font-size: 14px; }
@media (max-width: 520px) {
  .bar { gap: 8px; padding: 8px 10px; }
  .bar .meta, .bar .crumb { display: none; }
  .bar .title { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .bar .pause-mark { min-width: 0; }
  .bar .pause-mark:not(.on) { display: none; }
}

.stage { flex: 1; display: flex; min-height: 0; }
.stage[data-panel="below"] { flex-direction: column; overflow-y: auto; }
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 12px; overflow-y: auto; }
.stage[data-panel="below"] .main { flex: none; overflow: visible; }
/* top-aligned: a side column growing or shrinking never moves the board */
.middle { display: flex; gap: 12px; align-items: flex-start; justify-content: center; max-width: 100%; }
.stage[data-side="below"] .middle { flex-direction: column; }
.boardwrap { position: relative; flex: none; }
.boardbox { position: relative; flex: none; display: flex; align-items: center; justify-content: center; }
.slot-overlay { position: absolute; inset: 0; pointer-events: none; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; padding: 10px; }
.slot-overlay > .widget { pointer-events: auto; }
[data-lost] .boardbox { box-shadow: 0 0 0 3px var(--danger); border-radius: 10px; }
[data-solved] .boardbox { box-shadow: 0 0 0 3px var(--accent); border-radius: 10px; }
.boardbox > .view { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
.slot { display: flex; flex-direction: column; gap: 10px; }
.slot:empty { display: none; }
.slot-top, .slot-bottom { width: 100%; align-items: center; }
.slot-top > .widget, .slot-bottom > .widget { width: 100%; display: flex; justify-content: center; }
.slot-side { width: 240px; flex: none; }
.stage[data-side="below"] .slot-side { width: min(100%, 520px); }

.panel { width: 320px; flex: none; border-left: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0; }
.stage[data-panel="below"] .panel { width: auto; border-left: none; border-top: 1px solid var(--border); min-height: auto; }
#games:not([data-has-panel]) .panel { display: none; }
.tabs { display: flex; flex-wrap: wrap; border-bottom: 1px solid var(--border); flex: none; }
.tabs button { border: none; border-radius: 0; background: none; padding: 10px 12px; color: var(--text-dim); white-space: nowrap; }
.tabs button[aria-selected="true"] { color: var(--text); box-shadow: inset 0 -2px var(--accent); }
.panel-body { flex: 1; overflow-y: auto; padding: 12px 16px 24px; }
.panel-body > .widget { display: flex; flex-direction: column; gap: 10px; }

[data-paused] .boardbox .view { filter: blur(14px); pointer-events: none; }
[data-zen] .slot-top, [data-zen] .slot-side, [data-zen] .slot-bottom, [data-zen] .panel, [data-zen] .bar .meta { display: none; }
[data-mode="index"] .stage { display: none; }
#games:not([data-mode="index"]) .index-wrap { display: none; }
.index-wrap { padding: 16px; display: flex; justify-content: center; }
.index-inner { width: 100%; max-width: 960px; display: flex; flex-direction: column; gap: 12px; }
.index-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.index-tags:empty { display: none; }
.index-tags button { padding: 3px 10px; font-size: 13px; border-radius: 99px; }
.index-tags button[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); }
.index-search { max-width: 320px; }
.index-continue { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.index .aka { font-size: 12px; color: var(--text-dim); font-style: normal; }
.index .tags { font-size: 11px; padding: 0 14px 8px; color: var(--text-dim); }
.index { list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; width: 100%; max-width: 960px; }
.index li { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); overflow: hidden; }
.index .card { display: flex; flex-direction: column; gap: 4px; padding: 14px; color: var(--text); flex: 1; }
.index .card:hover { background: var(--surface-2); text-decoration: none; }
.index span { color: var(--text-dim); font-size: 13px; }
.index .learn { font-size: 12px; padding: 8px 14px; border-top: 1px solid var(--border); }
.generating { display: flex; gap: 12px; align-items: center; color: var(--text-dim); }
`;

/** Debug aid (?debugLayout): logs every layout shift with the nodes that moved. */
function watchLayoutShifts(): void {
  type Shift = PerformanceEntry & { value: number; sources?: { node?: Node; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[] };
  const shifts: unknown[] = [];
  (globalThis as { __layoutShifts?: unknown[] }).__layoutShifts = shifts;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries() as Shift[]) {
      const moved = (e.sources ?? []).map((s) => ({
        node: s.node instanceof Element ? `${s.node.tagName.toLowerCase()}.${[...s.node.classList].join(".")}` : s.node?.nodeName,
        from: [Math.round(s.previousRect.x), Math.round(s.previousRect.y)],
        to: [Math.round(s.currentRect.x), Math.round(s.currentRect.y)],
      }));
      shifts.push({ value: e.value, moved });
      console.warn("[games] layout shift", e.value.toFixed(4), moved);
    }
  }).observe({ type: "layout-shift", buffered: false });
}
