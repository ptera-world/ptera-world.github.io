import type { GamesApi } from "../../api";
import { orderDef, type DataSource } from "./logic";
import { orderView } from "./view";

/** Put things in order by a number, on any dataset with numbers: sorting, a line, higher or lower. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  const data: DataSource = { get: (id) => registry.getDataset(id), list: () => registry.listDatasets() };
  const def = orderDef(data);
  registry.puzzle(def);
  registry.view(orderView(data, def));
}
