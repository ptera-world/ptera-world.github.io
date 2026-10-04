/** Candidate sets are bitmasks: digit d ↔ bit (1 << (d - 1)). */

export const bit = (d: number): number => 1 << (d - 1);

export const fullMask = (n: number): number => (1 << n) - 1;

export function popcount(m: number): number {
  let c = 0;
  while (m) {
    m &= m - 1;
    c++;
  }
  return c;
}

/** Digit of the lowest set bit; 0 for an empty mask. */
export function lowDigit(m: number): number {
  return m ? 31 - Math.clz32(m & -m) + 1 : 0;
}

export const isSingle = (m: number): boolean => m !== 0 && (m & (m - 1)) === 0;

export function digits(m: number): number[] {
  const out: number[] = [];
  for (let d = 1; m; d++, m >>= 1) if (m & 1) out.push(d);
  return out;
}

export function maskOf(ds: Iterable<number>): number {
  let m = 0;
  for (const d of ds) if (d > 0) m |= bit(d);
  return m;
}

export const minDigit = lowDigit;

export function maxDigit(m: number): number {
  return m ? 32 - Math.clz32(m) : 0;
}

/** All k-element subsets of items, in lexicographic index order. */
export function* combinations<T>(items: readonly T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) {
    yield acc.slice();
    return;
  }
  for (let i = start; i <= items.length - (k - acc.length); i++) {
    acc.push(items[i]!);
    yield* combinations(items, k, i + 1, acc);
    acc.pop();
  }
}
