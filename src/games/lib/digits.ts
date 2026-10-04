export const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export type Digit = (typeof DIGITS)[number];

/** 1 … n, for n up to 9. */
export const digitsUpTo = (n: number): Digit[] => DIGITS.filter((d) => d <= n);
