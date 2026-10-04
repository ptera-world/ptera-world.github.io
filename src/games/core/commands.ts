import type { CommandDef } from "./types";

/** Binding defaults keyed by command id (same shape as the keybinds package's schema). */
export type BindingSchema = Record<string, {
  label: string;
  category?: string;
  description?: string;
  keys?: string[];
  mouse?: string[];
  hidden?: boolean;
}>;

export type CommandHandler = (ctx: Record<string, unknown>, event?: Event) => unknown;

/** Commands from a binding schema plus handlers keyed by the same ids. Ids missing from either side are dropped. */
export function bindCommands(
  schema: BindingSchema,
  handlers: Record<string, CommandHandler>,
  extra: Record<string, Partial<CommandDef>> = {},
): CommandDef[] {
  return Object.entries(handlers).flatMap(([id, run]) => {
    const b = schema[id];
    return b ? [{ id, ...b, ...extra[id], run }] : [];
  });
}
