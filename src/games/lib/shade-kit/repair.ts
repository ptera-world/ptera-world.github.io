import type { GenerateContext } from "../../core/types";
import type { Rng } from "../../core/rng";
import { countSolutions, decidedBy, decides, saturate, valueOf, type Doms, type Model } from "../grid-kit/csp";
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
  /** Region id per cell; every region is one connected piece. */
  regions: readonly number[];
  /** The planted solution, one value per cell. */
  intended: readonly number[];
  /** True for values that count toward a region's quota; those cells never move. */
  counts(value: number): boolean;
  /** How much of the puzzle cheap logic decides under these regions; higher is better. */
  progress(regions: readonly number[]): number;
  /** True once the layout is finished. Checked whenever progress matches or beats its best so far. */
  solved(regions: readonly number[], progress: number): boolean;
  /** A solution other than `intended` under these regions, or null when there is none. */
  rival(regions: readonly number[]): number[] | null;
  /** Extra condition on moving cell `c` into region `to` (default: any). */
  allowed?(regions: readonly number[], c: number, to: number): boolean;
  rng: Rng;
  ctx: GenerateContext;
  /** Steps before giving up. */
  budget: number;
  /** Candidate moves scored per step. */
  sample: number;
  /** Steps in a row without improvement before a rival gets broken. */
  patience: number;
}

/**
 * Reshapes the regions of a puzzle whose rule is "each region holds a fixed number of counted
 * cells" until `solved` holds (e.g. logic at the target level finishes it, which also makes the
 * planted solution the only one). Only cells `intended` doesn't count move, so every layout keeps
 * `intended` as a solution.
 *
 * Each step scores a sample of single-cell moves by `progress` and takes the best that improves.
 * When none does and a rival solution exists, it moves a cell the rival counts and `intended`
 * doesn't into a neighbouring region instead: the rival's quota breaks in both regions. With no
 * rival left, the best sideways move is taken. Null if the budget runs out.
 */
export async function climbRegions(o: RegionClimb): Promise<number[] | null> {
  let regions = o.regions.slice();
  let score = o.progress(regions), top = score, stalled = 0;
  const movable = o.intended.flatMap((v, c) => (o.counts(v) ? [] : [c]));
  const ok = (c: number) => (to: number) => o.allowed?.(regions, c, to) ?? true;
  if (o.solved(regions, score)) return regions;
  for (let step = 0; step < o.budget; step++) {
    await o.ctx.yield();
    let best: { regions: number[]; score: number } | null = null;
    for (let tries = 0; tries < o.sample; tries++) {
      const c = o.rng.pick(movable);
      const next = moveCell(regions, o.nbrs, c, o.rng, ok(c));
      if (!next) continue;
      const s = o.progress(next);
      if (!best || s > best.score) best = { regions: next, score: s };
    }
    stalled = best && best.score > score ? 0 : stalled + 1;
    let kicked = false;
    if (stalled >= o.patience) {
      stalled = 0;
      const kick = breakRival(o, regions, ok);
      if (kick) { best = { regions: kick, score: o.progress(kick) }; kicked = true; }
    }
    if (!best || (!kicked && best.score < score)) continue;
    ({ regions, score } = best);
    if (score >= top) {
      top = score;
      if (o.solved(regions, score)) return regions;
    }
  }
  return null;
}

/**
 * A layout where the current rival breaks: one of its counted cells (not counted by `intended`)
 * moved to a neighbouring region, or, when none of those sits on an edge it can cross, a cell
 * beside one moved instead so a later step can. Null without a rival or a possible move.
 */
function breakRival(o: RegionClimb, regions: readonly number[], ok: (c: number) => (to: number) => boolean): number[] | null {
  const rival = o.rival(regions);
  if (!rival) return null;
  const extra = o.rng.shuffle(rival.flatMap((v, c) => (o.counts(v) && !o.counts(o.intended[c]!) ? [c] : [])));
  let next: number[] | null = null;
  for (const c of extra) if ((next = moveCell(regions, o.nbrs, c, o.rng, ok(c)))) break;
  if (!next) {
    const beside = o.rng.shuffle([...new Set(extra.flatMap((c) => o.nbrs[c]!))].filter((d) => !o.counts(o.intended[d]!)));
    for (const d of beside) if ((next = moveCell(regions, o.nbrs, d, o.rng, ok(d)))) break;
  }
  return next;
}

