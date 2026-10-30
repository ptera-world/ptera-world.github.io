import { defineSchema } from "../../core/schema";
import type { Plugin } from "../../core/types";
import { downloadAhead, type AheadWhen } from "../../lib/dataset/ahead";
import { mediaUrl } from "../../lib/pokemon/media";
import type { PokemonDataset, MediaKind } from "../../lib/pokemon/types";

const settings = defineSchema({
  when: {
    type: "enum", label: "download every pokémon's sprites and cries ahead", default: "wifi",
    description: "so every pokémon shows and sounds offline, even ones you haven't met. anything you have seen is kept either way",
    options: [
      { value: "off", label: "no" },
      { value: "wifi", label: "on wifi only", description: "only where the browser says it's on wifi: chrome on android does; safari, firefox and desktop chrome don't say, so there nothing is downloaded ahead" },
      { value: "always", label: "always, mobile data too" },
    ],
  },
  kinds: {
    type: "set", label: "what to download", default: ["sprite", "shiny", "cry"],
    when: (v) => v.when !== "off",
    options: [
      { value: "sprite", label: "sprites (about 2 MB)" },
      { value: "shiny", label: "shiny sprites (about 2 MB)" },
      { value: "cry", label: "cries (about 22 MB)" },
    ],
  },
});

/** The setting for downloading the dataset's media ahead; shown on every game built on pokémon. */
export function offlinePlugin(dataset: PokemonDataset): Plugin<any, any, any, any, typeof settings> {
  return {
    id: "pokemon.offline",
    name: "pokémon offline",
    category: "offline",
    appliesTo: "*",
    datasets: ["pokemon"],
    settings,
    setup({ settings: s }) {
      const kinds = s.kinds as readonly MediaKind[];
      // standard forms first, in dex order, so a run cut short covers the most-played ones
      const items = [...dataset.items()].sort((a, b) => Number(a.form !== "default") - Number(b.form !== "default") || a.species - b.species);
      const urls = s.when === "off" ? [] : kinds.flatMap((k) => items.map((i) => mediaUrl(i, k)).filter((u): u is string => !!u));
      downloadAhead(urls, s.when as AheadWhen);
    },
  };
}
