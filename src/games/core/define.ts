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

/**
 * A puzzle's features as named tests; `features(puzzle)` lists the names whose test passes.
 * The names are the record's keys, so `FeatureNames` can be derived from it.
 */
export const featureTests = <Pz, const F extends Record<string, (puzzle: Pz) => boolean>>(tests: F) =>
  (puzzle: Pz): (keyof F & string)[] => (Object.keys(tests) as (keyof F & string)[]).filter((k) => tests[k]!(puzzle));
