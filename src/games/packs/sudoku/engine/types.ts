import type { Rng } from "../../../core/rng";

/**
 * Engine contracts. A puzzle is an n×n grid of digits 1..n plus a list of constraint instances.
 * Each constraint *type* compiles its instances into three primitives the solvers understand:
 * all-different houses, pairwise not-equal links, and generic rules over a few cells.
 * Everything else (propagation, uniqueness, hints, grading, conflict checks) is derived from those.
 */

/** One constraint instance, plain JSON. `type` selects the ConstraintType. */
export interface ConstraintSpec {
  type: string;
  [key: string]: unknown;
}

export interface LatinPuzzle {
  n: number;
  /** Row-major, length n*n, 0 = empty. */
  givens: number[];
  constraints: ConstraintSpec[];
  /** Known unique solution (generated puzzles carry it). */
  solution?: number[];
  title?: string;
  author?: string;
}

/** Digits in `cells` are all different. A house of exactly n cells contains every digit once. */
export interface House {
  cells: readonly number[];
  /** Grouping used by techniques and highlighting: "row", "col", "box", "diagonal", "cage", … */
  kind: string;
  label: string;
}

/**
 * A relation over a small set of cells. Masks passed in are aligned with `cells`.
 * propagate must be sound: it may only remove digits that appear in no assignment satisfying the
 * rule within the given masks. It returns false when no assignment remains.
 */
export interface Rule {
  cells: readonly number[];
  label: string;
  /** Human difficulty of deductions from this rule (see human.ts scale). */
  difficulty?: number;
  propagate(masks: number[]): boolean;
  /** Positions (indices into `cells`) that already violate the rule; values use 0 for empty. */
  broken(values: readonly number[]): number[];
  /** Up to `limit` satisfying assignments within masks. */
  enumerate?(masks: readonly number[], limit: number): number[][];
}

export interface Compiled {
  houses?: House[];
  neq?: [number, number][];
  rules?: Rule[];
}

export interface Margins {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/** Drawing context handed to ConstraintType.render. Coordinates are SVG user units. */
export interface RenderCtx {
  n: number;
  /** Cell size. */
  S: number;
  layer: { under: SVGGElement; over: SVGGElement; outside: SVGGElement };
  svg: <K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Record<string, unknown> | null, ...children: (Node | string | number | null | undefined | false)[]) => SVGElementTagNameMap[K];
  /** Centre of a cell, or of an off-grid position given as (row, col). */
  center(cell: number): [number, number];
  at(row: number, col: number): [number, number];
  /** Keep the cell's top-left corner free of corner marks (a clue label sits there). */
  reserveCorner(cell: number): void;
}

export interface ConstraintType<C extends ConstraintSpec = ConstraintSpec> {
  type: string;
  label: string;
  /** One-line rule text for players. */
  rule?: string;
  /**
   * "global": shapes the solution (searched before clues exist), e.g. rows, boxes, anti-knight.
   * "clue": read off a finished solution by `clues`, e.g. cages, thermos, dots.
   */
  kind: "global" | "clue";
  /** Error message, or null if the instance is well formed. */
  validate?(c: C, n: number): string | null;
  compile(c: C, n: number): Compiled;
  /** Clue instances true of `solution`. Generation then strips the redundant ones (if removable). */
  clues?(solution: readonly number[], n: number, rng: Rng, options?: Readonly<Record<string, unknown>>): C[];
  /** Generation may drop instances while the solution stays unique. */
  removable?: boolean;
  /**
   * Make `c` say more about `cell` (e.g. split a cage so it becomes its own cage), to break a
   * second solution that differs there. Returns replacement instances, or null if it can't.
   */
  repair?(c: C, cell: number, solution: readonly number[], n: number): C[] | null;
  cells?(c: C, n: number): number[];
  /** Players benefit from seeing this rule's possible digit combinations (cages). */
  combos?: boolean;
  margin?(c: C, n: number): Margins;
  render?(c: C, ctx: RenderCtx): void;
}

export const cellName = (n: number, cell: number): string => `r${Math.floor(cell / n) + 1}c${(cell % n) + 1}`;
export const rowOf = (n: number, cell: number): number => Math.floor(cell / n);
export const colOf = (n: number, cell: number): number => cell % n;

/** Digit glyph; digits above 9 never occur (n ≤ 9). */
export const glyph = (d: number): string => String(d);
