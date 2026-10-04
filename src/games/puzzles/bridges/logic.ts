import type { Hint, PuzzleDef, Rating } from "../../core/types";
import { formats } from "./formats";
import { generate, params } from "./generate";
import { emptyState, graph, isValidSolution, islandName, type BridgesPuzzle, type BridgesState, type Graph } from "./graph";
import {
  TIER_NAMES, analyze, describeContradiction, domainFromState, isContradiction, nextSteps, search,
  type Domain, type Step,
} from "./solver";

export type BridgesAction =
  /** Exact bridge count on an edge; n > 0 clears its mark. Ignored if a placed bridge crosses it. */
  | { type: "set"; edge: number; n: number }
  /** Step the count by ±1, wrapping through 0..maxb. */
  | { type: "cycle"; edge: number; delta: 1 | -1 }
  /** Set (or toggle when `on` is omitted) the "no bridge" mark; only while the edge has no bridges. */
  | { type: "mark"; edge: number; on?: boolean }
  | { type: "many"; actions: BridgesAction[] };

export type Mode = "bridge" | "mark";

export interface BridgesInteraction {
  /** Island index under the keyboard cursor. */
  cursor: number;
  /** "mark": primary taps/keys remove bridges or toggle marks instead of adding. */
  mode: Mode;
  /** In-progress drag from an island; edge is the targeted edge or -1. */
  drag: { from: number; edge: number } | null;
}

/** Hint focus understood by the bridges views. */
export interface Focus {
  islands: number[];
  edges: number[];
}

function blocked(g: Graph, b: readonly number[], edge: number): boolean {
  return g.cross[edge]!.some((c) => (b[c] ?? 0) > 0);
}

function setEdge(p: BridgesPuzzle, s: BridgesState, edge: number, n: number): BridgesState {
  const g = graph(p);
  if (edge < 0 || edge >= g.edges.length || !Number.isInteger(n)) return s;
  n = Math.max(0, Math.min(p.maxb, n));
  if (n > 0 && blocked(g, s.b, edge)) return s;
  const clearMark = n > 0 && s.no[edge] === 1;
  if (s.b[edge] === n && !clearMark) return s;
  const b = s.b.slice();
  b[edge] = n;
  if (!clearMark) return { b, no: s.no };
  const no = s.no.slice();
  no[edge] = 0;
  return { b, no };
}

export function reduce(p: BridgesPuzzle, s: BridgesState, a: BridgesAction): BridgesState {
  const g = graph(p);
  switch (a.type) {
    case "set":
      return setEdge(p, s, a.edge, a.n);
    case "cycle": {
      if (a.edge < 0 || a.edge >= g.edges.length) return s;
      const m = p.maxb + 1;
      let n = ((s.b[a.edge]! + a.delta) % m + m) % m;
      // a blocked edge can only drop to 0
      if (n > 0 && blocked(g, s.b, a.edge)) n = 0;
      return setEdge(p, s, a.edge, n);
    }
    case "mark": {
      if (a.edge < 0 || a.edge >= g.edges.length || s.b[a.edge]! > 0) return s;
      const on = a.on ?? s.no[a.edge] !== 1;
      if ((s.no[a.edge] === 1) === on) return s;
      const no = s.no.slice();
      no[a.edge] = on ? 1 : 0;
      return { b: s.b, no };
    }
    case "many":
      return a.actions.reduce((st, x) => (x.type === "many" ? st : reduce(p, st, x)), s);
    default:
      return s;
  }
}

function edgeName(p: BridgesPuzzle, g: Graph, e: number): string {
  const ed = g.edges[e]!;
  return `${islandName(p, ed.a)} and ${islandName(p, ed.b)}`;
}

function one(actions: BridgesAction[]): BridgesAction | undefined {
  return actions.length === 0 ? undefined : actions.length === 1 ? actions[0] : { type: "many", actions };
}

/** Player-visible effect of a step: bridges to add, and marks for edges not already obviously blocked. */
function stepActions(g: Graph, s: BridgesState, st: Step): BridgesAction[] {
  const out: BridgesAction[] = [];
  for (const c of st.changes) {
    if (c.lo > (s.b[c.edge] ?? 0)) out.push({ type: "set", edge: c.edge, n: c.lo });
    else if (c.hi === 0 && visibleMark(g, s, c.edge)) out.push({ type: "mark", edge: c.edge, on: true });
  }
  return out;
}

function visibleMark(g: Graph, s: BridgesState, e: number): boolean {
  return s.b[e] === 0 && s.no[e] !== 1 && !blocked(g, s.b, e);
}

function applySteps(d: Domain, steps: readonly Step[]): void {
  for (const st of steps) {
    for (const c of st.changes) {
      d.lo[c.edge] = Math.max(d.lo[c.edge]!, c.lo);
      d.hi[c.edge] = Math.min(d.hi[c.edge]!, c.hi);
    }
  }
}

