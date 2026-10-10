import { cellName as boardCell } from "../../core/names";
import type { Action, PuzzleRef, Step, Technique } from "../../core/types";
import { scan, type Deduction, type Doms, type Model } from "./csp";

/** A cell's name as the board's edge labels show it, e.g. "C5". */
export const cellName = (p: { w: number }, c: number): string => boardCell(c % p.w, Math.floor(c / p.w));

/** "C5", "C5 and D2", "C5, D2, E1 and 3 more". */
export function cellList(p: { w: number }, cells: readonly number[]): string {
  const names = cells.slice(0, 3).map((c) => cellName(p, c));
  const rest = cells.length - names.length;
  if (rest > 0) return `${names.join(", ")} and ${rest} more`;
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "";
}

export const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** Highlight payload the grid views understand. Every cell a hint's text names is in one of these lists. */
export interface Focus {
  /** Cells the hint changes. */
  cells: number[];
  /** Cells explaining why. */
  because: number[];
  /** Other cells the text talks about. */
  related?: number[];
  /** Grid points (corners, on the (w + 1)-wide lattice) the hint is about. */
  points?: number[];
}

/** What the board establishes, as domains over the puzzle's model. */
export interface Reading {
  model: Model;
  k: Doms;
}

export interface TechniqueSpec<Pz, S, A extends Action> {
  id: string;
  name: string;
  puzzle: PuzzleRef;
  level: number;
  description: string;
  /** Deduction kinds this technique reports. */
  kinds: readonly string[];
  /** Null when the counted marks contradict each other. */
  read(p: Pz, s: S): Reading | null;
  /** Variables of `d` whose mark on the board the deduction would change. */
  changes(p: Pz, s: S, d: Deduction): number[];
  /** The step for `d`, narrowed to `vars`. */
  explain(p: Pz, s: S, d: Deduction, vars: number[], k: Doms): Step<A>;
  /** True if `d` is about `target` (a view target). Default: it changes or comes from that cell. */
  aim?(p: Pz, d: Deduction, vars: number[], target: unknown): boolean;
  requires?: Technique["requires"];
  defaults?: Technique["defaults"];
  practice?: Technique["practice"];
}

const defaultAim = (_p: unknown, d: Deduction, vars: number[], target: unknown): boolean =>
  typeof target === "number" && (vars.includes(target) || d.because.includes(target));

/** A technique whose instances are the deductions of its kinds that change the board, in scan order. */
export function technique<Pz, S, A extends { type: string }>(spec: TechniqueSpec<Pz, S, A>): Technique<Pz, S, A> {
  const each = (p: Pz, s: S, target: unknown, visit: (step: Step<A>) => boolean | void): void => {
    const r = spec.read(p, s);
    if (!r) return;
    const aim = spec.aim ?? defaultAim;
    scan(r.model, r.k, (x) => {
      if (!spec.kinds.includes(x.kind)) return false;
      const vars = spec.changes(p, s, x);
      if (!vars.length || (target !== undefined && !aim(p, x, vars, target))) return false;
      return visit(spec.explain(p, s, x, vars, r.k)) === true;
    }, spec.kinds);
  };
  return {
    id: spec.id,
    name: spec.name,
    puzzles: [spec.puzzle],
    level: spec.level,
    description: spec.description,
    instances: (p, s, visit) => each(p, s, undefined, visit),
    findAt: (p, s, target) => {
      let hit: Step<A> | null = null;
      each(p, s, target, (step) => { hit = step; return true; });
      return hit;
    },
    ...(spec.requires ? { requires: spec.requires } : {}),
    ...(spec.defaults ? { defaults: spec.defaults } : {}),
    ...(spec.practice ? { practice: spec.practice } : {}),
  };
}
