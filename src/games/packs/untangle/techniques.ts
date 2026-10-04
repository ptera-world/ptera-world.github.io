import type { Step, Technique } from "../../core/types";
import { crossings, crossingsAt, type Pt, type UntangleAction, type UntangleFocus, type UntanglePuzzle, type UntangleState } from "./logic";

type UntangleTechnique = Technique<UntanglePuzzle, UntangleState, UntangleAction>;

/** What a technique can be aimed at: a point. */
export type UntangleTarget = { point: number };

const neighbours = (p: UntanglePuzzle, v: number) => p.edges.flatMap(([a, b]) => (a === v ? [b] : b === v ? [a] : []));

function centroid(pts: readonly Pt[], list: readonly number[]): Pt | null {
  if (!list.length) return null;
  let x = 0, y = 0;
  for (const i of list) { x += pts[i]![0]; y += pts[i]![1]; }
  return [x / list.length, y / list.length];
}

/** True for a point already at its place in the known untangled arrangement; local moves leave those alone. */
const settled = (p: UntanglePuzzle, s: UntangleState, v: number) =>
  !!p.layout && Math.hypot(s.pts[v]![0] - p.layout[v]![0], s.pts[v]![1] - p.layout[v]![1]) <= 1e-9;

/** The move of one point (to one of `spots(v)`) that clears the most crossings; null if none clears any. */
function bestMove(p: UntanglePuzzle, s: UntangleState, spots: (v: number) => Pt[], only?: number): { v: number; to: Pt; gain: number } | null {
  if (!crossings(p, s.pts).length) return null;
  let best: { v: number; to: Pt; gain: number } | null = null;
  for (let v = 0; v < p.n; v++) {
    if (only !== undefined && v !== only) continue;
    if (settled(p, s, v)) continue;
    const now = crossingsAt(p, s.pts, v, s.pts[v]!);
    if (!now) continue;
    for (const to of spots(v)) {
      const gain = now - crossingsAt(p, s.pts, v, to);
      if (gain > 0 && (!best || gain > best.gain)) best = { v, to, gain };
    }
  }
  return best;
}

function step(v: number, to: Pt, message: string, nudge: string): Step<UntangleAction> {
  return {
    message,
    nudge,
    focus: { points: [v], to: [to] } satisfies UntangleFocus,
    nudgeFocus: { points: [v] } satisfies UntangleFocus,
    actions: [{ type: "move", moves: [[v, to[0], to[1]]] }],
  };
}

const plural = (n: number) => `${n} crossing${n === 1 ? "" : "s"}`;
type Finder = (p: UntanglePuzzle, s: UntangleState, only?: number) => Step<UntangleAction> | null;

function technique(def: Omit<UntangleTechnique, "find" | "findAt" | "puzzles">, find: Finder): UntangleTechnique {
  return { ...def, puzzles: ["untangle"], find: (p, s) => find(p, s), findAt: (p, s, t) => find(p, s, (t as UntangleTarget).point) };
}

export const toNeighbours = technique({
  id: "untangle.to-neighbours",
  name: "move to its neighbors",
  level: 1,
  description: "a point usually belongs among the points it's joined to. moving it to the middle of them often clears its crossings.",
}, (p, s, only) => {
  const m = bestMove(p, s, (v) => { const c = centroid(s.pts, neighbours(p, v)); return c ? [c] : []; }, only);
  return m && step(m.v, m.to, `moving the highlighted point to the middle of the points it's joined to clears ${plural(m.gain)}`, "one point is far from the points it's joined to");
});

/** Spots tried for a point: a grid over the board plus the middle of its neighbors. */
const GRID = 15;

export const bestSpot = technique({
  id: "untangle.best-spot",
  name: "best spot",
  level: 2,
  description: "try a point all over the board and put it wherever its lines cross the fewest others.",
}, (p, s, only) => {
  const spots = (v: number) => {
    const out: Pt[] = [];
    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) out.push([0.05 + (0.9 * i) / (GRID - 1), 0.05 + (0.9 * j) / (GRID - 1)]);
    const c = centroid(s.pts, neighbours(p, v));
    if (c) out.push(c);
    return out;
  };
  const m = bestMove(p, s, spots, only);
  return m && step(m.v, m.to, `the highlighted point's lines cross the least from here: that clears ${plural(m.gain)}`, "one point has a better spot");
});

export const knownLayout = technique({
  id: "untangle.known-layout",
  name: "known layout",
  level: 3,
  description: "when nothing local helps, move points one at a time to an arrangement known to have no crossings (the one the puzzle was made from).",
}, (p, s, only) => {
  if (!p.layout || !crossings(p, s.pts).length) return null;
  const layout = p.layout;
  const m = bestMove(p, s, (v) => [layout[v]!], only);
  const v = m?.v ?? Array.from({ length: p.n }, (_, i) => i).find((i) => !settled(p, s, i) && (only === undefined || i === only));
  if (v === undefined) return null;
  return step(v, layout[v]!, "the highlighted point goes here in an arrangement with no crossings", "one point has a place in an untangled arrangement");
});

export const untangleTechniques: UntangleTechnique[] = [toNeighbours, bestSpot, knownLayout];
