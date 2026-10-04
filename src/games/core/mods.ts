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
  /** Runs from stored versions, so it can be updated, pinned and rolled back. */
  versioned?: boolean;
  /** Track used unless the player chose one: built-in lists follow latest, player sources stay pinned. */
  defaultTrack?: Track;
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
 * Every pack, built-in or not, runs from a stored copy of one of its versions. Version metadata
 * lives in local storage and code in Cache Storage (sizes beyond local storage). A source either
 * follows the latest upstream copy (fetched on each load, falling back to the stored copy when
 * offline) or stays pinned to the version the player chose until they update.
 */
export type Track = "latest" | "pinned";

export interface PackVersion {
  hash: string;
  fetchedAt: number;
}

export interface PackRecord {
  versions: PackVersion[];
  /** Hash of the version that runs; newest when unset. */
  selected?: string;
  /** A newer upstream version found by the last check, stored but not yet adopted. */
  available?: PackVersion;
  /** Unset: the default for where the pack came from. */
  track?: Track;
}

const versions = namespace("packstore");
const KEEP_VERSIONS = 5;
const CACHE = "games-packs";
const memory = new Map<string, string>();

async function sha(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf).slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
}

const codeKey = (url: string, hash: string): string => `${url}${url.includes("?") ? "&" : "?"}__pack=${hash}`;

async function putCode(url: string, hash: string, code: string): Promise<void> {
  memory.set(codeKey(url, hash), code);
  try {
    const c = await caches.open(CACHE);
    await c.put(codeKey(url, hash), new Response(code, { headers: { "Content-Type": "text/javascript" } }));
  } catch {
    // no Cache Storage (e.g. insecure origin): this page load still has the in-memory copy
  }
}

async function getCode(url: string, hash: string): Promise<string | null> {
  const mem = memory.get(codeKey(url, hash));
  if (mem !== undefined) return mem;
  try {
    const res = await (await caches.open(CACHE)).match(codeKey(url, hash));
    return res ? await res.text() : null;
  } catch {
    return null;
  }
}

export function packRecord(url: string): PackRecord {
  return versions.get<PackRecord>(url, { versions: [] });
}

function savePackRecord(url: string, rec: PackRecord): void {
  versions.set(url, rec);
}

export function setTrack(url: string, track: Track): void {
  const rec = packRecord(url);
  rec.track = track;
  if (track === "pinned" && !rec.selected) rec.selected = rec.versions[0]?.hash;
  savePackRecord(url, rec);
}

/** Fetch upstream and store it; returns its version. */
async function fetchVersion(url: string): Promise<PackVersion> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const code = await res.text();
  const v = { hash: await sha(code), fetchedAt: Date.now() };
  await putCode(url, v.hash, code);
  return v;
}

function remember(rec: PackRecord, v: PackVersion): void {
  if (!rec.versions.some((x) => x.hash === v.hash)) rec.versions.unshift(v);
  rec.versions = rec.versions.slice(0, KEEP_VERSIONS);
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
    remember(rec, rec.available);
    hash = rec.available.hash;
    delete rec.available;
  }
  rec.selected = hash;
  savePackRecord(url, rec);
}

/** The code a pack runs: latest upstream when following, else the selected stored version. */
async function resolveCode(url: string, defaultTrack: Track): Promise<string> {
  const rec = packRecord(url);
  const track = rec.track ?? defaultTrack;
  if (track === "latest" || !rec.versions.length) {
    try {
      const v = await fetchVersion(url);
      remember(rec, v);
      if (track === "latest" || !rec.selected) rec.selected = v.hash;
      savePackRecord(url, rec);
    } catch (e) {
      if (!rec.versions.length) throw e;
    }
  }
  const order = [rec.selected, ...rec.versions.map((v) => v.hash)].filter((h): h is string => !!h);
  for (const h of order) {
    const code = await getCode(url, h);
    if (code !== null) return code;
  }
  throw new Error("no stored copy of this pack is available");
}

async function runCode(code: string, api: unknown): Promise<void> {
  const blobUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try {
    const m = (await import(/* @vite-ignore */ blobUrl)) as { default?: unknown };
    if (typeof m.default !== "function") throw new Error("pack has no default export function");
    await (m.default as (api: unknown) => unknown)(api);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
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

  /** One path for every pack; where it came from only sets its default track. */
  const loadUrl = async (url: string, name: string, list: string | undefined, defaultTrack: Track): Promise<void> => {
    const key = new URL(url, location.href).href;
    if (seen.has(key)) return;
    seen.add(key);
    const entry: LoadedPack = { key, name, list, enabled: !disabled.has(key), versioned: true, defaultTrack };
    packs.push(entry);
    if (!entry.enabled) return;
    try {
      await runCode(await resolveCode(key, defaultTrack), api);
    } catch (e) {
      console.error(`[games] pack ${name} failed`, e);
      entry.error = e instanceof Error ? e.message : String(e);
    }
  };

  const loadList = async (url: string, defaultTrack: Track): Promise<void> => {
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
      await loadUrl(new URL(p.url, base).href, p.name ?? p.id ?? p.url, data.name, defaultTrack);
    }
  };

  try {
    await loadList(baseList, "latest");
  } catch (e) {
    console.error("[games] built-in pack list failed", e);
  }

  for (const mod of listMods()) {
    if (!mod.enabled) continue;
    try {
      if ("url" in mod.source) {
        if (isList(mod.source.url)) await loadList(mod.source.url, "pinned");
        else await loadUrl(mod.source.url, mod.name, undefined, "pinned");
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
