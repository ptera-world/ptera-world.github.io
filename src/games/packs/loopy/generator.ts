import type { Rng } from "../../core/rng";
import { halfTurn, type Grid } from "./grid";
import { solveLogic } from "./solver";

export interface GenOptions {
  /** Hardest solver tier the puzzle may need (0 easy … 3 hard). */
  tier: number;
  /** Remove clues in half-turn-symmetric pairs (ignored if the grid isn't symmetric). */
  symmetric: boolean;
  /** Fraction of cells inside the loop, 0..1. */
  fill: number;
  /** How strongly the loop prefers thin, winding arms over blobs, 0..1. */
  wiggle: number;
  /** Await between expensive steps; may throw to abort. */
  yieldNow?: () => Promise<void>;
}

/**
 * Random region of faces whose boundary is one simple loop. Grows from one face, only adding
 * faces whose neighbor ring holds exactly one run of inside faces, which keeps both the
 * inside and the outside connected and never makes a dot with four lines.
 */
export function growLoop(g: Grid, rng: Rng, fill: number, wiggle: number): Uint8Array {
  const inside = new Uint8Array(g.nf);
  const nbrIn = new Int32Array(g.nf);
  const add = (f: number) => {
    inside[f] = 1;
    for (const e of g.fe[f]!) {
      const o = g.ef[2 * e] === f ? g.ef[2 * e + 1]! : g.ef[2 * e]!;
      if (o >= 0) nbrIn[o]!++;
    }
  };
  add(rng.int(g.nf));
  const target = Math.max(1, Math.round(g.nf * fill));
  const pow = 1 + 4 * wiggle;
  const weights = new Float64Array(g.nf);
  for (let count = 1; count < target; count++) {
    let total = 0;
    for (let f = 0; f < g.nf; f++) {
      weights[f] = 0;
      if (inside[f] || nbrIn[f] === 0 || !simple(g, inside, f)) continue;
      weights[f] = 1 / nbrIn[f]! ** pow;
      total += weights[f]!;
    }
    if (total === 0) break;
    let r = rng.next() * total;
    let pick = -1;
    for (let f = 0; f < g.nf; f++) {
      if (weights[f] === 0) continue;
      pick = f;
      r -= weights[f]!;
      if (r < 0) break;
    }
    add(pick);
  }
  return inside;
}

function simple(g: Grid, inside: Uint8Array, f: number): boolean {
  const ring = g.ring[f]!;
  let runs = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n]!, b = ring[i]!;
    const ia = a >= 0 && inside[a] === 1, ib = b >= 0 && inside[b] === 1;
    if (ib && !ia) runs++;
  }
  return runs === 1;
}

export function loopEdges(g: Grid, inside: Uint8Array): Uint8Array {
  const out = new Uint8Array(g.ne);
  for (let e = 0; e < g.ne; e++) {
    const a = g.ef[2 * e]!, b = g.ef[2 * e + 1]!;
    const ia = a >= 0 ? inside[a]! : 0, ib = b >= 0 ? inside[b]! : 0;
    out[e] = ia !== ib ? 1 : 0;
  }
  return out;
}

export function fullClues(g: Grid, line: Uint8Array): Int8Array {
  return Int8Array.from(g.fe, (es) => es.reduce((n, e) => n + line[e]!, 0));
}

const MAX_ATTEMPTS = 40;

/**
 * Clues (-1 = blank) whose unique solution the solver reaches using techniques up to
 * `opts.tier`, and (when possible) not with the tier below. Deterministic in (grid, rng, opts).
 */
export async function generateClues(g: Grid, rng: Rng, opts: GenOptions): Promise<Int8Array> {
  const pause = opts.yieldNow ?? (async () => {});
  const ht = opts.symmetric ? halfTurn(g) : null;
  let fallback: Int8Array | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const inside = growLoop(g, rng, opts.fill, opts.wiggle);
    const full = fullClues(g, loopEdges(g, inside));
    if (solveLogic(g, full, opts.tier).status !== "solved") continue;
    await pause();

    const orbits: number[][] = [];
    const done = new Uint8Array(g.nf);
    for (let f = 0; f < g.nf; f++) {
      if (done[f]) continue;
      const o = ht && ht[f] !== f ? [f, ht[f]!] : [f];
      for (const x of o) done[x] = 1;
      orbits.push(o);
    }
    rng.shuffle(orbits);

    const clues = full.slice();
    const passes = Array.from({ length: opts.tier + 1 }, (_, t) => t);
    for (const tier of passes) {
      for (const o of orbits) {
        if (clues[o[0]!]! < 0) continue;
        const saved = o.map((f) => clues[f]!);
        for (const f of o) clues[f] = -1;
        if (solveLogic(g, clues.slice(), tier).status !== "solved") o.forEach((f, i) => { clues[f] = saved[i]!; });
        await pause();
      }
    }
    if (opts.tier > 0 && solveLogic(g, clues.slice(), opts.tier - 1).status === "solved") {
      fallback ??= clues;
      continue;
    }
    return clues;
  }
  if (fallback) return fallback;
  throw new Error("couldn't make a puzzle with these settings; try a bigger grid or another difficulty");
}
