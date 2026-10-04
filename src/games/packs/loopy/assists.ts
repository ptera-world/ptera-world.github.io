import { defineSchema } from "../../core/schema";
import type { Hint, Plugin } from "../../core/types";
import { LINE, UNKNOWN, check } from "./board";
import { gridOf, wrongMarks, type LoopyAction, type LoopyFocus, type LoopyInteraction, type LoopyPuzzle, type LoopyState } from "./def";
import type { Grid } from "./grid";
import { edgeRef } from "./names";
import { KEYS } from "./keys";
import { sidesOf } from "./solver";

type LoopyPlugin = Plugin<LoopyPuzzle, LoopyState, LoopyAction, LoopyInteraction>;

const clueErrors: LoopyPlugin = {
  id: "loopy.clue-errors",
  name: "highlight broken numbers",
  description: "numbers turn red when they have too many lines around them",
  category: "checks",
  appliesTo: ["loopy"],
  enabledByDefault: true,
  settings: defineSchema({
    crosses: { type: "bool", label: "also when crosses leave too few edges", default: true, description: "a number also turns red when there aren't enough uncrossed edges left around it to reach its count" },
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
  description: "dots turn red when three or more lines meet there, or when a line ends there with no edge left to carry on",
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
  description: "a loop closed while other lines are still outside it turns orange, and dots where a line stops are marked",
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
  description: "shades the cells your lines and crosses already prove are inside the loop (everything beyond the outer edge counts as outside)",
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
  name: "dim finished numbers",
  description: "fades a number once it's done, so the ones still needing work stand out",
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
  requires: ["solution"],
  enabledByDefault: false,
  setup({ session, owner }) {
    session.hooks.derive.tap((d, { puzzle, state }) => {
      const wrong = wrongMarks(puzzle, state);
      return wrong ? { ...d, [KEYS.wrong]: wrong } : d;
    }, { owner });
  },
};

/** Runs before technique hints (priority 100), so a hint never builds on a wrong mark. */
const mistakeHints: LoopyPlugin = {
  id: "loopy.mistake-hints",
  name: "hints point out mistakes first",
  description: "if a line or cross disagrees with the solution, the hint shows it before any deduction",
  category: "checks",
  appliesTo: ["loopy"],
  requires: ["solution"],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }): Hint<LoopyAction> | undefined => {
      const wrong = wrongMarks(puzzle, state);
      if (!wrong?.length) return undefined;
      const e = wrong[0]!;
      const where = edgeRef(gridOf(puzzle), e);
      const what = state.edges[e] === LINE ? `the line on ${where} shouldn't be there` : `${where} shouldn't be crossed`;
      const more = wrong.length - 1;
      return {
        message: more ? `${what} (and ${more} more mark${more > 1 ? "s are" : " is"} wrong)` : what,
        focus: { edges: [e] } satisfies LoopyFocus,
        actions: [{ type: "set", edges: [e], value: UNKNOWN }],
      };
    }, { owner, priority: 50 });
  },
};

export const assists: LoopyPlugin[] = [clueErrors, dotErrors, loopStatus, insideOutside, dimDone, mistakes, mistakeHints];
