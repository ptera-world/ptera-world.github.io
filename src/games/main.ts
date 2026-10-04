import { api } from "./api";
import { loadMods } from "./core/mods";
import { registry } from "./core/registry";
import { registerBuiltins } from "./puzzles";
import { Shell } from "./ui/shell";

(globalThis as { pteraGames?: typeof api }).pteraGames = api;

registerBuiltins(registry);
const modResults = await loadMods(api);
const root = document.getElementById("games")!;
const shell = new Shell(root, registry, modResults);
api.shell = shell;
await shell.start();
