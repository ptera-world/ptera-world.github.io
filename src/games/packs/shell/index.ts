import type { GamesApi } from "../../api";
import { bind } from "./engine";

/** The standard frontend: board, panels, commands, settings, saved games, pack manager. */
export default function pack(games: GamesApi): void {
  bind(games);
  games.registry.frontend({
    id: "shell",
    name: "standard",
    async mount(root, carried) {
      // ui code (and the keybinds library) loads only when the page mounts, so registering never needs a DOM
      const { Shell } = await import("./shell");
      const shell = new Shell(root, games.registry, games.packs.sources, games.packs.loaded, games.safe);
      games.shell = shell;
      await shell.start(carried);
      return { unmount: () => shell.stop() };
    },
  });
}
