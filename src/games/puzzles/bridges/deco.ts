import type { Derived } from "../../core/session";

/**
 * Derived-annotation channel between bridges plugins and views. Plugins add CSS classes and
 * labels; views apply them. Known classes styled by the built-in view:
 *   island: done, error, g0..g7 (group colours)
 *   edge:   error, wrong, guide
 * Mods may add their own classes and ship matching CSS.
 */
export const DECO = "bridges.deco";

export interface Deco {
  island: Readonly<Record<number, readonly string[]>>;
  edge: Readonly<Record<number, readonly string[]>>;
  /** Replaces an island's number. */
  label: Readonly<Record<number, string>>;
  /** Small badge beside an island. */
  badge: Readonly<Record<number, string>>;
}

export interface DecoBuilder {
  island(i: number, cls: string): void;
  edge(e: number, cls: string): void;
  label(i: number, text: string): void;
  badge(i: number, text: string): void;
}

const EMPTY: Deco = { island: {}, edge: {}, label: {}, badge: {} };

export function getDeco(d: Derived): Deco {
  return (d[DECO] as Deco | undefined) ?? EMPTY;
}

/** Copy-on-write: returns a new Derived with additions from `fn`. */
export function decorate(d: Derived, fn: (b: DecoBuilder) => void): Derived {
  const prev = getDeco(d);
  const next = {
    island: { ...prev.island } as Record<number, readonly string[]>,
    edge: { ...prev.edge } as Record<number, readonly string[]>,
    label: { ...prev.label } as Record<number, string>,
    badge: { ...prev.badge } as Record<number, string>,
  };
  fn({
    island: (i, cls) => { next.island[i] = [...(next.island[i] ?? []), cls]; },
    edge: (e, cls) => { next.edge[e] = [...(next.edge[e] ?? []), cls]; },
    label: (i, text) => { next.label[i] = text; },
    badge: (i, text) => { next.badge[i] = text; },
  });
  return { ...d, [DECO]: next };
}
