import { keysForPath, type SwManifest } from "./routes";

/**
 * Offline copy of the whole deploy. Replaced at build time with the manifest of the files being
 * deployed, so the worker's own bytes change exactly when the deploy does and the browser installs
 * it as an update.
 *
 * Contract:
 * - Only same-origin GETs for files in the manifest are answered here. Everything else (other
 *   origins, anything not listed, such as pack modules, which keep their own versions) goes to
 *   the network untouched.
 * - Online, a listed file always comes from the network, revalidated, so a deploy is visible on
 *   the next load. The stored copy answers only when the network fails, errors, or is too slow.
 * - Each deploy is stored whole under its own cache name; a deploy is only used once all of it
 *   has been fetched, and older ones are deleted when the new one takes over.
 */
declare const __MANIFEST__: SwManifest;

interface ExtendableEvent extends Event {
  waitUntil(p: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  respondWith(r: Response | Promise<Response>): void;
}
interface Worker {
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  location: Location;
  addEventListener(type: "install" | "activate", l: (e: ExtendableEvent) => void): void;
  addEventListener(type: "fetch", l: (e: FetchEvent) => void): void;
}
const sw = self as unknown as Worker;

const PREFIX = "site-";
const CACHE = `${PREFIX}${__MANIFEST__.version}`;
const LEGACY = ["pteraworld-v1"];
const files = new Set(__MANIFEST__.files);
const FETCH_AT_ONCE = 8;
const SLOW_MS = 4000;

const urlOf = (key: string): string => new URL(key, sw.location.origin).href;

async function install(): Promise<void> {
  const cache = await caches.open(CACHE);
  const queue = [...files];
  const worker = async (): Promise<void> => {
    for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
      const res = await fetch(urlOf(key), { cache: "reload", redirect: "manual" });
      if (!res.ok) throw new Error(`${key}: ${res.status}`);
      await cache.put(urlOf(key), res);
    }
  };
  try {
    await Promise.all(Array.from({ length: FETCH_AT_ONCE }, worker));
  } catch (e) {
    await caches.delete(CACHE);
    throw e;
  }
  await sw.skipWaiting();
}

async function activate(): Promise<void> {
  for (const k of await caches.keys()) {
    if ((k.startsWith(PREFIX) && k !== CACHE) || LEGACY.includes(k)) await caches.delete(k);
  }
  await sw.clients.claim();
}

async function networkFirst(req: Request, key: string): Promise<Response> {
  const stored = await (await caches.open(CACHE)).match(urlOf(key));
  const ctl = new AbortController();
  const timer = stored ? setTimeout(() => ctl.abort(), SLOW_MS) : undefined;
  try {
    const res = await fetch(req.url, { cache: "no-cache", redirect: req.redirect, signal: ctl.signal });
    return res.status >= 500 && stored ? stored : res;
  } catch (e) {
    if (stored) return stored;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

sw.addEventListener("install", (e) => e.waitUntil(install()));
sw.addEventListener("activate", (e) => e.waitUntil(activate()));
sw.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) return;
  const key = keysForPath(url.pathname).find((k) => files.has(k));
  if (key !== undefined) {
    e.respondWith(networkFirst(req, key));
  } else if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(async () => (await (await caches.open(CACHE)).match(urlOf("/404.html"))) ?? Response.error()),
    );
  }
});
