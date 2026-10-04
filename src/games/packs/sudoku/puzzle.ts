import type { Rng } from "../../core/rng";
import type { Schema, Values } from "../../core/schema";
import type { GenerateContext, Hint, Preset, PuzzleDef } from "../../core/types";
import { bit, digits, popcount } from "./engine/bits";
import { listOf } from "../../lib/edge-names";
import { grade, gridFrom, type Grade, type Grid } from "./engine/human";
import { conflicts, modelOf } from "./engine/model";
import { constraintTypes } from "./engine/registry";
import { solve } from "./engine/solver";
import { cellName, type LatinPuzzle } from "./engine/types";
import { latinFormats } from "./formats";

export type { LatinPuzzle };

/** Player progress. Arrays are length n*n; marks and colors are bitmasks. */
export interface GridState {
  /** Digits including givens, 0 = empty. */
  values: number[];
  center: number[];
  corner: number[];
  /** Color ids 1..9 as bits. */
  colors: number[];
  /** Candidates the player has ruled out (honored by auto candidates and techniques). */
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
  /** Digit picked for highlighting; 0 (or absent, in older saves) follows the selected cell. */
  highlight?: number;
}

/** Highlight data carried by hints and technique steps (Hint.focus). */
export interface HintFocus {
  cells: number[];
  areas: number[][];
  place: [number, number][];
  eliminate: [number, number][];
  /** 0 = where to look, 2 = the full deduction. */
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

/** Moves that take progress back: erasing digits or marks, restoring a ruled-out candidate. */
export function isRetraction(a: GridAction): boolean {
  switch (a.type) {
    case "set": return a.digit === 0;
    case "clear": return a.layer !== "colors";
    case "strike": return !a.on;
    default: return false;
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

/**
 * The position techniques reason about: placed digits plus the candidates the player ruled out.
 * A ruled-out candidate that is actually the solution is ignored, so a wrong strike never leads
 * a technique to a wrong deduction.
 */
export function gridOf(p: LatinPuzzle, s: GridState): Grid {
  const sol = solutionOf(p) ?? undefined;
  const struck = sol ? s.struck.map((m, c) => m & ~bit(sol[c]!)) : s.struck;
  return gridFrom(modelOf(p), s.values, sol, struck);
}

const featureCache = new WeakMap<LatinPuzzle, string[]>();

/**
 * Constraint type ids present, plus: "boxes" (box or jigsaw regions), "givens", "rules" (any
 * clue arithmetic), "unnamed-rules" (rules from a type without its own technique), "combos" (clues worth listing combinations for), "links" (cells that see
 * each other other than by row, column or box).
 */
export function featuresOf(p: LatinPuzzle): string[] {
  let f = featureCache.get(p);
  if (f) return f;
  const m = modelOf(p);
  const out = new Set(p.constraints.map((c) => c.type));
  if (m.houses.some((h) => h.kind === "box")) out.add("boxes");
  if (p.givens.some((v) => v)) out.add("givens");
  if (m.rules.length) out.add("rules");
  if (m.ruleSource.some((i) => !constraintTypes.get(p.constraints[i]!.type)?.logic)) out.add("unnamed-rules");
  if (p.constraints.some((c) => constraintTypes.get(c.type)?.combos)) out.add("combos");
  const basic = new Set(["row", "col", "box"]);
  let basicPairs = 0;
  for (let c = 0; c < m.size; c++) {
    const seen = new Set<number>();
    for (const h of m.houseOf[c]!) if (basic.has(m.houses[h]!.kind)) for (const x of m.houses[h]!.cells) if (x !== c) seen.add(x);
    basicPairs += seen.size;
  }
  if (m.peers.reduce((a, ps) => a + ps.length, 0) > basicPairs) out.add("links");
  f = [...out];
  featureCache.set(p, f);
  return f;
}

/** Rule text for each constraint type in the puzzle, once each, in order of appearance. */
export function rulesOf(p: LatinPuzzle): string[] {
  const seen = new Set<string>();
  const out = [`fill every cell with a digit from 1 to ${p.n}`];
  for (const c of p.constraints) {
    const t = constraintTypes.get(c.type);
    if (!t?.rule || seen.has(t.type)) continue;
    seen.add(t.type);
    out.push(t.rule);
  }
  return out;
}

// --- hints that aren't techniques ---

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
    actions: [{ type: "set", cells: wrong, digit: 0 }],
  };
}

/** Last resort when no technique (with hints on) applies: give away the most constrained cell. */
export function revealHint(p: LatinPuzzle, s: GridState): Hint<GridAction> | null {
  const sol = solutionOf(p);
  if (!sol) return null;
  const g = gridOf(p, s);
  let best = -1;
  for (let c = 0; c < g.m.size; c++) {
    if (g.vals[c]) continue;
    if (best < 0 || popcount(g.masks[c]!) < popcount(g.masks[best]!)) best = c;
  }
  if (best < 0) return null;
  const d = sol[best]!;
  const focus: HintFocus = { cells: [best], areas: [], place: [[best, d]], eliminate: [], level: 2 };
  return {
    message: `no step found with the techniques that give hints; ${cellName(p.n, best)} is ${d}`,
    focus,
    actions: [{ type: "set", cells: [best], digit: d }],
  };
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
  aliases?: readonly string[];
  tags?: readonly string[];
  params: P;
  presets?: readonly Preset<P>[];
  generatorVersion: number;
  generate(values: Values<P>, rng: Rng, ctx: GenerateContext): Promise<LatinPuzzle>;
  /** Constraint types implied by this puzzle (left out of the header label). */
  implied: readonly string[];
}

/** One move in words: "C5: 7", "center 3 in C5", "rule out 4 in C5 and D6". */
export function describeAction(p: LatinPuzzle, a: GridAction): string {
  const at = (cells: readonly number[]) => listOf(cells, (c) => cellName(p.n, c));
  switch (a.type) {
    case "set": return a.digit ? `${at(a.cells)}: ${a.digit}` : `clear ${at(a.cells)}`;
    case "mark": return a.on ? `${a.layer} ${a.digit} in ${at(a.cells)}` : `remove ${a.layer} ${a.digit} from ${at(a.cells)}`;
    case "color": return a.on ? `color ${a.color} on ${at(a.cells)}` : `remove color ${a.color} from ${at(a.cells)}`;
    case "clear": return a.layer === "values" ? `clear ${at(a.cells)}` : `clear ${a.layer === "marks" ? "notes" : "colors"} in ${at(a.cells)}`;
    case "strike": return `${a.on ? "rule out" : "bring back"} ${listOf(a.marks, ([c, m]) => `${digits(m).join("/")} in ${cellName(p.n, c)}`)}`;
  }
}

/** A puzzle definition over the shared engine; puzzle types differ only in params and generation. */
export function latinDef<P extends Schema>(cfg: LatinDefConfig<P>): PuzzleDef<LatinPuzzle, GridState, GridAction, GridInteraction, P> {
  return {
    id: cfg.id,
    name: cfg.name,
    description: cfg.description,
    aliases: cfg.aliases,
    tags: cfg.tags,
    generatorVersion: cfg.generatorVersion,
    params: cfg.params,
    presets: cfg.presets,
    generate: cfg.generate,
    formats: latinFormats(),
    init: initState,
    initInteraction: (p) => {
      const mid = Math.floor(p.n / 2) * p.n + Math.floor(p.n / 2);
      return { selection: [mid], cursor: mid, mode: "digit", highlight: 0 };
    },
    reduce,
    isSolved,
    isRetraction,
    describeAction,
    solve(p) {
      const sol = solutionOf(p);
      return sol ? { ...initState(p), values: sol.slice() } : null;
    },
    hint: (p, s) => mistakeHint(p, s) ?? revealHint(p, s),
    rules: rulesOf,
    features: featuresOf,
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
