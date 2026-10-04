import { namespace } from "./storage";

export interface ModEntry {
  id: string;
  name: string;
  enabled: boolean;
  /** Module URL, or inline module source. */
  source: { url: string } | { code: string };
}

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

/**
 * Import each enabled mod in list order and call its default export with `api`.
 * Mods only ever come from the player's own stored list, never from the page URL.
 */
export async function loadMods(api: unknown): Promise<ModLoadResult[]> {
  const results: ModLoadResult[] = [];
  for (const mod of listMods()) {
    if (!mod.enabled) continue;
    let blobUrl: string | null = null;
    try {
      let url: string;
      if ("url" in mod.source) url = mod.source.url;
      else {
        blobUrl = URL.createObjectURL(new Blob([mod.source.code], { type: "text/javascript" }));
        url = blobUrl;
      }
      const m = (await import(/* @vite-ignore */ url)) as { default?: unknown };
      if (typeof m.default !== "function") throw new Error("mod has no default export function");
      await (m.default as (api: unknown) => unknown)(api);
      results.push({ mod });
    } catch (e) {
      console.error(`[games] mod ${mod.name} failed`, e);
      results.push({ mod, error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    }
  }
  return results;
}
