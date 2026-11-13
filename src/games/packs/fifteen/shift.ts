import type { Rng } from "../../core/rng";
import { nextStep, solveAll, type PermMove, type PermSpec, type PermStep } from "../../lib/perm";
import { describeShift } from "../../lib/shift-names";
import { distinct, goalTiles, type Goal } from "./goal";

/** Whole rows and columns slide round, wrapping (Sixteen, Loopover). */
export interface ShiftPuzzle {
  moves: "shift";
  w: number;
  h: number;
  goal: Goal;
  /** Row-major tile values (1-based). */
  tiles: number[];
}

export interface ShiftState {
  tiles: number[];
  moves: number;
}

/** Shift a whole row (positive = right) or column (positive = down), wrapping round. */
export type ShiftAction = { type: "shift"; line: "row" | "col"; index: number; by: number };

export interface ShiftFocus {
  /** Cells the hinted step moves. */
  moving?: number[];
  /** Cell being filled. */
  home?: number;
  /** Where its tile is now. */
  tile?: number;
}

export const shiftGoal = (p: Pick<ShiftPuzzle, "w" | "h" | "goal">): number[] => goalTiles({ w: p.w, h: p.h, goal: p.goal, gap: false });

export function shift(w: number, h: number, tiles: readonly number[], a: ShiftAction): number[] {
  const out = tiles.slice();
  if (a.line === "row") {
    if (a.index < 0 || a.index >= h) return out;
    for (let x = 0; x < w; x++) out[a.index * w + ((((x + a.by) % w) + w) % w)] = tiles[a.index * w + x]!;
  } else {
    if (a.index < 0 || a.index >= w) return out;
    for (let y = 0; y < h; y++) out[((((y + a.by) % h) + h) % h) * w + a.index] = tiles[y * w + a.index]!;
  }
  return out;
}

const specs = new Map<string, PermSpec<ShiftAction>>();

export function shiftSpec(p: Pick<ShiftPuzzle, "w" | "h" | "goal">): PermSpec<ShiftAction> {
  const { w, h } = p;
  const unique = distinct(p.goal);
  const key = `shift:${w}x${h}${unique ? "" : "r"}`;
  let s = specs.get(key);
  if (s) return s;
  const n = w * h;
  const ids = Array.from({ length: n }, (_, i) => i);
  const moves: PermMove<ShiftAction>[] = [];
  const add = (a: ShiftAction) => {
    const after = shift(w, h, ids, a);
    const to = new Int32Array(n);
    after.forEach((from, cell) => { to[from] = cell; });
    moves.push({ action: a, to, turn: null });
  };
  for (let y = 0; y < h; y++) for (const by of [1, -1]) if (w > 2 || by === 1) add({ type: "shift", line: "row", index: y, by });
  for (let x = 0; x < w; x++) for (const by of [1, -1]) if (h > 2 || by === 1) add({ type: "shift", line: "col", index: x, by });
  s = { key, n, turns: 1, moves, order: ids, distinct: unique };
  specs.set(key, s);
  return s;
}

const stepCache = new WeakMap<readonly number[], Map<string, PermStep<ShiftAction> | null>>();
export function shiftHint(p: ShiftPuzzle, tiles: readonly number[]): PermStep<ShiftAction> | null {
  const byGoal = stepCache.get(tiles) ?? new Map<string, PermStep<ShiftAction> | null>();
  stepCache.set(tiles, byGoal);
  const key = `${p.w}x${p.h}${p.goal}`;
  if (byGoal.has(key)) return byGoal.get(key)!;
  const st = nextStep(shiftSpec(p), shiftGoal(p), { values: tiles });
  byGoal.set(key, st);
  return st;
}

export const shiftSolve = (p: ShiftPuzzle, tiles: readonly number[]): ShiftAction[] | null => solveAll(shiftSpec(p), shiftGoal(p), { values: tiles });

/** Parity of the arrangement relative to the goal (values distinct). */
function parity(goal: readonly number[], tiles: readonly number[]): number {
  const home = new Map(goal.map((v, c) => [v, c]));
  const seen = new Uint8Array(tiles.length);
  let par = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (seen[i]) continue;
    let len = 0;
    for (let j = i; !seen[j]; j = home.get(tiles[j]!)!) { seen[j] = 1; len++; }
    par ^= (len - 1) & 1;
  }
  return par;
}

/** With both sides odd every shift is an even permutation, so only even arrangements can be reached. */
export const isReachable = (p: Pick<ShiftPuzzle, "w" | "h" | "goal">, tiles: readonly number[]): boolean =>
  !(p.w & p.h & 1) || !distinct(p.goal) || parity(shiftGoal(p), tiles) === 0;

export const shiftSolved = (p: ShiftPuzzle, tiles: readonly number[]): boolean => {
  const goal = shiftGoal(p);
  return tiles.every((t, i) => t === goal[i]);
};

export function generateShift(w: number, h: number, goal: Goal, shuffle: number, rng: Rng): ShiftPuzzle {
  const p: ShiftPuzzle = { moves: "shift", w, h, goal, tiles: [] };
  let tiles = shiftGoal(p).slice();
  if (shuffle > 0) {
    let last: ShiftAction | null = null;
    for (let i = 0; i < shuffle; i++) {
      let a: ShiftAction;
      do {
        const row = rng.bool(h / (w + h));
        a = { type: "shift", line: row ? "row" : "col", index: rng.int(row ? h : w), by: rng.bool() ? 1 : -1 };
      } while (last && last.line === a.line && last.index === a.index && last.by === -a.by);
      tiles = shift(w, h, tiles, a);
      last = a;
    }
  } else {
    rng.shuffle(tiles);
    if (!isReachable(p, tiles)) {
      const b = tiles.findIndex((t) => t !== tiles[0]);
      [tiles[0], tiles[b]] = [tiles[b]!, tiles[0]!];
    }
  }
  if (shiftSolved(p, tiles)) tiles = shift(w, h, tiles, { type: "shift", line: distinct(goal) ? "row" : "col", index: 0, by: 1 });
  return { ...p, tiles };
}

/** Throws a player-facing message unless `tiles` can be reached on this board. */
export function checkShift(p: ShiftPuzzle): ShiftPuzzle {
  const n = p.w * p.h;
  if (p.tiles.length !== n) throw new Error(`expected ${n} numbers, got ${p.tiles.length}`);
  const want = shiftGoal(p).slice().sort((a, b) => a - b).join();
  if (p.tiles.slice().sort((a, b) => a - b).join() !== want) {
    throw new Error(distinct(p.goal) ? `the numbers must be 1 to ${n}, each once` : "each number must appear as often as the finished board has it");
  }
  if (!isReachable(p, p.tiles)) throw new Error("with both sides odd, this arrangement can't be reached (two tiles would have to swap)");
  return p;
}

export function shiftOk(p: ShiftPuzzle, a: ShiftAction): boolean {
  if (a.type !== "shift" || !Number.isInteger(a.by) || a.by === 0) return false;
  const len = a.line === "row" ? p.w : p.h;
  return a.by % len !== 0 && a.index >= 0 && a.index < (a.line === "row" ? p.h : p.w);
}

export { describeShift };
