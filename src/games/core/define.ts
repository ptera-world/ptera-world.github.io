import type { Schema } from "./schema";
import type { Action, Hint, Plugin, Step, Technique, View, WidgetDef } from "./types";

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

/**
 * Level 1 (nudge) carries level 2 (full) in `more`; level 2 alone when asked directly. With no
 * technique (a puzzle's own fallback hint, e.g. a solver's next move) the texts carry no name.
 */
export function hintFrom<A extends Action>(t: Technique<any, any, A> | null, step: Step<A>, level: number): Hint<A> {
  const named = (text: string) => (t ? `${t.name}: ${text}` : text);
  const full: Hint<A> = { message: named(step.message), focus: step.focus, technique: t?.id, level: 2, actions: step.actions };
  if (level >= 2) return full;
  return {
    message: step.nudge ? named(step.nudge) : t ? `try a ${t.name}` : step.message,
    focus: t || step.nudge ? step.nudgeFocus : step.focus,
    technique: t?.id,
    level: 1,
    actions: step.actions,
    more: full,
  };
}
