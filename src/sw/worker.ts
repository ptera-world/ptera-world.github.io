import { CACHE_PREFIX, fileHash, keysForPath, type SwManifest } from "./routes";

/**
 * Offline copy of the parts of the site this browser has used. Replaced at build time with the
 * manifest of the files being deployed, so the worker's own bytes change exactly when the deploy
 * does: checking for a new deploy is the browser's one update request for this file.
 *
 * Contract:
 * - Only same-origin GETs for files in the manifest are answered here. Everything else (other
 *   origins, anything not listed, such as pack modules, which keep their own versions) goes to
 *   the network untouched, except that a navigation that fails offline gets the stored 404 page.
 * - A listed file is answered from the stored copy when there is one, with no request.
 * - Nothing is fetched up front but the 404 page. A file is stored when it is first fetched (or
 *   when a page loaded before the worker took over names it) and its bytes match its hash here.
 * - Each deploy is stored under its own cache name and only ever holds that deploy's bytes. A new
 *   deploy's worker copies every stored file whose hash is unchanged and fetches only the stored
 *   files that changed; it takes over only once all of them are in.
 * - When a new deploy takes over from an older one, every open page gets
 *   `{ type: "deploy", version, changed }`, `changed` being the keys whose bytes differ.
 */
declare const __MANIFEST__: SwManifest;

interface ExtendableEvent extends Event {
  waitUntil(p: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  respondWith(r: Response | Promise<Response>): void;
}
interface MessageEvent extends ExtendableEvent {
  readonly data: unknown;
}
interface Worker {
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void>; matchAll(o: { type: "window" }): Promise<{ postMessage(m: unknown): void }[]> };
  registration: { update(): Promise<unknown> };
  location: Location;
  addEventListener(type: "install" | "activate", l: (e: ExtendableEvent) => void): void;
  addEventListener(type: "fetch", l: (e: FetchEvent) => void): void;
  addEventListener(type: "message", l: (e: MessageEvent) => void): void;
}
const sw = self as unknown as Worker;

const PREFIX = CACHE_PREFIX;
const CACHE = `${PREFIX}${__MANIFEST__.version}`;
const LEGACY = ["pteraworld-v1"];
/** Written last into each deploy's cache: the manifest it holds. A cache without it is incomplete. */
const MANIFEST_KEY = "/__sw-manifest__";
const OFFLINE = "/404.html";
const files = __MANIFEST__.files;
const FETCH_AT_ONCE = 8;

const urlOf = (key: string): string => new URL(key, sw.location.origin).href;
const keyOf = (url: string): string | undefined => {
  const u = new URL(url);
  return u.origin === sw.location.origin ? keysForPath(u.pathname).find((k) => k in files) : undefined;
};

/** `res` when it is this deploy's copy of `key`. */
async function verified(key: string, res: Response): Promise<Response | null> {
  if (!res.ok) return null;
  return (await fileHash(await res.clone().arrayBuffer())) === files[key] ? res : null;
}

/** The newest complete cache of an earlier deploy. */
async function previous(): Promise<{ cache: Cache; manifest: SwManifest } | null> {
  let found: { cache: Cache; manifest: SwManifest } | null = null;
  for (const name of await caches.keys()) {
    if (!name.startsWith(PREFIX) || name === CACHE) continue;
    const cache = await caches.open(name);
    const m = await cache.match(urlOf(MANIFEST_KEY));
    if (m) found = { cache, manifest: (await m.json()) as SwManifest };
  }
  return found;
}

async function install(): Promise<void> {
  const cache = await caches.open(CACHE);
  try {
    const prev = await previous();
    const queue = new Set<string>(OFFLINE in files ? [OFFLINE] : []);
    for (const req of prev ? await prev.cache.keys() : []) {
      const key = new URL(req.url).pathname;
      if (!(key in files)) continue;
      const old = prev!.manifest.files[key] === files[key] ? await prev!.cache.match(req) : undefined;
      if (old) {
        await cache.put(urlOf(key), old);
        queue.delete(key);
      } else {
        queue.add(key);
      }
    }
    const keys = [...queue];
    const worker = async (): Promise<void> => {
      for (let key = keys.pop(); key !== undefined; key = keys.pop()) {
        const res = await verified(key, await fetch(urlOf(key), { cache: "reload", redirect: "manual" }));
        if (!res) throw new Error(`${key}: not this deploy's copy`);
        await cache.put(urlOf(key), res);
      }
    };
    await Promise.all(Array.from({ length: FETCH_AT_ONCE }, worker));
    await cache.put(urlOf(MANIFEST_KEY), Response.json(__MANIFEST__));
  } catch (e) {
    await caches.delete(CACHE);
    throw e;
  }
  await sw.skipWaiting();
}

async function activate(): Promise<void> {
  const prev = await previous();
  for (const k of await caches.keys()) {
    if ((k.startsWith(PREFIX) && k !== CACHE) || LEGACY.includes(k)) await caches.delete(k);
  }
  await sw.clients.claim();
  if (!prev) return;
  const changed = Object.keys(files).filter((k) => prev.manifest.files[k] !== files[k]);
  for (const c of await sw.clients.matchAll({ type: "window" })) c.postMessage({ type: "deploy", version: __MANIFEST__.version, changed });
}

/** Store `res` if it is this deploy's copy; a different copy means a newer deploy is out. */
async function keep(key: string, res: Response): Promise<void> {
  const ok = await verified(key, res);
  if (ok) await (await caches.open(CACHE)).put(urlOf(key), ok);
  else if (res.ok) await sw.registration.update().catch(() => {});
}

async function serve(e: FetchEvent, key: string): Promise<Response> {
  const stored = await (await caches.open(CACHE)).match(urlOf(key));
  if (stored) return stored;
  try {
    const res = await fetch(e.request);
    e.waitUntil(keep(key, res.clone()));
    return res;
  } catch (err) {
    if (e.request.mode === "navigate") return offline();
    throw err;
  }
}

async function offline(): Promise<Response> {
  return (await (await caches.open(CACHE)).match(urlOf(OFFLINE))) ?? Response.error();
}

sw.addEventListener("install", (e) => e.waitUntil(install()));
sw.addEventListener("activate", (e) => e.waitUntil(activate()));
sw.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const key = keyOf(req.url);
  if (key !== undefined) e.respondWith(serve(e, key));
  else if (req.mode === "navigate" && new URL(req.url).origin === sw.location.origin) e.respondWith(fetch(req).catch(offline));
});
/** `{ type: "cache", urls }`: a page loaded without this worker names what it loaded, to be stored. */
sw.addEventListener("message", (e) => {
  const data = e.data as { type?: string; urls?: unknown };
  if (data?.type !== "cache" || !Array.isArray(data.urls)) return;
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const url of data.urls as unknown[]) {
      const key = typeof url === "string" ? keyOf(url) : undefined;
      if (key === undefined || (await cache.match(urlOf(key)))) continue;
      try {
        await keep(key, await fetch(urlOf(key), { cache: "force-cache", redirect: "manual" }));
      } catch {
        // offline: stored the next time it is fetched
      }
    }
  })());
});
