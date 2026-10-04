import { defineSchema } from "../../core/schema";
import type { Plugin } from "../../core/types";
import { CROSS, LINE, UNKNOWN, check } from "./board";
import { analysisOf, gridOf, type LoopyAction, type LoopyInteraction, type LoopyPuzzle, type LoopyState } from "./def";
import { otherEnd, type Grid } from "./grid";
import { KEYS } from "./keys";
import { sidesOf } from "./solver";

type LoopyPlugin = Plugin<LoopyPuzzle, LoopyState, LoopyAction, LoopyInteraction>;

/** Edges that differ from prev; every edge on a settle pass (no action), so the whole board is checked. */
function changed(prev: LoopyState, next: LoopyState, settling: boolean): number[] {
  if (settling) return next.edges.map((_, e) => e);
  const out: number[] = [];
  for (let e = 0; e < next.edges.length; e++) if (prev.edges[e] !== next.edges[e]) out.push(e);
  return out;
}

const facesOf = (g: Grid, es: number[]) => new Set(es.flatMap((e) => [g.ef[2 * e]!, g.ef[2 * e + 1]!]).filter((f) => f >= 0));

const autoCrossClues: LoopyPlugin = {
  id: "loopy.auto-cross-clues",
  name: "auto-cross finished clues",
  description: "when a clue gets all its lines, cross out its other edges",
  category: "assists",
  appliesTo: ["loopy"],
  enabledByDefault: false,
  setup({ session, owner }) {
    session.hooks.apply.tap((next, { prev, action, puzzle, reduce }) => {
      const g = gridOf(puzzle);
      let state = next;
      for (const f of facesOf(g, changed(prev, next, !action))) {
        const c = puzzle.clues[f]!;
        if (c < 0) continue;
        const es = g.fe[f]!;
        if (es.filter((e) => state.edges[e] === LINE).length !== c) continue;
        const todo = es.filter((e) => state.edges[e] === UNKNOWN);
        if (todo.length) state = reduce(state, { type: "set", edges: todo, value: CROSS });
      }
      return state;
    }, { owner });
  },
};

const autoCrossDots: LoopyPlugin = {
  id: "loopy.auto-cross-dots",
  name: "auto-cross full dots",
  description: "when a dot has two lines, cross out its other edges",
  category: "assists",
  appliesTo: ["loopy"],
  enabledByDefault: false,
  settings: defineSchema({
    deadEnds: { type: "bool", label: "also cross dead ends", default: false, description: "a dot with only one edge left can't be used, so cross it (this can chain along)" },
  }),
  setup({ session, settings, owner }) {
    const deadEnds = settings.deadEnds as boolean;
    session.hooks.apply.tap((next, { prev, action, puzzle, reduce }) => {
      const g = gridOf(puzzle);
      let state = next;
      const queue: number[] = [];
      for (const e of changed(prev, next, !action)) queue.push(g.ev[2 * e]!, g.ev[2 * e + 1]!);
      const seen = new Set<number>();
      while (queue.length) {
        const v = queue.pop()!;
        const es = g.ve[v]!;
        const lines = es.filter((e) => state.edges[e] === LINE).length;
        const free = es.filter((e) => state.edges[e] === UNKNOWN);
        let todo: number[] = [];
        if (lines === 2) todo = free;
        else if (deadEnds && lines === 0 && free.length === 1 && !seen.has(v)) todo = free;
        seen.add(v);
        if (!todo.length) continue;
        state = reduce(state, { type: "set", edges: todo, value: CROSS });
        if (deadEnds) for (const e of todo) queue.push(otherEnd(g, e, v));
      }
      return state;
    }, { owner });
  },
};

const clueErrors: LoopyPlugin = {
  id: "loopy.clue-errors",
  name: "highlight broken clues",
  category: "checks",
  appliesTo: ["loopy"],
  enabledByDefault: true,
  settings: defineSchema({
    crosses: { type: "bool", label: "also when crosses leave too few edges", default: true },
  }),
  setup({ session, settings, owner }) {
    const crosses = settings.crosses as boolean;
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const g = gridOf(puzzle);
      const bad: number[] = [];
      for (let f = 0; f < g.nf; f++) {
        const c = puzzle.clues[f]!;
        if (c < 0) continue;
        let l = 0, u = 0;
        for (const e of g.fe[f]!) {
          if (state.edges[e] === LINE) l++;
          else if (state.edges[e] === UNKNOWN) u++;
        }
        if (l > c || (crosses && l + u < c)) bad.push(f);
      }
      return { ...d, [KEYS.badFaces]: bad };
    }, { owner });
  },
};

