import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { GenerateContext, Hint, PuzzleDef } from "../../core/types";
import { CROSS, LINE, UNKNOWN, check, type EdgeState } from "./board";
import { formats, type LoopyPuzzle } from "./formats";
import { generateClues } from "./generator";
import { getGrid, getTiling, listTilings, type Grid } from "./grid";
import { TIERS, analyse, nextDeduction, type Analysis } from "./solver";

export type { LoopyPuzzle };

export interface LoopyState {
  /** Per edge: 0 unknown, 1 line, 2 crossed. */
  edges: number[];
}

export type LoopyAction = { type: "set"; edges: number[]; value: EdgeState };

export interface LoopyInteraction {
  /** Edge under the keyboard cursor. */
  cursor: number;
}

/** What hint focus and assist annotations point at. */
export interface LoopyFocus {
  faces?: number[];
  vertices?: number[];
  edges?: number[];
}

export const params = defineSchema({
  tiling: {
    type: "enum", label: "tiling", default: "square",
    options: listTilings().filter((t) => !t.hidden).map((t) => ({ value: t.id, label: t.label })),
  },
  width: { type: "int", label: "width", default: 10, min: 2, max: 30 },
  height: { type: "int", label: "height", default: 10, min: 2, max: 30 },
  difficulty: {
    type: "enum", label: "difficulty", default: "normal",
    options: [
      { value: "easy", label: "easy", description: "one clue or one dot at a time" },
      { value: "normal", label: "normal", description: "a clue together with the dots around it" },
      { value: "tricky", label: "tricky", description: "pairs of clues, and inside/outside reasoning" },
      { value: "hard", label: "hard", description: "following a supposition to a contradiction" },
    ],
  },
  symmetric: { type: "bool", label: "symmetric clues", default: false, description: "clues come in half-turn pairs, when the grid allows it" },
  loopSize: { type: "int", label: "loop size (% of cells inside)", default: 55, min: 20, max: 80 },
  wiggle: { type: "int", label: "loop wiggliness (%)", default: 60, min: 0, max: 100 },
});

export type LoopyParams = Values<typeof params>;

const cluesMemo = new WeakMap<LoopyPuzzle, Int8Array>();
const analysisMemo = new WeakMap<LoopyPuzzle, Analysis>();

export function gridOf(p: LoopyPuzzle): Grid {
  return getGrid(p.tiling, p.w, p.h);
}

export function cluesOf(p: LoopyPuzzle): Int8Array {
  let c = cluesMemo.get(p);
  if (!c) {
    c = Int8Array.from(p.clues);
    cluesMemo.set(p, c);
  }
  return c;
}

/** Solution, solution count and difficulty, computed once per puzzle object. */
export function analysisOf(p: LoopyPuzzle): Analysis {
  let a = analysisMemo.get(p);
  if (!a) {
    a = analyse(gridOf(p), cluesOf(p));
    analysisMemo.set(p, a);
  }
  return a;
}

async function generate(v: LoopyParams, rng: Rng, ctx: GenerateContext): Promise<LoopyPuzzle> {
  const t = getTiling(v.tiling) ?? getTiling("square")!;
  const w = Math.max(t.minW, v.width), h = Math.max(t.minH, v.height);
  const g = getGrid(t.id, w, h);
  const clues = await generateClues(g, rng, {
    tier: Math.max(0, TIERS.indexOf(v.difficulty as (typeof TIERS)[number])),
    symmetric: v.symmetric,
    fill: v.loopSize / 100,
    wiggle: v.wiggle / 100,
    yieldNow: () => ctx.yield(),
  });
  return { tiling: t.id, w, h, clues: [...clues] };
}

