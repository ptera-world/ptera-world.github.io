import { cellName } from "../../core/names";
import type { Rng } from "../../core/rng";
import type { GenerateContext } from "../../core/types";
import { nextStep, solveAll, type PermMove, type PermSpec, type PermStep } from "../../lib/perm";
import { distinct, goalTiles, type Goal } from "./goal";

/** Which blocks may turn: every n×n block, or only the four corner ones and the middle one (Gripple). */
export type Blocks = "all" | "corners";

/** Square blocks of tiles turn a quarter at a time (Twiddle, Gripple). */
export interface TurnPuzzle {
  moves: "turn";
  w: number;
  h: number;
  /** Block size. */
  n: number;
  blocks: Blocks;
  goal: Goal;
  orientable: boolean;
  /** Row-major values, 1-based. */
  tiles: number[];
  /** Quarter turns counterclockwise from upright, per cell (all 0 unless orientable). */
  turns: number[];
}

export interface TurnState {
  tiles: number[];
  turns: number[];
  moves: number;
}

/** Turn the n×n block whose top-left cell is (x, y). */
export type TurnAction = { type: "rotate"; x: number; y: number; clockwise: boolean };

export interface TurnFocus {
  /** Cells the hinted step moves. */
  moving?: number[];
  /** Top-left cells of the blocks the step turns, in order. */
  blocks?: number[];
  home?: number;
  tile?: number;
}

type Shape = Pick<TurnPuzzle, "w" | "h" | "n" | "blocks">;

/** Top-left cells of the blocks that may turn. */
export function blockCorners(p: Shape): number[] {
  const rw = p.w - p.n, rh = p.h - p.n;
  if (p.blocks === "corners") {
    const out = new Set([0, rw, rh * p.w, rh * p.w + rw]);
    if (rw % 2 === 0 && rh % 2 === 0) out.add((rh / 2) * p.w + rw / 2);
    return [...out].sort((a, b) => a - b);
  }
  const out: number[] = [];
  for (let y = 0; y <= rh; y++) for (let x = 0; x <= rw; x++) out.push(y * p.w + x);
  return out;
}

