/** Directions as indices into a cell's four edges. */
export const UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3;
export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;
export const opposite = (d: number): number => (d + 2) % 4;

/** Edge states, in knowledge and in what the player has drawn. */
export const UNK = 0, LINE = 1, NO = 2;

/**
 * The edges between orthogonally adjacent cells of a w×h board. Horizontal edges come first: id
 * y*(w-1)+x joins (x, y) and (x+1, y). Vertical ones follow: id H + y*w + x joins (x, y) and
 * (x, y+1), with H = (w-1)*h.
 */
export interface EdgeGrid {
  w: number;
  h: number;
  /** Cells. */
  n: number;
  /** Edges. */
  ne: number;
  /** cellEdge[c*4+d]: the edge leaving cell c in direction d, or -1 at the border. */
  cellEdge: Int32Array;
  /** First (left or top) and second cell of each edge. */
  ea: Int32Array;
  eb: Int32Array;
}

const cache = new Map<string, EdgeGrid>();

export function edgeGrid(w: number, h: number): EdgeGrid {
  const key = `${w}x${h}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const n = w * h, H = (w - 1) * h, ne = H + w * (h - 1);
  const cellEdge = new Int32Array(n * 4).fill(-1);
  const ea = new Int32Array(ne), eb = new Int32Array(ne);
  for (let e = 0; e < ne; e++) {
    let a: number, b: number;
    if (e < H) {
      const y = Math.floor(e / (w - 1)), x = e % (w - 1);
      a = y * w + x;
      b = a + 1;
      cellEdge[a * 4 + RIGHT] = e;
      cellEdge[b * 4 + LEFT] = e;
    } else {
      a = e - H;
      b = a + w;
      cellEdge[a * 4 + DOWN] = e;
      cellEdge[b * 4 + UP] = e;
    }
    ea[e] = a;
    eb[e] = b;
  }
  const g: EdgeGrid = { w, h, n, ne, cellEdge, ea, eb };
  cache.set(key, g);
  return g;
}

export const edgeAt = (g: EdgeGrid, c: number, d: number): number => g.cellEdge[c * 4 + d]!;

/** The cell one step from c in direction d, or -1 off the board. */
export function step(g: EdgeGrid, c: number, d: number): number {
  const x = (c % g.w) + DX[d]!, y = Math.floor(c / g.w) + DY[d]!;
  return x < 0 || y < 0 || x >= g.w || y >= g.h ? -1 : y * g.w + x;
}

export const otherEnd = (g: EdgeGrid, e: number, c: number): number => (g.ea[e] === c ? g.eb[e]! : g.ea[e]!);

/** The state of the edge leaving c in direction d (NO off the board). */
export const stateAt = (g: EdgeGrid, k: ArrayLike<number>, c: number, d: number): number => {
  const e = edgeAt(g, c, d);
  return e < 0 ? NO : k[e]!;
};

/** Lines and unknown edges around a cell. */
export function around(g: EdgeGrid, k: ArrayLike<number>, c: number): { lines: number; unk: number[] } {
  let lines = 0;
  const unk: number[] = [];
  for (let d = 0; d < 4; d++) {
    const e = edgeAt(g, c, d);
    if (e < 0) continue;
    if (k[e] === LINE) lines++;
    else if (k[e] === UNK) unk.push(e);
  }
  return { lines, unk };
}

/**
 * Pieces of line: per cell, the id of the piece it is on (-1 if no line touches it), and per
 * piece its cells and its ends (cells with exactly one line). A closed loop has no ends.
 */
export interface Pieces {
  id: Int32Array;
  cells: number[][];
  ends: number[][];
}

export function pieces(g: EdgeGrid, k: ArrayLike<number>): Pieces {
  const id = new Int32Array(g.n).fill(-1);
  const cells: number[][] = [], ends: number[][] = [];
  for (let s = 0; s < g.n; s++) {
    if (id[s] !== -1 || around(g, k, s).lines === 0) continue;
    const pid = cells.length;
    const list: number[] = [], tips: number[] = [];
    const stack = [s];
    id[s] = pid;
    while (stack.length) {
      const c = stack.pop()!;
      list.push(c);
      let deg = 0;
      for (let d = 0; d < 4; d++) {
        const e = edgeAt(g, c, d);
        if (e < 0 || k[e] !== LINE) continue;
        deg++;
        const o = otherEnd(g, e, c);
        if (id[o] === -1) {
          id[o] = pid;
          stack.push(o);
        }
      }
      if (deg === 1) tips.push(c);
    }
    cells.push(list);
    ends.push(tips);
  }
  return { id, cells, ends };
}
