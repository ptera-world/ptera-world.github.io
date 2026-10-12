import type { GamesApi } from "../../api";
import { cube } from "./logic";
import { cubeView, facesWidget } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(cube);
  registry.view(cubeView);
  registry.widget(facesWidget);
}
