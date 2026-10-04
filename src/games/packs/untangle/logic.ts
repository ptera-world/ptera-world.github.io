import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, PuzzleDef } from "../../core/types";

export const params = defineSchema({
  points: { type: "int", label: "points", default: 10, min: 4, max: 60 },
});

export type Pt = readonly [number, number];

export interface UntanglePuzzle {
  n: number;
  /** Lines between points, each as [a, b] with a < b, sorted. */
  edges: [number, number][];
  /** An arrangement with no crossings, in the unit square, when one is known. */
  layout: Pt[] | null;
}

export interface UntangleState {
  /** Point positions in the unit square. */
  pts: Pt[];
}

export type UntangleAction = { type: "move"; moves: [number, number, number][] };

export interface UntangleInteraction {
  /** Point selected for the keyboard, or -1. */
  selected: number;
}

/** The starting arrangement: evenly round a circle, point 0 at the top, going clockwise. */
export function circle(n: number): Pt[] {
  const r = 3 / 7;
  return Array.from({ length: n }, (_, i) => {
    const a = (i * 2 * Math.PI) / n;
    return [0.5 + r * Math.sin(a), 0.5 - r * Math.cos(a)] as const;
  });
}

const sign = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v > 0 ? 1 : -1);

/** True if segments a1-a2 and b1-b2 meet: crossing, touching, or overlapping along a line. */
export function cross(a1: Pt, a2: Pt, b1: Pt, b2: Pt): boolean {
  const side = (p: Pt, q: Pt, r: Pt) => sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const d1 = side(a1, a2, b1), d2 = side(a1, a2, b2);
  if (d1 !== 0 && d1 === d2) return false;
  if (d1 === 0 && d2 === 0) {
    const along = (p: Pt) => (p[0] - a1[0]) * (a2[0] - a1[0]) + (p[1] - a1[1]) * (a2[1] - a1[1]);
    const len = along(a2);
    const t1 = along(b1), t2 = along(b2);
    if ((t1 < 0 && t2 < 0) || (t1 > len && t2 > len)) return false;
    return true;
  }
  const d3 = side(b1, b2, a1), d4 = side(b1, b2, a2);
  return !(d3 !== 0 && d3 === d4);
}

/** Pairs of lines (by index into edges) that cross, ignoring lines that share a point. */
export function crossings(p: UntanglePuzzle, pts: readonly Pt[]): [number, number][] {
  const out: [number, number][] = [];
  const E = p.edges;
  for (let i = 0; i < E.length; i++) {
    const [a, b] = E[i]!;
    for (let j = i + 1; j < E.length; j++) {
      const [c, d] = E[j]!;
      if (a === c || a === d || b === c || b === d) continue;
      if (cross(pts[a]!, pts[b]!, pts[c]!, pts[d]!)) out.push([i, j]);
    }
  }
  return out;
}

/** How many crossings involve a line at point v, with v moved to `at`. */
export function crossingsAt(p: UntanglePuzzle, pts: readonly Pt[], v: number, at: Pt): number {
  let count = 0;
  const pos = (i: number) => (i === v ? at : pts[i]!);
  for (const [a, b] of p.edges) {
    if (a !== v && b !== v) continue;
    for (const [c, d] of p.edges) {
      if (c === v || d === v || a === c || a === d || b === c || b === d) continue;
      if (cross(pos(a), pos(b), pos(c), pos(d))) count++;
    }
  }
  return count;
}

export const isSolved = (p: UntanglePuzzle, s: UntangleState): boolean => crossings(p, s.pts).length === 0;

