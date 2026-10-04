import { namespace } from "./storage";

/**
 * Packs: everything playable (puzzles, techniques, widgets, effects, themes) arrives as a pack,
 * an ES module whose default export is `(games) => void | Promise<void>`. The built-in content is
 * a pack list like any other; nothing reaches the engine by another route.
 *
 * A source is a pack module URL, a pack list URL (JSON, see PackList), or inline module code.
 */

export interface PackList {
  name: string;
  packs: { id?: string; name?: string; url: string }[];
}

export interface ModEntry {
  id: string;
  name: string;
  enabled: boolean;
  source: { url: string } | { code: string };
}

export interface LoadedPack {
  /** Stable identity: the resolved module URL, or "inline:<entry id>". */
  key: string;
  name: string;
  /** Name of the list it came from, if any. */
  list?: string;
  enabled: boolean;
  error?: string;
}

/** Kept for the mods UI: per-source outcome. */
export interface ModLoadResult {
  mod: ModEntry;
  error?: string;
}

const store = namespace("mods");

export function listMods(): ModEntry[] {
  return store.get<ModEntry[]>("list", []);
}

export function saveMods(mods: ModEntry[]): void {
  store.set("list", mods);
}

export function disabledPacks(): string[] {
  return store.get<string[]>("disabled", []);
}

export function setPackEnabled(key: string, enabled: boolean): void {
  const cur = new Set(disabledPacks());
  if (enabled) cur.delete(key);
  else cur.add(key);
  store.set("disabled", [...cur]);
}

const isList = (url: string): boolean => /\.json(\?|#|$)/i.test(url);

async function runModule(url: string, api: unknown): Promise<void> {
  const m = (await import(/* @vite-ignore */ url)) as { default?: unknown };
  if (typeof m.default !== "function") throw new Error("pack has no default export function");
  await (m.default as (api: unknown) => unknown)(api);
}

/**
 * Load `baseList` first, then the player's own sources, in order. Each pack is isolated: a
 * failing pack is reported and skipped. Sources only come from the built-in list and the
 * player's stored list, never from the page URL.
 */
export async function loadPacks(api: unknown, baseList: string): Promise<{ packs: LoadedPack[]; sources: ModLoadResult[] }> {
  const disabled = new Set(disabledPacks());
  const packs: LoadedPack[] = [];
  const sources: ModLoadResult[] = [];
  const seen = new Set<string>();

  const loadUrl = async (url: string, name: string, list?: string): Promise<void> => {
    const key = new URL(url, location.href).href;
    if (seen.has(key)) return;
    seen.add(key);
    const entry: LoadedPack = { key, name, list, enabled: !disabled.has(key) };
    packs.push(entry);
    if (!entry.enabled) return;
    try {
      await runModule(key, api);
    } catch (e) {
      console.error(`[games] pack ${name} failed`, e);
      entry.error = e instanceof Error ? e.message : String(e);
    }
  };

  const loadList = async (url: string): Promise<void> => {
    const base = new URL(url, location.href);
    const res = await fetch(base);
    if (!res.ok) throw new Error(`list ${url}: ${res.status}`);
    const data = (await res.json()) as PackList;
    if (!Array.isArray(data.packs)) throw new Error("list has no \"packs\" array");
    for (const p of data.packs) await loadUrl(new URL(p.url, base).href, p.name ?? p.id ?? p.url, data.name);
  };

  try {
    await loadList(baseList);
  } catch (e) {
    console.error("[games] built-in pack list failed", e);
  }

  for (const mod of listMods()) {
    if (!mod.enabled) continue;
    try {
      if ("url" in mod.source) {
        if (isList(mod.source.url)) await loadList(mod.source.url);
        else await loadUrl(mod.source.url, mod.name);
      } else {
        const key = `inline:${mod.id}`;
        const entry: LoadedPack = { key, name: mod.name, enabled: !disabled.has(key) };
        packs.push(entry);
        if (entry.enabled) {
          const blobUrl = URL.createObjectURL(new Blob([mod.source.code], { type: "text/javascript" }));
          try {
            await runModule(blobUrl, api);
          } finally {
            URL.revokeObjectURL(blobUrl);
          }
        }
      }
      sources.push({ mod });
    } catch (e) {
      console.error(`[games] source ${mod.name} failed`, e);
      sources.push({ mod, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { packs, sources };
}
