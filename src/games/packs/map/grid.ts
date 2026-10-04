import type { Rng } from "../../core/rng";

export const COLOURS = 4;
export const ALL = 15;

export interface MapPuzzle {
  w: number;
  h: number;
  /** Number of regions. */
  n: number;
  /** Region per cell, row-major, numbered by first appearance in reading order. */
  map: number[];
  /** Colour shown from the start per region, 0..3, or -1. */
  given: number[];
}

export interface Geometry {
  w: number;
  h: number;
  n: number;
  map: readonly number[];
  /** Regions sharing a cell edge with each region, ascending. */
  adj: number[][];
  /** Cells of each region in reading order. */
  cells: number[][];
  /** A cell near the middle of each region, for labels and marks. */
  anchor: number[];
}

const cache = new WeakMap<object, Geometry>();

export function geometry(p: Pick<MapPuzzle, "w" | "h" | "n" | "map">): Geometry {
  const hit = cache.get(p);
  if (hit) return hit;
  const { w, h, n, map } = p;
  const adjSet: Set<number>[] = Array.from({ length: n }, () => new Set());
  const cells: number[][] = Array.from({ length: n }, () => []);
  for (let c = 0; c < w * h; c++) {
    const r = map[c]!;
    cells[r]!.push(c);
    if (c % w < w - 1 && map[c + 1] !== r) { adjSet[r]!.add(map[c + 1]!); adjSet[map[c + 1]!]!.add(r); }
    if (c + w < w * h && map[c + w] !== r) { adjSet[r]!.add(map[c + w]!); adjSet[map[c + w]!]!.add(r); }
  }
  const anchor = cells.map((list) => {
    const mx = list.reduce((s, c) => s + (c % w), 0) / list.length, my = list.reduce((s, c) => s + Math.floor(c / w), 0) / list.length;
    let best = list[0]!, bd = Infinity;
    for (const c of list) {
      const d = (c % w - mx) ** 2 + (Math.floor(c / w) - my) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  });
  const g: Geometry = { w, h, n, map, adj: adjSet.map((s) => [...s].sort((a, b) => a - b)), cells, anchor };
  cache.set(p, g);
  return g;
}

/** Region ids renumbered by first appearance in reading order. */
export function renumber(map: number[]): { map: number[]; n: number } {
  const ids = new Map<number, number>();
  const out = map.map((r) => {
    if (!ids.has(r)) ids.set(r, ids.size);
    return ids.get(r)!;
  });
  return { map: out, n: ids.size };
}

/** n connected regions grown from random seeds until they cover the board. */
export function randomMap(w: number, h: number, n: number, rng: Rng): number[] {
  const wh = w * h;
  const map = Array.from({ length: wh }, () => -1);
  const seeds = rng.shuffle(Array.from({ length: wh }, (_, i) => i)).slice(0, n);
  seeds.forEach((c, r) => { map[c] = r; });
  const frontier: [number, number][] = [];
  const push = (c: number, r: number) => {
    const x = c % w;
    for (const d of [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1, c - w, c + w]) {
      if (d >= 0 && d < wh && map[d] === -1) frontier.push([d, r]);
    }
  };
  seeds.forEach((c, r) => push(c, r));
  while (frontier.length) {
    const i = rng.int(frontier.length);
    const [c, r] = frontier[i]!;
    frontier[i] = frontier[frontier.length - 1]!;
    frontier.pop();
    if (map[c] !== -1) continue;
    map[c] = r;
    push(c, r);
  }
  return map;
}

/** A proper four-colouring of the region graph, chosen at random, or null if the search gives up. */
export function randomColouring(g: Geometry, rng: Rng): number[] | null {
  const col = Array.from({ length: g.n }, () => -1);
  const order = rng.shuffle(Array.from({ length: g.n }, (_, i) => i)).sort((a, b) => g.adj[b]!.length - g.adj[a]!.length);
  let budget = 200000;
  const go = (i: number): boolean => {
    if (i === order.length) return true;
    if (--budget < 0) return false;
    const r = order[i]!;
    for (const c of rng.shuffle([0, 1, 2, 3])) {
      if (g.adj[r]!.some((o) => col[o] === c)) continue;
      col[r] = c;
      if (go(i + 1)) return true;
    }
    col[r] = -1;
    return false;
  };
  return go(0) ? col : null;
}
