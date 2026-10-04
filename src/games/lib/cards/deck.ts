/**
 * Playing cards as numbers. A face is suit * 13 + (rank - 1): suits run clubs, diamonds, hearts,
 * spades; ranks run 1 (ace) to 13 (king). Games with more than one deck give every physical card
 * its own id and map ids to faces themselves.
 */

import type { Rng } from "../../core/rng";

export type Face = number;

export const SUIT_NAMES = ["clubs", "diamonds", "hearts", "spades"] as const;
export const SUIT_GLYPHS = ["♣", "♦", "♥", "♠"] as const;
const SUIT_LETTERS = "CDHS";
const RANK_LABELS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
const RANK_WORDS = ["", "ace", "2", "3", "4", "5", "6", "7", "8", "9", "10", "jack", "queen", "king"] as const;
const RANK_LETTERS = "?A23456789TJQK";

export const face = (suit: number, rank: number): Face => suit * 13 + rank - 1;
export const suitOf = (f: Face): number => Math.floor(f / 13);
export const rankOf = (f: Face): number => (f % 13) + 1;
export const isRed = (f: Face): boolean => suitOf(f) === 1 || suitOf(f) === 2;
export const rankLabel = (rank: number): string => RANK_LABELS[rank] ?? "?";
export const rankWord = (rank: number): string => RANK_WORDS[rank] ?? "?";

/** "10♥", "K♠". */
export const cardName = (f: Face): string => `${RANK_LABELS[rankOf(f)]}${SUIT_GLYPHS[suitOf(f)]}`;

/** Two-letter code as used by solvers and deal lists: rank (A23456789TJQK) then suit (CDHS), e.g. "TH". */
export const cardCode = (f: Face): string => `${RANK_LETTERS[rankOf(f)]}${SUIT_LETTERS[suitOf(f)]}`;

/** Parses "TH", "10h", "qs", "A♠" (rank then suit, any case). Throws with the offending text. */
export function parseCard(text: string): Face {
  const m = /^(10|[a2-9tjqk1])([cdhs♣♦♥♠])$/i.exec(text.trim());
  if (!m) throw new Error(`"${text}" is not a card (expected a rank A 2–9 T J Q K and a suit C D H S, like TH or 5c)`);
  const r = m[1]!.toUpperCase();
  const rank = r === "10" ? 10 : r === "1" ? 1 : RANK_LETTERS.indexOf(r);
  const s = m[2]!.toUpperCase();
  const suit = "♣♦♥♠".includes(s) ? "♣♦♥♠".indexOf(s) : SUIT_LETTERS.indexOf(s);
  return face(suit, rank);
}

/** Cards from whitespace- or comma-separated codes. */
export const parseCards = (text: string): Face[] => text.split(/[\s,]+/).filter(Boolean).map(parseCard);

/** A full deck 0…51 shuffled with `rng`. */
export const shuffledDeck = (rng: Rng): Face[] => rng.shuffle(Array.from({ length: 52 }, (_, i) => i));

/**
 * Microsoft FreeCell deal `n` (1 … 2³¹−1): the 52 cards in the order they are dealt, left to
 * right across 8 columns, row after row.
 */
export function msDeal(n: number): Face[] {
  let seed = n >>> 0;
  const rand = () => {
    seed = (seed * 214013 + 2531011) % 2147483648;
    return Math.floor(seed / 65536);
  };
  // microsoft numbers cards rank-major (AC AD AH AS 2C …)
  const deck = Array.from({ length: 52 }, (_, i) => face(i % 4, Math.floor(i / 4) + 1));
  const out: Face[] = [];
  while (deck.length) {
    const j = rand() % deck.length;
    const last = deck.length - 1;
    [deck[j], deck[last]] = [deck[last]!, deck[j]!];
    out.push(deck.pop()!);
  }
  return out;
}

/** `upper` can sit on `lower` in a column built down in alternating colors. */
export const buildsDownAlternating = (upper: Face, lower: Face): boolean => rankOf(lower) === rankOf(upper) + 1 && isRed(lower) !== isRed(upper);
