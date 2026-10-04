import { defineSchema } from "../../core/schema";
import type { Plugin } from "../../core/types";
import { decorate } from "./deco";
import { components, cycleEdges, graph, islandSums, type BridgesPuzzle, type BridgesState, type Graph } from "./graph";
import type { BridgesAction, BridgesInteraction } from "./logic";
import { analyze, domainFromState, isContradiction, propagate, type Tier } from "./solver";

type BridgesPlugin = Plugin<BridgesPuzzle, BridgesState, BridgesAction, BridgesInteraction>;

const APPLIES = ["bridges"] as const;

function blocked(g: Graph, s: BridgesState, e: number): boolean {
  return s.no[e] === 1 || g.cross[e]!.some((c) => s.b[c]! > 0);
}

/** Most bridges island i could still end up with, given marks, crossings and neighbours' counts. */
function room(g: Graph, s: BridgesState, sums: readonly number[], i: number): number {
  const p = g.puzzle;
  let total = 0;
  for (const e of g.islandEdges[i]!) {
    if (e < 0) continue;
    const ed = g.edges[e]!;
    const have = s.b[e]!;
    if (blocked(g, s, e)) {
      total += have;
      continue;
    }
    const other = ed.a === i ? ed.b : ed.a;
    total += Math.min(p.maxb, have + Math.max(0, p.islands[other]!.n - sums[other]!));
  }
  return total;
}

const complete: BridgesPlugin = {
  id: "bridges.complete",
  name: "dim finished islands",
  category: "assists",
  appliesTo: APPLIES,
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const sums = islandSums(graph(puzzle), state.b);
      return decorate(d, (b) => puzzle.islands.forEach((is, i) => { if (sums[i] === is.n) b.island(i, "done"); }));
    }, { owner });
  },
};

const errors: BridgesPlugin = {
  id: "bridges.errors",
  name: "flag rule breaks",
  description: "only checks the rules, never the solution",
  category: "assists",
  appliesTo: APPLIES,
  enabledByDefault: true,
  settings: defineSchema({
    over: { type: "bool", label: "islands with too many bridges", default: true },
    stuck: { type: "bool", label: "islands that can't be finished any more", default: true },
    closed: { type: "bool", label: "finished groups cut off from the rest", default: true },
    loops: { type: "bool", label: "loops (when loops aren't allowed)", default: true },
  }),
  setup({ session, settings, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const g = graph(puzzle);
      const sums = islandSums(g, state.b);
      return decorate(d, (b) => {
        puzzle.islands.forEach((is, i) => {
          if (settings.over && sums[i]! > is.n) b.island(i, "error");
          else if (settings.stuck && room(g, state, sums, i) < is.n) b.island(i, "error");
        });
        if (settings.closed) {
          const { comp, count } = components(g, state.b);
          if (count > 1) {
            const open = new Set<number>();
            puzzle.islands.forEach((is, i) => { if (sums[i] !== is.n) open.add(comp[i]!); });
            puzzle.islands.forEach((_, i) => { if (!open.has(comp[i]!)) b.island(i, "error"); });
          }
        }
        if (settings.loops && !puzzle.loops) for (const e of cycleEdges(g, state.b)) b.edge(e, "error");
      });
    }, { owner });
  },
};

const counts: BridgesPlugin = {
  id: "bridges.counts",
  name: "show bridges still needed",
  category: "assists",
  appliesTo: APPLIES,
  enabledByDefault: false,
  settings: defineSchema({
    style: {
      type: "enum", label: "show as", default: "badge",
      options: [{ value: "badge", label: "small badge" }, { value: "replace", label: "replace the number" }],
    },
  }),
  setup({ session, settings, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const sums = islandSums(graph(puzzle), state.b);
      return decorate(d, (b) => puzzle.islands.forEach((is, i) => {
        const left = is.n - sums[i]!;
        if (settings.style === "replace") b.label(i, String(left));
        else if (left !== is.n && left !== 0) b.badge(i, String(left));
      }));
    }, { owner });
  },
};

