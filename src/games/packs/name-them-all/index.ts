import type { GamesApi } from "../../api";
import { makeDef } from "./logic";
import { makeView } from "./view";

/** Name them all: type every pokémon of a pool you can remember, against the clock. */
export default function pack(games: GamesApi): void {
  // looked up when used, never now: the dataset's pack may load after this one
  const dataset = () => games.registry.getDataset("pokemon");
  const def = makeDef(dataset);
  games.registry.puzzle(def);
  games.registry.view(makeView(def, dataset));
}
