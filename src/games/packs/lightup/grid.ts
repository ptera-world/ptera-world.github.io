/** Cell value in `LightupPuzzle.cells`: an open square. */
export const EMPTY = -2;
/** Cell value in `LightupPuzzle.cells`: a wall without a number. 0..4 = numbered wall. */
export const BLACK = -1;

export interface LightupPuzzle {
  w: number;
  h: number;
  /** Row-major; EMPTY, BLACK, or a clue 0..4. */
  cells: number[];
}

export interface Geometry {
  w: number;
  h: number;
  n: number;
  cells: readonly number[];
  /** Open cells in index order. */
  empties: number[];
  /** Numbered walls in index order. */
  clues: number[];
  /** For an open cell: every other open cell sharing its row or column segment. Empty for walls. */
  sees: number[][];
  /** For any cell: orthogonally adjacent open cells. */
  adj: number[][];
  /** For any cell: all orthogonal neighbours. */
  nbrs: number[][];
  /** seeMask[a * n + b] = 1 iff a and b are distinct open cells that see each other. */
  seeMask: Uint8Array;
}

export const isWall = (v: number): boolean => v !== EMPTY;
export const isClue = (v: number): boolean => v >= 0;

const cache = new WeakMap<LightupPuzzle, Geometry>();

/** Derived lookup tables, memoized per puzzle object. */
export function geometry(p: LightupPuzzle): Geometry {
  const hit = cache.get(p);
  if (hit) return hit;
  const { w, h, cells } = p;
  const n = w * h;
  const empties: number[] = [];
  const clues: number[] = [];
  const sees: number[][] = Array.from({ length: n }, () => []);
  const adj: number[][] = Array.from({ length: n }, () => []);
  const nbrs: number[][] = Array.from({ length: n }, () => []);
  const seeMask = new Uint8Array(n * n);
  for (let i = 0; i < n; i++) {
    if (cells[i] === EMPTY) empties.push(i);
    else if (isClue(cells[i]!)) clues.push(i);
    const x = i % w, y = Math.floor(i / w);
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      nbrs[i]!.push(j);
      if (cells[j] === EMPTY) adj[i]!.push(j);
    }
    if (cells[i] !== EMPTY) continue;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]] as const) {
      let nx = x + dx, ny = y + dy;
      while (nx >= 0 && ny >= 0 && nx < w && ny < h && cells[ny * w + nx] === EMPTY) {
        const j = ny * w + nx;
        sees[i]!.push(j);
        seeMask[i * n + j] = 1;
        nx += dx;
        ny += dy;
      }
    }
  }
  const g: Geometry = { w, h, n, cells, empties, clues, sees, adj, nbrs, seeMask };
  cache.set(p, g);
  return g;
}

/** Same geometry with different wall values; `cells` must have exactly g's open cells. */
export function withWalls(g: Geometry, cells: readonly number[]): Geometry {
  const clues: number[] = [];
  for (let i = 0; i < g.n; i++) if (isClue(cells[i]!)) clues.push(i);
  return { ...g, cells, clues };
}

/** Lit-by count per cell for a set of light flags (1 = light). */
export function litCounts(g: Geometry, lights: ArrayLike<number>): Int16Array {
  const out = new Int16Array(g.n);
  for (const c of g.empties) {
    if (lights[c] !== 1) continue;
    out[c]!++;
    for (const j of g.sees[c]!) out[j]!++;
  }
  return out;
}
