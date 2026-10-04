import { collapse, groups, isEmpty, type SamegamePuzzle } from "./logic";

export interface Search {
  /** Clicks that clear the board from here, or null. */
  path: number[] | null;
  /** True when no clear exists (the search ran to the end). */
  impossible: boolean;
}

const BUDGET = 60_000;

/** A color with exactly one tile left can never be removed. */
export function loneColour(grid: readonly number[]): number {
  const counts = new Map<number, number>();
  for (const c of grid) if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  for (const [c, n] of counts) if (n === 1) return c;
  return 0;
}

/** Tiles with no same-colored neighbor; fewer is better for move ordering. */
function isolated(w: number, h: number, grid: readonly number[]): number {
  let n = 0;
  for (let p = 0; p < grid.length; p++) {
    const c = grid[p];
    if (!c) continue;
    const x = p % w, y = Math.floor(p / w);
    if ((x > 0 && grid[p - 1] === c) || (x < w - 1 && grid[p + 1] === c) || (y > 0 && grid[p - w] === c) || (y < h - 1 && grid[p + w] === c)) continue;
    n++;
  }
  return n;
}

/** Depth-first search for a full clear, trying moves that leave the fewest isolated tiles first. */
export function findClear(p: Pick<SamegamePuzzle, "w" | "h">, grid: readonly number[], budget = BUDGET): Search {
  const dead = new Set<string>();
  let nodes = 0, cut = false;
  const go = (g: readonly number[]): number[] | null => {
    if (isEmpty(g)) return [];
    if (loneColour(g)) return null;
    const key = g.join("");
    if (dead.has(key)) return null;
    if (++nodes > budget) { cut = true; return null; }
    const options = groups(p.w, p.h, g).map((cells) => {
      const next = collapse(p.w, p.h, g, cells);
      return { cell: cells[0]!, next, score: isolated(p.w, p.h, next) };
    }).sort((a, b) => a.score - b.score);
    for (const o of options) {
      const rest = go(o.next);
      if (rest) return [o.cell, ...rest];
      if (cut) return null;
    }
    dead.add(key);
    return null;
  };
  const path = go(grid);
  return { path, impossible: !path && !cut };
}

const pathCache = new WeakMap<SamegamePuzzle, Map<string, number[]>>();

/** The generator's own clearing order, indexed by every position along it. */
function knownPath(p: SamegamePuzzle): Map<string, number[]> {
  let m = pathCache.get(p);
  if (m) return m;
  m = new Map();
  if (p.solution) {
    let g = p.grid;
    p.solution.forEach((cell, i) => {
      m!.set(g.join(""), p.solution!.slice(i));
      const cells = groups(p.w, p.h, g).find((gr) => gr.includes(cell));
      if (cells) g = collapse(p.w, p.h, g, cells);
    });
  }
  pathCache.set(p, m);
  return m;
}

const searchCache = new WeakMap<readonly number[], Search>();

/** Clearing path from the current grid: the stored one when still on it, else a fresh search (cached). */
export function clearFrom(p: SamegamePuzzle, grid: readonly number[]): Search {
  let r = searchCache.get(grid);
  if (r) return r;
  const known = knownPath(p).get(grid.join(""));
  r = known ? { path: known, impossible: false } : findClear(p, grid);
  searchCache.set(grid, r);
  return r;
}
