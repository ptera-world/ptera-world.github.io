import type { Rng } from "../../core/rng";
import type { Spot } from "./layouts";
import { matchKey } from "./tiles";

/** Which spots touch which, for the free-tile rule. Built once per layout. */
export interface Board {
  n: number;
  /** Spots on the next layer up that overlap this one. */
  above: number[][];
  /** Spots on the layer below that this one overlaps. */
  below: number[][];
  /** Same-layer spots touching the left edge, and the right edge. */
  left: number[][];
  right: number[][];
  /** Every spot that must go before this one can be free from above (transitively), as flags. */
  over: Uint8Array[];
}

const boards = new WeakMap<readonly Spot[], Board>();

export function boardOf(spots: readonly Spot[]): Board {
  let b = boards.get(spots);
  if (b) return b;
  const n = spots.length;
  const above: number[][] = spots.map(() => []), below: number[][] = spots.map(() => []);
  const left: number[][] = spots.map(() => []), right: number[][] = spots.map(() => []);
  for (let i = 0; i < n; i++) {
    const [x, y, z] = spots[i]!;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const [u, v, w] = spots[j]!;
      if (Math.abs(v - y) >= 2) continue;
      if (w === z + 1 && Math.abs(u - x) < 2) { above[i]!.push(j); below[j]!.push(i); }
      if (w === z && u === x - 2) left[i]!.push(j);
      if (w === z && u === x + 2) right[i]!.push(j);
    }
  }
  const over = spots.map(() => new Uint8Array(n));
  const order = spots.map((_, i) => i).sort((a, c) => spots[c]![2] - spots[a]![2]);
  for (const i of order) for (const j of above[i]!) { over[i]![j] = 1; for (let k = 0; k < n; k++) if (over[j]![k]) over[i]![k] = 1; }
  b = { n, above, below, left, right, over };
  boards.set(spots, b);
  return b;
}

/** Gone flags: 1 once a tile has been matched away. */
export type Gone = ArrayLike<number>;

export function isFree(b: Board, gone: Gone, i: number): boolean {
  if (gone[i]) return false;
  for (const j of b.above[i]!) if (!gone[j]) return false;
  return b.left[i]!.every((j) => gone[j]) || b.right[i]!.every((j) => gone[j]);
}

export const freeTiles = (b: Board, gone: Gone): number[] => Array.from({ length: b.n }, (_, i) => i).filter((i) => isFree(b, gone, i));

/** Every pair of free tiles that match, lower spot first. */
export function freePairs(b: Board, tiles: readonly number[], gone: Gone): [number, number][] {
  const free = freeTiles(b, gone);
  const out: [number, number][] = [];
  for (let x = 0; x < free.length; x++) for (let y = x + 1; y < free.length; y++) {
    if (matchKey(tiles[free[x]!]!) === matchKey(tiles[free[y]!]!)) out.push([free[x]!, free[y]!]);
  }
  return out;
}

/** Tiles left of each match group, by match key. */
export function remaining(tiles: readonly number[], gone: Gone): Map<number, number[]> {
  const m = new Map<number, number[]>();
  tiles.forEach((t, i) => {
    if (gone[i]) return;
    const k = matchKey(t);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(i);
  });
  return m;
}

/** Calls `visit` with the first two tiles of every group whose remaining tiles are all free, until it returns true. */
export function eachSafePair(b: Board, tiles: readonly number[], gone: Gone, visit: (pair: [number, number]) => boolean | void): void {
  for (const [, idx] of [...remaining(tiles, gone)].sort((a, c) => a[0] - c[0])) {
    if (idx.length % 2 === 0 && idx.every((i) => isFree(b, gone, i)) && visit([idx[0]!, idx[1]!]) === true) return;
  }
}

/** A group whose every remaining tile is free: pairing them any way can't go wrong. */
export function safePair(b: Board, tiles: readonly number[], gone: Gone): [number, number] | null {
  let found: [number, number] | null = null;
  eachSafePair(b, tiles, gone, (pair) => { found = pair; return true; });
  return found;
}

/** Two tiles of a group with nothing else left of it, one stacked above the other: they can never both be free. */
export function stuckPair(b: Board, tiles: readonly number[], gone: Gone): [number, number] | null {
  for (const [, idx] of remaining(tiles, gone)) {
    if (idx.length !== 2) continue;
    const [a, c] = idx as [number, number];
    if (b.over[a]![c] || b.over[c]![a]) return [a, c];
  }
  return null;
}

export interface Search {
  path: [number, number][] | null;
  impossible: boolean;
  nodes: number;
}

/** How much tile i holds up: the tiles under it, and the row it closes off on its blocked side. */
function weight(b: Board, gone: Gone, i: number): number {
  let w = 0;
  for (let j = 0; j < b.n; j++) if (!gone[j] && b.over[j]![i]) w += 2;
  const side = b.left[i]!.every((j) => gone[j]) ? b.right : b.left;
  const seen = new Set<number>();
  for (let row = side[i]!.filter((j) => !gone[j]); row.length; row = row.flatMap((j) => side[j]!.filter((k) => !gone[k] && !seen.has(k)))) {
    for (const j of row) seen.add(j);
  }
  return w + seen.size;
}

export const BUDGET = 60_000;

/** Depth-first search for a way to clear the board, safe pairs taken first. Deterministic per budget. */
export function solve(spots: readonly Spot[], tiles: readonly number[], start: Gone, budget = BUDGET): Search {
  const b = boardOf(spots);
  const gone = Uint8Array.from(start);
  const dead = new Set<string>();
  let nodes = 0, cut = false;
  const key = () => {
    let s = "";
    for (let i = 0; i < b.n; i += 16) {
      let v = 0;
      for (let k = 0; k < 16 && i + k < b.n; k++) if (gone[i + k]) v |= 1 << k;
      s += String.fromCharCode(v);
    }
    return s;
  };
  const left = () => { for (let i = 0; i < b.n; i++) if (!gone[i]) return true; return false; };
  const go = (): [number, number][] | null => {
    if (!left()) return [];
    if (stuckPair(b, tiles, gone)) return null;
    const k = key();
    if (dead.has(k)) return null;
    if (++nodes > budget) { cut = true; return null; }
    const safe = safePair(b, tiles, gone);
    const options = safe ? [safe] : freePairs(b, tiles, gone)
      .map((p) => ({ p, w: weight(b, gone, p[0]) + weight(b, gone, p[1]) }))
      .sort((x, y) => y.w - x.w)
      .map((o) => o.p);
    for (const [x, y] of options) {
      gone[x] = 1; gone[y] = 1;
      const rest = go();
      gone[x] = 0; gone[y] = 0;
      if (rest) return [[x, y], ...rest];
      if (cut) return null;
    }
    dead.add(k);
    return null;
  };
  const path = go();
  return { path, impossible: !path && !cut, nodes };
}

/**
 * A random order of removing free pairs that clears the layout (spots only, no tiles yet), or
 * null if this attempt ran into a dead end.
 */
export function clearingOrder(spots: readonly Spot[], rng: Rng): [number, number][] | null {
  const b = boardOf(spots);
  const gone = new Uint8Array(b.n);
  const out: [number, number][] = [];
  for (let left = b.n; left > 0; left -= 2) {
    const free = freeTiles(b, gone);
    if (free.length < 2) return null;
    const x = free.splice(rng.int(free.length), 1)[0]!;
    const y = free[rng.int(free.length)]!;
    gone[x] = 1; gone[y] = 1;
    out.push([x, y]);
  }
  return out;
}
