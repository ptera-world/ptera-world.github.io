import type { StringField } from "../../core/schema";
import { filter } from "../dataset/query";
import type { PokemonDataset, PokemonItem } from "./types";

/** The pool most games start from: every species' standard form. */
export const DEFAULT_POOL = "form:default";

/** Presets of pools people ask for, as queries (each game may offer them as presets). */
export const POOL_PRESETS: readonly { label: string; pool: string }[] = [
  { label: "every species", pool: "form:default" },
  { label: "gen 1", pool: "form:default gen:1" },
  { label: "gens 1–4", pool: "form:default gen:1-4" },
  { label: "no legendaries or mythicals", pool: "form:default class:regular,baby,paradox,ultra-beast" },
  { label: "fully evolved", pool: "form:default final" },
  { label: "every form (megas, regional, gigantamax…)", pool: "" },
];

/**
 * A pool param: a filter query (see lib/dataset/query) with a live count under the box. `dataset`
 * is read when the form is shown, so the field works before the dataset's pack has loaded.
 */
export function poolField(dataset: () => PokemonDataset | undefined, label = "which pokémon"): StringField {
  return {
    type: "string", label, default: DEFAULT_POOL, filterOf: () => dataset(), placeholder: "e.g. gen:1-4 type:fire,water !legendary",
    description: "a filter: gen:1-3 type:fire,water (any of) type=fire (exactly) bst>=500 final mega !mythical, | for or, brackets to group. empty: every form",
    check: (v) => {
      const d = dataset();
      if (!d) return "the pokémon data pack isn't loaded";
      const r = filter(d.items(), v, d.attributes);
      return "error" in r ? r.error : `${r.items.length} pokémon`;
    },
  };
}

/** The pool for a query; throws a readable error for a bad query or an empty pool. */
export function poolOf(dataset: PokemonDataset, query: string, min = 1): PokemonItem[] {
  const r = filter(dataset.items(), query, dataset.attributes);
  if ("error" in r) throw new Error(`the pokémon filter: ${r.error}`);
  if (r.items.length < min) throw new Error(`the pokémon filter leaves ${r.items.length} pokémon; this needs at least ${min}`);
  return r.items;
}
