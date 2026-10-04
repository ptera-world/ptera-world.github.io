import type { Rng } from "../../core/rng";
import type { GenerateContext } from "../../core/types";
import { bfs, pathTo } from "../../lib/search";

export interface Car {
  x: number;
  y: number;
  len: number;
  horizontal: boolean;
}

export interface RushPuzzle {
  w: number;
  h: number;
  /** Cars in their starting places; car 0 is the red car, horizontal, and leaves by the right edge of its row. */
  cars: Car[];
  /** Fixed blocked cells. */
  walls: number[];
}

/** Per car, its column (horizontal cars) or row (vertical cars). */
export type Pos = readonly number[];

export interface Slide {
  car: number;
  to: number;
}

export const startPos = (p: RushPuzzle): number[] => p.cars.map((c) => (c.horizontal ? c.x : c.y));
export const exitAt = (p: RushPuzzle): number => p.w - p.cars[0]!.len;
export const isGoal = (p: RushPuzzle, pos: Pos): boolean => pos[0] === exitAt(p);

/** Cells a car covers at a position. */
export function cellsOf(p: RushPuzzle, car: number, at: number): number[] {
  const c = p.cars[car]!;
  return Array.from({ length: c.len }, (_, i) => (c.horizontal ? c.y * p.w + at + i : (at + i) * p.w + c.x));
}

/** Per cell: -1 wall, 0 empty, else car index + 1. */
export function occupancy(p: RushPuzzle, pos: Pos): Int16Array {
  const occ = new Int16Array(p.w * p.h);
  for (const c of p.walls) occ[c] = -1;
  pos.forEach((at, i) => { for (const c of cellsOf(p, i, at)) occ[c] = i + 1; });
  return occ;
}

/** The furthest a car can go each way from where it is. */
export function reach(p: RushPuzzle, pos: Pos, occ: Int16Array, car: number): { min: number; max: number } {
  const c = p.cars[car]!;
  const at = pos[car]!;
  const free = (k: number) => {
    const cell = c.horizontal ? c.y * p.w + k : k * p.w + c.x;
    return occ[cell] === 0;
  };
  const limit = (c.horizontal ? p.w : p.h) - c.len;
  let min = at, max = at;
  while (min > 0 && free(min - 1)) min--;
  while (max < limit && free(max + c.len)) max++;
  return { min, max };
}

export function canSlide(p: RushPuzzle, pos: Pos, s: Slide): boolean {
  if (s.car < 0 || s.car >= p.cars.length || s.to === pos[s.car]) return false;
  const r = reach(p, pos, occupancy(p, pos), s.car);
  return s.to >= r.min && s.to <= r.max;
}

const LIMIT = 400_000;

const radixCache = new WeakMap<RushPuzzle, { radix: number[]; mult: number[] }>();

/** Positions as numbers: car i contributes pos[i] × mult[i], with pos[i] < radix[i]. */
function radixOf(p: RushPuzzle): { radix: number[]; mult: number[] } {
  const hit = radixCache.get(p);
  if (hit) return hit;
  const radix = p.cars.map((c) => (c.horizontal ? p.w : p.h) - c.len + 1);
  const mult: number[] = [];
  radix.forEach((_, i) => mult.push(i ? mult[i - 1]! * radix[i - 1]! : 1));
  const out = { radix, mult };
  radixCache.set(p, out);
  return out;
}

export function encode(p: RushPuzzle, pos: Pos): number {
  const { mult } = radixOf(p);
  return pos.reduce((sum, v, i) => sum + v * mult[i]!, 0);
}

export function decode(p: RushPuzzle, code: number): number[] {
  const { radix, mult } = radixOf(p);
  return radix.map((r, i) => Math.floor(code / mult[i]!) % r);
}

const goalCode = (p: RushPuzzle, code: number) => code % radixOf(p).radix[0]! === exitAt(p);

function* codeMoves(p: RushPuzzle, code: number): Generator<readonly [Slide, number]> {
  const { mult } = radixOf(p);
  const pos = decode(p, code);
  const occ = occupancy(p, pos);
  for (let car = 0; car < p.cars.length; car++) {
    const r = reach(p, pos, occ, car);
    for (let to = r.min; to <= r.max; to++) if (to !== pos[car]) yield [{ car, to }, code + (to - pos[car]!) * mult[car]!] as const;
  }
}

const explore = (p: RushPuzzle, starts: number[], opts: { limit?: number; stop?: (k: number) => boolean } = {}) =>
  bfs<number, Slide, number>(starts, (k) => k, (k) => codeMoves(p, k), { limit: opts.limit ?? LIMIT, parents: !!opts.stop, stop: opts.stop && ((k) => opts.stop!(k)) });

export interface Cluster {
  /** Moves to the nearest goal, by position code; missing when unreachable or not explored. */
  toGoal: Map<number, number>;
  /** Every position reachable was explored. */
  complete: boolean;
}

const clusterCache = new WeakMap<RushPuzzle, Cluster>();

/** Every position reachable from the start, with each one's distance to the exit (moves are reversible). */
export function cluster(p: RushPuzzle): Cluster {
  const hit = clusterCache.get(p);
  if (hit) return hit;
  const all = explore(p, [encode(p, startPos(p))]);
  const back = explore(p, all.order.filter((k) => goalCode(p, k)));
  const out = { toGoal: back.dist, complete: all.complete && back.complete };
  clusterCache.set(p, out);
  return out;
}

/** Moves to the exit from a position, or null if it can't get out (or the search was cut short). */
export function distance(p: RushPuzzle, pos: Pos): number | null {
  const c = cluster(p);
  const d = c.toGoal.get(encode(p, pos));
  if (d !== undefined) return d;
  return c.complete ? null : searchFrom(p, pos)?.length ?? null;
}

