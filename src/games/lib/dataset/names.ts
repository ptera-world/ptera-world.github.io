import type { DataItem } from "../../core/types";

/**
 * What a typed name is compared as: accents, punctuation, spaces and case dropped, ♀/♂ as f/m,
 * so "Farfetch'd", "farfetchd" and "Farfetch’d" are one name.
 */
export function normalizeName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/♀/g, "f").replace(/♂/g, "m").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const keyCache = new WeakMap<DataItem, string[]>();
function keys(it: DataItem): string[] {
  let k = keyCache.get(it);
  if (!k) keyCache.set(it, k = [it.name, ...(it.aliases ?? [])].map(normalizeName));
  return k;
}

/** Words of a name, normalized, for matching a typed start of any word ("raichu" in "Alolan Raichu"). */
const wordCache = new WeakMap<DataItem, string[]>();
function words(it: DataItem): string[] {
  let w = wordCache.get(it);
  if (!w) wordCache.set(it, w = [it.name, ...(it.aliases ?? [])].flatMap((n) => n.split(/[\s\-:.()]+/)).map(normalizeName).filter(Boolean));
  return w;
}

/**
 * Items whose name (or alias) fits what was typed, best first: the exact name, then names starting
 * with it, then a word starting with it, then containing it. Ties keep the items' order.
 */
export function matchNames<T extends DataItem>(items: readonly T[], typed: string, limit = 8): T[] {
  const q = normalizeName(typed);
  if (!q) return [];
  const scored: { it: T; score: number; i: number }[] = [];
  items.forEach((it, i) => {
    const ks = keys(it);
    let score = 0;
    if (ks.includes(q)) score = 4;
    else if (ks.some((k) => k.startsWith(q))) score = 3;
    else if (words(it).some((w) => w.startsWith(q))) score = 2;
    else if (ks.some((k) => k.includes(q))) score = 1;
    if (score) scored.push({ it, score, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, limit).map((s) => s.it);
}

/** The item a typed name names exactly, if exactly one does. */
export function exactName<T extends DataItem>(items: readonly T[], typed: string): T | undefined {
  const q = normalizeName(typed);
  const hits = items.filter((it) => keys(it).includes(q));
  return hits.length === 1 ? hits[0] : undefined;
}