export function reduce(p: UntanglePuzzle, s: UntangleState, a: UntangleAction): UntangleState {
  if (a.type !== "move") return s;
  let pts: Pt[] | null = null;
  for (const [i, x, y] of a.moves) {
    if (!(i >= 0 && i < p.n) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const cx = Math.min(1, Math.max(0, x)), cy = Math.min(1, Math.max(0, y));
    if (s.pts[i]![0] === cx && s.pts[i]![1] === cy) continue;
    pts ??= s.pts.slice();
    pts[i] = [cx, cy];
  }
  return pts ? { pts } : s;
}

// --- generation ---

const MAX_DEGREE = 4;
/** Points take up about one grid spot in this many. */
const DENSITY = 3;

/**
 * A planar graph as in the original: points on random spots of a grid, then lines added one at a
 * time from the lowest-degree point to its nearest point that keeps every degree at most 4, crosses
 * no line and passes through no point; then the points are renumbered at random until the circle
 * arrangement has a crossing (giving up after 200 tries, for graphs too small to tangle).
 */
function generate(v: Values<typeof params>, rng: Rng): UntanglePuzzle {
  const n = v.points;
  const g = Math.max(2, Math.floor(Math.sqrt(n * DENSITY)));
  const spots = rng.shuffle(Array.from({ length: g * g }, (_, i) => i)).slice(0, n);
  const grid: Pt[] = spots.map((s) => [s % g, Math.floor(s / g)] as const);
  const deg = Array.from({ length: n }, () => 0);
  const edges: [number, number][] = [];
  const has = new Set<string>();
  for (;;) {
    let added = false;
    const byDegree = Array.from({ length: n }, (_, i) => i).sort((a, b) => deg[a]! - deg[b]! || a - b);
    for (let i = 0; i < n && !added; i++) {
      const j = byDegree[i]!;
      if (deg[j]! >= MAX_DEGREE) break;
      const cands = byDegree.slice(i + 1).filter((k) => deg[k]! < MAX_DEGREE && !has.has(`${Math.min(j, k)}-${Math.max(j, k)}`))
        .sort((a, b) => {
          const da = (grid[a]![0] - grid[j]![0]) ** 2 + (grid[a]![1] - grid[j]![1]) ** 2;
          const db = (grid[b]![0] - grid[j]![0]) ** 2 + (grid[b]![1] - grid[j]![1]) ** 2;
          return da - db || a - b;
        });
      for (const k of cands) {
        if (grid.some((pt, q) => q !== j && q !== k && cross(grid[j]!, grid[k]!, pt, pt))) continue;
        if (edges.some(([a, b]) => a !== j && a !== k && b !== j && b !== k && cross(grid[j]!, grid[k]!, grid[a]!, grid[b]!))) continue;
        edges.push([j, k]);
        has.add(`${Math.min(j, k)}-${Math.max(j, k)}`);
        deg[j]!++;
        deg[k]!++;
        added = true;
        break;
      }
    }
    if (!added) break;
  }
  const ring = circle(n);
  for (let tries = 0; ; tries++) {
    const map = rng.shuffle(Array.from({ length: n }, (_, i) => i));
    const mapped = edges.map(([a, b]) => [Math.min(map[a]!, map[b]!), Math.max(map[a]!, map[b]!)] as [number, number]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const p: UntanglePuzzle = { n, edges: mapped, layout: null };
    if (crossings(p, ring).length === 0 && tries < 200) continue;
    const layout: Pt[] = Array.from({ length: n }, () => [0, 0] as const);
    grid.forEach(([x, y], i) => { layout[map[i]!] = [(x + 0.5) / g, (y + 0.5) / g]; });
    return { ...p, layout };
  }
}

// --- formats ---

const SGT_RE = /^(\d+)[^:]*:((?:\d+-\d+,?)*)$/;

/** Simon Tatham's Untangle game id: `N:a-b,c-d,…`, the lines between numbered points. */
export const sgtFormat: Format<UntanglePuzzle> = {
  id: "sgt",
  label: "game id (N:a-b,…)",
  detect: (t) => SGT_RE.test(t.trim()),
  parse(t) {
    const m = SGT_RE.exec(t.trim());
    if (!m) throw new Error("expected N:a-b,c-d,…");
    const n = Number(m[1]);
    if (!(n >= 2 && n <= 500)) throw new Error("there must be between 2 and 500 points");
    const seen = new Set<string>();
    const edges: [number, number][] = [];
    for (const part of m[2]!.split(",").filter(Boolean)) {
      const [a, b] = part.split("-").map(Number) as [number, number];
      if (a >= n || b >= n) throw new Error(`point ${Math.max(a, b)} doesn't exist`);
      if (a === b) throw new Error(`point ${a} is joined to itself`);
      const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([Math.min(a, b), Math.max(a, b)]);
    }
    edges.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    return { n, edges, layout: null };
  },
  serialize: (p) => `${p.n}:${p.edges.map(([a, b]) => `${a}-${b}`).join(",")}`,
};

/** Focus payload understood by the untangle view: points, and where to put them. */
export interface UntangleFocus {
  points: number[];
  to?: Pt[];
}

export const untangle: PuzzleDef<UntanglePuzzle, UntangleState, UntangleAction, UntangleInteraction, typeof params> = {
  id: "untangle",
  name: "untangle",
  aliases: ["planarity", "untangle", "tangle"],
  tags: ["graph", "dexterity"],
  description: "move the points around until none of the lines between them cross.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "6 points", params: { points: 6 } },
    { label: "10 points", params: { points: 10 } },
    { label: "15 points", params: { points: 15 } },
    { label: "20 points", params: { points: 20 } },
    { label: "25 points", params: { points: 25 } },
  ],
  generate,
  formats: [sgtFormat],
  init: (p) => ({ pts: circle(p.n) }),
  initInteraction: () => ({ selected: -1 }),
  reduce,
  isSolved,
  rules: () => [
    "drag the points anywhere you like. the lines stay attached to their points.",
    "the puzzle is done when no two lines cross (or touch, other than at a point they share).",
  ],
  solve: (p) => (p.layout ? { pts: p.layout.slice() } : null),
  describe: (p) => `${p.n} points`,
  rate: (p) => ({ label: `${p.edges.length} lines`, score: p.edges.length }),
};
