export interface SignpostPuzzle {
  w: number;
  h: number;
  /** Arrow per cell, 0..7 clockwise from north (N, NE, E, SE, S, SW, W, NW). Ignored on the last cell. */
  dirs: number[];
  /** Given number per cell, 0 for none. 1 and w*h are always given. */
  nums: number[];
}

export const DX = [0, 1, 1, 1, 0, -1, -1, -1] as const;
export const DY = [-1, -1, 0, 1, 1, 1, 0, -1] as const;

export interface Geometry {
  w: number;
  h: number;
  n: number;
  dirs: readonly number[];
  nums: readonly number[];
  /** Cells each cell's arrow points at, nearest first. Empty for the last cell. */
  ray: number[][];
  /** Cells whose arrow points at each cell. Empty for the first cell. */
  from: number[][];
  /** Cell with given 1, and with given n. */
  first: number;
  last: number;
  /** Cell holding each given number, -1 where not given (index 1..n). */
  where: Int32Array;
}

const cache = new WeakMap<SignpostPuzzle, Geometry>();

export function geometry(p: SignpostPuzzle): Geometry {
  const hit = cache.get(p);
  if (hit) return hit;
  const { w, h, dirs, nums } = p;
  const n = w * h;
  const where = new Int32Array(n + 1).fill(-1);
  nums.forEach((v, c) => { if (v > 0) where[v] = c; });
  const first = where[1]!, last = where[n]!;
  const ray: number[][] = Array.from({ length: n }, () => []);
  const from: number[][] = Array.from({ length: n }, () => []);
  for (let c = 0; c < n; c++) {
    if (c === last) continue;
    const d = dirs[c]!;
    let x = (c % w) + DX[d]!, y = Math.floor(c / w) + DY[d]!;
    while (x >= 0 && y >= 0 && x < w && y < h) {
      const t = y * w + x;
      if (t !== first) {
        ray[c]!.push(t);
        from[t]!.push(c);
      }
      x += DX[d]!;
      y += DY[d]!;
    }
  }
  const g: Geometry = { w, h, n, dirs, nums, ray, from, first, last, where };
  cache.set(p, g);
  return g;
}

/** Direction index from a to b if b lies on one of a's eight lines, else -1. */
export function directionTo(w: number, a: number, b: number): number {
  const dx = (b % w) - (a % w), dy = Math.floor(b / w) - Math.floor(a / w);
  if (dx === 0 && dy === 0) return -1;
  if (dx !== 0 && dy !== 0 && Math.abs(dx) !== Math.abs(dy)) return -1;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  for (let d = 0; d < 8; d++) if (DX[d] === sx && DY[d] === sy) return d;
  return -1;
}

/**
 * Chains formed by `next` links: per cell the chain's head, the cell's offset from the head, and
 * the chain's length (indexed by head). `num` is the number each cell gets from a given number in
 * its chain (0 when the chain has none; the first given found wins).
 */
export interface Chains {
  head: Int32Array;
  offset: Int32Array;
  length: Int32Array;
  num: Int32Array;
}

export function chains(g: Geometry, next: ArrayLike<number>, prev: ArrayLike<number>): Chains {
  const head = new Int32Array(g.n).fill(-1), offset = new Int32Array(g.n), length = new Int32Array(g.n), num = new Int32Array(g.n);
  for (let c = 0; c < g.n; c++) {
    if (prev[c] !== -1) continue;
    let k = 0, x = c, base = 0;
    while (x !== -1 && head[x] === -1) {
      head[x] = c;
      offset[x] = k;
      if (!base && g.nums[x]! > 0) base = g.nums[x]! - k;
      k++;
      x = next[x]!;
    }
    length[c] = k;
    if (base) for (let y = c, i = 0; y !== -1 && i < k; y = next[y]!, i++) num[y] = base + i;
  }
  return { head, offset, length, num };
}