function searchFrom(p: RushPuzzle, pos: Pos): Slide[] | null {
  const r = explore(p, [encode(p, pos)], { stop: (k) => goalCode(p, k) });
  return r.found === null ? null : pathTo(r, r.found);
}

/** A shortest way out from a position (first-found among equals), or null if there is none. */
export function plan(p: RushPuzzle, pos: Pos): Slide[] | null {
  const c = cluster(p);
  let code = encode(p, pos);
  let d = c.toGoal.get(code);
  if (d === undefined) return c.complete ? null : searchFrom(p, pos);
  const out: Slide[] = [];
  while (d > 0) {
    let moved = false;
    for (const [s, next] of codeMoves(p, code)) {
      if (c.toGoal.get(next) === d - 1) {
        out.push(s);
        code = next;
        d--;
        moved = true;
        break;
      }
    }
    if (!moved) return null;
  }
  return out;
}

// --- generation ---
export const LEVEL_NAMES = ["easy", "medium", "hard"] as const;
/** Fewest and most moves to solve, by difficulty. */
export const BANDS = [[4, 9], [10, 19], [20, 40]] as const;
const START_CARS = [5, 8, 10] as const;

const freeCells = (p: RushPuzzle) => {
  const occ = occupancy(p, startPos(p));
  return Array.from(occ.keys()).filter((c) => occ[c] === 0);
};

/** A car of random length and direction on free cells, or null if it doesn't fit there. */
function randomCar(p: RushPuzzle, rng: Rng): Car | null {
  const occ = occupancy(p, startPos(p));
  const len = rng.bool(0.25) ? 3 : 2;
  const horizontal = rng.bool();
  const row = p.cars[0]!.y;
  const x = rng.range(0, horizontal ? p.w - len : p.w - 1), y = rng.range(0, horizontal ? p.h - 1 : p.h - len);
  if (horizontal && y === row) return null;
  for (let i = 0; i < len; i++) if (occ[horizontal ? y * p.w + x + i : (y + i) * p.w + x] !== 0) return null;
  return { x, y, len, horizontal };
}

/** One random change: add a car, take one away (never the red car), or move one somewhere else. */
function mutate(p: RushPuzzle, rng: Rng): RushPuzzle | null {
  const kind = p.cars.length < 4 ? 0 : rng.int(3);
  if (kind === 1) {
    const i = rng.range(1, p.cars.length - 1);
    return { ...p, cars: p.cars.filter((_, k) => k !== i) };
  }
  const base = kind === 2 ? { ...p, cars: p.cars.filter((_, k) => k !== rng.range(1, p.cars.length - 1)) } : p;
  if (!freeCells(base).length) return null;
  for (let t = 0; t < 20; t++) {
    const c = randomCar(base, rng);
    if (c) return { ...base, cars: [...base.cars, c] };
  }
  return null;
}

/** The hardest position reachable from the puzzle's start, and how many moves it needs; null if it can't be solved or explored. */
function hardest(p: RushPuzzle, cap: number): { p: RushPuzzle; d: number } | null {
  const all = explore(p, [encode(p, startPos(p))], { limit: 60_000 });
  if (!all.complete) return null;
  const goals = all.order.filter((k) => goalCode(p, k));
  if (!goals.length) return null;
  const back = explore(p, goals);
  let far = 0;
  for (const d of back.dist.values()) far = Math.max(far, Math.min(d, cap));
  const k = back.order.find((x) => Math.min(back.dist.get(x)!, cap) === far)!;
  return { p: withPos(p, decode(p, k)), d: far };
}

/** The puzzle with its cars moved to a position. */
export function withPos(p: RushPuzzle, pos: Pos): RushPuzzle {
  return { ...p, cars: p.cars.map((c, i) => (c.horizontal ? { ...c, x: pos[i]! } : { ...c, y: pos[i]! })) };
}

/**
 * Hill-climbs parking lots: starting from a red car alone, keep random changes (add, remove or
 * move a car) that leave the hardest reachable position at least as hard. Stops once that needs
 * as many moves as the difficulty asks for; the start is that position (the first found, capped
 * at the difficulty's most).
 */
export async function generatePuzzle(o: { w: number; h: number; difficulty: number }, rng: Rng, ctx: GenerateContext): Promise<RushPuzzle> {
  const [lo, hi] = BANDS[o.difficulty]!;
  let best: { p: RushPuzzle; d: number } | null = null;
  for (let restart = 0; ; restart++) {
    const row = Math.floor((o.h - 1) / 2);
    let cur: { p: RushPuzzle; d: number } = { p: { w: o.w, h: o.h, cars: [{ x: 0, y: row, len: 2, horizontal: true }], walls: [] }, d: 1 };
    for (let i = 0; i < START_CARS[o.difficulty]! * 3 && cur.p.cars.length <= START_CARS[o.difficulty]!; i++) {
      const m = mutate(cur.p, rng);
      if (m) cur = { p: m, d: 0 };
    }
    cur = hardest(cur.p, hi) ?? cur;
    let stale = 0;
    while (stale < 60) {
      await ctx.yield();
      const m = mutate(cur.p, rng);
      const next = m && hardest(m, hi);
      if (next && next.d >= cur.d) {
        stale = next.d > cur.d ? 0 : stale + 1;
        cur = next;
      } else stale++;
      if (cur.d >= lo) return cur.p;
    }
    if (!best || cur.d > best.d) best = cur;
    if (restart >= 8) return best.p;
  }
}
