import { SOLIDS, faceOf } from "./geometry";
import { arena, roll, type CubePuzzle, type CubeState } from "./logic";

type Core = Pick<CubeState, "square" | "key" | "faces" | "blue">;

export interface Route {
  /** Squares to roll onto, in order. */
  squares: number[];
  /** The blue square picked up at the end (or -1 for a full solve). */
  target: number;
}

/**
 * Fewest rolls to pick up a blue square without setting any blue face down on a plain square
 * on the way; null if every route would have to.
 */
export function pickUp(p: CubePuzzle, s: Core): Route | null {
  const a = arena(p);
  const solid = SOLIDS[p.solid];
  const id = (sq: number, key: readonly number[]) => `${sq}:${key.join(",")}`;
  const prev = new Map<string, { from: string; to: number } | null>([[id(s.square, s.key), null]]);
  let frontier: { sq: number; key: number[]; id: string }[] = [{ sq: s.square, key: s.key, id: id(s.square, s.key) }];
  while (frontier.length) {
    const next: typeof frontier = [];
    for (const node of frontier) {
      for (const link of a.links[node.sq]!) {
        const r = roll(p, { ...s, square: node.sq, key: node.key }, link.to);
        if (!r) continue;
        const face = s.faces[faceOf(solid, r.key)]!, square = s.blue[link.to]!;
        if (face && !square) continue;
        const nid = id(link.to, r.key);
        if (prev.has(nid)) continue;
        prev.set(nid, { from: node.id, to: link.to });
        if (!face && square) {
          const squares: number[] = [];
          for (let e = prev.get(nid); e; e = prev.get(e.from)) squares.unshift(e.to);
          return { squares, target: link.to };
        }
        next.push({ sq: link.to, key: r.key, id: nid });
      }
    }
    frontier = next;
  }
  return null;
}

const BUDGET = 150_000;
const WEIGHT = 12;

/** A whole route to all faces blue (weighted best-first on the blue squares left), or null within the budget. */
export function fullRoute(p: CubePuzzle, s: Core, budget = BUDGET): Route | null {
  const a = arena(p);
  const key = (c: Core) => `${c.square}:${c.key.join(",")}:${c.faces.join("")}:${c.blue.join("")}`;
  const left = (c: Core) => c.blue.reduce((x, y) => x + y, 0);
  const start = key(s);
  const prev = new Map<string, { from: string; to: number } | null>([[start, null]]);
  const cost = new Map<string, number>([[start, 0]]);
  const heap: { f: number; k: string; c: Core }[] = [];
  const push = (item: { f: number; k: string; c: Core }) => {
    heap.push(item);
    for (let i = heap.length - 1; i > 0;) {
      const up = (i - 1) >> 1;
      if (heap[up]!.f <= heap[i]!.f) break;
      [heap[up], heap[i]] = [heap[i]!, heap[up]!];
      i = up;
    }
  };
  const pop = () => {
    const top = heap[0]!, last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]!.f < heap[m]!.f) m = l;
        if (r < heap.length && heap[r]!.f < heap[m]!.f) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };
  push({ f: 0, k: start, c: s });
  let nodes = 0;
  while (heap.length) {
    const { k, c } = pop();
    if (c.faces.every(Boolean)) {
      const squares: number[] = [];
      for (let e = prev.get(k); e; e = prev.get(e.from)) squares.unshift(e.to);
      return { squares, target: -1 };
    }
    if (++nodes > budget) return null;
    const g = cost.get(k)!;
    for (const link of a.links[c.square]!) {
      const r = roll(p, c, link.to);
      if (!r) continue;
      const nk = key(r);
      const ng = g + 1;
      if ((cost.get(nk) ?? Infinity) <= ng) continue;
      cost.set(nk, ng);
      prev.set(nk, { from: k, to: link.to });
      push({ f: ng + WEIGHT * left(r), k: nk, c: r });
    }
  }
  return null;
}

export interface Plan {
  route: Route;
  /** The first roll sets a blue face down on a plain square. */
  drops: boolean;
  /** The route finishes the puzzle (else it only fetches one square). */
  whole: boolean;
}

const QUICK = 30_000;
const plans = new WeakMap<readonly number[], { faces: readonly number[]; square: number; plan: Plan | null }>();

/** A whole route when a quick search finds one, else the nearest safe fetch. Cached per state. */
export function plan(p: CubePuzzle, s: Core): Plan | null {
  const hit = plans.get(s.blue);
  if (hit && hit.faces === s.faces && hit.square === s.square) return hit.plan;
  let result: Plan | null = null;
  const whole = fullRoute(p, s, QUICK) ?? (pickUp(p, s) ? null : fullRoute(p, s));
  const route = whole ?? pickUp(p, s);
  if (route?.squares.length) {
    const first = roll(p, s, route.squares[0]!)!;
    const solid = SOLIDS[p.solid];
    const drops = !!s.faces[faceOf(solid, first.key)] && !s.blue[route.squares[0]!];
    result = { route, drops, whole: !!whole };
  }
  plans.set(s.blue, { faces: s.faces, square: s.square, plan: result });
  return result;
}
