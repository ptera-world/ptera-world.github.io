import type { GamesApi } from "../../api";
import { makeTypeMatchups, typesFor, type DataSource } from "./logic";
import { makeTechniques } from "./techniques";
import { makeView } from "./view";

/** Pack entry. The chart comes with a dataset (pokémon's type chart), looked up when a game needs it. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  const data: DataSource = { get: (id) => registry.getDataset(id), list: () => registry.listDatasets() };
  const def = makeTypeMatchups(data);
  registry.puzzle(def);
  registry.view(makeView(typesFor(data), def));
  for (const t of makeTechniques(def, typesFor(data))) registry.technique(t);
}
