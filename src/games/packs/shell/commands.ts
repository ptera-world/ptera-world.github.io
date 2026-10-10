import {
  BindingsStore,
  formatKeyParts,
  formatMouseParts,
  fuzzyMatcher,
  keybinds,
  validateCommands,
  type Command,
  type CommandPalette,
  type ContextMenu,
  type KeybindCheatsheet,
  type KeybindSettings,
} from "keybinds";
import { KEYBINDS_CSS } from "./keybinds-theme";
import { keybindElement } from "../../../keybind-elements";
import type { CommandContext, CommandDef } from "../../core/types";
import { bindCommands, type BindingSchema } from "../../core/commands";
import { confirmDialog } from "./dialog";
import { style } from "../../core/dom";
import { prefs } from "../../core/storage";


const KEY_GLYPHS: Record<string, string> = { SLASH: "/", COMMA: ",", PERIOD: ".", MINUS: "-", EQUAL: "=", SEMICOLON: ";", QUOTE: "'", BACKQUOTE: "`", BRACKETLEFT: "[", BRACKETRIGHT: "]", BACKSLASH: "\\" };
const prettyKey = (p: string): string => KEY_GLYPHS[p.toUpperCase()] ?? p;

export type ConfirmPolicy = "danger" | "always" | "never";

export const isDanger = (c: CommandDef): boolean => (typeof c.danger === "function" ? c.danger() : !!c.danger);

/** Whether a command's confirm question is asked, per the player's setting. */
function shouldConfirm(c: CommandDef): string | null {
  const policy = prefs.get("confirm", "danger");
  if (policy === "never" || !c.confirm) return null;
  const q = c.confirm();
  if (!q) return null;
  return policy === "always" || isDanger(c) ? q : null;
}

type Schema = BindingSchema;
export { bindCommands };

/**
 * Every command on the page, from every source, with one rebindable binding store per scope.
 * Sources are functions so they're re-read on refresh() (commands can depend on live state).
 * Earlier sources win on id clashes.
 */
export class CommandHub {
  private sources: { owner: string; get: () => CommandDef[] }[] = [];
  private unbind: (() => void) | null = null;
  private store: BindingsStore<Schema> | null = null;
  private storeListener = () => this.refresh();
  private defs = new Map<string, CommandDef>();
  private live: Command[] = [];
  private contextSources: (() => Partial<CommandContext>)[] = [];
  readonly palette: CommandPalette;
  readonly cheatsheet: KeybindCheatsheet;
  readonly settings: KeybindSettings;
  readonly menu: ContextMenu;
  private scope = "global";

  constructor(host: HTMLElement) {
    style("keybinds", KEYBINDS_CSS);
    this.palette = keybindElement("command-palette");
    this.palette.matcher = fuzzyMatcher as CommandPalette["matcher"];
    this.cheatsheet = keybindElement("keybind-cheatsheet");
    this.settings = keybindElement("keybind-settings");
    this.menu = keybindElement("context-menu");
    host.append(this.palette, this.cheatsheet, this.settings, this.menu);
  }

  /** Replace all sources owned by `owner`. */
  setSource(owner: string, get: (() => CommandDef[]) | null): void {
    this.sources = this.sources.filter((s) => s.owner !== owner);
    if (get) this.sources.push({ owner, get });
  }

  addContext(get: () => Partial<CommandContext>): () => void {
    this.contextSources.push(get);
    return () => {
      this.contextSources = this.contextSources.filter((g) => g !== get);
    };
  }

  context(): CommandContext {
    return Object.assign({}, ...this.contextSources.map((g) => g()));
  }

  /** Bindings are stored per scope (e.g. per puzzle), so the same key can mean different things per puzzle. */
  setScope(scope: string): void {
    this.scope = scope;
  }

  all(): CommandDef[] {
    return [...this.defs.values()];
  }

  get(id: string): CommandDef | undefined {
    return this.defs.get(id);
  }

