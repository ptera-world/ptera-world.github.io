import type { GamesApi } from "../../api";
import { makeGrid } from "./logic";
import { gridView } from "./view";

/** Pack entry: the pokémon grid (pokedoku / immaculate grid), built on the pokémon dataset. */
export default function pack(games: GamesApi): void {
  const get = () => games.registry.getDataset("pokemon");
  games.registry.puzzle(makeGrid(get));
  games.registry.view(gridView(get));
}
