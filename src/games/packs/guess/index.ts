import type { GamesApi } from "../../api";
import { guess } from "./logic";
import { guessPlugins } from "./plugins";
import { guessTechniques } from "./techniques";
import { guessView } from "./view";

/** Pack entry: loaded by URL through the same path as any third-party pack. */
export default function pack(games: GamesApi): void {
  const { registry } = games;
  registry.puzzle(guess);
  registry.view(guessView());
  for (const t of guessTechniques) registry.technique(t);
  for (const p of guessPlugins) registry.plugin(p);
}
