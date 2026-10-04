import { namespace } from "../core/storage";

const prefs = namespace("prefs");

export type Side = "top" | "right" | "bottom" | "left";
const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];

/**
 * Board conventions shared by every view and every hint, so text and board agree:
 * columns are letters (A, B, …) and rows are numbers (1, 2, …), a cell is "C5".
 * Which edges show those labels is a player setting; views draw labels on exactly these sides.
 */
export function labelSides(): Set<Side> {
  return new Set(prefs.get<Side[]>("labelSides", []));
}

export function setLabelSides(sides: Iterable<Side>): void {
  prefs.set("labelSides", SIDES.filter((s) => new Set(sides).has(s)));
  for (const cb of listeners) cb();
}

/** Off → top+left → all four → off. */
export function cycleLabels(): void {
  const n = labelSides().size;
  setLabelSides(n === 0 ? ["top", "left"] : n < 4 ? SIDES : []);
}

const listeners = new Set<() => void>();
export function onBoardPrefsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

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