/** Region ids renumbered by first appearance in row-major order, the order text and URL formats read them back in. */
export function canonicalRegions(regions: readonly number[]): number[] {
  const ids = new Map<number, number>();
  return regions.map((r) => ids.get(r) ?? (ids.set(r, ids.size), ids.size - 1));
}

/**
 * A layout one single-cell move away from `regions` that `accept` takes (e.g. a finished puzzle
 * made one level harder), trying up to `tries` random moves of cells `intended` doesn't count.
 */
export function nudgeRegions(o: {
  nbrs: readonly number[][];
  regions: readonly number[];
  intended: readonly number[];
  counts(value: number): boolean;
  accept(regions: readonly number[]): boolean;
  rng: Rng;
  tries: number;
}): number[] | null {
  const movable = o.intended.flatMap((v, c) => (o.counts(v) ? [] : [c]));
  for (let t = 0; t < o.tries; t++) {
    const next = moveCell(o.regions, o.nbrs, o.rng.pick(movable), o.rng, () => true);
    if (next && o.accept(next)) return next;
  }
  return null;
}

export interface LevelShape {
  nbrs: readonly number[][];
  regions: readonly number[];
  /** The planted solution, one value per cell. */
  intended: readonly number[];
  counts(value: number): boolean;
  /** The puzzle's model and starting domains under a region layout. */
  setup(regions: readonly number[]): { model: Model; start: Doms };
  /** 0: level-0 logic finishes it; 1: level 1 does and level 0 doesn't; 2: trial (level 2) does and level 1 doesn't. */
  level: 0 | 1 | 2;
  rng: Rng;
  ctx: GenerateContext;
}

/**
 * Reshapes regions around `intended` until logic at `level` finishes the puzzle and logic one
 * level down doesn't. Level 2 starts from a level-1 layout and moves one cell so that level 1 no
 * longer finishes it but trial still does. Null if it doesn't settle.
 */
export async function shapeToLevel(o: LevelShape): Promise<number[] | null> {
  const n = o.setup(o.regions).model.n;
  const decided = (r: readonly number[], at: number) => { const s = o.setup(r); return decidedBy(s.model, s.start, at); };
  const cheap = Math.min(o.level, 1);
  const regions = await climbRegions({
    nbrs: o.nbrs, regions: o.regions, intended: o.intended, counts: o.counts, rng: o.rng, ctx: o.ctx, budget: 6 * n, sample: 8, patience: 12,
    // more decided by the level's logic is better; at level 1, ties go to less decided one level down
    progress: (r) => (cheap === 1 ? decided(r, 1) * (n + 1) + n - decided(r, 0) : decided(r, 0)),
    solved: (_r, score) => (cheap === 1 ? score > n * (n + 1) : score === n),
    rival: (r) => {
      const s = o.setup(r), k = s.start.slice();
      return saturate(s.model, k, cheap) ? rivalSolution(s.model, k, o.intended, cheap) : null;
    },
  });
  if (!regions || o.level < 2) return regions;
  return nudgeRegions({
    nbrs: o.nbrs, regions, intended: o.intended, counts: o.counts, rng: o.rng, tries: 3 * n,
    accept: (r) => { if (decided(r, 1) === n) return false; const s = o.setup(r); return decides(s.model, s.start, 2); },
  });
}

/**
 * Deterministic in `rng`: fresh attempts (each on its own fork) until one needs exactly `level`.
 * After `exact` attempts, the hardest puzzle found at or below `level` is taken instead; throws if
 * `max` attempts find none.
 */
export async function attemptLevel<P>(o: {
  level: number;
  rng: Rng;
  ctx: GenerateContext;
  attempt(rng: Rng): Promise<P | null>;
  /** Least level that finishes `p`, or null if none up to `level` does. */
  levelOf(p: P): number | null;
  exact?: number;
  max?: number;
}): Promise<P> {
  let best: { p: P; level: number } | null = null;
  for (let i = 0; i < (o.max ?? 200); i++) {
    if (best && i >= (o.exact ?? 40)) break;
    await o.ctx.yield();
    const p = await o.attempt(o.rng.fork(`attempt ${i}`));
    if (!p) continue;
    const got = o.levelOf(p);
    if (got === o.level) return p;
    if (got !== null && got < o.level && (!best || got > best.level)) best = { p, level: got };
  }
  if (best) return best.p;
  throw new Error("couldn't make a puzzle with these settings; try a different size");
}
