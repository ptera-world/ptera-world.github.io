import type { Rng } from "../../../core/rng";

export const ORTHO: readonly [number, number][] = [[-1, 0], [0, 1], [1, 0], [0, -1]];
export const DIAG: readonly [number, number][] = [[-1, -1], [-1, 1], [1, 1], [1, -1]];
export const KING: readonly [number, number][] = [...ORTHO, ...DIAG];
export const KNIGHT: readonly [number, number][] = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];

export function offsets(n: number, cell: number, deltas: readonly [number, number][]): number[] {
  const r = Math.floor(cell / n), c = cell % n;
  const out: number[] = [];
  for (const [dr, dc] of deltas) {
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && cc >= 0 && rr < n && cc < n) out.push(rr * n + cc);
  }
  return out;
}

/** Every unordered pair (a < b) of cells related by `deltas`. */
export function pairs(n: number, deltas: readonly [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (let a = 0; a < n * n; a++) for (const b of offsets(n, a, deltas)) if (a < b) out.push([a, b]);
  return out;
}

export const orthoPairs = (n: number) => pairs(n, ORTHO);

export const isOrthoAdjacent = (n: number, a: number, b: number): boolean =>
  Math.abs(Math.floor(a / n) - Math.floor(b / n)) + Math.abs((a % n) - (b % n)) === 1;

export const isKingAdjacent = (n: number, a: number, b: number): boolean =>
  a !== b && Math.abs(Math.floor(a / n) - Math.floor(b / n)) <= 1 && Math.abs((a % n) - (b % n)) <= 1;

/** Box width × height for sizes with a conventional box layout. */
export function boxDims(n: number): [number, number] | null {
  switch (n) {
    case 4: return [2, 2];
    case 6: return [3, 2];
    case 8: return [4, 2];
    case 9: return [3, 3];
    default: return null;
  }
}

export function boxIds(n: number, w: number, h: number): number[] {
  const perRow = n / w;
  return Array.from({ length: n * n }, (_, cell) => {
    const r = Math.floor(cell / n), c = cell % n;
    return Math.floor(r / h) * perRow + Math.floor(c / w);
  });
}

export function connected(n: number, cells: readonly number[]): boolean {
  if (cells.length === 0) return true;
  const set = new Set(cells);
  const seen = new Set([cells[0]!]);
  const stack = [cells[0]!];
  while (stack.length) {
    const c = stack.pop()!;
    for (const d of offsets(n, c, ORTHO)) if (set.has(d) && !seen.has(d)) {
      seen.add(d);
      stack.push(d);
    }
  }
  return seen.size === set.size;
}

/**
 * Random partition of the grid into orthogonally connected groups of at most maxSize cells.
 * `accepts(group, cell)` may refuse a cell joining a group.
 */
export function partition(n: number, rng: Rng, sizeOf: () => number, accepts: (group: readonly number[], cell: number) => boolean = () => true): number[][] {
  const owner = Array.from({ length: n * n }, () => -1);
  const groups: number[][] = [];
  for (const start of rng.shuffle([...Array(n * n).keys()])) {
    if (owner[start] !== -1) continue;
    const g = [start];
    owner[start] = groups.length;
    const want = sizeOf();
    while (g.length < want) {
      const frontier = g.flatMap((c) => offsets(n, c, ORTHO)).filter((c) => owner[c] === -1 && accepts(g, c));
      if (!frontier.length) break;
      const c = rng.pick(frontier);
      owner[c] = groups.length;
      g.push(c);
    }
    groups.push(g);
  }
  return groups.map((g) => g.sort((a, b) => a - b));
}

/**
 * Random jigsaw layout: n connected regions of n cells, reached by random boundary swaps from
 * the standard boxes (or row bands when n has no box layout).
 */
export function jigsaw(n: number, rng: Rng): number[] {
  const dims = boxDims(n);
  const ids = dims ? boxIds(n, dims[0], dims[1]) : Array.from({ length: n * n }, (_, c) => Math.floor(c / n));
  const members = (id: number) => ids.flatMap((v, c) => (v === id ? [c] : []));
  const swaps = n * n * 6;
  for (let i = 0; i < swaps; i++) {
    const a = rng.int(n * n);
    const nb = offsets(n, a, ORTHO).filter((c) => ids[c] !== ids[a]);
    if (!nb.length) continue;
    const ra = ids[a]!, rb = ids[rng.pick(nb)]!;
    const back = members(rb).filter((c) => c !== a && offsets(n, c, ORTHO).some((d) => ids[d] === ra));
    if (!back.length) continue;
    const b = rng.pick(back);
    ids[a] = rb;
    ids[b] = ra;
    if (!connected(n, members(ra)) || !connected(n, members(rb))) {
      ids[a] = ra;
      ids[b] = rb;
    }
  }
  return ids;
}

/** Cells along a line starting at off-grid position (r, c) stepping (dr, dc), clipped to the grid. */
export function ray(n: number, r: number, c: number, dr: number, dc: number): number[] {
  const out: number[] = [];
  let rr = r + dr, cc = c + dc;
  while (rr >= 0 && cc >= 0 && rr < n && cc < n) {
    out.push(rr * n + cc);
    rr += dr;
    cc += dc;
  }
  return out;
}

/**
 * Random self-avoiding king-move path through cells not in `used`, where each step must satisfy
 * `step(prev, next)`. Returns the longest of a few greedy attempts, at most maxLen cells.
 */
export function randomPath(n: number, rng: Rng, start: number, maxLen: number, used: ReadonlySet<number>, step: (path: readonly number[], next: number) => boolean): number[] {
  const path = [start];
  const inPath = new Set(path);
  while (path.length < maxLen) {
    const last = path[path.length - 1]!;
    const opts = offsets(n, last, KING).filter((c) => !inPath.has(c) && !used.has(c) && step(path, c)
      // no diagonal crossing of the path itself
      && !(Math.abs(c - last) !== 1 && Math.abs(c - last) !== n && crosses(n, path, last, c)));
    if (!opts.length) break;
    const c = rng.pick(opts);
    path.push(c);
    inPath.add(c);
  }
  return path;
}

function crosses(n: number, path: readonly number[], a: number, b: number): boolean {
  const ar = Math.floor(a / n), ac = a % n, br = Math.floor(b / n), bc = b % n;
  const x = ar * n + bc, y = br * n + ac;
  for (let i = 0; i + 1 < path.length; i++) {
    const p = path[i]!, q = path[i + 1]!;
    if ((p === x && q === y) || (p === y && q === x)) return true;
  }
  return false;
}
