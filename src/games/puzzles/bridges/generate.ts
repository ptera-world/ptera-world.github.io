import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { GenerateContext } from "../../core/types";
import { DX, DY, MAX_BRIDGES, cycleEdges, graph, islandSums, normalize, type BridgesPuzzle, type Island } from "./graph";
import { logicSolve, solverWork, type Domain, type LogicResult, type Tier } from "./solver";

export const params = defineSchema({
  width: { type: "int", label: "width", default: 7, min: 3, max: 30 },
  height: { type: "int", label: "height", default: 7, min: 3, max: 30 },
  difficulty: {
    type: "enum", label: "difficulty", default: "easy",
    options: [
      { value: "easy", label: "easy", description: "counting only" },
      { value: "medium", label: "medium", description: "plus connectivity reasoning" },
      { value: "hard", label: "hard", description: "plus what-if contradictions" },
    ],
  },
  density: { type: "int", label: "islands (% of cells)", default: 30, min: 5, max: 50, step: 5 },
  maxb: { type: "int", label: "max bridges per pair", default: 2, min: 1, max: MAX_BRIDGES },
  loops: { type: "bool", label: "allow loops", default: true, description: "off: the finished bridges must form a tree" },
  adjacent: { type: "bool", label: "allow touching islands", default: false },
  long: { type: "int", label: "long bridges (%)", default: 10, min: 0, max: 100, step: 10, description: "bias toward long bridges" },
  extra: {
    type: "int", label: "extra links (%)", default: 40, min: 0, max: 100, step: 10,
    description: "chance to add loop-closing bridges",
    when: (v) => v.loops === true,
  },
});

export type BridgesParams = Values<typeof params>;

const TIERS: Record<string, Tier> = { easy: 1, medium: 2, hard: 3 };

/** Layouts tried before settling for the closest tier found; solvable puzzles are always required. */
const ATTEMPTS = 300;
const MAX_ATTEMPTS = 5000;

export interface Layout {
  islands: Island[];
  /** The bridge network the island counts were taken from. */
  links: { a: [number, number]; b: [number, number]; n: number }[];
}

/** One random island layout with a valid bridge network; island counts come from that network. */
export function layout(v: BridgesParams, rng: Rng): Layout {
  const { width: w, height: h, maxb } = v;
  const island = new Int32Array(w * h).fill(-1);
  const covered = new Uint8Array(w * h);
  const xs: number[] = [], ys: number[] = [], ns: number[] = [];
  const linked: boolean[][] = [];
  const links: Layout["links"] = [];
  const add = (x: number, y: number) => {
    island[y * w + x] = xs.length;
    xs.push(x);
    ys.push(y);
    ns.push(0);
    linked.push([false, false, false, false]);
    return xs.length - 1;
  };
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const touchesIsland = (x: number, y: number) => {
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d]!, ny = y + DY[d]!;
      if (inside(nx, ny) && island[ny * w + nx]! >= 0) return true;
    }
    return false;
  };
  const link = (i: number, d: number, len: number, j: number) => {
    const n = rng.range(1, maxb);
    ns[i]! += n;
    ns[j]! += n;
    linked[i]![d] = true;
    linked[j]![(d + 2) % 4] = true;
    links.push({ a: [xs[i]!, ys[i]!], b: [xs[j]!, ys[j]!], n });
    for (let k = 1; k < len; k++) covered[(ys[i]! + DY[d]! * k) * w + xs[i]! + DX[d]! * k] = 1;
  };

  add(rng.int(w), rng.int(h));
  const target = Math.max(2, Math.round((w * h * v.density) / 100));
  const minLen = v.adjacent ? 1 : 2;
  let fails = 0;
  while (xs.length < target && fails < 40 * target) {
    const i = rng.int(xs.length);
    const d = rng.int(4);
    if (linked[i]![d]) {
      fails++;
      continue;
    }
    const spots: number[] = [];
    for (let len = 1; ; len++) {
      const x = xs[i]! + DX[d]! * len, y = ys[i]! + DY[d]! * len;
      if (!inside(x, y)) break;
      const c = y * w + x;
      if (island[c]! >= 0 || covered[c]) break;
      if (len >= minLen && (v.adjacent || !touchesIsland(x, y))) spots.push(len);
    }
    if (!spots.length) {
      fails++;
      continue;
    }
    const len = rng.int(100) < v.long ? spots[spots.length - 1]! : rng.pick(spots);
    const j = add(xs[i]! + DX[d]! * len, ys[i]! + DY[d]! * len);
    link(i, d, len, j);
  }

  if (v.loops && v.extra > 0) {
    const pairs: [number, number, number, number][] = [];
    for (let i = 0; i < xs.length; i++) {
      for (const d of [0, 1]) {
        if (linked[i]![d]) continue;
        let len = 1;
        let x = xs[i]! + DX[d]!, y = ys[i]! + DY[d]!;
        while (inside(x, y) && island[y * w + x]! < 0) {
          x += DX[d]!;
          y += DY[d]!;
          len++;
        }
        if (inside(x, y)) pairs.push([i, d, len, island[y * w + x]!]);
      }
    }
    rng.shuffle(pairs);
    for (const [i, d, len, j] of pairs) {
      if (rng.int(100) >= v.extra) continue;
      let blocked = false;
      for (let k = 1; k < len && !blocked; k++) blocked = covered[(ys[i]! + DY[d]! * k) * w + xs[i]! + DX[d]! * k] === 1;
      if (!blocked) link(i, d, len, j);
    }
  }
  return { islands: xs.map((x, i) => ({ x, y: ys[i]!, n: ns[i]! })), links };
}

