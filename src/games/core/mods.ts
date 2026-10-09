import { namespace } from "./storage";

/**
 * Packs: everything playable (puzzles, techniques, widgets, effects, themes) arrives as a pack,
 * an ES module whose default export is `(games) => void | Promise<void>`. The built-in content is
 * a pack list like any other; nothing reaches the engine by another route.
 *
 * A source is a pack module URL, a pack list URL (JSON, see PackList), or inline module code.
 */

/**
 * A pack list doubles as the manifest of its packs: one request tells which of them changed.
 * Each `url` resolves against the list's own URL, so one list may name packs on any number of hosts.
 */
export interface PackList {
  name: string;
  packs: {
    id?: string;
    name?: string;
    url: string;
    /** `packHash` of the module's bytes. A pack whose hash is already stored runs without a request. */
    hash?: string;
    /** The pack failed to build and is listed only so the failure is visible. */
    error?: string;
  }[];
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

/** A pack version's identity: the first 12 hex digits of the SHA-256 of the module's bytes. */
export async function packHash(bytes: BufferSource): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
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
  const bytes = await res.arrayBuffer();
  const code = new TextDecoder().decode(bytes);
  const v = { hash: await packHash(bytes), fetchedAt: Date.now() };
  await putCode(url, v.hash, code);
  return v;
}

function remember(rec: PackRecord, v: PackVersion): void {
  if (!rec.versions.some((x) => x.hash === v.hash)) rec.versions.unshift(v);
  rec.versions = rec.versions.slice(0, KEEP_VERSIONS);
}

const lists = namespace("packlists");
/** Pack key → URL of the list that named it, for this page load. */
const listOf = new Map<string, string>();

/** Fetch a list fresh and keep a copy for when it can't be reached. */
async function fetchList(url: string): Promise<PackList> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`list ${url}: ${res.status}`);
  const data = (await res.json()) as PackList;
  if (!Array.isArray(data.packs)) throw new Error("list has no \"packs\" array");
  lists.set(url, data);
  return data;
}

const listedHash = (list: PackList, listUrl: string, key: string): string | undefined =>
  list.packs.find((p) => new URL(p.url, listUrl).href === key)?.hash;

/**
 * Check upstream; if it differs from every stored version, remember it as available. A pack
 * named by a list is checked against the list, and its code is fetched only when it changed.
 */
