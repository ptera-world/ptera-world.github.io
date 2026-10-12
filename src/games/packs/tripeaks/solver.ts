import { rankOf } from "../../lib/cards/deck";
import { work } from "../../lib/work";

/** Rows of the three peaks from the apexes down: 3, 6, 9 and 10 cards. */
export const ROWS = [3, 6, 9, 10] as const;
export const SPOTS = 28;
const ROW_START = [0, 3, 9, 18] as const;

export const rowOf = (spot: number): number => (spot >= 18 ? 3 : spot >= 9 ? 2 : spot >= 3 ? 1 : 0);
export const colOf = (spot: number): number => spot - ROW_START[rowOf(spot)]!;

/** The two spots one row down that sit on top of `spot`; empty for the bottom row. */
export const COVERS: readonly (readonly number[])[] = Array.from({ length: SPOTS }, (_, spot) => {
  const r = rowOf(spot), c = colOf(spot);
  if (r === 3) return [];
  const below = ROW_START[r + 1]!;
  const first = r === 2 ? c : r === 1 ? c + (c >> 1) : 2 * c;
  return [below + first, below + first + 1];
});

/** Spots that `spot` sits on top of (the inverse of COVERS). */
export const UNDER: readonly (readonly number[])[] = Array.from({ length: SPOTS }, (_, spot) => {
  const out: number[] = [];
  COVERS.forEach((cs, up) => { if (cs.includes(spot)) out.push(up); });
  return out;
});

export interface Rules {
  /** Ace and king count as neighbours. */
  connect: boolean;
  /** Times the waste may be turned back over into the stock. */
  recycles: number;
}

/**
 * A TriPeaks position. Cards are faces 0…51. `spots[i]` is the card still at tableau spot i, −1
 * once played. `waste` bottom first, its last card is the one to play on; `stock` bottom first,
 * the last card is drawn next.
 */
export interface Pos {
  spots: number[];
  stock: number[];
  waste: number[];
  used: number;
}

/** A play of tableau spot 0…27, or −1 for a click on the stock. */
export type Move = number;
export const DRAW = -1;

export const clonePos = (p: Pos): Pos => ({ spots: p.spots.slice(), stock: p.stock.slice(), waste: p.waste.slice(), used: p.used });

export const isFree = (p: Pos, spot: number): boolean => p.spots[spot]! >= 0 && COVERS[spot]!.every((c) => p.spots[c]! < 0);

export function neighbours(a: number, b: number, connect: boolean): boolean {
  const d = Math.abs(rankOf(a) - rankOf(b));
  return d === 1 || (connect && d === 12);
}

export function canPlay(r: Rules, p: Pos, spot: number): boolean {
  const top = p.waste[p.waste.length - 1];
  return top !== undefined && isFree(p, spot) && neighbours(p.spots[spot]!, top, r.connect);
}

export const canDraw = (r: Rules, p: Pos): boolean => p.stock.length > 0 || (p.waste.length > 0 && p.used < r.recycles);

/** Spots that turn face up when `spot` is played. */
export const uncovers = (p: Pos, spot: number): number[] =>
  UNDER[spot]!.filter((up) => p.spots[up]! >= 0 && COVERS[up]!.every((c) => c === spot || p.spots[c]! < 0));

/** One click on the stock: draw, or turn the waste over when the stock is empty. False if neither is possible. */
export function draw(r: Rules, p: Pos): boolean {
  if (p.stock.length) {
    p.waste.push(p.stock.pop()!);
    return true;
  }
  if (p.waste.length && p.used < r.recycles) {
    p.stock = p.waste.reverse();
    p.waste = [];
    p.used++;
    return true;
  }
  return false;
}

export function play(p: Pos, spot: number): void {
  p.waste.push(p.spots[spot]!);
  p.spots[spot] = -1;
}

export const isWon = (p: Pos): boolean => p.spots.every((c) => c < 0);

export function moves(r: Rules, p: Pos): Move[] {
  const out: Move[] = [];
  for (let i = 0; i < SPOTS; i++) if (canPlay(r, p, i)) out.push(i);
  out.sort((a, b) => uncovers(p, b).length - uncovers(p, a).length || a - b);
  if (canDraw(r, p)) out.push(DRAW);
  return out;
}

export interface Search {
  path: Move[] | null;
  impossible: boolean;
  nodes: number;
}

export const BUDGET = 40_000;

function key(r: Rules, p: Pos): string {
  let mask = 0;
  for (let i = 0; i < SPOTS; i++) if (p.spots[i]! >= 0) mask |= 1 << i;
  const top = p.waste[p.waste.length - 1] ?? -1;
  return r.recycles > 0 ? `${mask}|${p.used}|${p.stock.join(".")}|${p.waste.join(".")}` : `${mask}|${p.stock.length}|${top}`;
}

/** Depth-first search for a win; each position is expanded once. Deterministic per budget (nodes expanded). */
export function solve(r: Rules, start: Pos, budget = BUDGET): Search {
  const seen = new Set<string>();
  const path: Move[] = [];
  let nodes = 0, aborted = false;
  const go = (p: Pos): boolean => {
    if (isWon(p)) return true;
    const k = key(r, p);
    if (seen.has(k)) return false;
    seen.add(k);
    if (++nodes > budget) { aborted = true; return false; }
    work.units++;
    for (const m of moves(r, p)) {
      const q = clonePos(p);
      if (m === DRAW) draw(r, q);
      else play(q, m);
      path.push(m);
      if (go(q)) return true;
      path.pop();
      if (aborted) return false;
    }
    return false;
  };
  if (go(clonePos(start))) return { path: path.slice(), impossible: false, nodes };
  return { path: null, impossible: !aborted, nodes };
}
