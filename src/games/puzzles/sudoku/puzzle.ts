import type { Rng } from "../../core/rng";
import type { Schema, Values } from "../../core/schema";
import type { GenerateContext, Hint, Preset, PuzzleDef } from "../../core/types";
import { bit } from "./engine/bits";
import { findStep, grade, gridFrom, type Grade, type Step } from "./engine/human";
import { conflicts, modelOf } from "./engine/model";
import { constraintTypes } from "./engine/registry";
import { solve } from "./engine/solver";
import { cellName, type LatinPuzzle } from "./engine/types";
import { latinFormats } from "./formats";

export type { LatinPuzzle };

/** Player progress. Arrays are length n*n; marks and colours are bitmasks. */
export interface GridState {
  /** Digits including givens, 0 = empty. */
  values: number[];
  center: number[];
  corner: number[];
  /** Colour ids 1..9 as bits. */
  colors: number[];
  /** Candidates the player has ruled out (honoured by auto candidates and hints). */
  struck: number[];
}

export type MarkLayer = "center" | "corner";

export type GridAction =
  | { type: "set"; cells: number[]; digit: number }
  | { type: "mark"; layer: MarkLayer; cells: number[]; digit: number; on: boolean }
  | { type: "color"; cells: number[]; color: number; on: boolean }
  | { type: "clear"; cells: number[]; layer: "values" | "marks" | "colors" }
  | { type: "strike"; marks: [cell: number, mask: number][]; on: boolean };

export type InputMode = "digit" | "corner" | "center" | "color";

export interface GridInteraction {
  selection: number[];
  cursor: number;
  mode: InputMode;
}

/** Highlight data carried by hints (Hint.focus). */
export interface HintFocus {
  cells: number[];
  areas: number[][];
  place: [number, number][];
  eliminate: [number, number][];
  /** 0 = where to look, 1 = the pattern, 2 = the full deduction. */
  level: number;
}

export type LatinDef = PuzzleDef<LatinPuzzle, GridState, GridAction, GridInteraction, any>;

// --- reducer ---

function edit(arr: number[], cells: readonly number[], n2: number, f: (v: number, c: number) => number): number[] {
  let out: number[] | null = null;
  for (const c of cells) {
    if (c < 0 || c >= n2) continue;
    const v = (out ?? arr)[c]!;
    const nv = f(v, c);
    if (nv === v) continue;
    out ??= arr.slice();
    out[c] = nv;
  }
  return out ?? arr;
}

function with_<K extends keyof GridState>(s: GridState, key: K, next: GridState[K]): GridState {
  return next === s[key] ? s : { ...s, [key]: next };
}

export function reduce(p: LatinPuzzle, s: GridState, a: GridAction): GridState {
  const n2 = p.n * p.n;
  const free = (c: number) => !p.givens[c];
  switch (a.type) {
    case "set": {
      if (a.digit < 0 || a.digit > p.n) return s;
      return with_(s, "values", edit(s.values, a.cells.filter(free), n2, () => a.digit));
    }
    case "mark": {
      if (a.digit < 1 || a.digit > p.n) return s;
      const b = bit(a.digit);
      const cells = a.cells.filter((c) => free(c) && !s.values[c]);
      return with_(s, a.layer, edit(s[a.layer], cells, n2, (v) => (a.on ? v | b : v & ~b)));
    }
    case "color": {
      if (a.color < 1 || a.color > 9) return s;
      const b = bit(a.color);
      return with_(s, "colors", edit(s.colors, a.cells, n2, (v) => (a.on ? v | b : v & ~b)));
    }
    case "clear": {
      if (a.layer === "values") return with_(s, "values", edit(s.values, a.cells.filter(free), n2, () => 0));
      if (a.layer === "colors") return with_(s, "colors", edit(s.colors, a.cells, n2, () => 0));
      let next = with_(s, "center", edit(s.center, a.cells, n2, () => 0));
      next = with_(next, "corner", edit(next.corner, a.cells, n2, () => 0));
      return with_(next, "struck", edit(next.struck, a.cells, n2, () => 0));
    }
    case "strike": {
      let struck = s.struck, center = s.center;
      for (const [c, m] of a.marks) {
        if (c < 0 || c >= n2 || !free(c)) continue;
        struck = edit(struck, [c], n2, (v) => (a.on ? v | m : v & ~m));
        if (a.on) center = edit(center, [c], n2, (v) => v & ~m);
      }
      return with_(with_(s, "struck", struck), "center", center);
    }
    default:
      return s;
  }
}

export function initState(p: LatinPuzzle): GridState {
  const z = () => Array.from({ length: p.n * p.n }, () => 0);
  return { values: p.givens.slice(), center: z(), corner: z(), colors: z(), struck: z() };
}

// --- derived facts, memoized per puzzle object ---

const solutions = new WeakMap<LatinPuzzle, number[] | null>();

