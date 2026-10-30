import type { DataAttribute, DataValue } from "../../core/types";
import { compare, type Bands, type Feedback } from "../../lib/dataset/compare";

/** Mark of one position: not in the answer (beyond copies already marked), in it elsewhere, right here. */
export const ABSENT = 0, ELSEWHERE = 1, RIGHT = 2;
export type PositionMark = typeof ABSENT | typeof ELSEWHERE | typeof RIGHT;

/** A blank place in a guess (codes may allow them): never marked, never in an answer. */
export const BLANK = "_";

/**
 * Wordle's marks for a sequence: right places first, then each other symbol is "elsewhere" while
 * the answer has unmarked copies of it left. Blanks are never marked.
 */
export function markPositions(guess: readonly string[], answer: readonly string[]): PositionMark[] {
  const out: PositionMark[] = guess.map((c, i) => (c !== BLANK && c === answer[i] ? RIGHT : ABSENT));
  const left = new Map<string, number>();
  answer.forEach((c, i) => { if (out[i] !== RIGHT) left.set(c, (left.get(c) ?? 0) + 1); });
  guess.forEach((c, i) => {
    if (out[i] === RIGHT || c === BLANK) return;
    const n = left.get(c) ?? 0;
    if (n > 0) { out[i] = ELSEWHERE; left.set(c, n - 1); }
  });
  return out;
}

/** Mastermind's marks: how many positions are right, and how many more symbols are in the answer elsewhere. */
export function markCounts(guess: readonly string[], answer: readonly string[]): { right: number; elsewhere: number } {
  const m = markPositions(guess, answer);
  return { right: m.filter((x) => x === RIGHT).length, elsewhere: m.filter((x) => x === ELSEWHERE).length };
}

/** Per attribute marks of a dataset item against another. */
export function markAttributes(attrs: readonly DataAttribute[], guess: Readonly<Record<string, DataValue>>, answer: Readonly<Record<string, DataValue>>, bands: Bands = {}): Feedback[] {
  return attrs.map((a) => compare(a, guess[a.id] ?? null, answer[a.id] ?? null, bands));
}
