import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { GenerateContext, Hint, PuzzleDef } from "../../core/types";
import { CROSS, LINE, UNKNOWN, check, type EdgeState } from "./board";
import { formats, type LoopyPuzzle } from "./formats";
import { generateClues } from "./generator";
import { getGrid, getTiling, listTilings, type Grid } from "./grid";
import { edgeRef } from "./names";
import { TIERS, analyse, type Analysis } from "./solver";
import { listOf } from "../../lib/edge-names";

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

/** What hint focus and assist annotations point at. Also what view.locate() accepts. */
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
      { value: "easy", label: "easy", description: "solvable by looking at one number or one dot at a time" },
      { value: "normal", label: "normal", description: "needs a number together with the dots at its corners" },
      { value: "tricky", label: "tricky", description: "needs two numbers at once, and working out which cells are inside the loop" },
      { value: "hard", label: "hard", description: "needs \"what if this edge were a line?\" reasoning" },
    ],
  },
  symmetric: { type: "bool", label: "symmetric clues", default: false, description: "clues come in half-turn pairs, when the grid allows it" },
  loopSize: { type: "int", label: "loop size (% of cells inside)", default: 55, min: 20, max: 80, description: "how much of the board the answer loop encloses" },
  wiggle: { type: "int", label: "loop wiggliness (%)", default: 60, min: 0, max: 100, description: "higher makes the answer loop twist through thin corridors; lower makes it round and blobby" },
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

/** Marks that disagree with the unique solution, or null if there isn't one. */
export function wrongMarks(p: LoopyPuzzle, s: LoopyState): number[] | null {
  const a = analysisOf(p);
  if (a.count !== 1 || !a.solution) return null;
  const sol = a.solution;
  return s.edges.flatMap((m, e) => ((m === LINE && sol[e] !== LINE) || (m === CROSS && sol[e] === LINE) ? [e] : []));
}

/** Fallback when no hint-enabled technique applies: an edge of the solution. */
function hint(p: LoopyPuzzle, s: LoopyState): Hint<LoopyAction> | null {
  const sol = analysisOf(p).count === 1 ? analysisOf(p).solution : null;
  if (!sol) return null;
  for (let e = 0; e < s.edges.length; e++) {
    if (s.edges[e] === UNKNOWN && sol[e] === LINE) {
      return {
        message: `none of your hint techniques apply here, but ${edgeRef(gridOf(p), e)} is a line`,
        focus: { edges: [e] } satisfies LoopyFocus,
        actions: [{ type: "set", edges: [e], value: LINE }],
      };
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
  name: "slitherlink",
  aliases: ["loopy", "fences", "loop the loop", "takegaki"],
  tags: ["logic", "loop", "edges", "nikoli"],
  description: "draw a single closed loop along the lines between the dots. a number in a cell tells you how many of that cell's sides the loop runs along.",
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
  describeAction: (p, a) => {
    const verb = a.value === LINE ? "line" : a.value === CROSS ? "cross" : "clear";
    const g = gridOf(p);
    const named = a.edges.map((e) => edgeRef(g, e));
    if (named.some((n) => n === "this edge")) return `${verb} ${a.edges.length === 1 ? "an edge" : `${a.edges.length} edges`}`;
    return `${verb} ${listOf(named, (n) => n.replace(/^the /, ""))}`;
  },
  isSolved: (p, s) => check(gridOf(p), p.clues, s.edges).solved,
  solve(p) {
    const sol = analysisOf(p).solution;
    return sol ? { edges: Array.from(sol, (m) => (m === LINE ? LINE : CROSS)) } : null;
  },
  hint,
  isRetraction: (a) => a.value === UNKNOWN,
  rules: (p) => [
    "the loop runs along the edges between dots and comes back to where it started. there is exactly one loop.",
    "it never branches, crosses itself or stops, so every dot has either two lines or none.",
    "a number counts how many sides of its cell the loop uses. empty cells can have any number of sides used.",
    "crosses are notes you make for edges you know aren't part of the loop. they don't count toward anything.",
    ...(gridOf(p).cells ? ["hints name cells by column letter and row number, like C5. the \"board labels\" command writes them along the edges."] : []),
  ],
  features: (p) => [`tiling:${p.tiling}` as const, ...(analysisOf(p).count === 1 ? ["solution" as const] : [])],
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

declare module "../../core/types" {
  interface FeatureNames {
    /** The puzzle has exactly one solution, so moves can be checked against it. */
    solution: true;
    /** Which tiling the board uses. */
    [k: `tiling:${string}`]: true;
  }
}
