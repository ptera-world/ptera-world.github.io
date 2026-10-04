import type { KeyValue } from "./types";

/** localStorage under a prefix. Every access is guarded: storage may be absent, full, or throw. */
export function namespace(prefix: string): KeyValue {
  const full = (k: string) => `games:${prefix}:${k}`;
  return {
    get<T>(key: string, fallback: T): T {
      try {
        const raw = localStorage.getItem(full(key));
        return raw === null ? fallback : (JSON.parse(raw) as T);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(full(key), JSON.stringify(value));
      } catch {
        // quota / disabled storage: persistence is best-effort
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(full(key));
      } catch {
        // ignore
      }
    },
  };
}
