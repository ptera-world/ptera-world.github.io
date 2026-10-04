import { api } from "./api";
import { loadPacks } from "./core/mods";
import { registry } from "./core/registry";
import { Shell } from "./ui/shell";
import { watchTheme } from "./ui/themes";

(globalThis as { pteraGames?: typeof api }).pteraGames = api;

// built-in content is a pack list served next to this script, loaded like any custom list
const { packs, sources } = await loadPacks(api, new URL("./packs.json", import.meta.url).href);
watchTheme(registry);
const root = document.getElementById("games")!;
const shell = new Shell(root, registry, sources, packs);
api.shell = shell;
await shell.start();
