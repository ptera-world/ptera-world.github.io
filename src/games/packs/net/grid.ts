/**
 * Net geometry. Tile and barrier masks use bit k for direction k: R=1, U=2, L=4, D=8
 * (counterclockwise order, same encoding as Simon Tatham's net).
 */

import { cellName } from "../../core/names";

export const R = 1, U = 2, L = 4, D = 8;
export const DIRS = [R, U, L, D] as const;

export interface NetPuzzle {
  w: number;
  h: number;
  wrap: boolean;
  /** Starting orientation of every tile, row-major. */
  tiles: number[];
  /** Blocked sides per cell. Symmetric: a barrier is recorded on both cells it separates. */
  barriers: number[];
  /** Default powered cell. */
  source: number;
}

export const opp = (d: number): number => (d < 4 ? d << 2 : d >> 2);
export const cw = (m: number): number => ((m >> 1) | (m << 3)) & 15;
export const ccw = (m: number): number => ((m << 1) | (m >> 3)) & 15;

export function rotate(m: number, quarterTurnsCw: number): number {
  let t = ((quarterTurnsCw % 4) + 4) % 4;
  while (t-- > 0) m = cw(m);
  return m;
}

/** Distinct masks reachable by rotation, starting from m, clockwise. */
export function orientations(m: number): number[] {
  const out: number[] = [];
  for (let k = 0, x = m; k < 4; k++, x = cw(x)) if (!out.includes(x)) out.push(x);
  return out;
}

/** Quarter turns clockwise taking `from` to `to`, or -1 if `to` isn't a rotation of `from`. */
export function turnsBetween(from: number, to: number): number {
  for (let k = 0, x = from; k < 4; k++, x = cw(x)) if (x === to) return k;
  return -1;
}

export const degree = (m: number): number => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

export type Geometry = Pick<NetPuzzle, "w" | "h" | "wrap">;

/** Cell across side d of cell i, ignoring barriers; -1 off the board or if it would be i itself. */
export function neighbour(g: Geometry, i: number, d: number): number {
  let x = i % g.w, y = Math.floor(i / g.w);
  if (d === R) x++;
  else if (d === L) x--;
  else if (d === U) y--;
  else y++;
  if (g.wrap) {
    x = (x + g.w) % g.w;
    y = (y + g.h) % g.h;
  } else if (x < 0 || y < 0 || x >= g.w || y >= g.h) return -1;
  const j = y * g.w + x;
  return j === i ? -1 : j;
}

/** Cell across side d if a connection there is physically possible (on-board, no barrier), else -1. */
export function link(p: NetPuzzle, i: number, d: number): number {
  return p.barriers[i]! & d ? -1 : neighbour(p, i, d);
}

/**
 * True iff masks form one spanning tree: every open side meets an open side, and all cells
 * are connected with exactly n-1 connections.
 */
export function isTree(p: NetPuzzle, masks: readonly number[]): boolean {
  const n = p.w * p.h;
  let edges = 0;
  for (let i = 0; i < n; i++) {
    const m = masks[i]!;
    for (const d of DIRS) {
      if (!(m & d)) continue;
      const j = link(p, i, d);
      if (j < 0 || !(masks[j]! & opp(d))) return false;
      if (d === R || d === D) edges++;
    }
  }
  if (edges !== n - 1) return false;
  return connectedFrom(p, masks, 0).count === n;
}

/** Cells reachable from `start` through matched connections. */
export function connectedFrom(p: NetPuzzle, masks: readonly number[], start: number): { cells: Uint8Array; count: number } {
  const n = p.w * p.h;
  const cells = new Uint8Array(n);
  if (start < 0 || start >= n) return { cells, count: 0 };
  const stack = [start];
  cells[start] = 1;
  let count = 1;
  while (stack.length) {
    const i = stack.pop()!;
    for (const d of DIRS) {
      if (!(masks[i]! & d)) continue;
      const j = link(p, i, d);
      if (j < 0 || cells[j] || !(masks[j]! & opp(d))) continue;
      cells[j] = 1;
      count++;
      stack.push(j);
    }
  }
  return { cells, count };
}

/** Make barriers symmetric and drop ones that face off the board. */
export function normalizeBarriers(g: Geometry, barriers: number[]): number[] {
  const out = barriers.map(() => 0);
  barriers.forEach((b, i) => {
    for (const d of DIRS) {
      if (!(b & d)) continue;
      const j = neighbour(g, i, d);
      if (j < 0) continue;
      out[i]! |= d;
      out[j]! |= opp(d);
    }
  });
  return out;
}

/** Board-wide cell name ("C5": column letter, row number, from the top-left of the unscrolled board). */
export const coord = (p: Geometry, i: number): string => cellName(i % p.w, Math.floor(i / p.w));

/** Default source: the middle cell (rounded down), as in sgt. */
export const centre = (g: Geometry): number => Math.floor(g.h / 2) * g.w + Math.floor(g.w / 2);
