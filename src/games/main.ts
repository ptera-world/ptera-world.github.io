import { api } from "./api";
import { h, style } from "./core/dom";
import { disabledPacks, loadPacks, setPackEnabled } from "./core/mods";
import { registry } from "./core/registry";
import { prefs } from "./core/storage";
import type { FrontendHandle } from "./core/types";
import { watchTheme } from "./core/themes";

/**
 * The core is only this loader: load every pack (the built-in list first, through the same path
 * as any other pack), then mount one frontend. With no frontend, or a broken one, a bare page
 * lists what went wrong and offers safe mode (?safe), which loads only the built-in packs.
 *
 * The engine is replaced while the page stays open when a deploy changes this app's files or a
 * check of the player's sources finds something a load would now run differently. This module is
 * imported again under a new URL, a fresh copy of the whole engine, which loads every pack while
 * the running copy keeps going, then stops it and mounts in its place with what its frontend
 * carried. A running copy that can't stop (its frontend has no unmount) stays, and the new one
 * discards itself.
 */

interface Engine {
  /** Unmount and release everything; null when this copy can't stop. */
  stop(): { carried: unknown } | null;
}
const ENGINE = Symbol.for("pteraworld.games.engine");
const g = globalThis as { pteraGames?: typeof api; [ENGINE]?: Engine };
const previous = g[ENGINE];
const previousApi = g.pteraGames;
const life = new AbortController();
const root = document.getElementById("games")!;
const app = new URL("./", import.meta.url).pathname;

g.pteraGames = api;
api.signal = life.signal;
const safe = new URLSearchParams(location.search).has("safe");
api.safe = safe;
const { packs, sources, checked } = await loadPacks(api, new URL("./packs.json", import.meta.url).href, { safe });
api.packs.loaded = packs;
api.packs.sources = sources;
watchTheme(registry, life.signal);

const fronts = registry.listFrontends();
const chosen = prefs.get("frontend", null);
const front = fronts.find((f) => f.id === chosen) ?? fronts[fronts.length - 1];

const stopped = previous ? (front ? previous.stop() : null) : { carried: undefined };
if (!stopped) {
  life.abort();
  g.pteraGames = previousApi;
} else {
  let handle: void | FrontendHandle = undefined;
  let mounted = false;
  g[ENGINE] = {
    stop() {
      if (mounted && !handle?.unmount) return null;
      let carried: unknown;
      try {
        carried = handle?.unmount();
      } catch (e) {
        console.error("[games] frontend unmount failed", e);
      }
      life.abort();
      root.replaceChildren();
      return { carried };
    },
  };
  try {
    if (!front) throw new Error("no pack provides a frontend");
    handle = await front.mount(root, stopped.carried);
    mounted = true;
  } catch (e) {
    console.error("[games] frontend failed", e);
    fallback(e instanceof Error ? e.message : String(e));
  }
  watchForReplacement();
}

/** Replace this engine when a deploy changes this app or a source check finds changes. */
function watchForReplacement(): void {
  let pressed = 0;
  let released: (() => void) | null = null;
  const opts = { capture: true, signal: life.signal };
  addEventListener("pointerdown", () => { pressed++; }, opts);
  for (const t of ["pointerup", "pointercancel"]) {
    addEventListener(t, () => {
      pressed = Math.max(0, pressed - 1);
      if (!pressed) released?.();
    }, opts);
  }
  let replacing = false;
  const replace = async (tag: string): Promise<void> => {
    if (replacing || life.signal.aborted) return;
    replacing = true;
    try {
      // never mid-gesture: the new engine would get half of it
      if (pressed) await new Promise<void>((r) => { released = r; });
      released = null;
      const next = new URL("./main.js", import.meta.url);
      next.search = `?v=${encodeURIComponent(tag)}`;
      await import(/* @vite-ignore */ next.href);
    } catch (e) {
      console.error("[games] couldn't replace the engine", e);
    } finally {
      replacing = false;
    }
  };
  addEventListener("deploy", (e) => {
    const { version, changed } = (e as CustomEvent<{ version: string; changed: string[] }>).detail;
    if (!changed.some((k) => k.startsWith(app) && !k.endsWith(".css"))) return;
    e.preventDefault();
    void replace(version);
  }, { signal: life.signal });
  void checked.then((any) => { if (any) void replace(`sources-${Date.now()}`); });
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
