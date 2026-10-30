import type { GamesApi } from "../../api";
import { makeWhoThat } from "./logic";
import { makeView } from "./view";

/** Who's that pokémon: name it from a silhouette, a blurred or zoomed picture, its cry or its dex entry. */
export default function pack(games: GamesApi): void {
  const dataset = () => games.registry.getDataset("pokemon");
  const def = makeWhoThat(dataset);
  games.registry.puzzle(def);
  games.registry.view(makeView(dataset, def));
}
