import type { CommandId } from "../../core/commands";
import type { CommandDef } from "../../core/types";
import type { ConfirmPolicy } from "./commands";
import type { SurfaceStyle } from "./surfaces";

export type TechniqueCommand = "apply" | "auto" | "find" | "here" | "practice";

declare module "../../core/commands" {
  interface CommandNames {
    "shell.palette": true;
    "shell.shortcuts": true;
    "shell.rebind": true;
    "shell.howto": true;
    "shell.labels": true;
    "shell.zoom-in": true;
    "shell.zoom-out": true;
    "shell.zoom-fit": true;
    "shell.zen": true;
    "shell.index": true;
    "shell.unlock": true;
    "shell.undo": true;
    "shell.redo": true;
    "shell.restart": true;
    "shell.hint": true;
    "shell.apply-hint": true;
    "shell.reveal": true;
    "shell.pause": true;
    "shell.new": true;
    "technique.here": true;
    [id: `shell.preset-${number}`]: true;
    [id: `technique.${TechniqueCommand}.${string}`]: true;
  }
}

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

export const techniqueCommand = (kind: TechniqueCommand, t: { id: string }): CommandId => `technique.${kind}.${t.id}`;

/** The keys the shell puts in every command's `when` context; views may add more. */
export interface ShellContext {
  hasSession: boolean;
  solved: boolean;
  locked: boolean;
  lost: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hint: boolean;
  practice: boolean;
  [key: string]: unknown;
}

/** A shell command: its id is declared above, and `when` sees the shell's context keys. */
export type ShellCommandDef = Omit<CommandDef, "id" | "when"> & {
  id: CommandId;
  when?(ctx: ShellContext): boolean;
};
