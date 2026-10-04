/**
 * Derived-annotation keys shared by the sudoku-family plugins and views (see Session.derived()).
 * Every value is optional; views render whatever is present.
 */

/** number[]: candidate masks to show for empty cells instead of the player's centre marks. */
export const CANDIDATES = "sudoku.candidates";
/** number[]: cells breaking a rule. */
export const CONFLICTS = "sudoku.conflicts";
/** number[]: placed digits that differ from the solution. */
export const MISTAKES = "sudoku.mistakes";
/** { digit: number; cells: number[] }: cells holding (or able to hold, if marked) the focused digit. */
export const SAME = "sudoku.same";
/** number[]: cells that see the selection. */
export const PEERS = "sudoku.peers";
/** number[]: count of each digit placed, indexed by digit (index 0 unused). */
export const COUNTS = "sudoku.counts";
/** string[]: short info lines shown beside the board. */
export const INFO = "sudoku.info";

export interface SameDigit {
  digit: number;
  cells: number[];
  /** Also highlight this digit inside marks. */
  marks: boolean;
}