function hint(p: LoopyPuzzle, s: LoopyState): Hint<LoopyAction> | null {
  const g = gridOf(p);
  const a = analysisOf(p);
  const sol = a.count === 1 ? a.solution : null;
  if (sol) {
    const wrong = s.edges.flatMap((m, e) => ((m === LINE && sol[e] !== LINE) || (m === CROSS && sol[e] === LINE) ? [e] : []));
    if (wrong.length) {
      const e = wrong[0]!;
      const what = s.edges[e] === LINE ? "this line shouldn't be here" : "this edge shouldn't be crossed";
      return {
        message: wrong.length > 1 ? `${what} (and ${wrong.length - 1} more mark${wrong.length > 2 ? "s are" : " is"} wrong)` : what,
        focus: { edges: [e] } satisfies LoopyFocus,
        action: { type: "set", edges: [e], value: UNKNOWN },
      };
    }
  }
  const d = nextDeduction(g, cluesOf(p), s.edges);
  if (d) {
    const x = d.explain();
    return {
      message: x.message,
      focus: { faces: x.faces, vertices: x.vertices, edges: d.edges } satisfies LoopyFocus,
      action: { type: "set", edges: d.edges, value: d.value },
    };
  }
  if (sol) {
    for (let e = 0; e < g.ne; e++) {
      if (s.edges[e] === UNKNOWN && sol[e] === LINE) {
        return {
          message: "no step of logic found from here, but this edge is a line",
          focus: { edges: [e] } satisfies LoopyFocus,
          action: { type: "set", edges: [e], value: LINE },
        };
      }
    }
  }
  return null;
}

function centreEdge(g: Grid): number {
  const cx = (g.minX + g.maxX) / 2, cy = (g.minY + g.maxY) / 2;
  let best = 0, bd = Infinity;
  for (let e = 0; e < g.ne; e++) {
    const a = g.ev[2 * e]!, b = g.ev[2 * e + 1]!;
    const d = Math.hypot((g.vx[a]! + g.vx[b]!) / 2 - cx, (g.vy[a]! + g.vy[b]!) / 2 - cy);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

export const loopy: PuzzleDef<LoopyPuzzle, LoopyState, LoopyAction, LoopyInteraction, typeof params> = {
  id: "loopy",
  name: "loopy",
  description: "draw one closed loop along the grid lines. each number says how many of its cell's edges the loop uses.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "7×7 easy", params: { tiling: "square", width: 7, height: 7, difficulty: "easy" } },
    { label: "10×10 normal", params: { tiling: "square", width: 10, height: 10, difficulty: "normal" } },
    { label: "10×10 tricky", params: { tiling: "square", width: 10, height: 10, difficulty: "tricky" } },
    { label: "10×10 hard", params: { tiling: "square", width: 10, height: 10, difficulty: "hard" } },
    { label: "hexagons", params: { tiling: "honeycomb", width: 8, height: 7, difficulty: "normal" } },
    { label: "triangles", params: { tiling: "triangular", width: 8, height: 8, difficulty: "normal" } },
    { label: "cairo", params: { tiling: "cairo", width: 6, height: 6, difficulty: "normal" } },
    { label: "snub square", params: { tiling: "snub-square", width: 6, height: 6, difficulty: "tricky" } },
  ],
  generate,
  formats,
  init: (p) => ({ edges: Array.from({ length: gridOf(p).ne }, () => UNKNOWN) }),
  initInteraction: (p) => ({ cursor: centreEdge(gridOf(p)) }),
  reduce(p, s, a) {
    if (a.type !== "set") return s;
    const ne = gridOf(p).ne;
    if (a.value !== UNKNOWN && a.value !== LINE && a.value !== CROSS) return s;
    const todo = a.edges.filter((e) => Number.isInteger(e) && e >= 0 && e < ne && s.edges[e] !== a.value);
    if (!todo.length) return s;
    const edges = s.edges.slice();
    for (const e of todo) edges[e] = a.value;
    return { edges };
  },
  isSolved: (p, s) => check(gridOf(p), p.clues, s.edges).solved,
  solve(p) {
    const sol = analysisOf(p).solution;
    return sol ? { edges: Array.from(sol, (m) => (m === LINE ? LINE : CROSS)) } : null;
  },
  hint,
  rate(p) {
    const a = analysisOf(p);
    if (a.count === 0) return { label: "no solution", score: 100 };
    if (a.count === 2) return { label: "more than one solution", score: 99 };
    if (a.count === -1) return { label: "too hard to rate", score: 98 };
    if (a.tier < 0) return { label: "beyond hard", score: 10 };
    return { label: TIERS[a.tier]!, score: a.tier * 10 + Math.min(9, a.used[a.tier]! / 5) };
  },
  describe: (p) => `${p.w}×${p.h} ${getTiling(p.tiling)?.label ?? p.tiling}`,
};
