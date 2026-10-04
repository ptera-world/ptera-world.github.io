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

/**
 * Keys of the shared "prefs" store and their value types, declared by the modules that use them:
 * `declare module "…/core/storage" { interface Prefs { minCell: number } }`.
 */
export interface Prefs {}

export interface TypedStore<T> {
  get<K extends keyof T & string>(key: K, fallback: T[K]): T[K];
  set<K extends keyof T & string>(key: K, value: T[K]): void;
  remove(key: keyof T & string): void;
}

export const prefs: TypedStore<Prefs> = namespace("prefs");
