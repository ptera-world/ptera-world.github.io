/** Cell values in `UndeadPuzzle.cells`. */
export const EMPTY = 0, MIRROR_L = 1, MIRROR_R = 2;
/** Monster codes (as values and given cells); bit (1 << (code - 1)) in candidate masks. */
export const GHOST = 1, VAMPIRE = 2, ZOMBIE = 3;
export const ALL = 7;
export const bit = (m: number): number => 1 << (m - 1);

export interface UndeadPuzzle {
  w: number;
  h: number;
  /** Row-major: EMPTY, MIRROR_L (\), MIRROR_R (/). */
  cells: number[];
  /** Monsters shown from the start, per cell (0 none). */
  given: number[];
  /** How many ghosts, vampires and zombies there are. */
  counts: [number, number, number];
  /**
   * Sight counts around the edge, clockwise: top edge left→right, right edge top→bottom, bottom
   * edge right→left, left edge bottom→top. 2*(w+h) entries.
   */
  clues: number[];
}

/** Visible-from-this-clue counts of one cell on one path, per monster. */
export interface Visit {
  cell: number;
  /** Times a ghost here is seen (reflected sightings). */
  g: number;
  /** Times a vampire here is seen (direct sightings). */
  v: number;
  /** Times a zombie here is seen (every sighting). */
  z: number;
}

export interface Geometry {
  w: number;
  h: number;
  n: number;
  /** Monster cells in index order. */
  empties: number[];
  /** Per clue: its line of sight's cells, merged per cell, in the order first seen. */
  paths: Visit[][];
  /** Per clue: every square the sight line passes (mirrors included), in order. */
  trace: number[][];
  /** Per cell: the clues whose path passes it. */
  through: number[][];
}

/** Clue i's outside position (x, y in -1..w / -1..h) and the direction it looks in. */
export function clueAt(w: number, h: number, i: number): { x: number; y: number; dx: number; dy: number } {
  if (i < w) return { x: i, y: -1, dx: 0, dy: 1 };
  i -= w;
  if (i < h) return { x: w, y: i, dx: -1, dy: 0 };
  i -= h;
  if (i < w) return { x: w - 1 - i, y: h, dx: 0, dy: -1 };
  i -= w;
  return { x: -1, y: h - 1 - i, dx: 1, dy: 0 };
}

const cache = new WeakMap<UndeadPuzzle, Geometry>();

export function geometry(p: Pick<UndeadPuzzle, "w" | "h" | "cells">): Geometry {
  const hit = cache.get(p as UndeadPuzzle);
  if (hit) return hit;
  const { w, h, cells } = p;
  const n = w * h;
  const empties = cells.flatMap((v, c) => (v === EMPTY ? [c] : []));
  const paths: Visit[][] = [], trace: number[][] = [];
  const through: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < 2 * (w + h); i++) {
    let { x, y, dx, dy } = clueAt(w, h, i);
    let reflected = false;
    const byCell = new Map<number, Visit>();
    const tr: number[] = [];
    for (;;) {
      x += dx;
      y += dy;
      if (x < 0 || y < 0 || x >= w || y >= h) break;
      const c = y * w + x;
      tr.push(c);
      const v = cells[c]!;
      if (v === MIRROR_L) {
        [dx, dy] = [dy, dx];
        reflected = true;
      } else if (v === MIRROR_R) {
        [dx, dy] = [-dy, -dx];
        reflected = true;
      } else {
        const visit = byCell.get(c) ?? { cell: c, g: 0, v: 0, z: 0 };
        if (reflected) visit.g++;
        else visit.v++;
        visit.z++;
        byCell.set(c, visit);
      }
    }
    paths.push([...byCell.values()]);
    trace.push(tr);
    for (const vis of byCell.values()) through[vis.cell]!.push(i);
  }
  const g: Geometry = { w, h, n, empties, paths, trace, through };
  cache.set(p as UndeadPuzzle, g);
  return g;
}

/** How many times monster m at this visit is seen. */
export const seen = (vis: Visit, m: number): number => (m === GHOST ? vis.g : m === VAMPIRE ? vis.v : vis.z);

/** Sight counts for a full assignment of monsters (0 where unknown counts nothing). */
export function sightCounts(g: Geometry, monsters: ArrayLike<number>): number[] {
  return g.paths.map((path) => path.reduce((sum, vis) => sum + (monsters[vis.cell] ? seen(vis, monsters[vis.cell]!) : 0), 0));
}
