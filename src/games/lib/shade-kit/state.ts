import type { Hint } from "../../core/types";
import { bit, type Analysis, type Doms } from "../grid-kit/csp";
import { cellList, cellName, type Focus } from "../grid-kit/names";

/** Model values: one variable per cell. */
export const WHITE = 0, SHADED = 1;
export const W = bit(WHITE), B = bit(SHADED), ANY = W | B;

/** Per-cell mark. DOT is the player's note that a cell stays unshaded; it counts for nothing. */
export const NONE = 0, BLACK = 1, DOT = 2;
export type Mark = typeof NONE | typeof BLACK | typeof DOT;

export interface ShadeState {
  marks: number[];
}

/** Setting NONE is the only way marks are removed, so it alone is a retraction. */
export type ShadeAction = { type: "set"; cells: number[]; value: Mark };

export interface ShadeInteraction {
  cursor: number;
}

export const initShade = (n: number): ShadeState => ({ marks: Array.from({ length: n }, () => NONE) });

/** `fixed(c)` cells never take marks. Returns the same state when nothing changes. */
export function reduceShade(n: number, fixed: (c: number) => boolean, s: ShadeState, a: ShadeAction): ShadeState {
  if (a.type !== "set" || ![NONE, BLACK, DOT].includes(a.value)) return s;
  let next: number[] | null = null;
  for (const c of a.cells) {
    if (!(c >= 0 && c < n) || fixed(c) || s.marks[c] === a.value) continue;
    next ??= s.marks.slice();
    next[c] = a.value;
  }
  return next ? { marks: next } : s;
}

/**
 * Start domains plus board marks; with a unique solution only marks that agree with it count,
 * so deductions never build on a mistake.
 */
export function readShade(start: Doms, a: Analysis, s: ShadeState, fixed: (c: number) => boolean): Doms {
  const sol = a.count === 1 ? a.solution : null;
  const k = start.slice();
  s.marks.forEach((m, c) => {
    if (fixed(c)) return;
    if (m === BLACK && (!sol || sol[c] === SHADED)) k[c] = B;
    else if (m === DOT && (!sol || sol[c] === WHITE)) k[c] = W;
  });
  return k;
}

/** Marks that disagree with the unique solution, as a hint that removes them. */
export function wrongShadeHint(p: { w: number }, a: Analysis, s: ShadeState): Hint<ShadeAction> | null {
  if (a.count !== 1 || !a.solution) return null;
  const sol = a.solution;
  const wrong = s.marks.flatMap((m, c) => ((m === BLACK && sol[c] !== SHADED) || (m === DOT && sol[c] !== WHITE) ? [c] : []));
  if (!wrong.length) return null;
  return {
    message: `${wrong.length === 1 ? "the mark on" : "the marks on"} ${cellList(p, wrong)} ${wrong.length === 1 ? "is" : "are"} wrong`,
    focus: { cells: wrong, because: [] } satisfies Focus,
    actions: [{ type: "set", cells: wrong, value: NONE }],
  };
}

/** Solution marks: shaded cells BLACK, the rest DOT, `fixed` cells NONE. */
export const solvedShade = (solution: readonly number[], fixed: (c: number) => boolean): ShadeState =>
  ({ marks: solution.map((v, c) => (fixed(c) ? NONE : v === SHADED ? BLACK : DOT)) });

/** History text for one move, e.g. "shade C5", "dot C5 and D2", "clear E1". `shadeWord` names a BLACK mark. */
export function describeShade(p: { w: number }, a: ShadeAction, before: ShadeState, after: ShadeState, shadeWord = "shade"): string {
  const changed = a.cells.filter((c) => before.marks[c] !== after.marks[c]);
  const cells = changed.length ? changed : a.cells;
  const verb = a.value === BLACK ? shadeWord : a.value === DOT ? "dot" : "clear";
  return cells.length === 1 ? `${verb} ${cellName(p, cells[0]!)}` : `${verb} ${cellList(p, cells)}`;
}
