import type { GamesApi } from "../../api";
import { pokedleDef } from "./logic";
import { statsPlugin, statsWidget } from "./stats";
import { fallbackHint, pokedleTechniques } from "./techniques";
import { pokedleView } from "./view";

/**
 * Guess the hidden pokémon from per-attribute marks, on one board or many. The pokémon dataset
 * comes from the pokemon-data pack, looked up when a game needs it (packs load in any order).
 */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  const data = () => registry.getDataset("pokemon");
  const def = pokedleDef(data);
  registry.puzzle({ ...def, hint: (p, s) => fallbackHint(data, p, s) });
  registry.view(pokedleView(data, def));
  for (const t of pokedleTechniques(data, def)) registry.technique(t);
  registry.plugin(statsPlugin(data, def));
  registry.widget(statsWidget(data, def));
}