  run(id: string, event?: Event): boolean {
    const cmd = this.defs.get(id);
    if (!cmd) return false;
    const ctx = this.context();
    if (cmd.when && !cmd.when(ctx)) return false;
    void this.execute(cmd, ctx, event);
    return true;
  }

  /** Every trigger (key, palette, menu, button) goes through here, so confirmation is uniform. */
  private async execute(cmd: CommandDef, ctx: CommandContext, event?: Event): Promise<void> {
    const q = shouldConfirm(cmd);
    if (q && !(await confirmDialog(q, cmd.label, isDanger(cmd)))) return;
    cmd.run(ctx, event);
  }

  /** Re-read sources, rebuild bindings and re-attach dispatch. Call when sources change. */
  refresh(): void {
    this.defs.clear();
    for (const src of this.sources) {
      let list: CommandDef[] = [];
      try {
        list = src.get();
      } catch (e) {
        console.error(`[games] command source ${src.owner} threw`, e);
      }
      for (const c of list) if (!this.defs.has(c.id)) this.defs.set(c.id, c);
    }

    const schema: Schema = {};
    for (const c of this.defs.values()) {
      schema[c.id] = { label: c.label, category: c.category, description: c.description, keys: c.keys ?? [], mouse: c.mouse, hidden: c.hidden };
    }
    this.store?.removeEventListener("change", this.storeListener);
    this.store = new BindingsStore(schema, `games:keys:${this.scope}`);
    this.store.addEventListener("change", this.storeListener);
    const bound = this.store.get();

    this.live = [...this.defs.values()].flatMap((c): Command[] => {
      const b = bound[c.id]!;
      const cmd: Command = {
        id: c.id, label: c.checked ? `${c.checked() ? "☑" : "☐"} ${c.label}` : c.label,
        description: c.description, category: c.category, keys: b.keys, mouse: b.mouse,
        when: c.when, hidden: c.hidden, captureInput: c.captureInput, menu: c.menu,
        // a run() returning false (with no confirmation pending) lets the key/mouse event through
        execute: (ctx, ev) => {
          if (!shouldConfirm(c)) return c.run(ctx, ev);
          void this.execute(c, ctx, ev);
          return undefined;
        },
      };
      try {
        validateCommands([cmd]);
        return [cmd];
      } catch (e) {
        console.error(`[games] dropping bindings of "${c.id}"`, e);
        return [{ ...cmd, keys: [], mouse: [] }];
      }
    });

    this.unbind?.();
    this.unbind = keybinds(this.live.filter((c) => c.keys?.length || c.mouse?.length), () => this.libContext());
    const visible = this.live.filter((c) => !c.hidden);
    this.palette.commands = visible;
    this.cheatsheet.commands = visible;
    this.menu.commands = this.live;
    this.settings.store = this.store;
    this.syncContext();
  }

  /** The keybinds package takes the context as a plain record and hands it back to `when`/`run`. */
  private libContext(): Record<string, unknown> {
    return this.context() as Record<string, unknown>;
  }

  /** Push current context into components so `when` greys out unavailable commands. */
  syncContext(): void {
    const ctx = this.libContext();
    this.palette.context = ctx;
    this.cheatsheet.context = ctx;
    this.menu.context = ctx;
  }

  openPalette(): void {
    this.refresh();
    this.palette.open = true;
  }

  openMenu(tag: string, x: number, y: number): void {
    this.syncContext();
    this.menu.menu = tag;
    this.menu.position = { x, y };
    this.menu.open = true;
  }

  /** Keys currently bound to a command, as shown to people (e.g. "Ctrl+Z"). */
  keysFor(id: string): string[] {
    return (this.live.find((c) => c.id === id)?.keys ?? []).map((k) => formatKeyParts(k).map(prettyKey).join("+"));
  }

  /** Mouse bindings as shown to people (e.g. "Right click"). */
  mouseFor(id: string): string[] {
    return (this.live.find((c) => c.id === id)?.mouse ?? []).map((m) => formatMouseParts(m).join("+"));
  }

  destroy(): void {
    this.unbind?.();
    this.store?.removeEventListener("change", this.storeListener);
  }
}
