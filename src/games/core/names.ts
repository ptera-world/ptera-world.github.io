/**
 * Shared cell naming, so hint text and board labels agree everywhere: columns are letters
 * (A, B, …, Z, AA, …) and rows are numbers from 1, counted from the top-left; a cell is "C5".
 */

export type Side = "top" | "right" | "bottom" | "left";

/** Column label: A … Z, then AA, AB, … */
export function colName(col: number): string {
  let s = "";
  let n = col + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function rowName(row: number): string {
  return String(row + 1);
}

/** "C5" for column 2, row 4 (zero-based). */
export function cellName(col: number, row: number): string {
  return colName(col) + rowName(row);
}