export const canTurn = (p: Shape, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x <= p.w - p.n && y <= p.h - p.n && (p.blocks !== "corners" || blockCorners(p).includes(y * p.w + x));

export function rotate(p: Pick<TurnPuzzle, "w" | "n" | "orientable">, s: { tiles: number[]; turns: number[] }, a: TurnAction): { tiles: number[]; turns: number[] } {
  const tiles = s.tiles.slice(), turns = s.turns.slice();
  for (let j = 0; j < p.n; j++) for (let i = 0; i < p.n; i++) {
    const from = (a.y + j) * p.w + a.x + i;
    const [ti, tj] = a.clockwise ? [p.n - 1 - j, i] : [j, p.n - 1 - i];
    const to = (a.y + tj) * p.w + a.x + ti;
    tiles[to] = s.tiles[from]!;
    turns[to] = p.orientable ? (s.turns[from]! + (a.clockwise ? 3 : 1)) % 4 : 0;
  }
  return { tiles, turns };
}

export const turnGoal = (p: Pick<TurnPuzzle, "w" | "h" | "goal">): number[] => goalTiles({ w: p.w, h: p.h, goal: p.goal, gap: false });

export function turnSolved(p: TurnPuzzle, s: { tiles: readonly number[]; turns: readonly number[] }): boolean {
  const goal = turnGoal(p);
  return s.tiles.every((t, c) => t === goal[c]) && (!p.orientable || s.turns.every((o) => o === 0));
}

const specs = new Map<string, PermSpec<TurnAction>>();

/** Blocks of 3×3 and up have commutators too big for the plain macro library, so they get deep macros. */
export function turnSpec(p: Pick<TurnPuzzle, "w" | "h" | "n" | "blocks" | "orientable" | "goal">): PermSpec<TurnAction> {
  const unique = distinct(p.goal);
  const key = `turn:${p.w}x${p.h}n${p.n}${p.blocks === "corners" ? "c" : ""}${p.orientable ? "o" : ""}${unique ? "" : "r"}`;
  let s = specs.get(key);
  if (s) return s;
  const cells = p.w * p.h;
  const ids = Array.from({ length: cells }, (_, i) => i);
  const zero = ids.map(() => 0);
  const moves: PermMove<TurnAction>[] = [];
  for (const corner of blockCorners(p)) {
    const x = corner % p.w, y = Math.floor(corner / p.w);
    for (const clockwise of [false, true]) {
      const a: TurnAction = { type: "rotate", x, y, clockwise };
      const after = rotate({ ...p, orientable: true }, { tiles: ids, turns: zero }, a);
      const to = new Int32Array(cells), turn = p.orientable ? new Int8Array(cells) : null;
      after.tiles.forEach((from, c) => {
        to[from] = c;
        if (turn) turn[from] = after.turns[c]!;
      });
      moves.push({ action: a, to, turn });
    }
  }
  const deep = p.n > 2 || p.blocks === "corners";
  let order: number[];
  if (deep) order = ids;
  else {
    order = [];
    for (let y = 0; y < p.h - p.n; y++) for (let x = 0; x < p.w; x++) order.push(y * p.w + x);
    for (let x = 0; x < p.w; x++) for (let y = p.h - p.n; y < p.h; y++) order.push(y * p.w + x);
  }
  s = { key, n: cells, turns: p.orientable ? 4 : 1, moves, order, distinct: unique, endgame: deep ? (cells <= 9 ? cells : 6) : p.orientable ? 4 : 6, deep };
  specs.set(key, s);
  return s;
}

const stepCache = new WeakMap<readonly number[], { turns: readonly number[]; p: TurnPuzzle; step: PermStep<TurnAction> | null }>();
export function turnHint(p: TurnPuzzle, s: TurnState): PermStep<TurnAction> | null {
  const hit = stepCache.get(s.tiles);
  if (hit && hit.turns === s.turns && hit.p === p) return hit.step;
  const step = nextStep(turnSpec(p), turnGoal(p), { values: s.tiles, turns: p.orientable ? s.turns : undefined });
  stepCache.set(s.tiles, { turns: s.turns, p, step });
  return step;
}

export const turnSolve = (p: TurnPuzzle, s: { tiles: readonly number[]; turns: readonly number[] }): TurnAction[] | null =>
  solveAll(turnSpec(p), turnGoal(p), { values: s.tiles, turns: p.orientable ? s.turns : undefined });

export interface TurnSetup {
  w: number;
  h: number;
  n: number;
  blocks: Blocks;
  goal: Goal;
  orientable: boolean;
  shuffle: number;
}

export async function generateTurn(v: TurnSetup, rng: Rng, ctx: GenerateContext): Promise<TurnPuzzle> {
  const { w, h, n } = v;
  const base: TurnPuzzle = { moves: "turn", w, h, n, blocks: v.blocks, goal: v.goal, orientable: v.orientable, tiles: [], turns: [] };
  const solved = { tiles: turnGoal(base).slice(), turns: Array.from({ length: w * h }, () => 0) };
  const corners = blockCorners(base);
  const total = v.shuffle || w * h * n * n * 2 + rng.int(2);
  let s = solved;
  for (let attempt = 0; attempt < 20; attempt++) {
    s = solved;
    /** Net turns per block since a neighboring block last turned: no more than a half turn either way. */
    const net = new Int32Array(w * h);
    for (let i = 0; i < total; i++) {
      let corner: number, dir: number, ok: boolean;
      do {
        corner = corners[rng.int(corners.length)]!;
        dir = rng.bool() ? 1 : -1;
        const old = net[corner]!, next = old + dir;
        ok = corners.length === 1 || (Math.abs(next) >= Math.abs(old) && Math.abs(next) <= 2);
      } while (!ok);
      const x = corner % w, y = Math.floor(corner / w);
      s = rotate(base, s, { type: "rotate", x, y, clockwise: dir < 0 });
      net[corner] = net[corner]! + dir;
      for (const other of corners) {
        const ox = other % w, oy = Math.floor(other / w);
        if (other !== corner && Math.abs(ox - x) < n && Math.abs(oy - y) < n) net[other] = 0;
      }
      if (i % 2000 === 1999) await ctx.yield();
    }
    if (!turnSolved(base, s)) break;
  }
  return { ...base, tiles: s.tiles, turns: s.turns };
}

/** Throws a player-facing message unless the board's values fit its goal. */
export function checkTurn(p: TurnPuzzle): TurnPuzzle {
  const { w, h, n } = p;
  if (!(n >= 2 && n <= Math.min(w, h))) throw new Error(`blocks must be from 2 to ${Math.min(w, h)} across on a ${w}×${h} board`);
  if (p.tiles.length !== w * h) throw new Error(`expected ${w * h} tiles, got ${p.tiles.length}`);
  const want = turnGoal(p).slice().sort((a, b) => a - b).join();
  if (p.tiles.slice().sort((a, b) => a - b).join() !== want) {
    throw new Error(p.goal === "rows" ? `each row number 1 to ${h} must appear ${w} times` : distinct(p.goal) ? `the numbers must be 1 to ${w * h}, each once` : "each number must appear as often as the finished board has it");
  }
  return p;
}

export const blockName = (p: Pick<TurnPuzzle, "n">, x: number, y: number): string =>
  `the block ${cellName(x, y)}–${cellName(x + p.n - 1, y + p.n - 1)}`;

export function describeTurn(p: Pick<TurnPuzzle, "n">, a: TurnAction): string {
  return `turn ${blockName(p, a.x, a.y)} ${a.clockwise ? "clockwise" : "counterclockwise"}`;
}
