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
  /** `error`: the pack failed to build and is listed only so the failure is visible. */
  packs: { id?: string; name?: string; url: string; error?: string }[];
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
  /** Runs from stored versions (player-added URL packs), so it can be updated and rolled back. */
  versioned?: boolean;
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

/**
 * Versions of player-added packs, keyed by module URL. A pack runs from the stored copy of its
 * selected version, so it keeps working offline and never changes under the player until they
 * update; older versions stay available to roll back to.
 */
export interface PackVersion {
  hash: string;
  fetchedAt: number;
  code: string;
}

export interface PackRecord {
  versions: PackVersion[];
  /** Hash of the version that runs; latest when unset. */
  selected?: string;
  /** Hash of a newer upstream copy found by the last update check, not yet adopted. */
  available?: PackVersion;
}

const versions = namespace("packstore");
const KEEP_VERSIONS = 5;

async function sha(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf).slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function packRecord(url: string): PackRecord {
  return versions.get<PackRecord>(url, { versions: [] });
}

function savePackRecord(url: string, rec: PackRecord): void {
  versions.set(url, rec);
}

async function fetchVersion(url: string): Promise<PackVersion> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const code = await res.text();
  return { hash: await sha(code), fetchedAt: Date.now(), code };
}

/** Fetch upstream; if it differs from every stored version, remember it as available. */
export async function checkForUpdate(url: string): Promise<PackVersion | null> {
  const rec = packRecord(url);
  const v = await fetchVersion(url);
  if (rec.versions.some((x) => x.hash === v.hash)) {
    delete rec.available;
    savePackRecord(url, rec);
    return null;
  }
  rec.available = v;
  savePackRecord(url, rec);
  return v;
}

/** Adopt the available update (or select a stored version by hash). Takes effect on reload. */
export function selectPackVersion(url: string, hash?: string): void {
  const rec = packRecord(url);
  if (!hash && rec.available) {
    rec.versions.unshift(rec.available);
    rec.versions = rec.versions.slice(0, KEEP_VERSIONS);
    hash = rec.available.hash;
    delete rec.available;
  }
  rec.selected = hash;
  savePackRecord(url, rec);
}

/** Code to run for a player pack: the selected stored version, fetching the first one if none. */
async function storedCode(url: string): Promise<string> {
  const rec = packRecord(url);
  if (!rec.versions.length) {
    rec.versions.push(await fetchVersion(url));
    savePackRecord(url, rec);
  }
  return (rec.versions.find((v) => v.hash === rec.selected) ?? rec.versions[0]!).code;
}

async function runCode(code: string, api: unknown): Promise<void> {
  const blobUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try {
    await runModule(blobUrl, api);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

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

  /** Built-in packs import their own chunks, so they run straight from the site; player packs run from stored versions. */
  const loadUrl = async (url: string, name: string, list?: string, builtin = false): Promise<void> => {
    const key = new URL(url, location.href).href;
    if (seen.has(key)) return;
    seen.add(key);
    const entry: LoadedPack = { key, name, list, enabled: !disabled.has(key), versioned: !builtin };
    packs.push(entry);
    if (!entry.enabled) return;
    try {
      if (builtin) await runModule(key, api);
      else await runCode(await storedCode(key), api);
    } catch (e) {
      console.error(`[games] pack ${name} failed`, e);
      entry.error = e instanceof Error ? e.message : String(e);
    }
  };

  const loadList = async (url: string, builtin = false): Promise<void> => {
    const base = new URL(url, location.href);
    const res = await fetch(base);
    if (!res.ok) throw new Error(`list ${url}: ${res.status}`);
    const data = (await res.json()) as PackList;
    if (!Array.isArray(data.packs)) throw new Error("list has no \"packs\" array");
    for (const p of data.packs) {
      if (p.error) {
        packs.push({ key: new URL(p.url, base).href, name: p.name ?? p.id ?? p.url, list: data.name, enabled: false, error: p.error });
        continue;
      }
      await loadUrl(new URL(p.url, base).href, p.name ?? p.id ?? p.url, data.name, builtin);
    }
  };

  try {
    await loadList(baseList, true);
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
        if (entry.enabled) await runCode(mod.source.code, api);
      }
      sources.push({ mod });
    } catch (e) {
      console.error(`[games] source ${mod.name} failed`, e);
      sources.push({ mod, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { packs, sources };
}