const groups: BridgesPlugin = {
  id: "bridges.groups",
  name: "colour connected groups",
  category: "assists",
  appliesTo: APPLIES,
  enabledByDefault: false,
  settings: defineSchema({
    singles: { type: "bool", label: "colour lone islands too", default: false },
  }),
  setup({ session, settings, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const { comp, count } = components(graph(puzzle), state.b);
      if (count <= 1) return d;
      const size = Array.from({ length: count }, () => 0);
      for (const c of comp) size[c]!++;
      const colour = new Map<number, number>();
      return decorate(d, (b) => comp.forEach((c, i) => {
        if (size[c] === 1 && !settings.singles) return;
        if (!colour.has(c)) colour.set(c, colour.size % 8);
        b.island(i, `g${colour.get(c)}`);
      }));
    }, { owner });
  },
};

const guides: BridgesPlugin = {
  id: "bridges.guides",
  name: "show open connections",
  description: "faint lines wherever a bridge could still go",
  category: "assists",
  appliesTo: APPLIES,
  enabledByDefault: false,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const g = graph(puzzle);
      const sums = islandSums(g, state.b);
      const open = (i: number) => sums[i]! < puzzle.islands[i]!.n;
      return decorate(d, (b) => {
        for (const e of g.edges) {
          if (state.b[e.id]! < puzzle.maxb && !blocked(g, state, e.id) && open(e.a) && open(e.b)) b.edge(e.id, "guide");
        }
      });
    }, { owner });
  },
};

const check: BridgesPlugin = {
  id: "bridges.check",
  name: "flag wrong bridges",
  description: "compares against the solution (unique puzzles only)",
  category: "assists",
  appliesTo: APPLIES,
  enabledByDefault: false,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const a = analyze(puzzle);
      if (a.unique !== true || !a.solution) return d;
      const sol = a.solution;
      return decorate(d, (b) => {
        for (let e = 0; e < sol.length; e++) {
          if (state.b[e]! > sol[e]! || (state.no[e] === 1 && sol[e]! > 0)) b.edge(e, "wrong");
        }
      });
    }, { owner });
  },
};

const TIER_OF: Record<string, Tier> = { counting: 1, connectivity: 2, all: 3 };

/** Bridges and marks every deduction up to `tier` forces from the player's state; same object if none. */
export function autoFill(puzzle: BridgesPuzzle, s: BridgesState, tier: Tier, marks: boolean): BridgesState {
  const g = graph(puzzle);
  const d = domainFromState(g, s);
  if (isContradiction(d) || propagate(g, d, tier)) return s;
  let b: number[] | null = null, no: number[] | null = null;
  for (const e of g.edges) {
    if (d.lo[e.id]! > s.b[e.id]!) {
      b ??= s.b.slice();
      b[e.id] = d.lo[e.id]!;
    }
  }
  if (marks) {
    const nb = b ?? s.b;
    for (const e of g.edges) {
      if (d.hi[e.id] === 0 && nb[e.id] === 0 && s.no[e.id] !== 1 && !g.cross[e.id]!.some((c) => nb[c]! > 0)) {
        no ??= s.no.slice();
        no[e.id] = 1;
      }
    }
  }
  if (!b && !no) return s;
  return { b: b ?? s.b, no: no ?? s.no };
}

const auto: BridgesPlugin = {
  id: "bridges.auto",
  name: "auto-place forced bridges",
  description: "after each move, adds bridges that follow from what's on the board",
  category: "assists",
  appliesTo: APPLIES,
  enabledByDefault: false,
  settings: defineSchema({
    strength: {
      type: "enum", label: "reasoning", default: "counting",
      options: [
        { value: "counting", label: "counting only" },
        { value: "connectivity", label: "plus connectivity" },
        { value: "all", label: "everything (solves a lot)" },
      ],
    },
    marks: { type: "bool", label: "also mark impossible connections", default: false },
  }),
  /** Fires only on moves that add a bridge or mark, so removals stick. */
  setup({ session, settings, owner }) {
    const tier = TIER_OF[settings.strength as string] ?? 1;
    const marks = settings.marks === true;
    session.hooks.apply.tap((next, { puzzle, prev }) => {
      if (Object.is(next, prev)) return next;
      const added = next.b.some((v, e) => v > prev.b[e]!) || next.no.some((v, e) => v > prev.no[e]!);
      return added ? autoFill(puzzle, next, tier, marks) : next;
    }, { owner });
  },
};

export const plugins: readonly BridgesPlugin[] = [complete, errors, counts, groups, guides, check, auto];
