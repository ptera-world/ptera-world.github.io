/**
 * Seeded PRNG. Same seed string → same sequence on every JS engine (integer-only math).
 * Generators must draw all randomness from an Rng they were handed; never Math.random.
 */
export interface Rng {
  readonly seed: string;
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). n must be ≥ 1. */
  int(n: number): number;
  /** Uniform integer in [min, max] inclusive. */
  range(min: number, max: number): number;
  bool(p?: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Fisher–Yates in place; returns the same array. */
  shuffle<T>(items: T[]): T[];
  /**
   * Independent stream derived from (seed, label). Does not advance this stream, so adding
   * a new fork elsewhere never perturbs existing draws.
   */
  fork(label: string): Rng;
}

function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export function createRng(seed: string): Rng {
  let [a, b, c, d] = cyrb128(seed);
  const u32 = (): number => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    return r >>> 0;
  };
  for (let i = 0; i < 12; i++) u32();

  const rng: Rng = {
    seed,
    next: () => u32() / 4294967296,
    int(n) {
      if (n <= 1) return 0;
      // rejection sampling: unbiased for any n < 2^32
      const limit = 4294967296 - (4294967296 % n);
      let x = u32();
      while (x >= limit) x = u32();
      return x % n;
    },
    range: (min, max) => min + rng.int(max - min + 1),
    bool: (p = 0.5) => rng.next() < p,
    pick(items) {
      if (items.length === 0) throw new Error("rng.pick: empty array");
      return items[rng.int(items.length)]!;
    },
    shuffle(items) {
      for (let i = items.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        const t = items[i]!;
        items[i] = items[j]!;
        items[j] = t;
      }
      return items;
    },
    fork: (label) => createRng(`${seed}\u0000${label}`),
  };
  return rng;
}

const SEED_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** Fresh human-typeable seed (no 0/o/1/l/i). Non-deterministic by design. */
export function randomSeed(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += SEED_ALPHABET[b % SEED_ALPHABET.length];
  return out;
}
