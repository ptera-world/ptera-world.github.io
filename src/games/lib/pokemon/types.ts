import type { DataItem, Dataset } from "../../core/types";

/**
 * The pokémon dataset's items: one per pokémon PokeAPI lists (every species' default form, plus
 * megas, gigantamax, regional and other battle-distinct forms).
 */
export interface PokemonItem extends DataItem {
  /** PokeAPI pokémon id: what its media are filed under. */
  pid: number;
  /** National dex number of its species. */
  species: number;
  /** Evolution family (PokeAPI evolution chain id): every member shares it. */
  family: number;
  /** Item id of the species' default form this one is a form of (itself for a default form). */
  base: string;
  /** Item id of the default form of the species it evolves from, if any. */
  prevo: string | null;
  form: PokemonForm;
  /** Media that exist for it (see MEDIA_KINDS). */
  media: readonly MediaKind[];
}

export type PokemonForm = "default" | "mega" | "gmax" | "regional" | "other";

/** sprite: front sprite; shiny: its shiny sprite; art: official artwork (large); cry: its cry (ogg). */
export const MEDIA_KINDS = ["sprite", "shiny", "art", "cry"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Attacking type → defending type → damage factor (0, 0.5, 1, 2), types by attribute value. */
export type TypeChart = Readonly<Record<string, Readonly<Record<string, number>>>>;

export interface PokemonTables {
  typeChart: TypeChart;
}

export type PokemonDataset = Dataset<PokemonItem> & { tables: PokemonTables };

declare module "../../core/types" {
  interface Datasets {
    pokemon: PokemonDataset;
  }
}

