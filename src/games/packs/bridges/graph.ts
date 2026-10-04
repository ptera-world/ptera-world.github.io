import { cellName } from "../../core/names";

/**
 * Puzzle data and the derived island/edge graph shared by rules, solver, generator and views.
 */

export interface Island {
  x: number;
  y: number;
  /** Required bridge count, 1..4*maxb. */
  n: number;
}

export interface BridgesPuzzle {
  w: number;
  h: number;
  /** Max bridges between one pair of islands, 1..4. */
  maxb: number;
  /** Whether the finished bridge network may contain cycles. */
  loops: boolean;
  /** Row-major order (sorted by y, then x); edge ids depend on it. */
  islands: Island[];
}

/** Progress. Both arrays are indexed by edge id of `graph(puzzle)`. */
export interface BridgesState {
  /** Bridges placed on each edge, 0..maxb. */
  b: number[];
  /** 1 = player marked "no bridge here". Only set while b is 0. */
  no: number[];
}

export const MAX_BRIDGES = 4;

/** Directions: 0 right, 1 down, 2 left, 3 up. */
export const DX = [1, 0, -1, 0] as const;
export const DY = [0, 1, 0, -1] as const;
export const DIR_NAMES = ["right", "down", "left", "up"] as const;

export interface Edge {
  id: number;
  /** a is left of / above b. */
  a: number;
  b: number;
  horizontal: boolean;
  /** Empty cells strictly between a and b (cell = y*w + x). */
  cells: number[];
}

export interface Graph {
  puzzle: BridgesPuzzle;
  edges: Edge[];
  /** islandEdges[i][dir] = edge id or -1. */
  islandEdges: number[][];
  /** Edges whose paths cross this edge's path. */
  cross: number[][];
  /** Island index per cell, or -1. */
  cellIsland: Int32Array;
}

const cache = new WeakMap<BridgesPuzzle, Graph>();

/** Memoized per puzzle object. */
export function graph(p: BridgesPuzzle): Graph {
  let g = cache.get(p);
  if (!g) {
    g = buildGraph(p);
    cache.set(p, g);
  }
  return g;
}

function buildGraph(p: BridgesPuzzle): Graph {
  const { w, h } = p;
  const cellIsland = new Int32Array(w * h).fill(-1);
  p.islands.forEach((is, i) => { cellIsland[is.y * w + is.x] = i; });
  const edges: Edge[] = [];
  const islandEdges = p.islands.map(() => [-1, -1, -1, -1]);
  p.islands.forEach((is, i) => {
    for (const dir of [0, 1]) {
      const cells: number[] = [];
      let x = is.x + DX[dir]!, y = is.y + DY[dir]!;
      while (x < w && y < h && cellIsland[y * w + x]! < 0) {
        cells.push(y * w + x);
        x += DX[dir]!;
        y += DY[dir]!;
      }
      if (x >= w || y >= h) continue;
      const j = cellIsland[y * w + x]!;
      const id = edges.length;
      edges.push({ id, a: i, b: j, horizontal: dir === 0, cells });
      islandEdges[i]![dir] = id;
      islandEdges[j]![dir + 2] = id;
    }
  });
  const cross: number[][] = edges.map(() => []);
  const hAt = new Int32Array(w * h).fill(-1);
  for (const e of edges) if (e.horizontal) for (const c of e.cells) hAt[c] = e.id;
  for (const e of edges) {
    if (e.horizontal) continue;
    for (const c of e.cells) {
      const o = hAt[c]!;
      if (o >= 0) {
        cross[e.id]!.push(o);
        cross[o]!.push(e.id);
      }
    }
  }
  return { puzzle: p, edges, islandEdges, cross, cellIsland };
}

export function emptyState(p: BridgesPuzzle): BridgesState {
  const n = graph(p).edges.length;
  return { b: Array.from({ length: n }, () => 0), no: Array.from({ length: n }, () => 0) };
}

/** Islands' current bridge totals. */
export function islandSums(g: Graph, b: readonly number[]): number[] {
  const out = g.puzzle.islands.map(() => 0);
  for (const e of g.edges) {
    const v = b[e.id] ?? 0;
    out[e.a]! += v;
    out[e.b]! += v;
  }
  return out;
}

/** Connected component id per island using edges with b > 0; ids are dense from 0. */
export function components(g: Graph, b: readonly number[]): { comp: number[]; count: number } {
  const n = g.puzzle.islands.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  for (const e of g.edges) if ((b[e.id] ?? 0) > 0) parent[find(e.a)] = find(e.b);
  const ids = new Map<number, number>();
  const comp = Array.from({ length: n }, (_, i) => {
    const r = find(i);
    let id = ids.get(r);
    if (id === undefined) ids.set(r, id = ids.size);
    return id;
  });
  return { comp, count: ids.size };
}

