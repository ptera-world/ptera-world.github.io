/** Card piles as plain data, shared by every card game's state. */

export interface Pile {
  /** Card ids, bottom first. */
  c: number[];
  /** How many cards at the bottom are face down. */
  d: number;
}

export const top = (p: Pile): number | undefined => p.c[p.c.length - 1];
export const faceUp = (p: Pile, i: number): boolean => i >= p.d && i < p.c.length;

/**
 * Move the top `n` cards of `from` onto `to`, face up. When `flip` is set and the cards left on
 * `from` are all face down, its new top card turns face up. Returns new piles; input untouched.
 */
export function moveCards(piles: readonly Pile[], from: number, to: number, n: number, flip = true): Pile[] {
  const out = piles.slice();
  const a = piles[from]!, b = piles[to]!;
  const cut = a.c.length - n;
  const moved = a.c.slice(cut);
  const rest = a.c.slice(0, cut);
  const d = Math.min(a.d, rest.length);
  out[from] = { c: rest, d: flip && d === rest.length && d > 0 ? d - 1 : d };
  out[to] = { c: [...b.c, ...moved], d: b.d };
  return out;
}

/** Cards with a face-up/down flag, in pile order, for every pile. */
export function eachCard(piles: readonly Pile[], fn: (id: number, pile: number, index: number, up: boolean) => void): void {
  piles.forEach((p, pi) => p.c.forEach((id, i) => fn(id, pi, i, i >= p.d)));
}

/** Where every card is: pile and index, by id. */
export function whereIs(piles: readonly Pile[]): Map<number, { pile: number; index: number }> {
  const m = new Map<number, { pile: number; index: number }>();
  eachCard(piles, (id, pile, index) => m.set(id, { pile, index }));
  return m;
}
