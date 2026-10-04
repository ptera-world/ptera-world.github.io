import { defineSchema } from "../../core/schema";
import { definePlugins } from "../../core/define";
import { decorate } from "./deco";
import { components, cycleEdges, graph, islandSums, type BridgesPuzzle, type BridgesState, type Graph } from "./graph";
import { bridges, mistakeHint, type BridgesAction, type BridgesInteraction } from "./logic";
import { analyze } from "./solver";

const plugin = definePlugins<BridgesPuzzle, BridgesState, BridgesAction, BridgesInteraction>();

function blocked(g: Graph, s: BridgesState, e: number): boolean {
  return s.no[e] === 1 || g.cross[e]!.some((c) => s.b[c]! > 0);
}

/** Most bridges island i could still end up with, given marks, crossings and neighbors' counts. */
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

const complete = plugin({
  id: "bridges.complete",
  name: "fade finished islands",
  description: "islands that have all their bridges turn faint, so the ones still open stand out",
  category: "assists",
  appliesTo: [bridges],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const sums = islandSums(graph(puzzle), state.b);
      return decorate(d, (b) => puzzle.islands.forEach((is, i) => { if (sums[i] === is.n) b.island(i, "done"); }));
    }, { owner });
  },
});

const errors = plugin({
  id: "bridges.errors",
  name: "flag rule breaks",
  description: "only checks the rules, never the solution",
  category: "assists",
  appliesTo: [bridges],
  enabledByDefault: true,
  settings: defineSchema({
    over: { type: "bool", label: "islands with too many bridges", default: true },
    stuck: { type: "bool", label: "islands that can't be finished any more", default: true },
    closed: { type: "bool", label: "finished groups cut off from the rest", default: true },
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
      });
    }, { owner });
  },
});

const loops = plugin({
  id: "bridges.loop-errors",
  name: "flag loops",
  description: "bridges that close a loop, on boards where loops aren't allowed",
  category: "assists",
  appliesTo: [bridges],
  requires: ["no-loops"],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) =>
      decorate(d, (b) => { for (const e of cycleEdges(graph(puzzle), state.b)) b.edge(e, "error"); }), { owner });
  },
});

const counts = plugin({
  id: "bridges.counts",
  name: "show bridges still needed",
  description: "a small number by each island counting how many more bridges it needs",
  category: "assists",
  appliesTo: [bridges],
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
});

const groups = plugin({
  id: "bridges.groups",
  name: "color connected groups",
  description: "islands already joined to each other by bridges get the same colored ring, so you can see which pieces still need linking up",
  category: "assists",
  appliesTo: [bridges],
  enabledByDefault: false,
  settings: defineSchema({
    singles: { type: "bool", label: "color lone islands too", default: false },
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
});

const guides = plugin({
  id: "bridges.guides",
  name: "show open connections",
  description: "faint lines wherever a bridge could still go",
  category: "assists",
  appliesTo: [bridges],
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
});

const check = plugin({
  id: "bridges.check",
  name: "flag wrong bridges",
  description: "compares against the solution",
  category: "assists",
  appliesTo: [bridges],
  requires: ["unique"],
  enabledByDefault: false,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const sol = analyze(puzzle).solution;
      if (!sol) return d;
      return decorate(d, (b) => {
        for (let e = 0; e < sol.length; e++) {
          if (state.b[e]! > sol[e]! || (state.no[e] === 1 && sol[e]! > 0)) b.edge(e, "wrong");
        }
      });
    }, { owner });
  },
});

const mistakes = plugin({
  id: "bridges.mistakes",
  name: "hints point out mistakes first",
  description: "before suggesting a deduction, a hint shows a bridge or mark that's wrong",
  category: "assists",
  appliesTo: [bridges],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => mistakeHint(puzzle, state) ?? undefined, { owner, priority: 50 });
  },
});

export const plugins = [complete, errors, loops, counts, groups, guides, check, mistakes];
