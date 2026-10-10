import { commandFamily, type BindingSchema, type CommandId, type Ids } from "../../core/commands";
import type { ConfirmPolicy } from "./commands";
import type { SurfaceStyle } from "./surfaces";

/** Commands that exist whenever the shell runs. */
export const SHELL_BINDINGS = {
  "shell.palette": { label: "commands", category: "general", keys: ["$mod+k"] },
  "shell.shortcuts": { label: "keyboard shortcuts", category: "general", keys: ["$mod+slash"] },
  "shell.rebind": { label: "change key bindings", category: "general" },
  "shell.howto": { label: "how to play", category: "general", keys: ["f1"], description: "what this puzzle is, its rules, and how to play it" },
  "shell.labels": { label: "board labels", category: "view", keys: ["l"], description: "letters and numbers along the board edges, so cells named in hints (like C5) are easy to find. cycles off / top+left / all sides" },
  "shell.zoom-in": { label: "zoom in", category: "view", description: "make the board bigger (it scrolls when bigger than the screen). also pinch on the board" },
  "shell.zoom-out": { label: "zoom out", category: "view", description: "make the board smaller, down to fitting the screen" },
  "shell.zoom-fit": { label: "fit board", category: "view", description: "show the whole board at once" },
  "shell.zen": { label: "zen mode", category: "view", keys: ["z"], description: "just the board; press again to bring everything back" },
  "shell.index": { label: "all puzzles", category: "general" },
} satisfies BindingSchema;

/** Commands that exist while a game is open. */
export const GAME_BINDINGS = {
  "shell.unlock": { label: "unlock board", category: "game", description: "keep playing with a finished board (moves, undo). the solve time is kept as it was" },
  "shell.undo": { label: "undo", category: "game", keys: ["$mod+z", "u"], description: "take back the last step" },
  "shell.redo": { label: "redo", category: "game", keys: ["$mod+shift+z", "$mod+y", "r"], description: "put back a step you undid" },
  "shell.restart": { label: "restart", category: "game" },
  "shell.hint": { label: "hint", category: "game", keys: ["shift+slash"], description: "press again for more detail" },
  "shell.apply-hint": { label: "apply hint", category: "game", keys: ["shift+h"] },
  "shell.reveal": { label: "reveal solution", category: "game" },
  "shell.pause": { label: "pause", category: "game", keys: ["p"] },
  "shell.new": { label: "new game", category: "game", keys: ["$mod+Enter"] },
} satisfies BindingSchema;

/** Exists while some technique of the open game can be aimed. */
export const HERE_BINDINGS = {
  "technique.here": { label: "use a technique here", category: "techniques", description: "the techniques that apply where you are pointing; point at one to preview, pick it to apply" },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof SHELL_BINDINGS>, Ids<typeof GAME_BINDINGS>, Ids<typeof HERE_BINDINGS> {}
}

export type TechniqueCommand = "apply" | "auto" | "find" | "here" | "practice";
const techniqueFamilies = {
  apply: commandFamily("technique.apply.", (t: { id: string }) => t.id),
  auto: commandFamily("technique.auto.", (t: { id: string }) => t.id),
  find: commandFamily("technique.find.", (t: { id: string }) => t.id),
  here: commandFamily("technique.here.", (t: { id: string }) => t.id),
  practice: commandFamily("technique.practice.", (t: { id: string }) => t.id),
} satisfies Record<TechniqueCommand, unknown>;

export const techniqueCommand = (kind: TechniqueCommand, t: { id: string }): CommandId => techniqueFamilies[kind](t);
/** Index into the open puzzle's presets. */
export const presetCommand = commandFamily("shell.preset-", (i: number) => String(i));
export const pluginToggle = commandFamily("toggle.", (p: { id: string }) => p.id);
export const widgetToggle = commandFamily("widget.", (w: { id: string }) => w.id);

declare module "../../core/storage" {
  interface Prefs {
    confirm: ConfirmPolicy;
    explainerPace: number;
    hideTimer: boolean;
    holdShortcuts: number;
    indexTag: string | null;
    lockSolved: boolean;
    minCell: number;
    replaySpeed: number;
    tab: string;
    tipDelay: number;
    zoomTakeover: boolean;
    [k: `guideSeen:${string}`]: boolean;
    [k: `howtoSeen:${string}`]: boolean;
    [k: `menuStyle:${string}`]: SurfaceStyle;
    [k: `params:${string}`]: Record<string, unknown>;
    [k: `view:${string}`]: string | null;
    [k: `viewcfg:${string}`]: Record<string, unknown>;
    [k: `widget:${string}`]: Record<string, unknown>;
  }
}

/** The how-to-play widget, and the event that opens or closes it. */
export const HOWTO_WIDGET = "howto";
export const HOWTO_TOGGLE = "howto-toggle";

/** A command id written in code, checked against the declared ids. */
export const command = <K extends CommandId>(id: K): K => id;

/** The keys the shell puts in every command's `when` context. */
export interface ShellContext {
  hasSession: boolean;
  /** The game has ended, solved or revealed. */
  finished: boolean;
  locked: boolean;
  lost: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hint: boolean;
  practice: boolean;
}

declare module "../../core/types" {
  interface CommandContext extends Partial<ShellContext> {}
}
