/**
 * Derived-annotation keys shared by the sudoku-family plugins and views (see Session.derived()).
 * Every value is optional; views render whatever is present.
 */

/** number[]: candidate masks to show for empty cells instead of the player's center marks. */
export const CANDIDATES = "sudoku.candidates";
/** number[]: cells breaking a rule. */
export const CONFLICTS = "sudoku.conflicts";
/** number[]: placed digits that differ from the solution. */
export const MISTAKES = "sudoku.mistakes";
/** SameDigit: the highlighted digit and where it is. */
export const SAME = "sudoku.same";
/** number[]: cells that see the selection. */
export const PEERS = "sudoku.peers";

export interface SameDigit {
  digit: number;
  cells: number[];
  /** Also highlight this digit inside marks. */
  marks: boolean;
  /** Empty cells where the digit is still a candidate, if asked for. */
  open?: number[];
}
