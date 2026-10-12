import { Event as HookEvent, untapAll } from "../../core/hooks";
import type { LoadedPack, ModLoadResult } from "../../core/mods";
import type { PluginHost } from "../../core/plugins";
import type { Registry } from "../../core/registry";
import { randomSeed } from "../../core/rng";
import { canonical, fromQuery, resolve, toQuery, type Schema, type Values } from "../../core/schema";
import type { Origin, Session, SharedHistory, Snapshot } from "../../core/session";
import { PluginHostCtor, SessionCtor, TechniqueHostCtor, aimable, colorOf, rememberPosition, cycleLabels, findPracticePosition, generate, hintFrom, isPartOfStep, stepsLeft, stepsOf, loadPluginConfig, onBoardPrefsChange, onThemeChange } from "./engine";
import { packJson, unpackJson, type Patch } from "../../core/patch";

/** What a share link carries beyond the puzzle itself. */
export type ShareLevel = "puzzle" | "state" | "history";

interface Shared {
  state?: Patch | null;
  history?: SharedHistory;
}
import { namespace, prefs } from "../../core/storage";
import { GAME_BINDINGS, HERE_BINDINGS, HOWTO_TOGGLE, HOWTO_WIDGET, SHELL_BINDINGS, SKILL_BINDINGS, WATCH_WIDGET, command, pluginToggle, presetCommand, techniqueCommand, widgetToggle, type ShellContext } from "./names";
import { bindCommands } from "../../core/commands";
import type { TechniqueHost } from "../../core/techniques";
import type { Step, AnyPuzzleDef, CommandContext, AnyView, AnyWidget, CommandDef, Format, Hint, Technique, ViewHandle, SlotId } from "../../core/types";
import { CommandHub } from "./commands";
import { add, clear, formatTime, h, setInputKind, style } from "../../core/dom";
import { arrange, loadLayout, saveLayout, type LayoutConfig } from "./layout";
import { builtinWidgets } from "./widgets";
import { installTooltips } from "./tooltips";
import { sessionList } from "./session-list";
import { tagStyle } from "./tags";
import { openOverlays, popup, type SurfaceItem } from "./surfaces";
import { SAVE_PREFIX, INDEX_KEY, finished, findSession, listSessions, loadSession, newSessionId, removeSession, saveSession } from "./sessions";


/** Board zoom also takes the browser's own zoom gestures (ctrl ±, ctrl+0, ctrl+scroll). Off by default. */
export const zoomTakeover = (): boolean => prefs.get("zoomTakeover", false);

export { HOLD_MS } from "../../core/gestures";
import { HOLD_MS, buttonsSwapped, setButtonsSwapped } from "../../core/gestures";
import { Casting } from "./casting";
import { inPalette, noteProgress, skillPrefs } from "./skill-prefs";
import { onModifierHold } from "keybinds";

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


/** What a stopped shell hands to the next one: the open game and where the player was. */
interface Carried {
  kind: "shell";
  /** Saved-game id of the open game; null on the game list. */
  sessionId: string | null;
  tab: string;
  unlocked: boolean;
  zoom: number;
  scroll: [number, number];
}

const isCarried = (v: unknown): v is Carried => typeof v === "object" && v !== null && (v as Carried).kind === "shell";