export function solutionOf(p: LatinPuzzle): number[] | null {
  if (p.solution) return p.solution;
  let s = solutions.get(p);
  if (s === undefined) {
    s = solve(modelOf(p), p.givens, { limit: 1, budget: 500_000 }).solutions[0] ?? null;
    solutions.set(p, s);
  }
  return s;
}

const grades = new WeakMap<LatinPuzzle, Grade>();

export function gradeOf(p: LatinPuzzle): Grade {
  let g = grades.get(p);
  if (!g) {
    g = grade(modelOf(p), p.givens, solutionOf(p) ?? undefined);
    grades.set(p, g);
  }
  return g;
}

export function isSolved(p: LatinPuzzle, s: GridState): boolean {
  return s.values.every((v) => v > 0) && conflicts(modelOf(p), s.values).size === 0;
}

// --- hints ---

export function mistakeHint(p: LatinPuzzle, s: GridState): Hint<GridAction> | null {
  const sol = solutionOf(p);
  if (!sol) return null;
  const wrong = s.values.flatMap((v, c) => (v && !p.givens[c] && v !== sol[c] ? [c] : []));
  if (!wrong.length) return null;
  const names = wrong.slice(0, 3).map((c) => cellName(p.n, c)).join(", ") + (wrong.length > 3 ? ` and ${wrong.length - 3} more` : "");
  const focus: HintFocus = { cells: wrong, areas: [], place: [], eliminate: [], level: 2 };
  return {
    message: `${wrong.length === 1 ? "this digit doesn't" : "these digits don't"} belong: ${names}`,
    focus,
    action: { type: "set", cells: wrong, digit: 0 },
  };
}

/** Next logical step from the player's placed digits (and their struck-out candidates, when consistent). */
export function nextStep(p: LatinPuzzle, s: GridState): Step | null {
  const sol = solutionOf(p) ?? undefined;
  const struck = sol ? s.struck.map((m, c) => m & ~bit(sol[c]!)) : undefined;
  return findStep(gridFrom(modelOf(p), s.values, sol, struck));
}

export function stepHint(step: Step, level = 2): Hint<GridAction> {
  const focus: HintFocus = {
    cells: level >= 1 ? step.cells : [],
    areas: step.areas,
    place: level >= 2 ? step.place : [],
    eliminate: level >= 2 ? step.eliminate : [],
    level,
  };
  const action: GridAction | undefined = step.place.length
    ? { type: "set", cells: [step.place[0]![0]], digit: step.place[0]![1] }
    : step.eliminate.length ? { type: "strike", marks: step.eliminate, on: true } : undefined;
  const message = level === 0 ? `${step.name}: ${step.nudge}` : level === 1 ? `look for a ${step.name} in the highlighted cells` : step.message;
  return { message, focus, action };
}

export function hint(p: LatinPuzzle, s: GridState): Hint<GridAction> | null {
  const m = mistakeHint(p, s);
  if (m) return m;
  const step = nextStep(p, s);
  return step ? stepHint(step) : null;
}

// --- description ---

export function variantLabels(p: LatinPuzzle, hide: readonly string[] = ["latin", "boxes"]): string[] {
  const seen = new Set<string>();
  for (const c of p.constraints) if (!hide.includes(c.type)) seen.add(constraintTypes.get(c.type)?.label ?? c.type);
  return [...seen];
}

export interface LatinDefConfig<P extends Schema> {
  id: string;
  name: string;
  description: string;
  params: P;
  presets?: readonly Preset<P>[];
  generatorVersion: number;
  generate(values: Values<P>, rng: Rng, ctx: GenerateContext): Promise<LatinPuzzle>;
  /** Constraint types implied by this puzzle (left out of the header label). */
  implied: readonly string[];
}

/** A puzzle definition over the shared engine; puzzle types differ only in params and generation. */
export function latinDef<P extends Schema>(cfg: LatinDefConfig<P>): PuzzleDef<LatinPuzzle, GridState, GridAction, GridInteraction, P> {
  return {
    id: cfg.id,
    name: cfg.name,
    description: cfg.description,
    generatorVersion: cfg.generatorVersion,
    params: cfg.params,
    presets: cfg.presets,
    generate: cfg.generate,
    formats: latinFormats(),
    init: initState,
    initInteraction: (p) => {
      const mid = Math.floor(p.n / 2) * p.n + Math.floor(p.n / 2);
      return { selection: [mid], cursor: mid, mode: "digit" };
    },
    reduce,
    isSolved,
    solve(p) {
      const sol = solutionOf(p);
      return sol ? { ...initState(p), values: sol.slice() } : null;
    },
    hint,
    rate(p) {
      const g = gradeOf(p);
      return { label: g.band.label, score: g.score };
    },
    describe(p) {
      const extra = variantLabels(p, cfg.implied);
      return [`${p.n}×${p.n}`, ...extra].join(" ") + (p.title ? ` · ${p.title}` : "");
    },
  };
}
