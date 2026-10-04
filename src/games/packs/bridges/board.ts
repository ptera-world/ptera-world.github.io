import { graph, type BridgesPuzzle, type BridgesState, type Graph } from "./graph";
import { cloneDomain, describeContradiction, domainFromState, incident, isContradiction, type Contradiction, type Domain } from "./solver";
import type { Focus } from "./logic";

/**
 * Narrowings anyone reads straight off the board, to a fixpoint: a bridge blocks the paths it
 * crosses, and an island never takes more than it still needs on any one side. Never raises lo.
 */
export function implicit(g: Graph, d: Domain): Contradiction | null {
  const p = g.puzzle;
  const inc = incident(g);
  for (let changed = true; changed;) {
    changed = false;
    for (const e of g.edges) {
      if (d.lo[e.id]! <= 0) continue;
      for (const c of g.cross[e.id]!) {
        if (d.lo[c]! > 0) return { kind: "cross", islands: [], edges: [e.id, c] };
        if (d.hi[c]! > 0) { d.hi[c] = 0; changed = true; }
      }
    }
    for (let i = 0; i < p.islands.length; i++) {
      const n = p.islands[i]!.n;
      let sumLo = 0, sumHi = 0;
      for (const e of inc[i]!) { sumLo += d.lo[e]!; sumHi += d.hi[e]!; }
      if (sumLo > n) return { kind: "over", islands: [i], edges: inc[i]!.filter((e) => d.lo[e]! > 0) };
      if (sumHi < n) return { kind: "under", islands: [i], edges: inc[i]!.slice() };
      for (const e of inc[i]!) {
        const hi = n - (sumLo - d.lo[e]!);
        if (hi < d.hi[e]!) { d.hi[e] = hi; changed = true; }
      }
    }
  }
  return null;
}

const bases = new WeakMap<BridgesState, Domain | Contradiction>();

/** The board as a domain after the implicit narrowings, or why it can't be right. Memoized per state. */
export function boardDomain(p: BridgesPuzzle, s: BridgesState): Domain | Contradiction {
  let d = bases.get(s);
  if (!d) {
    const g = graph(p);
    const raw = domainFromState(g, s);
    d = isContradiction(raw) ? raw : implicit(g, raw) ?? raw;
    bases.set(s, d);
  }
  return isContradiction(d) ? d : cloneDomain(d);
}

/** Why the board can't be right, in words, or null if nothing obvious breaks. */
export function boardProblem(p: BridgesPuzzle, s: BridgesState): { message: string; focus: Focus } | null {
  const d = boardDomain(p, s);
  if (!isContradiction(d)) return null;
  return { message: describeContradiction(graph(p), d), focus: { islands: d.islands, edges: d.edges } };
}
