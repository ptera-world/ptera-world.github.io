import type { Side } from "./names";
import { prefs } from "./storage";

export { cellName, colName, rowName, type Side } from "./names";


declare module "./storage" {
  interface Prefs {
    labelSides: Side[];
  }
}
const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];

/** Which board edges the player wants labelled (a stored preference); views draw labels on exactly these sides. */
export function labelSides(): Set<Side> {
  return new Set(prefs.get("labelSides", []));
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

