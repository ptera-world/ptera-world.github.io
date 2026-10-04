import type { Rng } from "../../../core/rng";
import type { GenerateContext } from "../../../core/types";
import { popcount } from "./bits";
import { BANDS, grade, gridFrom, logicalSolve, place } from "./human";
import { compile, type Model } from "./model";
import { constraintTypes } from "./registry";
import { solve, uniqueness } from "./solver";
import type { ConstraintSpec, LatinPuzzle } from "./types";

export type RemovalOrder = "givens-first" | "mixed";

export type Symmetry = "none" | "rotational" | "mirror" | "diagonal";

export interface ClueRequest {
  type: string;
  options?: Readonly<Record<string, unknown>>;
}

export interface GenerateOptions {
  n: number;
  /** Global constraints for one attempt; may itself be random (e.g. jigsaw regions). */
  globals(rng: Rng): ConstraintSpec[];
  clues: readonly ClueRequest[];
  /** Start from a full grid of givens and strip them, or from none (adding only what uniqueness needs). */
  givens: "all" | "none";
  symmetry?: Symmetry;
  order?: RemovalOrder;
  /** Difficulty band id (see BANDS), or null for whatever comes out. */
  target?: string | null;
  /** Reach the target by adding givens where the solver gets stuck (otherwise only by retrying). */
  cap?: boolean;
  attempts?: number;
  /** Search budget per uniqueness check. Undecided counts as not unique. */
  nodes?: number;
}

function symmetryGroups(n: number, sym: Symmetry): number[][] {
  const seen = new Set<number>();
  const groups: number[][] = [];
  for (let c = 0; c < n * n; c++) {
    if (seen.has(c)) continue;
    const r = Math.floor(c / n), col = c % n;
    const mate = sym === "rotational" ? n * n - 1 - c
      : sym === "mirror" ? r * n + (n - 1 - col)
        : sym === "diagonal" ? col * n + r : c;
    const g = [...new Set([c, mate])];
    for (const x of g) seen.add(x);
    groups.push(g);
  }
  return groups;
}

interface Draft {
  n: number;
  givens: number[];
  constraints: ConstraintSpec[];
  solution: number[];
}

/** Repair until the solution is unique: refine a clue at a cell where two solutions differ, else add a given there. */
async function makeUnique(d: Draft, rng: Rng, ctx: GenerateContext, nodes: number): Promise<boolean> {
  for (let guard = 0; guard < d.n * d.n * 2; guard++) {
    await ctx.yield();
    const m = compile(d.n, d.constraints);
    const r = solve(m, d.givens, { limit: 2, budget: nodes });
    if (r.solutions.length === 1 && r.complete) return true;
    if (r.solutions.length === 0 && r.complete) return false;
    const other = r.solutions.find((s) => s.some((v, i) => v !== d.solution[i]));
    const diff = other
      ? [...other.keys()].filter((i) => other[i] !== d.solution[i])
      : [...d.givens.keys()].filter((i) => !d.givens[i]);
    if (!diff.length) return false;
    const cell = rng.pick(diff);
    let fixed = false;
    for (let i = 0; i < d.constraints.length && !fixed; i++) {
      const spec = d.constraints[i]!;
      const t = constraintTypes.get(spec.type)!;
      if (!t.repair || !(t.cells?.(spec, d.n) ?? []).includes(cell)) continue;
      const rep = t.repair(spec, cell, d.solution, d.n);
      if (rep) {
        d.constraints.splice(i, 1, ...rep);
        fixed = true;
      }
    }
    if (!fixed) d.givens[cell] = d.solution[cell]!;
  }
  return false;
}

/**
 * Drop givens (in symmetry groups) and removable clues whenever the solution stays unique.
 * "givens-first" strips every given it can before touching clues; "mixed" interleaves them.
 * The last instance of each clue type always stays, so a requested variant never vanishes.
 */