/** Edge ids (with b > 0) that lie on some cycle of the bridge network. */
export function cycleEdges(g: Graph, b: readonly number[]): number[] {
  const n = g.puzzle.islands.length;
  const adj: [number, number][][] = Array.from({ length: n }, () => []);
  for (const e of g.edges) {
    if ((b[e.id] ?? 0) <= 0) continue;
    adj[e.a]!.push([e.b, e.id]);
    adj[e.b]!.push([e.a, e.id]);
  }
  const cut = new Set(cutEdges(n, adj));
  return g.edges.filter((e) => (b[e.id] ?? 0) > 0 && !cut.has(e.id)).map((e) => e.id);
}

/**
 * Bridges (cut edges) of an undirected multigraph given as adjacency lists of [neighbour, edgeId].
 * Parallel edges are never cuts.
 */
export function cutEdges(n: number, adj: readonly (readonly [number, number])[][]): number[] {
  const disc = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const out: number[] = [];
  let time = 0;
  for (let root = 0; root < n; root++) {
    if (disc[root]! >= 0) continue;
    // iterative DFS: stack of [node, parentEdge, nextAdjIndex]
    const stack: [number, number, number][] = [[root, -1, 0]];
    disc[root] = low[root] = time++;
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const [u, pe] = top;
      const list = adj[u]!;
      if (top[2] < list.length) {
        const [v, id] = list[top[2]++]!;
        if (id === pe) continue;
        if (disc[v]! < 0) {
          disc[v] = low[v] = time++;
          stack.push([v, id, 0]);
        } else {
          low[u] = Math.min(low[u]!, disc[v]!);
        }
      } else {
        stack.pop();
        const parent = stack[stack.length - 1];
        if (parent) {
          const p = parent[0];
          low[p] = Math.min(low[p]!, low[u]!);
          if (low[u]! > disc[p]!) out.push(pe);
        }
      }
    }
  }
  return out;
}

/** Full rule check: counts exact, no crossings, connected, acyclic when loops are off. */
export function isValidSolution(p: BridgesPuzzle, b: readonly number[]): boolean {
  const g = graph(p);
  if (b.length !== g.edges.length) return false;
  for (const e of g.edges) {
    const v = b[e.id]!;
    if (v < 0 || v > p.maxb) return false;
    if (v > 0 && g.cross[e.id]!.some((c) => b[c]! > 0)) return false;
  }
  const sums = islandSums(g, b);
  if (p.islands.some((is, i) => sums[i] !== is.n)) return false;
  if (components(g, b).count > 1) return false;
  if (!p.loops && cycleEdges(g, b).length > 0) return false;
  return true;
}

/** The island's cell name, as the board labels show it (e.g. "C5"). */
export function pos(p: BridgesPuzzle, i: number): string {
  const is = p.islands[i]!;
  return cellName(is.x, is.y);
}

export function islandName(p: BridgesPuzzle, i: number): string {
  return `the ${p.islands[i]!.n} at ${pos(p, i)}`;
}

/** Throws a player-facing Error if the puzzle is malformed. */
export function validatePuzzle(p: BridgesPuzzle): void {
  if (!Number.isInteger(p.w) || !Number.isInteger(p.h) || p.w < 1 || p.h < 1 || p.w > 60 || p.h > 60) {
    throw new Error("size must be between 1 and 60");
  }
  if (!Number.isInteger(p.maxb) || p.maxb < 1 || p.maxb > MAX_BRIDGES) throw new Error(`max bridges must be 1 to ${MAX_BRIDGES}`);
  if (p.islands.length < 1) throw new Error("no islands");
  const seen = new Set<number>();
  let prev = -1;
  for (const is of p.islands) {
    const c = is.y * p.w + is.x;
    if (is.x < 0 || is.y < 0 || is.x >= p.w || is.y >= p.h) throw new Error("island outside the grid");
    if (seen.has(c)) throw new Error("two islands in one cell");
    if (c < prev) throw new Error("islands must be in row-major order");
    if (!Number.isInteger(is.n) || is.n < 1 || is.n > 4 * p.maxb) {
      throw new Error(`the island at ${cellName(is.x, is.y)} has ${is.n}; must be 1 to ${4 * p.maxb}`);
    }
    seen.add(c);
    prev = c;
  }
}

/** Sort islands row-major; returns a new puzzle. */
export function normalize(p: BridgesPuzzle): BridgesPuzzle {
  const islands = p.islands.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  return { ...p, islands };
}
