import type { GamesApi } from "../../api";
import { makeOddOneOut, type DataSource } from "./logic";
import { makeView } from "./view";

/** Odd one out: one picture in the grid is a variant (a shiny among plain sprites); pick it. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  const data: DataSource = { get: (id) => registry.getDataset(id), list: () => registry.listDatasets() };
  const def = makeOddOneOut(data);
  registry.puzzle(def);
  registry.view(makeView(data, def));
}