async function minimize(d: Draft, rng: Rng, ctx: GenerateContext, sym: Symmetry, nodes: number, order: RemovalOrder): Promise<void> {
  let model: Model = compile(d.n, d.constraints);
  type Item = { group: number[] } | { spec: ConstraintSpec };
  const groups: Item[] = rng.shuffle(symmetryGroups(d.n, sym).filter((g) => g.some((c) => d.givens[c]))).map((group) => ({ group }));
  const clues: Item[] = rng.shuffle(d.constraints.filter((s) => constraintTypes.get(s.type)?.removable)).map((spec) => ({ spec }));
  const items = order === "mixed" ? rng.shuffle([...groups, ...clues]) : [...groups, ...clues];
  for (const it of items) {
    await ctx.yield();
    if ("group" in it) {
      const saved = it.group.map((c) => d.givens[c]!);
      for (const c of it.group) d.givens[c] = 0;
      if (uniqueness(model, d.givens, nodes) !== 1) it.group.forEach((c, i) => { d.givens[c] = saved[i]!; });
    } else {
      const without = d.constraints.filter((s) => s !== it.spec);
      if (!without.some((s) => s.type === it.spec.type)) continue;
      const m = compile(d.n, without);
      if (uniqueness(m, d.givens, nodes) === 1) {
        d.constraints = without;
        model = m;
      }
    }
  }
}

/** Add givens until the puzzle is solvable using techniques no harder than `max`. */
function capDifficulty(d: Draft, rng: Rng, max: number): void {
  const m = compile(d.n, d.constraints);
  const g = gridFrom(m, d.givens, d.solution);
  for (let guard = 0; guard <= d.n * d.n; guard++) {
    const r = logicalSolve(g, max);
    if (r.solved) return;
    const empty = [...g.vals.keys()].filter((c) => !g.vals[c]);
    const fewest = Math.min(...empty.map((c) => popcount(g.masks[c]!)));
    const c = rng.pick(empty.filter((x) => popcount(g.masks[x]!) === fewest));
    d.givens[c] = d.solution[c]!;
    place(g, c, d.solution[c]!);
  }
}

export async function generateLatin(o: GenerateOptions, rng: Rng, ctx: GenerateContext): Promise<LatinPuzzle> {
  const n = o.n;
  const nodes = o.nodes ?? 20_000;
  const targetIdx = o.target ? BANDS.findIndex((b) => b.id === o.target) : -1;
  const attempts = o.attempts ?? (targetIdx < 0 ? 8 : o.clues.length ? 8 : 120);
  let best: { p: LatinPuzzle; distance: number } | null = null;
  for (let a = 0; a < attempts; a++) {
    await ctx.yield();
    const r = rng.fork(`attempt ${a}`);
    const globals = o.globals(r.fork("layout"));
    const base = compile(n, globals);
    const sol = solve(base, Array.from({ length: n * n }, () => 0), { limit: 1, rng: r.fork("solution"), budget: 100_000 }).solutions[0];
    if (!sol) continue;
    const clues = o.clues.flatMap((c) => {
      const t = constraintTypes.get(c.type);
      if (!t?.clues) throw new Error(`constraint type "${c.type}" can't generate clues`);
      return t.clues(sol, n, r.fork(`clues ${c.type}`), c.options);
    });
    const d: Draft = { n, givens: o.givens === "all" ? sol.slice() : Array.from({ length: n * n }, () => 0), constraints: [...globals, ...clues], solution: sol };
    if (!(await makeUnique(d, r.fork("unique"), ctx, nodes))) continue;
    await minimize(d, r.fork("minimize"), ctx, o.symmetry ?? "none", nodes, o.order ?? "givens-first");
    if (targetIdx >= 0 && o.cap !== false) capDifficulty(d, r.fork("cap"), BANDS[targetIdx]!.max);
    const p: LatinPuzzle = { n, givens: d.givens, constraints: d.constraints, solution: sol };
    if (targetIdx < 0) return p;
    const got = BANDS.indexOf(grade(compile(n, d.constraints), d.givens, sol).band);
    const distance = Math.abs(got - targetIdx);
    if (distance === 0) return p;
    if (!best || distance < best.distance) best = { p, distance };
  }
  if (best) return best.p;
  throw new Error("couldn't build a puzzle with these settings; try fewer variants or another seed");
}
