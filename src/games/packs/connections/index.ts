import type { GamesApi } from "../../api";
import { makeConnections, type DataSource } from "./logic";
import { connectionsView } from "./view";

/** Pack entry: connections (NYT Connections), on any dataset whose attributes make groups. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  const data: DataSource = { get: (id) => registry.getDataset(id), list: () => registry.listDatasets() };
  registry.puzzle(makeConnections(data));
  registry.view(connectionsView(data));
}
