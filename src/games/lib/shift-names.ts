import { colName, rowName } from "../core/names";

/** A whole row (positive = right) or column (positive = down) moved round by `by` places. */
export interface LineShift {
  line: "row" | "col";
  index: number;
  by: number;
}

/** "row 3 right", "column B up 2 places". */
export function describeShift(a: LineShift): string {
  const dir = a.line === "row" ? (a.by > 0 ? "right" : "left") : (a.by > 0 ? "down" : "up");
  const times = Math.abs(a.by) === 1 ? "" : ` ${Math.abs(a.by)} places`;
  return `${a.line === "row" ? `row ${rowName(a.index)}` : `column ${colName(a.index)}`} ${dir}${times}`;
}
