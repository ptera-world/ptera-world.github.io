import type { Technique } from "../../core/types";
import { graph, islandName, type BridgesPuzzle, type BridgesState, type Graph } from "./graph";
import {
  capacity, capacityStep, cloneDomain, cutSteps, describeContradiction, domainFromState, incident, isContradiction,
  isolationSteps, loopSteps, trial, trialStep, trialValues,
  type Contradiction, type Domain, type Step as SolverStep,
} from "./solver";
import type { BridgesAction, Focus } from "./logic";

/**
 * Player-facing deductions. Each one reads the board as a domain of possible bridge counts per
 * connection and reports a step only when it changes what's drawn (a bridge or a "no bridge"
 * mark). Narrowings the board can't show (e.g. "at most one here") are carried silently as
 * support for the same and harder techniques, and named in the explanation.
 */

type Kind = "full" | "all" | "some" | "loop" | "isolation" | "cut" | "trial";

const LEVEL: Record<Kind, number> = { full: 1, all: 2, some: 3, loop: 4, isolation: 5, cut: 6, trial: 7 };
const KINDS = Object.keys(LEVEL) as Kind[];

function blocked(g: Graph, b: readonly number[], edge: number): boolean {
  return g.cross[edge]!.some((c) => (b[c] ?? 0) > 0);
}

/** A "no bridge" mark that would add information to the board. */
function visibleMark(g: Graph, s: BridgesState, e: number): boolean {
  return s.b[e] === 0 && s.no[e] !== 1 && !blocked(g, s.b, e);
}

/** What a solver step changes on the board: bridges to raise to, and marks. */
export function stepActions(g: Graph, s: BridgesState, st: SolverStep): BridgesAction[] {
  const out: BridgesAction[] = [];
  for (const c of st.changes) {
    if (c.lo > (s.b[c.edge] ?? 0)) out.push({ type: "set", edge: c.edge, n: c.lo });
    else if (c.hi === 0 && visibleMark(g, s, c.edge)) out.push({ type: "mark", edge: c.edge, on: true });
  }
  return out;
}

/** Narrow in place; true if anything changed. */
function narrow(d: Domain, st: SolverStep): boolean {
  let changed = false;
  for (const c of st.changes) {
    if (c.lo > d.lo[c.edge]!) { d.lo[c.edge] = c.lo; changed = true; }
    if (c.hi < d.hi[c.edge]!) { d.hi[c.edge] = c.hi; changed = true; }
  }
  return changed;
}

/**
 * Narrowings anyone reads straight off the board, to a fixpoint: a bridge blocks the paths it
 * crosses, and an island never takes more than it still needs on any one side. Never raises lo.
 */
