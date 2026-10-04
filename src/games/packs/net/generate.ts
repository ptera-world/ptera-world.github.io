import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { GenerateContext } from "../../core/types";
import { D, DIRS, R, centre, isTree, link, neighbour, opp, orientations, rotate, type Geometry, type NetPuzzle } from "./grid";
import { solveLogic, type Tier } from "./solver";

export const params = defineSchema({
  width: { type: "int", label: "width", default: 7, min: 2, max: 30 },
  height: { type: "int", label: "height", default: 7, min: 2, max: 30 },
  wrap: { type: "bool", label: "wrapping", default: false, description: "edges join up with the opposite side" },
  barriers: {
    type: "int", label: "barriers (%)", default: 0, min: 0, max: 100,
    description: "walls placed on this share of the gaps the solution doesn't use",
  },
  difficulty: {
    type: "enum", label: "difficulty", default: "normal",
    options: [
      { value: "easy", label: "easy", description: "each tile follows from its neighbors and the walls" },
      { value: "normal", label: "normal", description: "also needs loop and closed-off-group reasoning" },
      { value: "hard", label: "hard", description: "also needs 'what if' reasoning one step deep" },
    ],
  },
});

export type NetParams = Values<typeof params>;

const TIER: Record<string, Tier> = { easy: 1, normal: 2, hard: 3 };
/** Fresh trees tried while looking for one that actually needs the requested tier. */
const TIER_ATTEMPTS = 10;
/** Tree edits per tree before starting over. */
const EDITS_PER_CELL = 8;
/** Accepted-or-rejected edits per cell spent trying to make a puzzle need its tier. */
const CLIMB_PER_CELL = 3;

/** Uniform-ish random spanning tree grown outward from `start` (randomized Prim). */
function randomTree(g: Geometry, start: number, rng: Rng): number[] {
  const n = g.w * g.h;
  const tiles = Array.from({ length: n }, () => 0);
  const inTree = new Uint8Array(n);
  const frontier: number[] = [];
  const add = (i: number) => {
    inTree[i] = 1;
    for (let k = 0; k < 4; k++) {
      const j = neighbour(g, i, DIRS[k]!);
      if (j >= 0 && !inTree[j]) frontier.push(i * 4 + k);
    }
  };
  add(start);
  while (frontier.length) {
    const at = rng.int(frontier.length);
    const e = frontier[at]!;
    frontier[at] = frontier[frontier.length - 1]!;
    frontier.pop();
    const i = e >> 2, d = DIRS[e & 3]!, j = neighbour(g, i, d);
    if (inTree[j]) continue;
    tiles[i]! |= d;
    tiles[j]! |= opp(d);
    add(j);
  }
  return tiles;
}

function placeBarriers(g: Geometry, tiles: number[], percent: number, rng: Rng): number[] {
  const n = g.w * g.h;
  const barriers = Array.from({ length: n }, () => 0);
  const spare: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (const d of [R, D]) {
      if (neighbour(g, i, d) >= 0 && !(tiles[i]! & d)) spare.push([i, d]);
    }
  }
  rng.shuffle(spare);
  const count = Math.floor((spare.length * percent) / 100);
  for (const [i, d] of spare.slice(0, count)) {
    barriers[i]! |= d;
    barriers[neighbour(g, i, d)]! |= opp(d);
  }
  return barriers;
}

/**
 * Swap one tree edge touching an undetermined cell for a different edge that reconnects the
 * two halves, so the tile shapes in the ambiguous region change. Returns false if no swap exists.
 */
function editTree(p: NetPuzzle, undetermined: Uint8Array, rng: Rng): boolean {
  const n = p.w * p.h;
  const cells: number[] = [];
  for (let i = 0; i < n; i++) if (undetermined[i]) cells.push(i);
  rng.shuffle(cells);
  for (const u of cells.slice(0, 8)) {
    const dirs = rng.shuffle(DIRS.filter((d) => p.tiles[u]! & d));
    for (const d of dirs) {
      const v = neighbour(p, u, d);
      p.tiles[u]! &= ~d;
      p.tiles[v]! &= ~opp(d);
      const side = new Uint8Array(n);
      side[u] = 1;
      const stack = [u];
      while (stack.length) {
        const i = stack.pop()!;
        for (const e of DIRS) {
          if (!(p.tiles[i]! & e)) continue;
          const j = neighbour(p, i, e);
          if (!side[j]) {
            side[j] = 1;
            stack.push(j);
          }
        }
      }
      const options: [number, number][] = [];
      for (let a = 0; a < n; a++) {
        if (!side[a]) continue;
        for (const e of DIRS) {
          if (a === u && e === d) continue;
          const b = link(p, a, e);
          if (b < 0 || side[b] || p.tiles[a]! & e) continue;
          if (undetermined[a] || undetermined[b]) options.push([a, e]);
        }
      }
      if (options.length) {
        const [a, e] = rng.pick(options);
        p.tiles[a]! |= e;
        p.tiles[neighbour(p, a, e)]! |= opp(e);
        return true;
      }
      p.tiles[u]! |= d;
      p.tiles[v]! |= opp(d);
    }
  }
  return false;
}

