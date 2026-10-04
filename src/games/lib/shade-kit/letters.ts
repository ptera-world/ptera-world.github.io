import { neighbours, pieces } from "../grid-kit/grid";

const SYMBOLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Regions from rows of characters, one per cell: each connected group of equal characters is one region. */
export function parseRegionLetters(text: string): { w: number; h: number; regions: number[] } {
  const rows = text.trim().split(/\r?\n/).map((r) => [...r.trim()]);
  const w = rows[0]!.length, h = rows.length;
  if (!w || rows.some((r) => r.length !== w)) throw new Error("every row needs the same number of cells");
  const chars = rows.flat();
  const nbrs = neighbours(w, h).map((ns, c) => ns.filter((d) => chars[d] === chars[c]));
  return { w, h, regions: Array.from(pieces(nbrs, () => true).id) };
}

/** Rows of characters, one per cell; touching regions always get different characters. */
export function regionLetters(w: number, h: number, regions: readonly number[]): string {
  const nbrs = neighbours(w, h);
  const sym = new Map<number, number>();
  for (let c = 0; c < regions.length; c++) {
    const r = regions[c]!;
    if (sym.has(r)) continue;
    const used = new Set<number>();
    for (let d = 0; d < regions.length; d++) if (regions[d] === r) for (const e of nbrs[d]!) if (regions[e] !== r && sym.has(regions[e]!)) used.add(sym.get(regions[e]!)!);
    let s = 0;
    while (used.has(s)) s++;
    sym.set(r, s);
  }
  const rows: string[] = [];
  for (let y = 0; y < h; y++) rows.push(regions.slice(y * w, (y + 1) * w).map((r) => SYMBOLS[sym.get(r)!]).join(""));
  return rows.join("\n");
}
