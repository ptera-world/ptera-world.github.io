import { BLOCK, landing, mergeOf, move, type MergeRule, type Moved, type PuzzleMerge, type StateMerge } from "./logic";

/**
 * How good a board looks to a player who keeps it tidy: lots of room, tiles that can merge lying
 * next to each other, every row and column running one way (big at one end, small at the other),
 * and few big tiles left unmerged. Read off the board alone, per row and column.
 */
export function tidiness(p: Pick<PuzzleMerge, "size" | "rules">, grid: readonly number[]): number {
  const m = mergeOf(p), n = p.size;
  let total = 0;
  const line = (cells: number[]) => {
    let run: number[] = [];
    const flush = () => {
      total += runScore(m, run);
      run = [];
    };
    for (const c of cells) {
      if (grid[c] === BLOCK) flush();
      else run.push(grid[c]!);
    }
    flush();
  };
  for (let i = 0; i < n; i++) {
    line(Array.from({ length: n }, (_, k) => i * n + k));
    line(Array.from({ length: n }, (_, k) => k * n + i));
  }
  return total;
}

/** Weights after nneonneo's 2048 heuristic (github.com/nneonneo/2048-ai), on tile ranks. */
const EMPTY = 270, MERGES = 700, MONO = 47, MONO_POW = 4, SUM = 11, SUM_POW = 3.5;

const height = (m: MergeRule, v: number): number => {
  if (v <= 0) return 0;
  if (m.rank(m.bases[0]!) > 0) return m.rank(v);
  return m.rank(v) === 0 ? m.bases.indexOf(v) + 1 : m.rank(v) + 2;
};

function runScore(m: MergeRule, vals: readonly number[]): number {
  if (!vals.length) return 0;
  let empty = 0, merges = 0, sum = 0, prev = 0, up = 0, down = 0;
  for (const v of vals) {
    if (!v) { empty++; continue; }
    sum += height(m, v) ** SUM_POW;
    if (prev && m.merge(prev, v)) merges++;
    prev = v;
  }
  for (let k = 1; k < vals.length; k++) {
    const a = height(m, vals[k - 1]!) ** MONO_POW, b = height(m, vals[k]!) ** MONO_POW;
    if (a > b) up += a - b;
    else down += b - a;
  }
  return EMPTY * empty + MERGES * merges - MONO * Math.min(up, down) - SUM * sum;
}

/**
 * Worth of each merge the slide itself makes: a merge now is a cell freed for sure, one the
 * look-ahead finds may never come. Tuned by auto play (strongest of 0, 1000, 3000 in 2048 and threes).
 */
const MERGE_NOW = 3000;

/** Below any board that can still move. */
const STUCK = -1e7;

export interface Weighed {
  dir: number;
  r: Moved;
  /** Tidiness after the slide, averaged over where (and, unless shown, which) new tile lands. */
  score: number;
}

/** How tidy the board can be made with `depth` more slides; the tiles they bring are averaged over. */
function lookAhead(p: PuzzleMerge, g: readonly number[], depth: number): number {
  let top = STUCK;
  for (let e = 0; e < 4; e++) {
    const r = move(p, g, e);
    if (r.changed) top = Math.max(top, depth > 1 ? landed(p, r, mergeOf(p).bases, depth - 1) : tidiness(p, r.grid));
  }
  return top;
}

/** The average over where each of `comes` lands after `r` of how tidy the board can then be made. */
function landed(p: PuzzleMerge, r: Moved, comes: readonly number[], depth: number): number {
  const spots = landing(p, r);
  let sum = 0;
  for (const c of spots) {
    for (const v of comes) {
      const g = r.grid.slice();
      g[c] = v;
      sum += lookAhead(p, g, depth);
    }
  }
  return sum / (spots.length * comes.length);
}

/**
 * Slides looked ahead past this one. An edge-entering tile has at most one spot per line, so two
 * slides with their new tiles are cheap; a tile landing anywhere has a spot per empty cell, so
 * there the second slide is weighed without its tile.
 */
const depthFor = (p: PuzzleMerge): number => (p.rules.entry === "edge" ? 2 : 1);

const cache = new WeakMap<PuzzleMerge, WeakMap<StateMerge, Weighed[]>>();

/** The new tiles a player can expect: the shown next tile, else each starting tile alike. */
export function expected(p: PuzzleMerge, s: StateMerge): number[] {
  if (p.rules.preview && !s.bonus) return [s.next];
  return mergeOf(p).bases.slice();
}

/** Every slide that moves something, weighed; best first (ties: up, right, down, left). */
export function weighSlides(p: PuzzleMerge, s: StateMerge): Weighed[] {
  let byState = cache.get(p);
  if (!byState) cache.set(p, (byState = new WeakMap()));
  const known = byState.get(s);
  if (known) return known;
  const out: Weighed[] = [];
  const comes = expected(p, s);
  for (let d = 0; d < 4; d++) {
    const r = move(p, s.grid, d);
    if (!r.changed) continue;
    out.push({ dir: d, r, score: landed(p, r, comes, depthFor(p)) + MERGE_NOW * r.moves.filter((x) => x.merged).length });
  }
  out.sort((a, b) => b.score - a.score);
  byState.set(s, out);
  return out;
}

/** The slide a tidy player takes here, or -1 when nothing moves. */
export const bestSlide = (p: PuzzleMerge, s: StateMerge): number => weighSlides(p, s)[0]?.dir ?? -1;
