import type { CommandContext, CommandDef } from "./types";

/**
 * Command ids, derived from the binding schemas that define them, so a hand-written id is type
 * checked: `declare module "…/core/commands" { interface CommandNames extends Ids<typeof BINDINGS> {} }`.
 */
export interface CommandNames {}

declare const family: unique symbol;
/** An id built from runtime data by a `commandFamily` constructor; a hand-written string never is one. */
export type FamilyId = string & { readonly [family]: true };

export type CommandId = (keyof CommandNames & string) | FamilyId;

/** The keys of `S` as `CommandNames` members. */
export type Ids<S> = { [K in keyof S & string]: true };

/**
 * Commands keyed by runtime data (a technique, a preset, a plugin): the returned function is the
 * one place their ids are built, for the definitions and for anything that runs them.
 */
export const commandFamily = <A>(prefix: string, key: (a: A) => string) => (a: A): FamilyId => `${prefix}${key(a)}` as FamilyId;

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

/** `<prefix><item>` for every item of a fixed list. */
export type Over<P extends string, L extends readonly (string | number)[]> = `${P}${L[number]}`;

/** One binding per item of a fixed list, with ids `<prefix><item>`. */
export function bindingsOver<P extends string, const L extends readonly (string | number)[]>(
  prefix: P, list: L, make: (item: L[number]) => Binding,
): Record<Over<P, L>, Binding> {
  return Object.fromEntries(list.map((x) => [`${prefix}${x}`, make(x)])) as Record<Over<P, L>, Binding>;
}

/** Handlers for `bindingsOver(prefix, list, …)`. */
export function handlersOver<P extends string, const L extends readonly (string | number)[]>(
  prefix: P, list: L, make: (item: L[number]) => CommandHandler,
): Record<Over<P, L>, CommandHandler> {
  return Object.fromEntries(list.map((x) => [`${prefix}${x}`, make(x)])) as Record<Over<P, L>, CommandHandler>;
}

/** Extras for `bindingsOver(prefix, list, …)`. */
export function extrasOver<P extends string, const L extends readonly (string | number)[]>(
  prefix: P, list: L, make: (item: L[number]) => Partial<CommandDef>,
): Record<Over<P, L>, Partial<CommandDef>> {
  return Object.fromEntries(list.map((x) => [`${prefix}${x}`, make(x)])) as Record<Over<P, L>, Partial<CommandDef>>;
}

export type CommandHandler = (ctx: CommandContext, event?: Event) => unknown;

/** One command per schema entry; every entry needs a handler, and extras may only name entries. */
export function bindCommands<K extends string>(
  schema: string extends K ? "a schema typed as plain BindingSchema has no checkable ids" : { readonly [k in K]: Binding },
  handlers: { readonly [k in K]: CommandHandler },
  extra: { readonly [k in K]?: Partial<CommandDef> } = {},
): CommandDef[] {
  const s = schema as { readonly [k in K]: Binding };
  return (Object.keys(s) as K[]).map((id) => ({ id, ...s[id], ...extra[id], run: handlers[id] }));
}

type OneBased<L extends readonly unknown[], Acc extends unknown[] = []> =
  L extends readonly [unknown, ...infer R] ? [[...Acc, unknown]["length"], ...OneBased<R, [...Acc, unknown]>] : [];

/** 1 … list.length, typed as that tuple of literals, for families numbered by a fixed list's positions. */
export const oneBased = <const L extends readonly unknown[]>(list: L): OneBased<L> =>
  list.map((_, i) => i + 1) as unknown as OneBased<L>;