export interface Candidate {
  puzzle: BridgesPuzzle;
  tier: Tier;
}

/**
 * Deterministic in (params, rng). Every result has exactly one solution reachable by the
 * logic solver. Aims for exactly the requested tier; after ATTEMPTS tries it takes the
 * closest tier found (easier preferred).
 */
export async function generate(v: BridgesParams, rng: Rng, ctx?: GenerateContext): Promise<BridgesPuzzle> {
  const want = TIERS[v.difficulty] ?? 1;
  let best: Candidate | null = null;
  const score = (t: Tier) => (t <= want ? (want - t) * 2 : (t - want) * 2 + 1);
  const start = solverWork();
  const spent = () => solverWork() - start;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (ctx) await ctx.yield();
    if (best ? attempt >= ATTEMPTS || spent() >= WORK_BUDGET : spent() >= WORK_LIMIT) break;
    const sub = rng.fork(`attempt ${attempt}`);
    const lay = layout(v, sub);
    if (lay.islands.length < 2) continue;
    const base = normalize({ w: v.width, h: v.height, maxb: v.maxb, loops: v.loops, islands: lay.islands });
    let b = networkOf(base, lay.links);
    let cur = base;
    let r = logicSolve(cur);
    let open = undecided(r);
    for (let step = 0; r.tier === null && step < REPAIRS && spent() < WORK_LIMIT; step++) {
      if (ctx) await ctx.yield();
      const nb = mutate(cur, b, r.domain, sub);
      if (!nb) break;
      const next = withCounts(base, nb);
      const r2 = logicSolve(next);
      const o2 = undecided(r2);
      if (o2 <= open) {
        b = nb;
        cur = next;
        r = r2;
        open = o2;
      }
    }
    const tier = r.tier;
    if (tier === null) continue;
    if (tier === want) return cur;
    if (!best || score(tier) < score(best.tier)) best = { puzzle: cur, tier };
  }
  if (!best) throw new Error("couldn't make a puzzle with a unique solution here; try fewer islands, fewer max bridges, or no touching islands");
  return best.puzzle;
}

/** Solver work spent before settling for the closest tier found. */
const WORK_BUDGET = 8_000_000;
/** Solver work after which generation gives up if nothing solvable turned up. */
const WORK_LIMIT = 30_000_000;
/** Count tweaks tried on one layout whose logic solve stalls. */
const REPAIRS = 24;

function undecided(r: LogicResult): number {
  if (r.contradiction) return Infinity;
  let n = 0;
  for (let e = 0; e < r.domain.lo.length; e++) if (r.domain.lo[e] !== r.domain.hi[e]) n++;
  return n;
}

/** Bridge counts per edge of `graph(p)` for a layout's links. */
export function networkOf(p: BridgesPuzzle, links: Layout["links"]): number[] {
  const g = graph(p);
  const at = (x: number, y: number) => g.cellIsland[y * p.w + x]!;
  const b = g.edges.map(() => 0);
  for (const l of links) {
    const i = at(...l.a), j = at(...l.b);
    const dir = l.a[1] === l.b[1] ? (l.b[0] > l.a[0] ? 0 : 2) : (l.b[1] > l.a[1] ? 1 : 3);
    const e = g.islandEdges[i]![dir]!;
    if (e < 0 || (g.edges[e]!.a !== j && g.edges[e]!.b !== j)) throw new Error("layout link is not a grid edge");
    b[e]! += l.n;
  }
  return b;
}

/** Same geometry as `base`, island counts taken from network `b`. */
function withCounts(base: BridgesPuzzle, b: readonly number[]): BridgesPuzzle {
  const sums = islandSums(graph(base), b);
  return { ...base, islands: base.islands.map((is, i) => ({ ...is, n: sums[i]! })) };
}

/**
 * Alter the intended network on one edge the solver left open: change its count, drop it
 * (only if it sits on a cycle), or add it (only if it crosses nothing and loops are allowed).
 * The result is always a valid network for the puzzle's rules.
 */
function mutate(p: BridgesPuzzle, b: readonly number[], d: Domain, rng: Rng): number[] | null {
  const g = graph(p);
  const open = g.edges.filter((e) => d.lo[e.id] !== d.hi[e.id]).map((e) => e.id);
  rng.shuffle(open);
  const onCycle = p.loops ? new Set(cycleEdges(g, b)) : new Set<number>();
  for (const e of open) {
    const options: number[] = [];
    const cur = b[e]!;
    if (cur > 0) {
      for (let v = 1; v <= p.maxb; v++) if (v !== cur) options.push(v);
      if (onCycle.has(e)) options.push(0);
    } else if (p.loops && !g.cross[e]!.some((c) => b[c]! > 0)) {
      for (let v = 1; v <= p.maxb; v++) options.push(v);
    }
    if (!options.length) continue;
    const nb = b.slice();
    nb[e] = rng.pick(options);
    return nb;
  }
  return null;
}
