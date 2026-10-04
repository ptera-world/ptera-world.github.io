import type { Side } from "../core/names";
import { namespace } from "../core/storage";

export { cellName, colName, rowName, type Side } from "../core/names";

const prefs = namespace("prefs");
const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];

/** Which board edges the player wants labelled (a stored preference); views draw labels on exactly these sides. */
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

