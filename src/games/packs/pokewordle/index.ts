import type { GamesApi } from "../../api";
import { makeDef } from "./logic";
import { makeTechniques } from "./techniques";
import { makeView } from "./view";

/** Name wordle: wordle on pokémon names. */
export default function pack(games: GamesApi): void {
  // looked up when used, never now: the dataset's pack may load after this one
  const dataset = () => games.registry.getDataset("pokemon");
  const def = makeDef(dataset);
  games.registry.puzzle(def);
  games.registry.view(makeView(def, dataset));
  const { techniques, plugins } = makeTechniques(def, dataset);
  for (const t of techniques) games.registry.technique(t);
  for (const p of plugins) games.registry.plugin(p);
}
