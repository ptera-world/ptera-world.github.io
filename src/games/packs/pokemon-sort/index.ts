import type { GamesApi } from "../../api";
import { makeSort } from "./logic";
import { sortView } from "./view";

/** Pokémon sort: put pokémon in order by a number, with wordle-like marks per place. */
export default function pack(games: GamesApi): void {
  const game = makeSort(() => games.registry.getDataset("pokemon"));
  games.registry.puzzle(game.def);
  games.registry.view(sortView(game));
}
