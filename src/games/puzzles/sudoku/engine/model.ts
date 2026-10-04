import { fullMask } from "./bits";
import "./constraints";
import { constraintTypes } from "./registry";
import type { ConstraintSpec, House, LatinPuzzle, Rule } from "./types";

/** A puzzle compiled to solver primitives. Immutable once built. */
export interface Model {
  n: number;
  size: number;
  all: number;
  houses: House[];
  /** Indices into houses of those with exactly n cells (every digit appears once). */
  full: number[];
  houseOf: number[][];
  /** Cells that must differ from each cell (house mates plus extra not-equal links), sorted. */
  peers: number[][];
  /** size*size matrix, 1 where two distinct cells must differ. */
  sees: Uint8Array;
  rules: Rule[];
  rulesOf: number[][];
  /** Which constraint instance (index into puzzle.constraints) produced each house / rule. */
  houseSource: number[];
  ruleSource: number[];
}

export function compile(n: number, specs: readonly ConstraintSpec[]): Model {
  const size = n * n;
  const houses: House[] = [];
  const rules: Rule[] = [];
  const houseSource: number[] = [];
  const ruleSource: number[] = [];
  const sees = new Uint8Array(size * size);
  const link = (a: number, b: number) => {
    if (a === b) return;
    sees[a * size + b] = 1;
    sees[b * size + a] = 1;
  };
  specs.forEach((spec, i) => {
    const t = constraintTypes.get(spec.type);
    if (!t) throw new Error(`unknown constraint type "${spec.type}"`);
    const err = t.validate?.(spec, n);
    if (err) throw new Error(`${t.label}: ${err}`);
    const c = t.compile(spec, n);
    for (const h of c.houses ?? []) {
      houses.push(h);
      houseSource.push(i);
      for (const a of h.cells) for (const b of h.cells) link(a, b);
    }
    for (const [a, b] of c.neq ?? []) link(a, b);
    for (const r of c.rules ?? []) {
      rules.push(r);
      ruleSource.push(i);
    }
  });
  const houseOf: number[][] = Array.from({ length: size }, () => []);
  houses.forEach((h, i) => h.cells.forEach((c) => houseOf[c]!.push(i)));
  const rulesOf: number[][] = Array.from({ length: size }, () => []);
  rules.forEach((r, i) => r.cells.forEach((c) => rulesOf[c]!.push(i)));
  const peers: number[][] = [];
  for (let a = 0; a < size; a++) {
    const p: number[] = [];
    for (let b = 0; b < size; b++) if (sees[a * size + b]) p.push(b);
    peers.push(p);
  }
  const full = houses.flatMap((h, i) => (h.cells.length === n ? [i] : []));
  return { n, size, all: fullMask(n), houses, full, houseOf, peers, sees, rules, rulesOf, houseSource, ruleSource };
}

const cache = new WeakMap<object, Model>();

/** Memoized per puzzle object (puzzles are immutable). */
export function modelOf(p: LatinPuzzle): Model {
  let m = cache.get(p);
  if (!m) {
    m = compile(p.n, p.constraints);
    cache.set(p, m);
  }
  return m;
}

export function seesCell(m: Model, a: number, b: number): boolean {
  return m.sees[a * m.size + b] === 1;
}

/** Cells violating something given placed values (0 = empty): duplicate digits and broken rules. */
export function conflicts(m: Model, values: readonly number[], withRules = true): Set<number> {
  const bad = new Set<number>();
  for (let a = 0; a < m.size; a++) {
    const v = values[a]!;
    if (!v) continue;
    for (const b of m.peers[a]!) if (values[b] === v) bad.add(a);
  }
  if (withRules) {
    for (const r of m.rules) {
      const vals = r.cells.map((c) => values[c]!);
      for (const i of r.broken(vals)) bad.add(r.cells[i]!);
    }
  }
  return bad;
}

export function isComplete(m: Model, values: readonly number[]): boolean {
  return values.every((v) => v > 0) && conflicts(m, values).size === 0;
}
