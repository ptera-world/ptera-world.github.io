import type { DatasetLook } from "../../core/types";
import { spriteUrl } from "../../lib/pokemon/media";

/** Pokémon standing along the grass at the bottom of the backdrop: [PokeAPI id, left %, size px]. */
const PARADE: [number, number, number][] = [
  [12, 3, 88], [1, 11, 80], [133, 19, 84], [39, 27, 72], [143, 83, 112], [25, 92, 80], [4, 74, 80], [7, 66, 76], [52, 58, 70],
];

/**
 * Games on pokémon look like the pokémon games and their fan sites: a pixel font, a sky over a
 * meadow with pokémon along the grass, navy panels edged in gold, chunky marks with black edges in
 * bright green, yellow and red-orange.
 */
export const POKEMON_LOOK: DatasetLook = {
  css: `@import url("https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400;600;700&display=swap");`,
  tokens: {
    font: `"Pixelify Sans", system-ui, sans-serif`,
    text: "#fff",
    "text-dim": "#dfe9f5",
    "verdict-match": "#3fdc7e",
    "verdict-near": "#f1d548",
    "verdict-miss": "#ee5f3c",
    "verdict-text": "#fff",
    "tile-border": "3px solid #111",
    "tile-radius": "6px",
    "tile-shadow": "0 3px 0 rgb(0 0 0 / .35)",
    "tile-bg": "#fff",
    "tile-text": "#111",
    "panel-bg": "#264b6b",
    "panel-border": "4px solid #d9b45a",
    "panel-text": "#fff",
    "panel-radius": "14px",
    "head-bar": "4px solid #fff",
    "stage-bg": "radial-gradient(circle at 50% 45%, #fffbe6 0%, #cfe6f7 65%, #8fbde4 100%)",
  },
  backdrop: [
    ...PARADE.map(([id, x, px]) => `url("${spriteUrl(id)}") no-repeat ${x}% calc(100% - 14px) / ${px}px`),
    // grass, then sky with a couple of clouds
    "linear-gradient(to bottom, transparent calc(100% - 70px), #5f9a4a calc(100% - 70px), #3f6b38 100%)",
    "radial-gradient(ellipse 120px 40px at 18% 22%, rgb(255 255 255 / .85) 60%, transparent 62%)",
    "radial-gradient(ellipse 160px 46px at 78% 14%, rgb(255 255 255 / .8) 60%, transparent 62%)",
    "linear-gradient(to bottom, #5d9fd6 0%, #8cc1ea 55%, #bfe0f6 100%)",
  ].join(", "),
};
