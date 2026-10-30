import {
  CommandHub as KeybindsHub,
  CommandPalette,
  ContextMenu,
  KeybindCheatsheet,
  KeybindSettings,
  aliases,
  fuzzyMatcher,
  keysUI,
  mouseUI,
  releases,
  symbols,
  type Command,
} from "keybinds";
import { KEYBINDS_CSS } from "./keybinds-theme";
import type { CommandContext, CommandDef } from "../../core/types";
import { bindCommands } from "../../core/commands";
import { confirmDialog } from "./dialog";
import { style } from "../../core/dom";
import { prefs } from "../../core/storage";

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

export { bindCommands };

/**
 * A games command as keybinds runs it. Every trigger (key, palette, menu, button) goes through
 * here, so confirmation is uniform; a run() returning false (with no confirmation pending) lets
 * the key/mouse event through.
 */
function toCommand(c: CommandDef): Command {
  return {
    id: c.id,
    label: c.checked ? `${c.checked() ? "☑" : "☐"} ${c.label}` : c.label,
    description: c.description,
    category: c.category,
    keys: c.keys,
    mouse: c.mouse,
    when: c.when as Command["when"],
    hidden: c.hidden,
    captureInput: c.captureInput,
    menu: c.menu,
    execute: (ctx, ev) => {
      const q = shouldConfirm(c);
      if (!q) return c.run(ctx as CommandContext, ev);
      void confirmDialog(q, c.label, isDanger(c)).then((ok) => ok && c.run(ctx as CommandContext, ev));
      return undefined;
    },
  };
}

/**
 * Every command on the page, from every source, with one rebindable binding store per scope
 * (e.g. per puzzle, so the same key can mean different things per puzzle). keybinds' CommandHub,
 * with games commands' confirmation, danger and toggles.
 */
export class CommandHub extends KeybindsHub<CommandDef, CommandContext> {
  declare readonly palette: CommandPalette;
  declare readonly cheatsheet: KeybindCheatsheet;
  declare readonly settings: KeybindSettings;
  declare readonly menu: ContextMenu;

  /** A command's key bindings as shown to people (e.g. "Ctrl+Z"). */
  keysFor(id: string): string[] {
    return this.bindingsFor(id, "keys");
  }

  /** A command's mouse bindings as shown to people (e.g. "Ctrl+Click"). */
  mouseFor(id: string): string[] {
    return this.bindingsFor(id, "mouse");
  }

  constructor(host: HTMLElement) {
    style("keybinds", KEYBINDS_CSS);
    super({
      storageKey: "games:keys", host, adapt: toCommand,
      // the keyboard (with "?"-style symbols and "up"-style names) and the mouse, both shown and rebindable
      inputs: [keysUI(symbols(), aliases()), mouseUI()],
      components: [CommandPalette, KeybindCheatsheet, KeybindSettings, ContextMenu],
      // the technique picker binds a key's release as well as its press ("f" and "f:up")
      releases: releases(),
    });
    this.palette.matcher = fuzzyMatcher as CommandPalette["matcher"];
  }
}
