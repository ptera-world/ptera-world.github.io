import type { CommandDef } from "./types";

/**
 * Command ids, declared by the packs that define them so a hand-written id is type checked:
 * `declare module "…/core/commands" { interface CommandNames extends Ids<typeof BINDINGS> {} }`.
 */
export interface CommandNames {}
export type CommandId = keyof CommandNames & string;

/** The keys of `S` as `CommandNames` members. */
export type Ids<S> = { [K in keyof S & string]: true };

export interface Binding {
  label: string;
  category?: string;
  description?: string;
  keys?: string[];
  mouse?: string[];
  hidden?: boolean;
}

/** Binding defaults keyed by command id (same shape as the keybinds package's schema). */
export type BindingSchema = Record<string, Binding>;

export type CommandHandler = (ctx: Record<string, unknown>, event?: Event) => unknown;

/**
 * One command per handler, labelled from the schema. With literal ids every handler and extra
 * must name a schema entry; an entry without a handler is a command left out on purpose.
 */
export function bindCommands<K extends string>(
  schema: { readonly [k in K]: Binding },
  handlers: { readonly [k in K]?: CommandHandler },
  extra: { readonly [k in K]?: Partial<CommandDef> } = {},
): CommandDef[] {
  return (Object.keys(handlers) as K[]).flatMap((id) => {
    const b = schema[id], run = handlers[id];
    return b && run ? [{ id, ...b, ...extra[id], run }] : [];
  });
}
