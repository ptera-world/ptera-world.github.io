import { prefs } from "./storage";

/** How long a touch must be held to count as a hold (the board menu opens at this point). */
export const HOLD_MS = 550;

declare module "./storage" {
  interface Prefs {
    [k: `swapButtons:${string}`]: boolean;
  }
}

const swapKey = (puzzleId: string) => `swapButtons:${puzzleId}` as const;

/** The player swapped primary and secondary (left/right click, tap/hold) for this puzzle. */
export const buttonsSwapped = (puzzleId: string): boolean => prefs.get(swapKey(puzzleId), false);

export function setButtonsSwapped(puzzleId: string, on: boolean): void {
  prefs.set(swapKey(puzzleId), on);
}

/**
 * True if a press asks for the board's secondary action: the right button (or the primary one
 * when the player swapped them for this puzzle). Boards with two opposite actions on the two
 * buttons choose through this, never from the raw button.
 */
export const secondary = (e: { button: number }, puzzleId: string): boolean => (e.button === 2) !== buttonsSwapped(puzzleId);
