import type { GamesApi } from "../../api";
import { wordleDef } from "./def";
import type { DataSource } from "./params";
import { wordleView } from "./view";

/**
 * Wordle and every game of its family as setups of one game, on any dataset a pack provides (looked
 * up when a game needs it, so packs load in any order), or on codes and equations.
 */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  const data: DataSource = { get: (id) => registry.getDataset(id), list: () => registry.listDatasets() };
  const def = wordleDef(data);
  registry.puzzle(def);
  registry.view(wordleView(data, def));
}
