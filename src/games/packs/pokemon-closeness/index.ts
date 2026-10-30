import type { GamesApi } from "../../api";
import { makeCloseness } from "./logic";
import { closenessView } from "./view";

/** Pokémon closeness: find the hidden pokémon by how alike your guesses are to it, on a map. */
export default function pack(games: GamesApi): void {
  const game = makeCloseness(() => games.registry.getDataset("pokemon"));
  games.registry.puzzle(game.def);
  games.registry.view(closenessView(game));
}