const dotErrors: LoopyPlugin = {
  id: "loopy.dot-errors",
  name: "highlight branches and dead ends",
  description: "dots with three or more lines, or a line with nowhere left to go",
  category: "checks",
  appliesTo: ["loopy"],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => ({
      ...d, [KEYS.badVertices]: check(gridOf(puzzle), puzzle.clues, state.edges).badVertices,
    }), { owner });
  },
};

const PALETTE_SIZE = 6;

const loopStatus: LoopyPlugin = {
  id: "loopy.loop-status",
  name: "loop status",
  description: "flag loops that close too early and show where lines stop",
  category: "checks",
  appliesTo: ["loopy"],
  enabledByDefault: true,
  settings: defineSchema({
    stray: { type: "bool", label: "flag loops closed too early", default: true },
    ends: { type: "bool", label: "mark loose ends", default: true },
    segments: { type: "bool", label: "colour each separate piece of line", default: false },
  }),
  setup({ session, settings, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const g = gridOf(puzzle);
      const r = check(g, puzzle.clues, state.edges);
      const out = { ...d };
      if (settings.stray && !r.solved) out[KEYS.strayLoop] = r.loops.flat();
      if (settings.ends) out[KEYS.ends] = r.ends;
      if (settings.segments) out[KEYS.segments] = segments(g, state.edges);
      return out;
    }, { owner });
  },
};

function segments(g: Grid, edges: number[]): number[] {
  const out = edges.map(() => -1);
  let next = 0;
  for (let e = 0; e < g.ne; e++) {
    if (edges[e] !== LINE || out[e] !== -1) continue;
    const colour = next++ % PALETTE_SIZE;
    const stack = [e];
    out[e] = colour;
    while (stack.length) {
      const x = stack.pop()!;
      for (const v of [g.ev[2 * x]!, g.ev[2 * x + 1]!]) {
        for (const y of g.ve[v]!) {
          if (edges[y] === LINE && out[y] === -1) {
            out[y] = colour;
            stack.push(y);
          }
        }
      }
    }
  }
  return out;
}

const insideOutside: LoopyPlugin = {
  id: "loopy.inside-outside",
  name: "shade inside and outside",
  description: "shade cells your lines and crosses already place inside the loop",
  category: "assists",
  appliesTo: ["loopy"],
  enabledByDefault: false,
  settings: defineSchema({
    outside: { type: "bool", label: "shade outside cells too", default: false },
  }),
  setup({ session, settings, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const g = gridOf(puzzle);
      const s = sidesOf(g, state.edges);
      const [outRoot, outPar] = s.find(g.nf);
      const sides: number[] = [];
      for (let f = 0; f < g.nf; f++) {
        const [r, p] = s.find(f);
        sides.push(r !== outRoot ? 0 : p !== outPar ? 1 : settings.outside ? 2 : 0);
      }
      return { ...d, [KEYS.sides]: sides };
    }, { owner });
  },
};

const dimDone: LoopyPlugin = {
  id: "loopy.dim-done",
  name: "dim finished clues",
  category: "assists",
  appliesTo: ["loopy"],
  enabledByDefault: true,
  settings: defineSchema({
    early: { type: "bool", label: "dim once the count is reached", default: false, description: "otherwise wait until every edge around it is decided" },
  }),
  setup({ session, settings, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const g = gridOf(puzzle);
      const done: number[] = [];
      for (let f = 0; f < g.nf; f++) {
        const c = puzzle.clues[f]!;
        if (c < 0) continue;
        let l = 0, u = 0;
        for (const e of g.fe[f]!) {
          if (state.edges[e] === LINE) l++;
          else if (state.edges[e] === UNKNOWN) u++;
        }
        if (l === c && (settings.early || u === 0)) done.push(f);
      }
      return { ...d, [KEYS.doneFaces]: done };
    }, { owner });
  },
};

const mistakes: LoopyPlugin = {
  id: "loopy.mistakes",
  name: "show mistakes",
  description: "mark lines and crosses that disagree with the solution",
  category: "checks",
  appliesTo: ["loopy"],
  enabledByDefault: false,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const a = analysisOf(puzzle);
      if (a.count !== 1 || !a.solution) return d;
      const sol = a.solution;
      const wrong = state.edges.flatMap((m, e) => ((m === LINE && sol[e] !== LINE) || (m === CROSS && sol[e] === LINE) ? [e] : []));
      return { ...d, [KEYS.wrong]: wrong };
    }, { owner });
  },
};

export const assists: LoopyPlugin[] = [autoCrossClues, autoCrossDots, clueErrors, dotErrors, loopStatus, insideOutside, dimDone, mistakes];
