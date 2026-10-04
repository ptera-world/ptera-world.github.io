import { namespace } from "./storage";

/**
 * Locale and translations as a shared service. Text is written in US English at the call site
 * and that text is the fallback, so nothing breaks while a translation is missing. Packs (or
 * translation packs) register messages per namespace and locale; any message library (e.g. a
 * per-pack compiled one) can be used instead, reading `locale()` and `onLocaleChange`.
 */

export type Messages = Record<string, string>;

const prefs = namespace("prefs");
const catalog = new Map<string, Map<string, Messages>>();
const listeners = new Set<() => void>();

function browserLocale(): string {
  return typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
}

export function locale(): string {
  return prefs.get<string | null>("locale", null) ?? browserLocale();
}

export function setLocale(tag: string | null): void {
  prefs.set("locale", tag);
  for (const cb of listeners) cb();
}

export function onLocaleChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Add (or extend) the messages for a namespace in one locale, e.g. register("mines", "de", { flag: "Flagge" }). */
export function register(ns: string, tag: string, messages: Messages): void {
  if (!catalog.has(ns)) catalog.set(ns, new Map());
  const byTag = catalog.get(ns)!;
  byTag.set(tag, { ...byTag.get(tag), ...messages });
  for (const cb of listeners) cb();
}

/** Locales that have any messages registered. */
export function available(): string[] {
  const out = new Set<string>(["en-US"]);
  for (const byTag of catalog.values()) for (const tag of byTag.keys()) out.add(tag);
  return [...out];
}

/**
 * The message for `key` in the current locale (exact tag, then its language, e.g. "pt-BR" → "pt"),
 * else `fallback`. `{name}` placeholders are filled from `params`.
 */
export function t(ns: string, key: string, fallback: string, params?: Record<string, string | number>): string {
  const tag = locale();
  const byTag = catalog.get(ns);
  const text = byTag?.get(tag)?.[key] ?? byTag?.get(tag.split("-")[0]!)?.[key] ?? fallback;
  return params ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : text;
}
