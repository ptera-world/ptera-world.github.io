import type { Rng } from "../../core/rng";
import { goalTiles, type Goal } from "./goal";

/** Tiles slide into the one gap (the 15 puzzle). */
export interface SlidePuzzle {
  /** Missing in boards saved before the games were merged: those slide. */
  moves?: "slide";
  w: number;
  h: number;
  /** Missing in boards saved before goals existed: "order". */
  goal?: Goal;
  /** Row-major; 0 is the gap, 1…n-1 the tiles. */
  tiles: number[];
}

export interface SlideState {
  tiles: number[];
  /** Tiles moved so far (sliding a line of three counts three). */
  moves: number;
}

/** Slide the tiles between `cell` and the gap one step toward the gap. `cell` must share a row or column with it. */
export type SlideAction = { type: "move"; cell: number };

/** Hint focus understood by the slide view: cells to press, the group's home cells, and the group's tiles. */
export interface SlideFocus {
  press?: number[];
  homes?: number[];
  tiles?: number[];
}

export const slideGoal = (p: Pick<SlidePuzzle, "w" | "h" | "goal">): number[] => goalTiles({ w: p.w, h: p.h, goal: p.goal ?? "order", gap: true });
export const gapOf = (tiles: readonly number[]): number => tiles.indexOf(0);

/** Parity of the arrangement as a permutation of cells relative to the goal (gap included). */
function permParity(goal: readonly number[], tiles: readonly number[]): number {
  const n = tiles.length;
  const home = new Int32Array(n);
  goal.forEach((t, c) => { home[t] = c; });
  const seen = new Uint8Array(n);
  let parity = 0;
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    let len = 0;
    for (let j = i; !seen[j]; j = home[tiles[j]!]!) { seen[j] = 1; len++; }
    parity ^= (len - 1) & 1;
  }
  return parity;
}

/** Every move swaps the gap with a neighbor, so arrangement parity and the gap's distance from home stay matched. */
export function isSolvable(p: Pick<SlidePuzzle, "w" | "h" | "goal">, tiles: readonly number[]): boolean {
  const goal = slideGoal(p);
  const g = gapOf(tiles), home = gapOf(goal);
  const dist = Math.abs((g % p.w) - (home % p.w)) + Math.abs(Math.floor(g / p.w) - Math.floor(home / p.w));
  return permParity(goal, tiles) === (dist & 1);
}

/** Cells the gap passes through for a move from `cell`, nearest the gap first; empty if not in line. */
export function lineToGap(w: number, tiles: readonly number[], cell: number): number[] {
  const g = gapOf(tiles);
  if (cell === g || cell < 0 || cell >= tiles.length) return [];
  const gx = g % w, gy = Math.floor(g / w), cx = cell % w, cy = Math.floor(cell / w);
  if (gx !== cx && gy !== cy) return [];
  const step = gx === cx ? (cy > gy ? w : -w) : (cx > gx ? 1 : -1);
  const out: number[] = [];
  for (let p = g + step; ; p += step) {
    out.push(p);
    if (p === cell) return out;
  }
}

export function applyMove(w: number, s: SlideState, cell: number): SlideState {
  const path = lineToGap(w, s.tiles, cell);
  if (!path.length) return s;
  const tiles = s.tiles.slice();
  let gap = gapOf(tiles);
  for (const p of path) {
    tiles[gap] = tiles[p]!;
    tiles[p] = 0;
    gap = p;
  }
  return { tiles, moves: s.moves + path.length };
}

export const slideSolved = (p: SlidePuzzle, tiles: readonly number[]): boolean => {
  const goal = slideGoal(p);
  return tiles.every((t, i) => t === goal[i]);
};

export function generateSlide(w: number, h: number, goal: Goal, shuffle: number, rng: Rng): SlidePuzzle {
  const n = w * h;
  const shape = { w, h, goal };
  const done = slideGoal(shape);
  let tiles: number[];
  if (shuffle > 0) {
    tiles = done.slice();
    let prev = -1;
    for (let i = 0; i < shuffle; i++) {
      const g = gapOf(tiles);
      const opts = [g - w, g + w, (g % w) > 0 ? g - 1 : -1, (g % w) < w - 1 ? g + 1 : -1]
        .filter((c) => c >= 0 && c < n && c !== prev);
      const c = rng.pick(opts);
      tiles[g] = tiles[c]!;
      tiles[c] = 0;
      prev = g;
    }
  } else {
    tiles = rng.shuffle(Array.from({ length: n }, (_, i) => i));
    if (!isSolvable(shape, tiles)) {
      const a = tiles.findIndex((t) => t !== 0);
      const b = tiles.findIndex((t, i) => i > a && t !== 0);
      [tiles[a], tiles[b]] = [tiles[b]!, tiles[a]!];
    }
  }
  if (tiles.every((t, i) => t === done[i])) {
    const g = gapOf(tiles), c = g % w > 0 ? g - 1 : g + 1;
    tiles[g] = tiles[c]!;
    tiles[c] = 0;
  }
  return { moves: "slide", w, h, goal, tiles };
}

/** Throws a player-facing message unless `tiles` is a solvable slide board. */
export function checkSlide(p: SlidePuzzle): SlidePuzzle {
  const n = p.w * p.h;
  if (p.tiles.length !== n) throw new Error(`expected ${n} numbers, got ${p.tiles.length}`);
  const seen = new Set<number>();
  for (const t of p.tiles) {
    if (!Number.isInteger(t) || t < 0 || t >= n) throw new Error(`numbers must run from 0 (the gap) to ${n - 1}`);
    if (seen.has(t)) throw new Error(`${t} appears twice`);
    seen.add(t);
  }
  if (!isSolvable(p, p.tiles)) throw new Error("this arrangement can't be solved (two tiles would have to swap)");
  return p;
}

export function describeSlide(p: SlidePuzzle, a: SlideAction, before: SlideState): string {
  const path = lineToGap(p.w, before.tiles, a.cell);
  if (!path.length) return "slide";
  const g = gapOf(before.tiles), first = path[0]!;
  const dir = first === g - 1 ? "right" : first === g + 1 ? "left" : first < g ? "down" : "up";
  return `slide ${path.map((c) => before.tiles[c]).join(", ")} ${dir}`;
}
