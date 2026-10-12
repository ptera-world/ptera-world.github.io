import { prefs } from "./storage";

/** How long a touch must be held to count as a hold (the board menu opens at this point). */
export const HOLD_MS = 550;

/** A modifier key the player can hold to change what a click does. */
export type HoldKey = "shift" | "alt" | "ctrl" | "none";

declare module "./storage" {
  interface Prefs {
    [k: `swapButtons:${string}`]: boolean;
    /** Held while clicking: the board's other action (the hold / right-click one). */
    holdOther: HoldKey;
    /** Held while clicking: the picked (or last picked) technique is cast instead of a mark. */
    holdSkill: HoldKey;
  }
}

const swapKey = (puzzleId: string) => `swapButtons:${puzzleId}` as const;

/** The player swapped primary and secondary (left/right click, tap/hold) for this puzzle. */
export const buttonsSwapped = (puzzleId: string): boolean => prefs.get(swapKey(puzzleId), false);

export function setButtonsSwapped(puzzleId: string, on: boolean): void {
  prefs.set(swapKey(puzzleId), on);
}

export const holdOtherKey = (): HoldKey => prefs.get("holdOther", "shift");
export const holdSkillKey = (): HoldKey => prefs.get("holdSkill", "alt");

/** True if `key` is held in this event (never for "none"). */
export function held(e: { shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }, key: HoldKey): boolean {
  return key === "shift" ? !!e.shiftKey : key === "alt" ? !!e.altKey : key === "ctrl" ? !!(e.ctrlKey || e.metaKey) : false;
}

/**
 * True if a press asks for the board's secondary action: the right button, flipped by the
 * player's swap for this puzzle and again while the "other action" key is held. Boards with two
 * opposite actions choose through this, never from the raw button or modifiers.
 */
export const secondary = (e: { button: number; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }, puzzleId: string): boolean =>
  ((e.button === 2) !== buttonsSwapped(puzzleId)) !== held(e, holdOtherKey());
