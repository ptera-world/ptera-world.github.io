import { api } from "./api";
import { h, style } from "./core/dom";
import { disabledPacks, loadPacks, setPackEnabled } from "./core/mods";
import { registry } from "./core/registry";
import { prefs } from "./core/storage";
import { watchTheme } from "./core/themes";

/**
 * The core is only this loader: load every pack (the built-in list first, through the same path
 * as any other pack), then mount one frontend. With no frontend, or a broken one, a bare page
 * lists what went wrong and offers safe mode (?safe), which loads only the built-in packs.
 */

(globalThis as { pteraGames?: typeof api }).pteraGames = api;

const safe = new URLSearchParams(location.search).has("safe");
api.safe = safe;
const { packs, sources } = await loadPacks(api, new URL("./packs.json", import.meta.url).href, { safe });
api.packs.loaded = packs;
api.packs.sources = sources;
watchTheme(registry);

const root = document.getElementById("games")!;
const fronts = registry.listFrontends();
const chosen = prefs.get("frontend", null);
const front = fronts.find((f) => f.id === chosen) ?? fronts[fronts.length - 1];

try {
  if (!front) throw new Error("no pack provides a frontend");
  await front.mount(root);
} catch (e) {
  console.error("[games] frontend failed", e);
  fallback(e instanceof Error ? e.message : String(e));
}

function fallback(reason: string): void {
  style("loader", `
.loader { max-width: 640px; margin: 40px auto; padding: 0 16px; display: flex; flex-direction: column; gap: 12px; font-family: var(--font); color: var(--text); }
.loader li { margin-left: 20px; }
.loader .error { color: var(--danger); }
`);
  const off = disabledPacks();
  root.replaceChildren(h("div", { class: "loader" },
    h("h1", null, "the games couldn't start"),
    h("p", { class: "error" }, reason),
    h("ul", null, packs.map((p) => h("li", null, p.name, p.enabled ? "" : " (off)", p.error ? h("span", { class: "error" }, ` · ${p.error}`) : ""))),
    sources.filter((s) => s.error).map((s) => h("p", { class: "error" }, `${s.mod.name}: ${s.error}`)),
    safe
      ? h("p", null, "this is already safe mode, so a built-in pack is broken.")
      : h("p", null, h("a", { href: `${location.pathname}?safe` }, "open in safe mode"), " (built-in packs only, all on)."),
    off.length
      ? h("button", { onclick: () => { for (const k of off) setPackEnabled(k, true); location.reload(); } }, `turn ${off.length} switched-off pack${off.length > 1 ? "s" : ""} back on`)
      : null));
}

declare module "./core/storage" {
  interface Prefs {
    /** Id of the frontend to mount; the last registered one when unset or unknown. */
    frontend: string | null;
  }
}
