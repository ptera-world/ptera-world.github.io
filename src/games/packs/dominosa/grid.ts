export interface DominosaPuzzle {
  /** Highest number on a domino; the set is every pair from 0..n. */
  n: number;
  w: number;
  h: number;
  /** Row-major numbers, 0..n. */
  numbers: number[];
}

/**
 * A placement is a pair of orthogonally adjacent cells (where a domino could lie). Horizontal
 * placements come first: id y*(w-1)+x joins (x, y) and (x+1, y). Vertical ones follow: id
 * H + y*w + x joins (x, y) and (x, y+1), with H = (w-1)*h.
 */
export interface Geometry {
  n: number;
  w: number;
  h: number;
  wh: number;
  numbers: readonly number[];
  /** Number of placements. */
  np: number;
  /** First cell of each placement (left or top). */
  pa: Int32Array;
  /** Second cell of each placement (right or bottom). */
  pb: Int32Array;
  /** Domino index of each placement. */
  pd: Int32Array;
  /** Placements touching each cell. */
  byCell: number[][];
  /** Placements showing each domino. */
  byDomino: number[][];
  /** Number of distinct dominoes, (n+1)(n+2)/2. */
  nd: number;
  /** Placement joining two adjacent cells, or -1. */
  between(a: number, b: number): number;
}

export const tri = (k: number): number => (k * (k + 1)) / 2;
/** Domino index of the pair {a, b}. */
export const dindex = (a: number, b: number): number => tri(Math.max(a, b)) + Math.min(a, b);

/** The pair of numbers on domino index d, smaller first. */
export function dpair(d: number): [number, number] {
  let hi = 0;
  while (tri(hi + 1) <= d) hi++;
  return [d - tri(hi), hi];
}

/** Placements of a w×h board (numbers not needed). */
export function placementCount(w: number, h: number): number {
  return (w - 1) * h + w * (h - 1);
}

const cache = new WeakMap<DominosaPuzzle, Geometry>();

export function geometry(p: DominosaPuzzle): Geometry {
  const hit = cache.get(p);
  if (hit) return hit;
  const { n, w, h, numbers } = p;
  const wh = w * h;
  const H = (w - 1) * h;
  const np = placementCount(w, h);
  const pa = new Int32Array(np), pb = new Int32Array(np), pd = new Int32Array(np);
  const nd = tri(n + 1);
  const byCell: number[][] = Array.from({ length: wh }, () => []);
  const byDomino: number[][] = Array.from({ length: nd }, () => []);
  for (let id = 0; id < np; id++) {
    let a: number, b: number;
    if (id < H) {
      const y = Math.floor(id / (w - 1)), x = id % (w - 1);
      a = y * w + x;
      b = a + 1;
    } else {
      a = id - H;
      b = a + w;
    }
    pa[id] = a;
    pb[id] = b;
    pd[id] = dindex(numbers[a]!, numbers[b]!);
    byCell[a]!.push(id);
    byCell[b]!.push(id);
    byDomino[pd[id]!]!.push(id);
  }
  const between = (a: number, b: number): number => {
    if (a > b) [a, b] = [b, a];
    if (b === a + 1 && a % w !== w - 1) return Math.floor(a / w) * (w - 1) + (a % w);
    if (b === a + w) return H + a;
    return -1;
  };
  const g: Geometry = { n, w, h, wh, numbers, np, pa, pb, pd, byCell, byDomino, nd, between };
  cache.set(p, g);
  return g;
}

/** The cell of placement p that isn't c. */
export const other = (g: Geometry, p: number, c: number): number => (g.pa[p] === c ? g.pb[p]! : g.pa[p]!);

/** True if placements p and q share a cell. */
export const overlaps = (g: Geometry, p: number, q: number): boolean =>
  g.pa[p] === g.pa[q] || g.pa[p] === g.pb[q] || g.pb[p] === g.pa[q] || g.pb[p] === g.pb[q];
