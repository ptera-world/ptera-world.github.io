import { DOWN, LEFT, RIGHT, UP } from "./edges";

/** While a technique is picked, a point this close to an edge (as a share of the cell size, on each side of it) points at the edge. */
export const CAST_BAND = 0.3;

/**
 * The side of a cell (UP, RIGHT, DOWN or LEFT) a point within `band` of it points at: the nearest
 * such side `has` accepts, ties going to the first in that order; -1 when none, i.e. the cell.
 * `fx`, `fy`: the point's offset inside the cell as a share of its size, 0 to 1.
 */
export function sideAt(fx: number, fy: number, band: number, has: (side: number) => boolean): number {
  const dist = [fy, 1 - fx, 1 - fy, fx];
  let best = -1;
  for (const d of [UP, RIGHT, DOWN, LEFT]) if (dist[d]! < band && has(d) && (best < 0 || dist[d]! < dist[best]!)) best = d;
  return best;
}
