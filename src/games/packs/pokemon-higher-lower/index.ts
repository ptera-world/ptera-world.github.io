import type { GamesApi } from "../../api";
import { makeHigherLower } from "./logic";
import { makeView } from "./view";

/** Pack entry. The pokémon dataset comes from the pokemon-data pack, looked up when a game needs it. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  const ds = () => registry.getDataset("pokemon");
  const def = makeHigherLower(ds);
  registry.puzzle(def);
  registry.view(makeView(ds, def));
}
