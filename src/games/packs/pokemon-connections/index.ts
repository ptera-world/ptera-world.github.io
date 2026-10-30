import type { GamesApi } from "../../api";
import { makeConnections } from "./logic";
import { connectionsView } from "./view";

/** Pack entry: pokémon connections (NYT Connections), built on the pokémon dataset. */
export default function pack(games: GamesApi): void {
  const get = () => games.registry.getDataset("pokemon");
  games.registry.puzzle(makeConnections(get));
  games.registry.view(connectionsView(get));
}