function implicit(g: Graph, d: Domain): Contradiction | null {
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

/** Capacity steps of one kind: "all" when the island has no slack at all, "some" otherwise. */
function capacitySteps(g: Graph, d: Domain, kind: "all" | "some"): SolverStep[] | Contradiction {
  const p = g.puzzle;
  const out: SolverStep[] = [];
  for (let i = 0; i < p.islands.length; i++) {
    const r = capacity(g, d, i);
    if (isContradiction(r)) return r;
    const raised = r.filter((c) => c.lo > d.lo[c.edge]!);
    if (!raised.length) continue;
    let sumHi = 0;
    for (const e of incident(g)[i]!) sumHi += d.hi[e]!;
    if ((sumHi === p.islands[i]!.n) === (kind === "all")) out.push(capacityStep(g, d, i, raised));
  }
  return out;
}

function fullSteps(g: Graph, d: Domain): SolverStep[] {
  const p = g.puzzle;
  const out: SolverStep[] = [];
  for (let i = 0; i < p.islands.length; i++) {
    const inc = incident(g)[i]!;
    let sum = 0;
    for (const e of inc) sum += d.lo[e]!;
    if (sum !== p.islands[i]!.n) continue;
    const open = inc.filter((e) => d.lo[e] === 0);
    if (!open.length) continue;
    out.push({
      tier: 1, technique: "full", islands: [i], edges: open, changes: open.map((e) => ({ edge: e, lo: 0, hi: 0 })),
      message: `${islandName(p, i)} has all its bridges, so nothing else connects to it`,
    });
  }
  return out;
}

/** Trial steps; stops at the first one `stop` accepts. */
function trialSteps(g: Graph, d: Domain, stop: (st: SolverStep) => boolean): SolverStep[] {
  const out: SolverStep[] = [];
  for (const e of g.edges) {
    for (const v of trialValues(d, e.id)) {
      const r = trial(g, d, e.id, v);
      if (!r) continue;
      const st = trialStep(g, r);
      out.push(st);
      if (stop(st)) return out;
    }
  }
  return out;
}

function produce(kind: Kind, g: Graph, d: Domain, stop: (st: SolverStep) => boolean): SolverStep[] | Contradiction {
  switch (kind) {
    case "full": return fullSteps(g, d);
    case "all": case "some": return capacitySteps(g, d, kind);
    case "loop": return loopSteps(g, d, true);
    case "isolation": return isolationSteps(g, d, true);
    case "cut": return cutSteps(g, d, true);
    case "trial": return trialSteps(g, d, stop);
  }
}

export interface Found {
  step: SolverStep;
  actions: BridgesAction[];
  /** Silent narrowings the step relies on, in the order they were made. */
  support: SolverStep[];
}

/**
 * First instance of `kind` that changes the board. Easier deductions and this one's own silent
 * narrowings are applied as support until one shows, or nothing more follows. Null on a board
 * that already breaks the rules (mistake checks explain those).
 */
export function findKind(p: BridgesPuzzle, s: BridgesState, kind: Kind): Found | null {
  const g = graph(p);
  const d = boardDomain(p, s);
  if (isContradiction(d)) return null;
  const start = cloneDomain(d);
  let easier: Domain | null | undefined;
  /** Whether an easier step's change needs this kind: easier techniques alone don't reach it. */
  const needsThis = (st: SolverStep): boolean => {
    if (easier === undefined) easier = closure(g, cloneDomain(start), LEVEL[kind] - 1);
    const low = easier;
    if (!low) return false;
    return st.changes.some((c) => c.lo > low.lo[c.edge]! || (c.hi === 0 && low.hi[c.edge]! > 0));
  };
  const support: SolverStep[] = [];
  let usedOwn = false;
  const visible = (st: SolverStep) => stepActions(g, s, st).length > 0;
  for (let round = 0; round < 1000; round++) {
    const own = produce(kind, g, d, visible);
    if (isContradiction(own)) return null;
    for (const st of own) {
      const actions = stepActions(g, s, st);
      if (actions.length) return { step: st, actions, support };
    }
    let changed = false;
    for (const k of KINDS) {
      if (LEVEL[k] > LEVEL[kind]) break;
      const steps = k === kind ? own : produce(k, g, d, () => false);
      if (isContradiction(steps)) return null;
      for (const st of steps) {
        if (usedOwn && k !== kind) {
          const actions = stepActions(g, s, st);
          if (actions.length && needsThis(st)) return { step: st, actions, support };
        }
        if (narrow(d, st)) {
          changed = true;
          support.push(st);
          if (k === kind) usedOwn = true;
        }
      }
      for (let e = 0; e < d.lo.length; e++) if (d.lo[e]! > d.hi[e]!) return null;
      if (implicit(g, d)) return null;
    }
    if (!changed) return null;
  }
  return null;
}

/** Narrow to the fixpoint of every kind up to `maxLevel`; null on a contradiction. */
function closure(g: Graph, d: Domain, maxLevel: number): Domain | null {
  for (let changed = true; changed;) {
    changed = false;
    for (const k of KINDS) {
      if (LEVEL[k] > maxLevel) break;
      const steps = produce(k, g, d, () => false);
      if (isContradiction(steps)) return null;
      for (const st of steps) if (narrow(d, st)) changed = true;
      for (let e = 0; e < d.lo.length; e++) if (d.lo[e]! > d.hi[e]!) return null;
      if (implicit(g, d)) return null;
    }
  }
  return d;
}

/** The support step worth naming: the latest one touching an island of the step. */
function because(g: Graph, f: Found): SolverStep | null {
  const near = new Set<number>();
  for (const e of f.step.edges) { near.add(g.edges[e]!.a); near.add(g.edges[e]!.b); }
  for (const i of f.step.islands) near.add(i);
  for (let k = f.support.length - 1; k >= 0; k--) {
    const st = f.support[k]!;
    if (st.islands.some((i) => near.has(i)) || st.edges.some((e) => near.has(g.edges[e]!.a) || near.has(g.edges[e]!.b))) return st;
  }
  return null;
}

interface Spec {
  kind: Kind;
  name: string;
  description: string;
  /** Where to look, naming exactly the islands it returns (they are highlighted). */
  nudge(p: BridgesPuzzle, g: Graph, st: SolverStep): { text: string; islands: number[] };
  requires?: readonly string[];
  practice?: Record<string, unknown>;
}

const firstIsland = (g: Graph, st: SolverStep): number => st.islands[0] ?? g.edges[st.edges[0]!]!.a;
const ends = (g: Graph, st: SolverStep): [number, number] => {
  const e = g.edges[st.edges[0]!]!;
  return [e.a, e.b];
};
const one = (p: BridgesPuzzle, i: number, text: (name: string) => string) => ({ text: text(islandName(p, i)), islands: [i] });
const two = (p: BridgesPuzzle, [a, b]: [number, number], text: (x: string, y: string) => string) => ({ text: text(islandName(p, a), islandName(p, b)), islands: [a, b] });

const SPECS: readonly Spec[] = [
  {
    kind: "full", name: "finished island",
    description: "an island that already has all its bridges takes no more, so every other connection from it can be crossed off.",
    nudge: (p, g, st) => one(p, firstIsland(g, st), (x) => `${x} is done. what does that rule out?`),
    practice: { difficulty: "easy" },
  },
  {
    kind: "all", name: "no room to spare",
    description: "add up the most bridges an island could still get on each side (limited by the max per pair, its neighbors' own numbers, and crossings). if that total is exactly its number, every side must be filled to the brim.",
    nudge: (p, g, st) => one(p, firstIsland(g, st), (x) => `count how many bridges ${x} has room for`),
    practice: { difficulty: "easy" },
  },
  {
    kind: "some", name: "at least one",
    description: "if the other sides of an island can't supply its number between them, the rest has to come from this side. a 3 with only two neighbors (max 2 each) needs at least one bridge to each; a 5 with three neighbors needs at least one to every side.",
    nudge: (p, g, st) => one(p, firstIsland(g, st), (x) => `${x} can't get enough without some side`),
    practice: { difficulty: "easy" },
  },
  {
    kind: "loop", name: "no loops", requires: ["no-loops"],
    description: "when loops aren't allowed, two islands that are already connected (by any route) can't get a bridge between them.",
    nudge: (p, g, st) => two(p, ends(g, st), (x, y) => `${x} and ${y} are already joined by some route`),
    practice: { difficulty: "medium", loops: false },
  },
  {
    kind: "isolation", name: "don't cut them off",
    description: "every island has to join one network. if filling a connection to the max would finish both groups it joins with nothing left over, they'd be sealed off from everything else, so that connection takes at least one less. two 1s can't join; neither can two 2s with a double bridge.",
    nudge: (p, g, st) => two(p, ends(g, st), (x, y) => `what if ${x} and ${y} got as many bridges as they can take?`),
    practice: { difficulty: "medium" },
  },
  {
    kind: "cut", name: "only way out",
    description: "if every route between one part of the board and the rest has been ruled out except one connection, that connection must have a bridge.",
    nudge: (p, g, st) => two(p, ends(g, st), (x, y) => `is there any other way through than the gap between ${x} and ${y}?`),
    practice: { difficulty: "medium" },
  },
  {
    kind: "trial", name: "what if",
    description: "suppose a connection had a particular number of bridges and follow the easier rules. if that leads to something impossible (an island over or under its number, crossing bridges, a group cut off), that number is ruled out.",
    nudge: (p, g, st) => two(p, ends(g, st), (x, y) => `suppose you knew how many bridges join ${x} and ${y}`),
    practice: { difficulty: "hard" },
  },
];

function technique(spec: Spec): Technique<BridgesPuzzle, BridgesState, BridgesAction> {
  return {
    id: `bridges.${spec.kind}`,
    name: spec.name,
    puzzles: ["bridges"],
    requires: spec.requires,
    level: LEVEL[spec.kind],
    description: spec.description,
    practice: spec.practice ? { params: spec.practice } : undefined,
    find(p, s) {
      const f = findKind(p, s, spec.kind);
      if (!f) return null;
      const g = graph(p);
      const why = because(g, f);
      const st = f.step;
      const focus: Focus = why
        ? { islands: [...new Set([...st.islands, ...why.islands])], edges: [...new Set([...st.edges, ...why.edges])] }
        : { islands: st.islands, edges: st.edges };
      const nudge = spec.nudge(p, g, st);
      const nudgeFocus: Focus = { islands: nudge.islands, edges: [] };
      return {
        message: why ? `${why.message}. ${st.message}` : st.message,
        nudge: nudge.text,
        focus,
        nudgeFocus,
        actions: f.actions,
      };
    },
  };
}

export const techniques = SPECS.map(technique);

/** Why the board can't be right, in words, or null if nothing obvious breaks. */
export function boardProblem(p: BridgesPuzzle, s: BridgesState): { message: string; focus: Focus } | null {
  const d = boardDomain(p, s);
  if (!isContradiction(d)) return null;
  return { message: describeContradiction(graph(p), d), focus: { islands: d.islands, edges: d.edges } };
}
