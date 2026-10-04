import type { Schema } from "./schema";
import type { Action, Plugin, View, WidgetDef } from "./types";

/**
 * Typed constructors: fix the puzzle's types once, then each definition's settings type is
 * inferred from its `settings` schema, so reading a setting the schema lacks is a type error.
 */
export const definePlugins = <Pz, S, A extends Action = any, I = any>() =>
  <P extends Schema = {}>(p: Plugin<Pz, S, A, I, P>): Plugin<Pz, S, A, I, P> => p;

export const defineViews = <Pz, S, A extends Action = any, I = any>() =>
  <P extends Schema = {}>(v: View<Pz, S, A, I, P>): View<Pz, S, A, I, P> => v;

export const defineWidgets = <Pz, S, A extends Action = any, I = any>() =>
  <P extends Schema = {}>(w: WidgetDef<Pz, S, A, I, P>): WidgetDef<Pz, S, A, I, P> => w;
