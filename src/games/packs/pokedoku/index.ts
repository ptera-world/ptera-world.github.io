import type { GamesApi } from "../../api";
import { makeGrid, type DataSource } from "./logic";
import { gridView } from "./view";

/** Pack entry: the grid (immaculate grid, pokedoku), on any dataset whose attributes can fill one. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  const data: DataSource = { get: (id) => registry.getDataset(id), list: () => registry.listDatasets() };
  registry.puzzle(makeGrid(data));
  registry.view(gridView(data));
}