interface MountedWidget {
  def: AnyWidget;
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
    zoom: new HookEvent<{ zoom: number }>("zoom"),
    /** The saved-games list changed (here or in another tab). */
    sessions: new HookEvent<void>("sessions"),
    /** What the player points at on the board changed (see `aim`). */
    aim: new HookEvent<{ target: unknown }>("aim"),
    /** The technique picked to cast changed (null: none). */
    armed: new HookEvent<{ technique: Technique | null }>("armed"),
    /** Which techniques the palette shows, or their progress or pins, may have changed. */
    palette: new HookEvent<void>("palette"),
    /** The technique whose demo plays beside the board changed (null: none). */
    watch: new HookEvent<{ technique: Technique | null }>("watch"),
  };

  session: Session<any, any, any, any> | null = null;
  private openId = "";
  /** Saved-game id of the open session; "" whenever no session is open. */
  get sessionId(): string {
    return this.session ? this.openId : "";
  }
  /** Player unlocked the current finished board for free play (not saved; a reopened finished board is locked again). */
  unlocked = false;
  private wasLost = false;
  /** Adopting another tab's save: don't write it back. */
  private reloading = false;
  host: PluginHost | null = null;
  techniques: TechniqueHost | null = null;
  readonly cast: Casting;
  /** The element the board view mounts in. */
  get boardEl(): HTMLElement {
    return this.els.boardbox;
  }
  readonly hub: CommandHub;
  view: { def: AnyView; handle: ViewHandle } | null = null;
  private sessionCleanup: (() => void)[] = [];
  private generating: AbortController | null = null;
  private saveTimer = 0;
  private widgets: MountedWidget[] = [];
  private layout: LayoutConfig = {};
  private activeTab = prefs.get("tab", "game");
  private statusText = "";
  /** Skip the next status reset (a message about the change that is being undone automatically). */
  private keepStatus = false;
  /** Practice: every instance of the practiced technique in the start position. */
  private lesson: Step[] = [];
  private els: ReturnType<Shell["buildDom"]>;
  /** Aborts on stop: every listener the shell puts outside its own elements is bound to it. */
  private readonly life = new AbortController();
  private ticker = 0;

  constructor(readonly root: HTMLElement, readonly registry: Registry, readonly modResults: ModLoadResult[], readonly packs: LoadedPack[] = [], readonly safe = false) {
    this.els = this.buildDom();
    this.hub = new CommandHub(root);
    this.cast = new Casting(this);
    this.hub.addContext(() => this.context());
    for (const w of builtinWidgets(this)) registry.widget(w);
  }

  /** `carried`: what a previous shell's stop returned, to continue from; anything else is ignored. */
  async start(carried?: unknown): Promise<void> {
    const signal = this.life.signal;
    window.addEventListener("popstate", () => void this.fromUrl(), { signal });
    document.addEventListener("visibilitychange", () => {
      if (!this.session) return;
      if (document.hidden) {
        this.session.pause();
        this.saveNow();
      } else if (!this.session.paused) this.session.resume();
    }, { signal });
    window.addEventListener("pagehide", () => this.saveNow(), { signal });
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
    }, { signal });
    if (new URLSearchParams(location.search).has("debugLayout")) watchLayoutShifts();
    let raf = 0;
    window.addEventListener("resize", () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => this.relayout());
    }, { signal });
    signal.addEventListener("abort", () => cancelAnimationFrame(raf));
    this.els.boardbox.addEventListener("contextmenu", (e) => {
      if (e.defaultPrevented || this.view?.handle.gestures?.secondaryClick || !this.hub.all().some((c) => [c.menu].flat().includes("board"))) return;
      e.preventDefault();
      this.openBoardMenu(e.clientX, e.clientY, "mouse");
    });
    this.ticker = window.setInterval(() => this.tick(), 250);
    setInputKind(this.root, "pointer");
    document.addEventListener("keydown", (e) => {
      if (!["Shift", "Control", "Alt", "Meta"].includes(e.key)) setInputKind(this.root, "keyboard");
    }, { capture: true, signal });
    document.addEventListener("pointerdown", () => { setInputKind(this.root, "pointer"); }, { capture: true, signal });
    for (const off of [onThemeChange(() => { if (this.session) this.mountView(); }), onBoardPrefsChange(() => { if (this.session) this.mountView(); })]) {
      signal.addEventListener("abort", off);
    }
    installTooltips(this.hub, signal);
    this.rearmHold();
    this.installZoom();
    this.installLongPress();
    this.cast.install(signal);
    this.hooks.palette.tap(() => this.hub.refresh());
    this.hooks.zoom.tap(() => this.cast.kept.schedule());
    this.els.scroller.addEventListener("scroll", () => this.cast.kept.schedule(), { passive: true, signal });
    let aimRaf = 0;
    this.els.boardbox.addEventListener("pointermove", () => {
      cancelAnimationFrame(aimRaf);
      aimRaf = requestAnimationFrame(() => this.updateAim());
    });
    this.hub.setSource("shell", () => this.shellCommands());
    const c = isCarried(carried) ? carried : null;
    if (c) this.activeTab = c.tab;
    if (!c?.sessionId || !this.openSession(c.sessionId, false)) {
      await this.fromUrl();
      return;
    }
    if (c.unlocked) {
      this.unlocked = true;
      this.syncLock();
    }
    if (c.zoom !== 1) this.zoomBy(c.zoom);
    this.els.scroller.scrollLeft = c.scroll[0];
    this.els.scroller.scrollTop = c.scroll[1];
  }

  /** Save, remove everything the shell added to the page, and return what a new shell continues from. */
  stop(): Carried {
    const sc = this.els.scroller;
    const carried: Carried = {
      kind: "shell",
      sessionId: this.sessionId || null,
      tab: this.activeTab,
      unlocked: this.unlocked,
      zoom: this.zoom,
      scroll: [sc.scrollLeft, sc.scrollTop],
    };
    this.generating?.abort();
    this.teardownSession();
    this.unmountWidgets();
    this.stopHold?.();
    this.hub.destroy();
    for (const close of openOverlays) close();
    clearInterval(this.ticker);
    clearTimeout(this.saveTimer);
    this.life.abort();
    this.root.replaceChildren();
    return carried;
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
        this.openBoardMenu(start.x, start.y, "touch");
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

  private context(): CommandContext {
    const s = this.session;
    const own: ShellContext = {
      hasSession: !!s,
      finished: s?.finished ?? false,
      locked: s?.locked ?? false,
      lost: s?.lost ?? false,
      canUndo: s?.canUndo ?? false,
      canRedo: s?.canRedo ?? false,
      hint: !!s?.activeHint,
      practice: s?.origin.kind === "practice",
    };
    return { ...own, ...this.view?.handle.context?.() };
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
      const t = this.registry.techniquesFor(def).find((x) => x.id === practice);
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
    if (this.resume(def, originKey(def, { ...origin, start: null }), true)) return;
    this.generating?.abort();
    const ac = new AbortController();
    this.generating = ac;
    this.showBusy(`finding a ${t.name}…`, ac);
    try {
      const pos = await findPracticePosition(def, this.registry.techniquesFor(def), t, seed, ac.signal);
      if (ac.signal.aborted) return;
      if (!pos) {
        this.showError(`couldn't find a ${t.name} to practice in time. try again for a different board.`);
        return;
      }
      this.setSession(new SessionCtor(def, pos.puzzle, { ...origin, start: pos.state }, { state: pos.state }), push);
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
    this.zoom = 1;
    this.session = session;
    this.openId = id;
    this.aim = undefined;
    this.watching = null;
    this.techniques = new TechniqueHostCtor(this.registry, session);
    this.cast.reset();
    const o = session.origin;
    const practiced = o.kind === "practice" ? this.registry.techniquesFor(session.def).find((t) => t.id === o.technique) : undefined;
    this.lesson = o.kind === "practice" && practiced ? stepsOf(session.def, practiced, session.puzzle, o.start) : [];
    this.host = new PluginHostCtor(this.registry, session);
    this.hub.setScope(session.def.id);
    const url = this.urlFor(session);
    if (push) history.pushState(null, "", url);
    else history.replaceState(null, "", url);

    delete this.root.dataset.mode;
    this.sessionCleanup.push(
      session.hooks.change.tap((ctx) => {
        // every technique step the game makes is a real example of that technique
        const list = this.techniques?.list ?? [];
        const remember = (src: { kind: string; technique?: string } | undefined, before: unknown) => {
          const t = src?.kind === "technique" ? list.find((x) => x.id === src.technique) : undefined;
          if (t && session.origin.kind !== "practice") rememberPosition(t, session.def.id, session.puzzle, before);
        };
        remember(ctx.source as never, ctx.prev);
        for (const n of ctx.notes) remember(n.source as never, n.before);
        const lost = session.lost;
        if (lost && !this.wasLost && ctx.cause === "action") {
          session.hooks.fx.call({ kind: "mistake", focus: session.lostFocus });
          session.hooks.fx.call({ kind: "lost" });
        }
        this.wasLost = lost;
        this.root.toggleAttribute("data-lost", lost);
        if (lost) session.pause();
        else if (!session.paused && !document.hidden && !session.finished) session.resume();
        this.scheduleSave();
        this.paintHintColor();
        this.syncSolvedStatus();
        this.hub.syncContext();
        this.checkPractice(ctx);
        this.cast.kept.schedule();
      }, { owner: "shell" }),
      session.hooks.fx.tap((e) => {
        if (e.kind !== "practice" || !e.done || session.origin.kind !== "practice") return;
        const t = this.techniques?.list.find((x) => x.id === (session.origin as { technique: string }).technique);
        if (t) { noteProgress(t, (p) => ({ ...p, practiced: true })); this.hooks.palette.call(); }
      }, { owner: "shell" }),
      session.hooks.solved.tap(() => {
        this.syncSolvedStatus();
        this.saveNow();
      }, { owner: "shell" }),
      session.hooks.refresh.tap(() => { this.hub.syncContext(); this.paintHintColor(); }, { owner: "shell" }),
      session.hooks.interaction.tap(() => this.updateAim(), { owner: "shell" }),
      // a finished board (solved or revealed): player moves are refused until it is unlocked
      session.hooks.solved.tap(() => this.syncLock(), { owner: "shell" }),
      session.hooks.action.tap((a, { source }) => {
        if (!a || !session.locked || source.kind !== "player") return a;
        this.setStatus(session.lost ? "game over. undo to step back, or start a new game" : session.solved ? "this board is solved. unlock it to keep playing with it" : "the answer was revealed. unlock the board to keep playing with it");
        session.hooks.fx.call({ kind: "locked" });
        return null;
      }, { owner: "shell", priority: -100 }),
      // while a technique is being cast, presses on the board aim it instead of marking
      session.hooks.action.tap((a, { source }) => (a && source.kind === "player" && this.cast.blockPress ? null : a), { owner: "shell", priority: -90 }),
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

  private chosenView(def: AnyPuzzleDef): AnyView | undefined {
    const views = this.registry.viewsFor(def);
    const want = prefs.get(`view:${def.id}`, null);
    return views.find((v) => v.id === want) ?? views[views.length - 1];
  }

  viewSettings(v: AnyView): Values<Schema> {
    return v.settings ? resolve(v.settings, prefs.get(`viewcfg:${v.id}`, {})) : {};
  }

  setViewSettings(v: AnyView, values: Record<string, unknown>): void {
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
      this.host!.attachView(handle, mount, this.els.boardbox);
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

  widgetDefs(): AnyWidget[] {
    return this.session ? this.registry.widgetsFor(this.session.def, this.session.puzzle) : [];
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

  widgetSettings(w: AnyWidget): Values<Schema> {
    return w.settings ? resolve(w.settings, prefs.get(`widget:${w.id}`, {})) : {};
  }

  setWidgetSettings(w: AnyWidget, values: Record<string, unknown>): void {
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
    this.els.menuBtn.hidden = !this.hub.all().some((c) => [c.menu].flat().includes("board"));
    this.relayout();
  }

  /** Hint highlights take the color of the technique the hint comes from. */
  private paintHintColor(): void {
    const id = this.session?.activeHint?.technique;
    const list = this.techniques?.list ?? [];
    const t = id ? list.find((x) => x.id === id) : undefined;
    if (t) {
      const c = colorOf(t, list);
      this.root.style.setProperty("--hint", c);
      this.root.style.setProperty("--hint-soft", `color-mix(in srgb, ${c} 22%, transparent)`);
    } else {
      this.root.style.removeProperty("--hint");
      this.root.style.removeProperty("--hint-soft");
    }
  }

  /** Keep the session lock in step with the outcome, the unlock choice and the setting. */
  syncLock(): void {
    const s = this.session;
    s?.setLocked((s.finished && !this.unlocked && prefs.get("lockSolved", true)) || s.lost);
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
    const w = this.widgets.find((m) => m.def.id === HOWTO_WIDGET);
    if (w) w.el.dispatchEvent(new CustomEvent(HOWTO_TOGGLE));
    else this.setPlacement(HOWTO_WIDGET, "side");
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
    // the window onto the board keeps the fitted size; the board inside grows past it when a
    // minimum cell size or the zoom asks for more, and the window scrolls
    const fitW = Math.max(120, a.boardW), fitH = Math.max(120, a.boardH);
    const cells = this.view?.handle.cells;
    const minCell = prefs.get("minCell", 18);
    const atLeast = cells && minCell > 0 ? Math.max(1, (minCell * cells.cols) / fitW, (minCell * cells.rows) / fitH) : 1;
    const scale = atLeast * this.zoom;
    e.boardwrap.style.width = `${fitW}px`;
    e.boardwrap.style.height = `${fitH}px`;
    e.boardbox.style.width = `${Math.round(fitW * scale)}px`;
    e.boardbox.style.height = `${Math.round(fitH * scale)}px`;
    e.boardwrap.toggleAttribute("data-zoomed", scale > 1.001);
    this.cast.kept.schedule();
  }

  /** Board-tagged commands, as any surface shows them. */
  boardItems(): SurfaceItem[] {
    const ctx = this.hub.context();
    return this.hub.all()
      .filter((c) => [c.menu].flat().includes("board"))
      .map((cmd) => ({ cmd, enabled: !cmd.when || cmd.when(ctx), keys: this.hub.keysFor(cmd.id) }));
  }

  /** Open the board menu in the player's chosen style for this input (defaults: list for mouse, radial for touch). */
  openBoardMenu(x: number, y: number, input: "mouse" | "touch"): void {
    const style = prefs.get(`menuStyle:${input}`, input === "touch" ? "radial" : "list");
    if (style === "list") {
      this.hub.openMenu("board", x, y);
      return;
    }
    void popup(style, x, y, this.boardItems(), (id) => this.hub.run(id));
  }

  private stopHold: (() => void) | null = null;
  private holdOpened = false;

  /** Holding ctrl (cmd on mac) on its own shows the shortcuts while held; using it in a shortcut never does. Re-reads its setting. */
  rearmHold(): void {
    this.stopHold?.();
    this.stopHold = null;
    const delay = prefs.get("holdShortcuts", 450);
    if (delay < 0) return;
    this.stopHold = onModifierHold(/Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control", (on) => {
      if (on && !this.hub.cheatsheet.open) { this.holdOpened = true; this.hub.cheatsheet.open = true; }
      else if (!on && this.holdOpened) { this.holdOpened = false; this.hub.cheatsheet.open = false; }
    }, { delay });
  }

  /** Board zoom on top of the fitted size (1 = fit). Not saved; resets with each game. */
  zoom = 1;

  /** Zoom by a factor, keeping the board point under (clientX, clientY) in place when given. */
  zoomBy(factor: number, at?: { x: number; y: number }): void {
    const next = Math.min(6, Math.max(1, this.zoom * factor));
    if (next === this.zoom) return;
    const sc = this.els.scroller;
    const r = sc.getBoundingClientRect();
    const px = at ? at.x - r.left : r.width / 2, py = at ? at.y - r.top : r.height / 2;
    const fx = (sc.scrollLeft + px) / sc.scrollWidth, fy = (sc.scrollTop + py) / sc.scrollHeight;
    this.zoom = next;
    this.relayout();
    sc.scrollLeft = fx * sc.scrollWidth - px;
    sc.scrollTop = fy * sc.scrollHeight - py;
    this.hooks.zoom.call({ zoom: this.zoom });
  }

  zoomFit(): void {
    this.zoom = 1;
    this.relayout();
    this.hooks.zoom.call({ zoom: 1 });
  }

  /** Trackpad pinch / ctrl+wheel zooms; two fingers on touch pan and pinch; views keep one-finger gestures. */
  private installZoom(): void {
    const sc = this.els.scroller;
    sc.addEventListener("wheel", (e) => {
      if (!e.ctrlKey || !zoomTakeover()) return;
      e.preventDefault();
      this.zoomBy(Math.exp(-e.deltaY * 0.01), { x: e.clientX, y: e.clientY });
    }, { passive: false });
    let pinch: { d: number; x: number; y: number } | null = null;
    const two = (e: TouchEvent) => {
      const [a, b] = [e.touches[0]!, e.touches[1]!];
      return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
    };
    sc.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) { pinch = two(e); e.stopPropagation(); }
    }, { capture: true, passive: true });
    sc.addEventListener("touchmove", (e) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      const now = two(e);
      sc.scrollLeft -= now.x - pinch.x;
      sc.scrollTop -= now.y - pinch.y;
      this.zoomBy(now.d / pinch.d, { x: now.x, y: now.y });
      pinch = now;
    }, { capture: true, passive: false });
    sc.addEventListener("touchend", (e) => { if (e.touches.length < 2) pinch = null; }, { capture: true });
  }

  // --- commands ---

  private shellCommands(): CommandDef[] {
    const s = this.session;
    const takeover = zoomTakeover();
    const base = bindCommands(SHELL_BINDINGS, {
      "shell.palette": () => this.hub.openPalette(),
      "shell.shortcuts": () => { this.hub.cheatsheet.open = !this.hub.cheatsheet.open; },
      "shell.rebind": () => { this.hub.settings.open = true; },
      "shell.howto": () => this.showHowTo(),
      "shell.labels": () => cycleLabels(),
      "shell.zoom-in": () => this.zoomBy(1.25),
      "shell.zoom-out": () => this.zoomBy(0.8),
      "shell.zoom-fit": () => this.zoomFit(),
      "shell.zen": () => this.toggleZen(),
      "shell.index": () => this.goIndex(),
    }, {
      "shell.palette": { captureInput: true },
      "shell.zoom-in": { menu: "board", keys: takeover ? ["equal", "$mod+equal", "$mod+shift+equal"] : ["equal"] },
      "shell.zoom-out": { menu: "board", keys: takeover ? ["minus", "$mod+minus"] : ["minus"] },
      "shell.zoom-fit": { menu: "board", keys: takeover ? ["$mod+0"] : [] },
      "shell.zen": { menu: "board", checked: () => this.zen },
      "shell.labels": { menu: "board" },
    });
    if (!s) return base;
    const def = s.def;
    const progress = () => s.canUndo && !s.finished;
    const confirmNew = () => (progress() ? "start a new game? this one's progress will be lost." : null);
    return [
      ...base,
      ...bindCommands(GAME_BINDINGS, {
        "shell.unlock": () => { this.unlocked = true; this.syncLock(); this.setStatus("unlocked: the board is yours to play with"); this.hub.refresh(); },
        "shell.undo": () => s.undo(),
        "shell.redo": () => s.redo(),
        "shell.restart": () => s.restart(),
        "shell.hint": () => this.showHint(),
        "shell.apply-hint": () => this.applyHint(),
        "shell.reveal": () => {
          if (!s.reveal()) {
            this.setStatus("no solution available");
            return;
          }
          this.syncSolvedStatus();
          this.saveNow();
        },
        "shell.pause": () => this.togglePause(),
        "shell.swap-buttons": () => { setButtonsSwapped(def.id, !buttonsSwapped(def.id)); s.hooks.refresh.call(); },
        "shell.new": () => this.newGameSame(),
      }, {
        "shell.unlock": { when: (c) => !!c.locked && !c.lost },
        "shell.undo": { when: (c) => !!c.canUndo && (!c.locked || !!c.lost) },
        "shell.redo": { when: (c) => !!c.canRedo && !c.locked },
        "shell.restart": {
          danger: true, when: (c) => !!c.canUndo || !!c.finished,
          confirm: () => (s.finished ? "this game is over. restarting clears it. restart anyway?" : "restart this board from the beginning?"),
        },
        "shell.hint": { when: (c) => !c.finished },
        "shell.apply-hint": { when: (c) => !c.finished },
        "shell.reveal": { danger: true, when: (c) => !c.finished && !!def.solve, confirm: () => "show the whole solution?" },
        "shell.pause": { when: (c) => !c.finished, checked: () => s.paused },
        "shell.swap-buttons": { menu: "board", when: () => !!this.view?.handle.gestures?.secondaryClick, checked: () => buttonsSwapped(def.id) },
        "shell.new": { danger: progress, confirm: confirmNew },
      }),
      ...(def.presets ?? []).map((p, i): CommandDef => ({
        id: presetCommand(i), label: `new ${def.name}: ${p.label}`, category: "new game",
        confirm: confirmNew,
        run: () => void this.newGame(def, { ...prefs.get(`params:${def.id}`, {}), ...p.params }, randomSeed()),
      })),
      ...(this.host?.plugins() ?? []).map((p): CommandDef => ({
        id: pluginToggle(p), label: p.name, category: p.category ?? "assists", description: p.description,
        checked: () => loadPluginConfig(p).enabled,
        run: () => {
          this.host!.setConfig(p, { ...loadPluginConfig(p), enabled: !loadPluginConfig(p).enabled });
          this.hub.refresh();
        },
      })),
    ];
  }

  /** What the player last pointed at on the board (ViewHandle.target), kept while they move off it (to a button). */
  aim: unknown = undefined;

  /** Re-read the view's target; fires `aim` when it changed. */
  updateAim(): void {
    const t = this.view?.handle.target?.();
    if (t === undefined || JSON.stringify(t) === JSON.stringify(this.aim)) return;
    this.aim = t;
    this.hooks.aim.call({ target: t });
  }


  /** The technique whose demo plays beside the board, if any. */
  watching: Technique | null = null;

  /** Play `t`'s demo beside the board (null: stop), placing the demo widget if it is hidden. */
  watch(t: Technique | null): void {
    this.watching = t;
    if (t) {
      const shown = inPalette(t);
      noteProgress(t, (p) => ({ ...p, watched: true }));
      if (inPalette(t) !== shown) this.hooks.palette.call();
      if ((this.layout[WATCH_WIDGET]?.slot ?? "off") === "off") this.setPlacement(WATCH_WIDGET, "side");
    }
    this.hooks.watch.call({ technique: t });
  }

  /** Keys the open game's own commands and the shell's fixed ones use, lowercased. */
  private takenKeys(): Set<string> {
    const out = new Set<string>();
    const add = (keys: readonly string[] | undefined) => { for (const k of keys ?? []) out.add(k.toLowerCase()); };
    for (const b of [...Object.values(SHELL_BINDINGS), ...Object.values(GAME_BINDINGS)] as { keys?: readonly string[] }[]) add(b.keys);
    for (const c of this.view?.handle.commands ?? []) add(c.keys);
    for (const c of this.host?.commands() ?? []) add(c.keys);
    return out;
  }

  /** The first of `candidates` no other command of this game uses, as a one-key default (or none). */
  private freeKey(candidates: readonly string[], taken: Set<string>): string[] {
    const k = candidates.find((c) => !taken.has(c));
    if (!k) return [];
    taken.add(k);
    return [k];
  }

  private techniqueCommands(): CommandDef[] {
    const th = this.techniques;
    const s = this.session;
    if (!th || !s) return [];
    const cast = this.cast;
    const taken = this.takenKeys();
    const anyAimable = th.list.some((t) => aimable(s.def, t));
    const pickerKey = this.freeKey(["e", "f", "semicolon"], taken);
    const skills = bindCommands(SKILL_BINDINGS, {
      "shell.skill-next": () => cast.pickNextHere(),
      "shell.skill-cast": () => {
        const t = cast.active() ?? cast.armed;
        if (!t) { this.setStatus("no technique picked yet"); return; }
        this.updateAim();
        cast.apply(t);
      },
      "shell.skill-drop": () => cast.pick(null),
      "shell.skill-step-next": () => cast.step(1),
      "shell.skill-step-prev": () => cast.step(-1),
      "shell.skill-swap": () => cast.swap(),
      "shell.skill-picker": (_ctx, ev) => {
        const e = ev as Event | undefined;
        if (e && (e.type === "keyup" || e.type === "mouseup")) { cast.releasePicker(); return; }
        if (e && "repeat" in e && (e as KeyboardEvent).repeat) return;
        const m = e instanceof MouseEvent ? { x: e.clientX, y: e.clientY } : undefined;
        cast.openPicker(m);
      },
      "shell.skill-watch": () => {
        const t = cast.armed;
        if (!t) { this.setStatus("no technique picked yet"); return; }
        this.watch(this.watching?.id === t.id ? null : t);
      },
    }, {
      "shell.skill-next": { when: () => !!th.list.length },
      "shell.skill-cast": { menu: "board", when: () => !!th.list.length },
      "shell.skill-drop": { when: () => !!cast.armed },
      "shell.skill-step-next": { keys: this.freeKey(["bracketright", "period"], taken) },
      "shell.skill-step-prev": { keys: this.freeKey(["bracketleft", "comma"], taken) },
      "shell.skill-swap": { menu: "board", keys: this.freeKey(["q", "backquote"], taken) },
      "shell.skill-picker": { menu: "board", keys: pickerKey.flatMap((k) => [k, `${k}:up`]), mouse: [] },
      "shell.skill-watch": { menu: "board", keys: this.freeKey(["i", "quote"], taken) },
    });
    const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].filter((d) => !taken.has(d));
    const palette = cast.palette();
    const here: CommandDef[] = anyAimable && skillPrefs.herePopup() ? bindCommands(HERE_BINDINGS, {
      "technique.here": (_ctx, ev) => {
        const list = cast.here();
        if (!list.length) { this.setStatus("no technique applies here right now"); return; }
        const pe = ev as MouseEvent | undefined;
        const x = pe?.clientX ?? innerWidth / 2, y = pe?.clientY ?? innerHeight / 2;
        const items = list.map((t) => ({ cmd: { id: techniqueCommand("here", t), label: t.name, description: t.description, run: () => cast.apply(t) } as CommandDef, enabled: true, keys: [] as string[], preview: (on: boolean) => cast.preview(on ? t : null) }));
        void popup("tiles", x, y, items, (id) => { const t = list.find((x) => techniqueCommand("here", x) === id); if (t) cast.apply(t); });
      },
    }, { "technique.here": { menu: "board" } }) : [];
    return [...skills, ...here, ...th.list.flatMap((t): CommandDef[] => {
      const slot = palette.findIndex((x) => x.id === t.id);
      return [
        { id: techniqueCommand("pick", t), label: `pick ${t.name}`, category: "techniques", keys: slot >= 0 && digits[slot] ? [digits[slot]!] : [], run: () => { if (cast.armed?.id !== t.id) cast.pick(t); } },
        ...(aimable(s.def, t) ? [{ id: techniqueCommand("here", t), label: `${t.name} here`, category: "techniques", description: `apply ${t.name} to what you are pointing at`, run: () => { this.updateAim(); cast.apply(t); } } satisfies CommandDef] : []),
        { id: techniqueCommand("find", t), label: `find ${t.name}`, category: "techniques", description: t.description, run: () => this.findTechnique(t) },
        { id: techniqueCommand("apply", t), label: `apply ${t.name}`, category: "techniques", run: () => { if (!th.apply(t)) this.setStatus(`no ${t.name} right now`); } },
        {
          id: techniqueCommand("auto", t), label: `auto-apply ${t.name}`, category: "techniques",
          checked: () => th.config(t).auto,
          run: () => { th.setConfig(t, { ...th.config(t), auto: !th.config(t).auto }); this.hub.refresh(); },
        },
        ...(t.practice === false ? [] : [{ id: techniqueCommand("practice", t), label: `practice ${t.name}`, category: "practice", run: () => void this.startPractice(s.def, t, randomSeed()) } satisfies CommandDef]),
      ];
    })];
  }

  private widgetCommands(): CommandDef[] {
    return this.widgetDefs().map((w): CommandDef => ({
      id: widgetToggle(w), label: `show ${w.name}`, category: "layout", description: w.description,
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
    if (!s || s.finished) return;
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
    const hint = s.origin.kind === "practice" ? s.showHint(this.lessonHint()) : s.showHint();
    if (!hint) {
      this.setStatus("no hint available");
      return;
    }
    const ht = hint.technique ? this.techniques?.list.find((x) => x.id === hint.technique) : undefined;
    if (ht && s.origin.kind !== "practice") rememberPosition(ht, s.def.id, s.puzzle, s.state);
    s.hooks.fx.call({ kind: "hint", focus: hint.focus });
    this.setStatus(hint.message);
  }

  applyHint(): void {
    const s = this.session;
    if (!s || s.finished) return;
    const hint = s.activeHint ?? (s.origin.kind === "practice" ? this.lessonHint() : s.hint());
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

  /** Instances of the lesson still to do on `state`. */
  private lessonLeft(state: unknown): Step[] {
    const s = this.session;
    return s?.origin.kind === "practice" ? stepsLeft(s.def, s.puzzle, s.origin.start, state, this.lesson) : [];
  }

  /** On a practice board: a nudge toward an instance of the practiced technique still to do. */
  lessonHint(): Hint<any> | null {
    const s = this.session;
    if (s?.origin.kind !== "practice") return null;
    const id = s.origin.technique;
    const t = this.techniques?.list.find((x) => x.id === id);
    const next = this.lessonLeft(s.state)[0];
    return t && next ? hintFrom(t, next, 1) as Hint<any> : null;
  }

  /** A lesson asks for every instance: a player move must be part of one still left, and it ends when none are. */
  private checkPractice(ctx: { cause: string; source?: { kind: string }; prev: unknown; state: unknown }): void {
    const s = this.session;
    if (!s || s.origin.kind !== "practice" || ctx.cause !== "action") return;
    const byPlayer = ctx.source?.kind === "player";
    if (byPlayer && !isPartOfStep(s.def, s.puzzle, ctx.prev, ctx.state, this.lessonLeft(ctx.prev))) {
      s.hooks.fx.call({ kind: "practice", correct: false, done: false });
      this.keepStatus = true;
      queueMicrotask(() => s.undo());
      this.setStatus("not that one. look again");
      return;
    }
    const left = this.lessonLeft(ctx.state).length;
    if (!byPlayer && left > 0) return;
    s.hooks.fx.call({ kind: "practice", correct: true, done: left === 0 });
    this.setStatus(left === 0 ? "that's all of them!" : `yes. ${left} more to find`);
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
      revealed: s.outcome === "revealed",
      elapsedMs: s.finishedAtMs ?? s.elapsedMs(),
      practice: s.origin.kind === "practice",
    }, s.snapshot());
    this.hooks.sessions.call();
  }

  /** Forget a saved game; closing the open one returns to the game list. */
  closeSession(id: string): void {
    this.deleteSessions([id]);
  }

  /** Delete saved games; if the open one is among them, go back to the game list. */
  deleteSessions(ids: readonly string[]): void {
    if (ids.includes(this.sessionId)) this.goIndex();
    for (const id of ids) removeSession(id);
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
      top: h("div", { class: "sh-slot sh-slot-top" }),
      middle: h("div", { class: "middle" }),
      boardbox: h("div", { class: "boardbox" }),
      boardwrap: h("div", { class: "boardwrap" }),
      scroller: h("div", { class: "board-scroller" }),
      overlay: h("div", { class: "sh-slot sh-slot-overlay" }),
      menuBtn: h("button", {
        class: "board-menu-btn", "aria-label": "board menu", "data-tip": "everything you can do on the board", hidden: true,
        onclick: (e: MouseEvent) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          this.openBoardMenu(r.left, r.bottom, (e as PointerEvent).pointerType === "touch" ? "touch" : "mouse");
        },
      }, "⋯"),
      side: h("div", { class: "sh-slot sh-slot-side" }),
      bottom: h("div", { class: "sh-slot sh-slot-bottom" }),
      panel: h("aside", { class: "panel" }),
      tabs: h("div", { class: "tabs", role: "tablist" }),
      panelBody: h("div", { class: "panel-body" }),
      index: h("div", { class: "index-wrap" }),
    };
    add(els.header,
      h("a", { href: "/", class: "home", title: "ptera.world" }, "ptera"),
      h("a", { href: location.pathname, class: "crumb", "data-command": command("shell.index"), onclick: (ev: MouseEvent) => { ev.preventDefault(); this.goIndex(); } }, "games"),
      els.title, els.meta, h("span", { class: "spacer" }),
      this.safe ? h("a", { class: "safe-mark", href: location.pathname, title: "safe mode: only the built-in packs are loaded, all switched on. your pack settings are untouched" }, "safe mode · leave") : null,
      els.pauseMark, els.timer,
      h("button", { class: "howto-btn", "data-command": command("shell.howto"), "aria-label": "how to play", onclick: () => this.hub.run(command("shell.howto")) }, "?"),
      h("button", { class: "palette-btn", "data-command": command("shell.palette"), onclick: () => this.hub.openPalette() }, "commands"));
    els.scroller.append(els.boardbox);
    els.boardwrap.append(els.scroller, els.overlay, els.menuBtn);
    els.middle.append(els.boardwrap, els.side);
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
    let active = prefs.get("indexTag", null);
    if (active && !tags.includes(active)) active = null;
    const filters = h("div", { class: "index-tags", role: "group", "aria-label": "filter by tag" });
    const search = h("input", { type: "search", placeholder: "search games", "aria-label": "search games", class: "index-search", oninput: () => render() });
    const list = h("ul", { class: "index" });
    const render = () => {
      clear(filters);
      if (tags.length) {
        for (const tag of [null, ...tags]) {
          filters.append(h("button", {
            "aria-pressed": String(tag === active), class: tag ? "tag" : undefined, style: tag ? tagStyle(tag) : undefined,
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
      const n = this.registry.techniquesFor(def).length;
      const p = encodeURIComponent(def.id);
      return h("li", null,
        h("a", { href: `?p=${p}`, class: "card", onclick: go(`p=${p}`) },
          h("strong", null, def.name),
          def.aliases?.length ? h("em", { class: "aka" }, `also: ${def.aliases.join(", ")}`) : null,
          def.description ? h("span", null, def.description) : null),
        def.tags?.length ? h("span", { class: "tags" }, def.tags.map((tag) => h("span", { class: "tag", style: tagStyle(tag) }, tag))) : null,
        n ? h("a", { href: `?p=${p}&tab=techniques`, class: "learn", onclick: go(`p=${p}&tab=techniques`) }, `learn · ${n} techniques`) : null);
    }).map((el, i) => ({ el, def: all[i]! }));
    const resume = h("aside", { class: "index-continue", "aria-label": "games in progress" }, h("h2", null, "continue"),
      sessionList(this, { filter: (m) => !finished(m) && !m.practice, limit: 12, tools: false, empty: "nothing in progress." }));
    this.els.index.append(h("div", { class: "index-inner" }, h("div", { class: "index-main" }, search, filters, list), resume));
    render();
    this.hub.refresh();
  }

  private renderHeader(): void {
    const s = this.session;
    if (!s) return;
    this.els.title.textContent = s.def.name;
    const bits: string[] = [];
    if (s.origin.kind === "practice") {
      const t = this.registry.techniquesFor(s.def).find((x) => x.id === (s.origin as { technique: string }).technique);
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
    const time = formatTime(s.finishedAtMs ?? s.elapsedMs());
    this.els.timer.textContent = hide && !s.finished ? "" : time;
    this.els.pauseMark.textContent = s.outcome ?? "paused";
    this.els.pauseMark.classList.toggle("on", s.finished || !s.running);
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
      this.setStatus(s.origin.kind === "practice" ? "solved" : `solved in ${formatTime(s.finishedAtMs!)}`);
    } else if (s.finished) {
      delete this.root.dataset.solved;
      this.root.removeAttribute("data-paused");
      this.setStatus("answer revealed");
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
.board-scroller { position: absolute; inset: 0; overflow: hidden; display: flex; }
.boardwrap[data-zoomed] .board-scroller { overflow: auto; overscroll-behavior: contain; }
.board-scroller > .boardbox { margin: auto; }
.boardbox { position: relative; flex: none; display: flex; align-items: center; justify-content: center; }
.sh-slot-overlay { position: absolute; inset: 0; pointer-events: none; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; padding: 10px; }
.sh-slot-overlay > .widget { pointer-events: auto; }
.board-menu-btn { position: absolute; top: 4px; right: 4px; z-index: 2; width: 30px; height: 30px; padding: 0; border-radius: 99px; font-size: 16px; line-height: 1; opacity: 0.8; }
.board-menu-btn:hover, .board-menu-btn:focus-visible { opacity: 1; }
[data-lost] .boardbox { box-shadow: 0 0 0 3px var(--danger); border-radius: 10px; }
[data-solved] .boardbox { box-shadow: 0 0 0 3px var(--accent); border-radius: 10px; }
.boardbox > .view { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
.sh-slot { display: flex; flex-direction: column; gap: 10px; }
.sh-slot:empty { display: none; }
.sh-slot-top, .sh-slot-bottom { width: 100%; align-items: center; }
.sh-slot-top > .widget, .sh-slot-bottom > .widget { width: 100%; display: flex; justify-content: center; }
.sh-slot-side { width: 240px; flex: none; }
.stage[data-side="below"] .sh-slot-side { width: min(100%, 520px); }

.panel { width: 320px; flex: none; border-left: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0; }
.stage[data-panel="below"] .panel { width: auto; border-left: none; border-top: 1px solid var(--border); min-height: auto; }
#games:not([data-has-panel]) .panel { display: none; }
.tabs { display: flex; flex-wrap: wrap; border-bottom: 1px solid var(--border); flex: none; }
.tabs button { border: none; border-radius: 0; background: none; padding: 10px 12px; color: var(--text-dim); white-space: nowrap; }
.tabs button[aria-selected="true"] { color: var(--text); box-shadow: inset 0 -2px var(--accent); }
.panel-body { flex: 1; overflow-y: auto; padding: 12px 16px 24px; }
.panel-body > .widget { display: flex; flex-direction: column; gap: 10px; }

[data-paused] .boardbox .view { filter: blur(14px); pointer-events: none; }
[data-zen] .sh-slot-top, [data-zen] .sh-slot-side, [data-zen] .sh-slot-bottom, [data-zen] .panel, [data-zen] .bar .meta { display: none; }
[data-mode="index"] .stage { display: none; }
#games:not([data-mode="index"]) .index-wrap { display: none; }
.index-wrap { padding: 16px; display: flex; justify-content: center; }
.index-inner { width: 100%; max-width: 1240px; display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 20px; align-items: start; }
.index-main { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
@media (max-width: 760px) { .index-inner { grid-template-columns: minmax(0, 1fr); } }
.index-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.index-tags:empty { display: none; }
.index-tags button { padding: 3px 10px; font-size: 13px; border-radius: 99px; }
.index-tags button[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); }
.index-search { max-width: 320px; }
.index-continue { display: flex; flex-direction: column; gap: 6px; position: sticky; top: 16px; }
.index-continue h2, .index-main > h2 { font-size: 13px; color: var(--text-dim); letter-spacing: .06em; font-weight: normal; }
.index .aka { font-size: 12px; color: var(--text-dim); font-style: normal; }
.index .tags { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 14px 10px; }
.tag { font-size: 11px; padding: 1px 7px; border-radius: 99px; color: var(--tag-ink); background: var(--tag-bg); border: 1px solid var(--tag-line); }
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
