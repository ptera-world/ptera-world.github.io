import type { GamesApi } from "../../api";
import { makeTypeMatchups, typesOf, type Types } from "./logic";
import { makeTechniques } from "./techniques";
import { makeView } from "./view";

/** Pack entry. The type chart comes with the pokémon dataset (pokemon-data pack), looked up when a game needs it. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  const ds = () => registry.getDataset("pokemon");
  const types = (): Types => {
    const d = ds();
    if (!d) throw new Error("the pokémon data pack isn't loaded");
    return typesOf(d);
  };
  const def = makeTypeMatchups(ds);
  registry.puzzle(def);
  registry.view(makeView(types, def));
  for (const t of makeTechniques(def, types)) registry.technique(t);
}
