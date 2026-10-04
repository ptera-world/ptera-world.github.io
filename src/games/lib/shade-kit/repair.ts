import type { GenerateContext } from "../../core/types";
import type { Rng } from "../../core/rng";
import { countSolutions, valueOf, type Doms, type Model } from "../grid-kit/csp";
import { pieces } from "../grid-kit/grid";

/**
 * A solution of `m` from `start` other than `intended` (one value per variable), or null if there
 * is none. The search prunes with deductions up to `level` (default: the model's countLevel).
 */
export function rivalSolution(m: Model, start: Doms, intended: readonly number[], level = m.countLevel): number[] | null {
  const differs = (k: Doms) => k.some((v, i) => valueOf(v) !== intended[i]);
  const other: Model = { ...m, countLevel: level, complete: (k) => (!m.complete || m.complete(k)) && differs(k) };
  const r = countSolutions(other, start, 1);
  return r.first ? Array.from(r.first, valueOf) : null;
}

export interface RegionRepair {
  nbrs: readonly number[][];
  /** Region id per cell; ids are 0 … count - 1 and every region is one connected piece. */
  regions: readonly number[];
  /** The planted solution, one value per cell; it must satisfy every region layout `rival` sees. */
  intended: readonly number[];
  /** True for values that count toward a region's quota (a star, a shaded cell). */
  counts(value: number): boolean;
  /** A solution other than `intended` under these regions, or null when `intended` is the only one. */
  rival(regions: readonly number[]): number[] | null;
  /** Extra condition on moving cell `c` into region `to` (default: any). */
  allowed?(regions: readonly number[], c: number, to: number): boolean;
  rng: Rng;
  ctx: GenerateContext;
  /** Rivals to remove before giving up. */
  budget: number;
}

/**
 * Makes `intended` the only solution of a puzzle whose rule is "each region holds a fixed number
 * of counted cells". Each step takes a rival solution and moves one cell that the rival counts and
 * `intended` doesn't into a neighbouring region: the rival's quota breaks in both regions, and
 * `intended` keeps its own. Null if no such move exists or the budget runs out.
 */
export async function repairRegions(o: RegionRepair): Promise<number[] | null> {
  let regions = o.regions.slice();
  for (let step = 0; step < o.budget; step++) {
    await o.ctx.yield();
    const rival = o.rival(regions);
    if (!rival) return regions;
    const extra = o.rng.shuffle(rival.flatMap((v, c) => (o.counts(v) && !o.counts(o.intended[c]!) ? [c] : [])));
    const ok = (c: number) => (to: number) => o.allowed?.(regions, c, to) ?? true;
    let next: number[] | null = null;
    for (const c of extra) if ((next = moveCell(regions, o.nbrs, c, o.rng, ok(c)))) break;
    // no rival cell sits on a region edge it can cross: move a cell beside one instead (one
    // `intended` doesn't count), which puts that rival cell on an edge for a later step
    if (!next) {
      const beside = o.rng.shuffle([...new Set(extra.flatMap((c) => o.nbrs[c]!))].filter((d) => !o.counts(o.intended[d]!)));
      for (const d of beside) if ((next = moveCell(regions, o.nbrs, d, o.rng, ok(d)))) break;
    }
    if (!next) return null;
    regions = next;
  }
  return null;
}

/** `regions` with `c` moved to a neighbouring region, keeping the one it leaves connected and nonempty; null if none qualifies. */
function moveCell(regions: readonly number[], nbrs: readonly number[][], c: number, rng: Rng, allowed: (to: number) => boolean): number[] | null {
  const from = regions[c]!;
  for (const to of rng.shuffle([...new Set(nbrs[c]!.map((d) => regions[d]!).filter((r) => r !== from))])) {
    if (!allowed(to)) continue;
    const next = regions.slice();
    next[c] = to;
    if (!next.includes(from) || pieces(nbrs, (d) => next[d] === from).count !== 1) continue;
    return next;
  }
  return null;
}

export interface RegionClimb {
  nbrs: readonly number[][];
  regions: readonly number[];
  /** The planted solution, one value per cell. */
  intended: readonly number[];
  /** True for values that count toward a region's quota; those cells never move. */
  counts(value: number): boolean;
  /** How much of the puzzle cheap logic decides under these regions; higher is better. */
  progress(regions: readonly number[]): number;
  /** True once the layout is finished. Checked whenever progress reaches a new best. */
  solved(regions: readonly number[], progress: number): boolean;
  /** Extra condition on moving cell `c` into region `to` (default: any). */
  allowed?(regions: readonly number[], c: number, to: number): boolean;
  rng: Rng;
  ctx: GenerateContext;
  /** Moves to try before giving up. */
  budget: number;
  /** Candidate moves scored per step. */
  sample: number;
}

/**
 * Reshapes regions until `solved` holds (e.g. logic at the target level finishes the puzzle,
 * which also makes the planted solution the only one). Each step scores a sample of single-cell
 * moves by `progress` and takes the best, sideways included. Only cells `intended` doesn't count
 * move, so every layout keeps `intended` as a solution. Null if the budget runs out.
 */
export async function climbRegions(o: RegionClimb): Promise<number[] | null> {
  let regions = o.regions.slice();
  let score = o.progress(regions), top = score;
  const movable = o.intended.flatMap((v, c) => (o.counts(v) ? [] : [c]));
  if (o.solved(regions, score)) return regions;
  for (let step = 0; step < o.budget; step++) {
    await o.ctx.yield();
    let best: { regions: number[]; score: number } | null = null;
    for (let tries = 0; tries < o.sample; tries++) {
      const c = o.rng.pick(movable);
      const next = moveCell(regions, o.nbrs, c, o.rng, (to) => o.allowed?.(regions, c, to) ?? true);
      if (!next) continue;
      const s = o.progress(next);
      if (!best || s > best.score) best = { regions: next, score: s };
    }
    if (!best || best.score < score) continue;
    ({ regions, score } = best);
    if (score > top) {
      top = score;
      if (o.solved(regions, score)) return regions;
    }
  }
  return null;
}