function mistakeHint(p: BridgesPuzzle, s: BridgesState): Hint<BridgesAction> | null {
  const g = graph(p);
  const a = analyze(p);
  if (a.unique === true && a.solution) {
    const sol = a.solution;
    for (const e of g.edges) {
      const have = s.b[e.id]!, want = sol[e.id]!;
      if (have > want) {
        return {
          message: want === 0
            ? `there shouldn't be a bridge between ${edgeName(p, g, e.id)}`
            : `too many bridges between ${edgeName(p, g, e.id)}`,
          focus: { islands: [e.a, e.b], edges: [e.id] } satisfies Focus,
          action: { type: "set", edge: e.id, n: want },
        };
      }
      if (s.no[e.id] === 1 && want > 0) {
        return {
          message: `a bridge does go between ${edgeName(p, g, e.id)}`,
          focus: { islands: [e.a, e.b], edges: [e.id] } satisfies Focus,
          action: { type: "mark", edge: e.id, on: false },
        };
      }
    }
    return null;
  }
  const d = domainFromState(g, s);
  if (!isContradiction(d)) {
    const r = search(p, d, 1, 50_000);
    if (r.count > 0 || r.aborted) return null;
  }
  const diff = a.solution ? g.edges.filter((e) => s.b[e.id]! > a.solution![e.id]!).map((e) => e.id) : [];
  return {
    message: "these bridges can't all be right; try undoing a few",
    focus: { islands: [], edges: diff } satisfies Focus,
  };
}

export function hint(p: BridgesPuzzle, s: BridgesState): Hint<BridgesAction> | null {
  if (isValidSolution(p, s.b)) return null;
  const g = graph(p);
  const mistake = mistakeHint(p, s);
  if (mistake) return mistake;
  const d0 = domainFromState(g, s);
  if (isContradiction(d0)) return { message: describeContradiction(g, d0), focus: { islands: d0.islands, edges: d0.edges } satisfies Focus };
  const d = d0;
  let because: Step | null = null;
  for (let iter = 0; iter < 10_000; iter++) {
    const steps = nextSteps(g, d, 3);
    if (isContradiction(steps)) {
      return { message: `something's off: ${describeContradiction(g, steps)}`, focus: { islands: steps.islands, edges: steps.edges } satisfies Focus };
    }
    if (!steps.length) break;
    const adds = steps.find((st) => st.changes.some((c) => c.lo > (s.b[c.edge] ?? 0)));
    const pick = adds ?? (steps[0]!.tier >= 2 ? steps.find((st) => stepActions(g, s, st).length > 0) : undefined);
    if (pick) {
      const prefix = because && because !== pick ? `${because.message}. ` : "";
      return {
        message: prefix + pick.message,
        focus: { islands: pick.islands, edges: pick.edges } satisfies Focus,
        action: one(stepActions(g, s, pick)),
      };
    }
    applySteps(d, steps);
    if (steps[0]!.tier >= 2) because = steps[steps.length - 1]!;
  }
  const a = analyze(p);
  if (a.solution) {
    const e = g.edges.find((x) => s.b[x.id]! < a.solution![x.id]!);
    if (e) {
      return {
        message: `no clean deduction from here, but ${edgeName(p, g, e.id)} take ${a.solution[e.id] === 1 ? "one bridge" : `${a.solution[e.id]} bridges`}`,
        focus: { islands: [e.a, e.b], edges: [e.id] } satisfies Focus,
        action: { type: "set", edge: e.id, n: a.solution[e.id]! },
      };
    }
  }
  return null;
}

export function rate(p: BridgesPuzzle): Rating | null {
  const a = analyze(p);
  const t = a.logic.tier;
  const st = a.logic.stats.byTier;
  if (t !== null) return { label: TIER_NAMES[t], score: t * 1000 + Math.min(999, st[3] * 20 + st[2] * 2) };
  if (!a.solution) return { label: a.unique === null ? "unknown" : "no solution", score: 9000 };
  if (a.unique === false) return { label: "multiple solutions", score: 8000 };
  if (a.unique === null) return { label: "unknown", score: 7000 };
  return { label: "needs guessing", score: 4000 + Math.min(999, st[3] * 20) };
}

export const bridges: PuzzleDef<BridgesPuzzle, BridgesState, BridgesAction, BridgesInteraction, typeof params> = {
  id: "bridges",
  name: "bridges",
  description: "connect every island into one network. each number is how many bridges touch that island; bridges run straight, never cross, and at most a set number join any two islands.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "7×7 easy", params: { width: 7, height: 7, difficulty: "easy" } },
    { label: "7×7 medium", params: { width: 7, height: 7, difficulty: "medium" } },
    { label: "10×10 medium", params: { width: 10, height: 10, difficulty: "medium" } },
    { label: "10×10 hard", params: { width: 10, height: 10, difficulty: "hard" } },
    { label: "15×15 hard", params: { width: 15, height: 15, difficulty: "hard" } },
    { label: "10×10 tree", params: { width: 10, height: 10, difficulty: "medium", loops: false } },
    { label: "10×10 max 3", params: { width: 10, height: 10, difficulty: "medium", maxb: 3 } },
  ],
  generate: (v, rng, ctx) => generate(v, rng, ctx),
  formats,
  init: (p) => emptyState(p),
  initInteraction: () => ({ cursor: 0, mode: "bridge", drag: null }),
  reduce,
  isSolved: (p, s) => isValidSolution(p, s.b),
  solve(p) {
    const sol = analyze(p).solution;
    return sol ? { b: sol.slice(), no: sol.map(() => 0) } : null;
  },
  hint,
  rate,
  describe: (p) => `${p.w}×${p.h}, max ${p.maxb}${p.loops ? "" : ", no loops"}`,
};