export async function checkForUpdate(url: string): Promise<PackVersion | null> {
  const rec = packRecord(url);
  const list = listOf.get(url);
  const listed = list ? listedHash(await fetchList(list), list, url) : undefined;
  const v = listed !== undefined && rec.versions.some((x) => x.hash === listed) ? null : await fetchVersion(url);
  if (!v || rec.versions.some((x) => x.hash === v.hash)) {
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


/**
 * Take a version fetched from upstream: a pack following updates switches to it (from the next
 * load), a pinned one is offered it as available. True when what the next load runs changed.
 */
function takeUpstream(url: string, track: Track, v: PackVersion): boolean {
  const rec = packRecord(url);
  const stored = rec.versions.some((x) => x.hash === v.hash);
  const was = rec.selected;
  if (track === "latest" || !rec.versions.length) {
    remember(rec, v);
    rec.selected = v.hash;
  } else if (stored) {
    delete rec.available;
  } else {
    rec.available = v;
  }
  savePackRecord(url, rec);
  return rec.selected !== was;
}

/**
 * The code a pack runs: latest upstream when following, else the selected stored version.
 * `listed` is the hash its list gives for it; when that version is stored, nothing is fetched.
 * With `later`, a pack that has a stored version never waits on upstream: it runs the stored
 * one, and the upstream check is handed to `later` (a listed pack's check is its list's).
 */
async function resolveCode(url: string, defaultTrack: Track, force?: Track, listed?: string, later?: (check: () => Promise<boolean>) => void): Promise<string> {
  const rec = packRecord(url);
  const track = force ?? rec.track ?? defaultTrack;
  if (track === "latest" && listed !== undefined && rec.versions.some((v) => v.hash === listed)) {
    const code = await getCode(url, listed);
    if (code !== null) {
      if (rec.selected !== listed) {
        rec.selected = listed;
        savePackRecord(url, rec);
      }
      return code;
    }
  }
  if (!rec.versions.length || (track === "latest" && !later)) {
    try {
      const v = await fetchVersion(url);
      remember(rec, v);
      if (track === "latest" || !rec.selected) rec.selected = v.hash;
      savePackRecord(url, rec);
    } catch (e) {
      if (!rec.versions.length) throw e;
    }
  } else if (track === "latest" && later && listed === undefined) {
    later(async () => takeUpstream(url, track, await fetchVersion(url)));
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
 * Load `baseList` first, then the player's own sources, in order. Code for every pack is fetched
 * at once, but packs run one at a time in that order. Each pack is isolated: a failing pack is
 * reported and skipped. Sources only come from the built-in list and the player's stored list,
 * never from the page URL.
 *
 * `baseList` is fetched before anything runs (a list that can't be reached is used as last
 * fetched). A player's source never holds up the load once it has been loaded before: it runs as
 * last stored, and all of them are checked upstream in parallel afterwards. What a check finds
 * (new and changed packs, fetched in full) is used from the next load, or offered as an update
 * for a pinned pack; a failed check is reported as the source's error. `checked` settles when
 * every check has, true when the next load would run something different.
 */
export async function loadPacks(api: unknown, baseList: string, opts: { safe?: boolean } = {}): Promise<{ packs: LoadedPack[]; sources: ModLoadResult[]; checked: Promise<boolean> }> {
  // safe mode: the built-in list only, every pack on, latest versions; player settings untouched
  const disabled = new Set(opts.safe ? [] : disabledPacks());
  const packs: LoadedPack[] = [];
  const seen = new Set<string>();
  const queue: { entry: LoadedPack; code: Promise<string>; source?: ModLoadResult }[] = [];
  const checks: (() => Promise<boolean>)[] = [];
  const reporting = (result: ModLoadResult) => (check: () => Promise<boolean>) =>
    checks.push(() => check().catch((e) => {
      console.warn(`[games] update check for ${result.mod.name} failed`, e);
      result.error = `couldn't check for updates: ${e instanceof Error ? e.message : String(e)}`;
      return false;
    }));

  const freshList = async (url: string): Promise<PackList> => {
    try {
      return await fetchList(url);
    } catch (e) {
      const kept = lists.get<PackList | null>(url, null);
      if (kept && e instanceof TypeError) return kept; // network failure, not an answer from the host
      throw e;
    }
  };

  /** One path for every pack; where it came from only sets its default track. */
  const addUrl = (url: string, name: string, list: string | undefined, defaultTrack: Track, listed?: string, later?: (check: () => Promise<boolean>) => void): void => {
    const key = new URL(url, location.href).href;
    if (seen.has(key)) return;
    seen.add(key);
    const entry: LoadedPack = { key, name, list, enabled: !disabled.has(key), versioned: true, defaultTrack };
    packs.push(entry);
    if (!entry.enabled) return;
    const code = resolveCode(key, defaultTrack, opts.safe ? "latest" : undefined, listed, later);
    code.catch(() => {}); // rejection is reported when its turn to run comes
    queue.push({ entry, code });
  };

  const addList = (url: string, data: PackList, defaultTrack: Track, later?: (check: () => Promise<boolean>) => void): void => {
    const base = new URL(url, location.href);
    for (const p of data.packs) {
      const key = new URL(p.url, base).href;
      if (p.error) {
        packs.push({ key, name: p.name ?? p.id ?? p.url, list: data.name, enabled: false, error: p.error });
        continue;
      }
      listOf.set(key, base.href);
      addUrl(key, p.name ?? p.id ?? p.url, data.name, defaultTrack, p.hash, later);
    }
  };

  /** Fetch a player's list and every enabled pack in it that changed. */
  const refreshList = async (url: string, defaultTrack: Track): Promise<boolean> => {
    const shape = (l: PackList | null) => JSON.stringify(l && [l.name, l.packs.map((p) => [p.id, p.name, p.url, p.error])]);
    const before = shape(lists.get<PackList | null>(url, null));
    const data = await fetchList(url);
    const switched = await Promise.all(data.packs.map(async (p) => {
      const key = new URL(p.url, url).href;
      if (p.error || disabled.has(key)) return false;
      const rec = packRecord(key);
      const track = rec.track ?? defaultTrack;
      if (p.hash !== undefined && rec.versions.some((v) => v.hash === p.hash)) return track === "latest" && rec.selected !== p.hash;
      if (p.hash === undefined && track === "pinned" && rec.versions.length) return false;
      return takeUpstream(key, track, await fetchVersion(key));
    }));
    return shape(data) !== before || switched.some(Boolean);
  };

  const baseData = freshList(new URL(baseList, location.href).href);
  baseData.catch(() => {});
  const mods = opts.safe ? [] : listMods().filter((m) => m.enabled);
  const sources: ModLoadResult[] = mods.map((mod) => ({ mod }));
  const playerLists = new Map<string, Promise<PackList>>();
  mods.forEach((mod, i) => {
    if (!("url" in mod.source) || !isList(mod.source.url)) return;
    const url = new URL(mod.source.url, location.href).href;
    const kept = lists.get<PackList | null>(url, null);
    const data = kept ? Promise.resolve(kept) : freshList(url);
    if (kept) reporting(sources[i]!)(() => refreshList(url, "pinned"));
    data.catch(() => {});
    playerLists.set(url, data);
  });

  try {
    addList(baseList, await baseData, "latest");
  } catch (e) {
    console.error("[games] built-in pack list failed", e);
  }

  for (const [i, mod] of mods.entries()) {
    const result = sources[i]!;
    try {
      if ("url" in mod.source) {
        const url = new URL(mod.source.url, location.href).href;
        if (isList(url)) addList(url, await playerLists.get(url)!, "pinned", () => {});
        else addUrl(url, mod.name, undefined, "pinned", undefined, reporting(result));
      } else {
        const key = `inline:${mod.id}`;
        const entry: LoadedPack = { key, name: mod.name, enabled: !disabled.has(key) };
        packs.push(entry);
        if (entry.enabled) queue.push({ entry, code: Promise.resolve(mod.source.code), source: result });
      }
    } catch (e) {
      console.error(`[games] source ${mod.name} failed`, e);
      result.error = e instanceof Error ? e.message : String(e);
    }
  }

  for (const { entry, code, source } of queue) {
    try {
      await runCode(await code, api);
    } catch (e) {
      console.error(`[games] pack ${entry.name} failed`, e);
      const msg = e instanceof Error ? e.message : String(e);
      if (source) source.error = msg;
      else entry.error = msg;
    }
  }
  const checked = Promise.all(checks.map((c) => c())).then((r) => r.some(Boolean));
  return { packs, sources, checked };
}
