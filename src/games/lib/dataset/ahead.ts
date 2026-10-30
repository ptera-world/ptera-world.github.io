/**
 * Ask the site's service worker to download media ahead, so they work offline before ever being
 * shown (see `media-ahead` in src/sw/worker.ts). "wifi": only while the browser says the
 * connection is wifi or ethernet; browsers that don't say (Safari, Firefox, desktop Chrome) never
 * count as wifi. "off" stops a download in progress. Does nothing without a service worker (the
 * dev server has none).
 */
export type AheadWhen = "off" | "wifi" | "always";

export function downloadAhead(urls: readonly string[], when: AheadWhen): void {
  const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
  if (!sw) return;
  void sw.ready.then((reg) => reg.active?.postMessage({ type: "media-ahead", urls: [...urls], when })).catch(() => {});
}

/** How many of `urls` the media cache already holds (see MEDIA_CACHE in src/sw/routes.ts). */
export async function storedCount(urls: readonly string[]): Promise<number> {
  try {
    const cache = await caches.open("media-v1");
    const have = new Set((await cache.keys()).map((r) => r.url));
    return urls.filter((u) => have.has(u)).length;
  } catch {
    return 0;
  }
}