/** Solved-orientation puzzle whose solution logic at `tier` determines, or null if edits ran out. */
async function buildUnique(g: Geometry, v: NetParams, tier: Tier, rng: Rng, ctx: GenerateContext): Promise<NetPuzzle | null> {
  const source = centre(g);
  const tiles = randomTree(g, source, rng.fork("tree"));
  const barriers = placeBarriers(g, tiles, v.barriers, rng.fork("barriers"));
  const p: NetPuzzle = { ...g, tiles, barriers, source };
  const edits = rng.fork("edits");
  const n = g.w * g.h;
  for (let round = 0; round < n * EDITS_PER_CELL; round++) {
    await ctx.yield();
    const res = solveLogic(p, { tier });
    if (res.status === "solved") return p;
    if (res.status === "contradiction") throw new Error("net: solver contradicted a valid tree");
    const undetermined = Uint8Array.from(res.masks, (m) => (m < 0 ? 1 : 0));
    if (!editTree(p, undetermined, edits)) return null;
  }
  return null;
}

function scramble(p: NetPuzzle, rng: Rng): NetPuzzle {
  const tiles = p.tiles.map((m) => rotate(m, rng.int(4)));
  const out = { ...p, tiles };
  while (isTree(out, tiles)) {
    const movable = tiles.flatMap((m, i) => (orientations(m).length > 1 ? [i] : []));
    const i = rng.pick(movable);
    tiles[i] = rotate(tiles[i]!, 1);
  }
  return out;
}

/**
 * Deterministic in (params, rng). The result has exactly one solution and the logic solver
 * reaches it using rules up to the requested tier; when possible it also needs that tier.
 */
export async function generate(v: NetParams, rng: Rng, ctx: GenerateContext): Promise<NetPuzzle> {
  const g: Geometry = { w: v.width, h: v.height, wrap: v.wrap };
  if (g.wrap && (g.w < 3 || g.h < 3)) {
    throw new Error("wrapping needs at least 3 tiles each way: with 2, every link has a twin and the answer is never unique");
  }
  const tier = TIER[v.difficulty] ?? 2;
  const needsTier = (p: NetPuzzle) => tier === 1 || solveLogic(p, { tier: (tier - 1) as Tier }).status !== "solved";
  const n = g.w * g.h;
  let fallback: { p: NetPuzzle; level: number } | null = null;
  let built = 0;
  for (let attempt = 0; attempt < 200 && built < TIER_ATTEMPTS; attempt++) {
    const p = await buildUnique(g, v, tier, rng.fork(`attempt:${attempt}`), ctx);
    if (!p) continue;
    built++;
    if (needsTier(p)) return scramble(p, rng.fork("scramble"));
    // hill-climb: random tree edits that keep the puzzle logic-solvable at this tier
    const climb = rng.fork(`climb:${attempt}`);
    const everywhere = new Uint8Array(n).fill(1);
    for (let step = 0; step < n * CLIMB_PER_CELL; step++) {
      await ctx.yield();
      const saved = p.tiles.slice();
      if (!editTree(p, everywhere, climb)) break;
      if (solveLogic(p, { tier }).status !== "solved") {
        p.tiles = saved;
        continue;
      }
      if (needsTier(p)) return scramble(p, rng.fork("scramble"));
    }
    const level = tierNeeded(p);
    if (!fallback || level > fallback.level) fallback = { p: { ...p, tiles: p.tiles.slice() }, level };
  }
  if (fallback) return scramble(fallback.p, rng.fork("scramble"));
  throw new Error("couldn't build a puzzle with a unique solution for these settings");
}

/** Lowest rule tier that solves p, or 4 if logic can't finish it. */
export function tierNeeded(p: NetPuzzle): number {
  for (const t of [1, 2, 3] as const) if (solveLogic(p, { tier: t }).status === "solved") return t;
  return 4;
}
