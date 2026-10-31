import type { GamesApi } from "../../api";
import { makeDef, type DataSource } from "./logic";
import { makeView } from "./view";

/** Name them all: type every one of a pool you can remember, against the clock, on any dataset whose pools fit a board. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  // looked up when used, never now: datasets' packs may load after this one
  const data: DataSource = { get: (id) => registry.getDataset(id), list: () => registry.listDatasets() };
  const def = makeDef(data);
  registry.puzzle(def);
  registry.view(makeView(def, data));
}
