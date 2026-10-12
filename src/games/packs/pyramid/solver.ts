import { rankOf } from "../../lib/cards/deck";
import { work } from "../../lib/work";

/** Piles in the game: 0 stock, 1 waste, then the 28 pyramid spots in row order from the apex. */
export const STOCK = 0, WASTE = 1, PYR = 2, SPOTS = 28, ROWS = 7;
export const FULL = (1 << SPOTS) - 1;

/** Row of each spot (0 is the apex). */
export const ROW: readonly number[] = Array.from({ length: SPOTS }, (_, i) => {
  let r = 0;
  while ((r + 1) * (r + 2) / 2 <= i) r++;
  return r;
});

/** The two spots that cover spot i (the cards below it that overlap it); none in the bottom row. */
export const coversOf = (i: number): [number, number] | null => (ROW[i]! === ROWS - 1 ? null : [i + ROW[i]! + 1, i + ROW[i]! + 2]);

/** A pyramid position for searching: which spots are cleared, and the stock and waste (bottom first, the last card is next / in play). */
export interface Pos {
  gone: number;
  stock: number[];
  waste: number[];
  recycles: number;
}

/** Passes through the stock allowed; 0 for no limit. */
export interface Rules {
  passes: number;
}

export type Move = { t: "draw" } | { t: "take"; a: number } | { t: "pair"; a: number; b: number };

export interface Search {
  path: Move[] | null;
  impossible: boolean;
  nodes: number;
}

export const clonePos = (p: Pos): Pos => ({ gone: p.gone, stock: p.stock.slice(), waste: p.waste.slice(), recycles: p.recycles });

export const isGone = (gone: number, i: number): boolean => ((gone >> i) & 1) === 1;

/** A spot still holding a card with nothing left covering it. */
export function isFree(gone: number, i: number): boolean {
  if (isGone(gone, i)) return false;
  const c = coversOf(i);
  return !c || (isGone(gone, c[0]) && isGone(gone, c[1]));
}

export const canRecycle = (r: Rules, recycles: number): boolean => r.passes === 0 || recycles < r.passes - 1;

export const canDraw = (p: Pos, r: Rules): boolean => p.stock.length > 0 || (p.waste.length > 0 && canRecycle(r, p.recycles));

/** One click on the stock: draw, or turn the waste over when the stock is empty. False if neither is possible. */
export function draw(p: Pos, r: Rules): boolean {
  if (p.stock.length) {
    p.waste.push(p.stock.pop()!);
    return true;
  }
  if (p.waste.length && canRecycle(r, p.recycles)) {
    p.stock = p.waste.reverse();
    p.waste = [];
    p.recycles++;
    return true;
  }
  return false;
}

/** The cards that can be removed now: the waste's top and every free spot, as pile numbers. */
export function removable(p: Pos): number[] {
  const out: number[] = [];
  if (p.waste.length) out.push(WASTE);
  for (let i = 0; i < SPOTS; i++) if (isFree(p.gone, i)) out.push(PYR + i);
  return out;
}

/** The card at a removable pile. */
export const cardAt = (pyr: readonly number[], p: Pos, pile: number): number => (pile === WASTE ? p.waste[p.waste.length - 1]! : pyr[pile - PYR]!);

/** Whether the cards at two removable piles are a pair. */
export const pairs = (pyr: readonly number[], p: Pos, a: number, b: number): boolean => a !== b && rankOf(cardAt(pyr, p, a)) + rankOf(cardAt(pyr, p, b)) === 13;

/** Apply a move in place (no checks). */
export function applyMove(p: Pos, m: Move, r: Rules): void {
  if (m.t === "draw") {
    draw(p, r);
    return;
  }
  for (const pile of m.t === "take" ? [m.a] : [m.a, m.b]) {
    if (pile === WASTE) p.waste.pop();
    else p.gone |= 1 << (pile - PYR);
  }
}

/** How many cards removing these piles would free. */
export function freedBy(p: Pos, piles: readonly number[]): number {
  let gone = p.gone;
  for (const pile of piles) if (pile >= PYR) gone |= 1 << (pile - PYR);
  let n = 0;
  for (let i = 0; i < SPOTS; i++) if (!isFree(p.gone, i) && isFree(gone, i)) n++;
  return n;
}

/** Every removal: a lone king, and each pair, those that free the most first. */
export function removals(pyr: readonly number[], p: Pos): Move[] {
  const rem = removable(p);
  const kings: Move[] = [];
  const prs: { m: Move; n: number }[] = [];
  for (let x = 0; x < rem.length; x++) {
    const a = rem[x]!;
    if (rankOf(cardAt(pyr, p, a)) === 13) kings.push({ t: "take", a });
    for (let y = x + 1; y < rem.length; y++) {
      const b = rem[y]!;
      if (pairs(pyr, p, a, b)) prs.push({ m: { t: "pair", a, b }, n: freedBy(p, [a, b]) });
    }
  }
  return [...kings, ...prs.sort((u, v) => v.n - u.n).map((x) => x.m)];
}

export const isLostPos = (pyr: readonly number[], p: Pos, r: Rules): boolean => p.gone !== FULL && !canDraw(p, r) && removals(pyr, p).length === 0;

const key = (p: Pos, r: Rules) => `${p.gone}|${p.stock.length}|${p.waste.join(".")}|${r.passes ? p.recycles : ""}`;

export const BUDGET = 40_000;

/**
 * Depth-first search for a clearing line, memoising positions. A free king is always taken
 * first (it can only help). Deterministic per budget (nodes expanded).
 */
export function solve(pyr: readonly number[], start: Pos, r: Rules, budget = BUDGET): Search {
  const seen = new Set<string>();
  const path: Move[] = [];
  let nodes = 0;
  let spent = false;
  const go = (p: Pos): boolean => {
    if (p.gone === FULL) return true;
    const k = key(p, r);
    if (seen.has(k)) return false;
    seen.add(k);
    if (++nodes > budget) { spent = true; return false; }
    work.units++;
    const rm = removals(pyr, p);
    const options: Move[] = rm.length && rm[0]!.t === "take" ? [rm[0]!] : [...rm, ...(canDraw(p, r) ? [{ t: "draw" } as Move] : [])];
    for (const m of options) {
      const q = clonePos(p);
      applyMove(q, m, r);
      path.push(m);
      if (go(q)) return true;
      path.pop();
      if (spent) return false;
    }
    return false;
  };
  const found = go(clonePos(start));
  return found ? { path: path.slice(), impossible: false, nodes } : { path: null, impossible: !spent, nodes };
}
