import type { Step, Technique } from "../../core/types";
import { DIR_NAMES, best, canSlide, slide, tileValue, type Action2048, type Focus2048, type Puzzle2048, type State2048 } from "./logic";

type Technique2048 = Technique<Puzzle2048, State2048, Action2048>;

const corners = (n: number) => [0, n - 1, n * (n - 1), n * n - 1];

/** How good a board looks: empty cells, rows and columns that run in order, neighbours that match, the biggest tile in a corner. */
export function evaluate(n: number, g: readonly number[]): number {
  let empty = 0, smooth = 0, mono = 0;
  for (let c = 0; c < g.length; c++) {
    const v = g[c]!;
    if (!v) { empty++; continue; }
    const x = c % n, y = Math.floor(c / n);
    if (x + 1 < n && g[c + 1]) smooth -= Math.abs(v - g[c + 1]!);
    if (y + 1 < n && g[c + n]) smooth -= Math.abs(v - g[c + n]!);
  }
  for (let i = 0; i < n; i++) {
    let incR = 0, decR = 0, incC = 0, decC = 0;
    for (let k = 0; k + 1 < n; k++) {
      const a = g[i * n + k]!, b = g[i * n + k + 1]!;
      if (a > b) decR += b - a; else incR += a - b;
      const c = g[k * n + i]!, d = g[(k + 1) * n + i]!;
      if (c > d) decC += d - c; else incC += c - d;
    }
    mono += Math.max(incR, decR) + Math.max(incC, decC);
  }
  const top = best(g);
  const cornered = corners(n).some((c) => g[c] === top) ? top : 0;
  return 2.7 * Math.log(empty + 1) * 10 + mono + 0.1 * smooth + cornered;
}

const LOST = -1e6;

/** Expected value of a board after the move, averaged over where the new tile lands. */
function chance(n: number, g: readonly number[], depth: number): number {
  if (depth <= 0) return evaluate(n, g);
  const empty = g.flatMap((v, c) => (v ? [] : [c]));
  if (!empty.length) return evaluate(n, g);
  let sum = 0;
  for (const c of empty) {
    for (const [v, w] of [[1, 0.9], [2, 0.1]] as const) {
      const next = g.slice();
      next[c] = v;
      sum += w * moveValue(n, next, depth - 1);
    }
  }
  return sum / empty.length;
}

function moveValue(n: number, g: readonly number[], depth: number): number {
  let top = LOST;
  for (let d = 0; d < 4; d++) {
    const r = slide(n, g, d);
    if (r.changed) top = Math.max(top, chance(n, r.grid, depth));
  }
  return top === LOST ? evaluate(n, g) + LOST / 10 : top;
}

/** How far to look: further on small or crowded boards, where each step has fewer branches. */
const depthFor = (n: number, g: readonly number[]) => {
  const empty = g.filter((v) => !v).length;
  return n > 4 ? 1 : empty <= 4 ? 3 : 2;
};

/** Each direction's value looking `depth` moves ahead (null where nothing moves). */
export function valuesOf(n: number, g: readonly number[], depth = depthFor(n, g)): (number | null)[] {
  return [0, 1, 2, 3].map((d) => {
    const r = slide(n, g, d);
    return r.changed ? chance(n, r.grid, depth) : null;
  });
}

const valueCache = new WeakMap<State2048, (number | null)[]>();
const values = (p: Puzzle2048, s: State2048) => {
  let v = valueCache.get(s);
  if (!v) valueCache.set(s, (v = valuesOf(p.size, s.grid)));
  return v;
};

function mergedText(p: Puzzle2048, s: State2048, d: number): string {
  const r = slide(p.size, s.grid, d);
  const made = r.moves.filter((m) => m.merged).map((m) => tileValue(r.grid[m.to]!) / 2);
  if (!made.length) return "";
  const names = [...new Set(made)].sort((a, b) => b - a).map((v) => `${v}s`);
  return `merges ${names.length === 1 ? `two ${names[0]}` : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`}`;
}

function step(p: Puzzle2048, s: State2048, d: number, message: string, nudge: string): Step<Action2048> {
  const r = slide(p.size, s.grid, d);
  const cells = r.moves.filter((m) => m.merged).flatMap((m) => [m.from, m.to]);
  return { message, nudge, actions: [{ type: "slide", dir: d }], focus: { dir: d, cells: [...new Set(cells)] } satisfies Focus2048, nudgeFocus: { dir: d } satisfies Focus2048 };
}

export const onlyMove: Technique2048 = {
  id: "2048.only-move",
  name: "only move",
  puzzles: ["2048"],
  level: 1,
  description: "when sliding just one way moves anything, that's the move.",
  find(p, s) {
    const ways = [0, 1, 2, 3].filter((d) => canSlide(p.size, s.grid, d));
    if (ways.length !== 1) return null;
    const d = ways[0]!;
    return step(p, s, d, `only sliding ${DIR_NAMES[d]} moves any tile.`, "which slide moves anything at all?");
  },
  practice: false,
};

export const reachGoal: Technique2048 = {
  id: "2048.goal",
  name: "make the goal tile",
  puzzles: ["2048"],
  level: 2,
  description: "when a slide merges two tiles into the goal tile, make it.",
  find(p, s) {
    if (best(s.grid) >= p.target) return null;
    for (let d = 0; d < 4; d++) {
      const r = slide(p.size, s.grid, d);
      if (r.changed && best(r.grid) >= p.target) return step(p, s, d, `slide ${DIR_NAMES[d]}: it makes the ${tileValue(p.target)}.`, `can two tiles make ${tileValue(p.target)}?`);
    }
    return null;
  },
  practice: false,
};

export const lookAhead: Technique2048 = {
  id: "2048.look-ahead",
  name: "look ahead",
  puzzles: ["2048"],
  level: 3,
  description: "try each slide, then every place the next tile could appear and your best reply to it, and average. a good board keeps its biggest tile in a corner, its rows and columns in order, and plenty of empty cells.",
  find(p, s) {
    const v = values(p, s);
    const order = [0, 1, 2, 3].filter((d) => v[d] !== null).sort((a, b) => v[b]! - v[a]! || a - b);
    const d = order[0];
    if (d === undefined) return null;
    const n = p.size;
    const after = slide(n, s.grid, d).grid;
    const top = best(s.grid);
    const inCorner = (g: readonly number[]) => corners(n).some((c) => g[c] === top);
    const reasons: string[] = [];
    const merged = mergedText(p, s, d);
    if (merged) reasons.push(merged);
    if (inCorner(s.grid) && inCorner(after)) reasons.push(`keeps the ${tileValue(top)} in its corner`);
    const empty = after.filter((x) => !x).length;
    reasons.push(`leaves ${empty} ${empty === 1 ? "cell" : "cells"} empty before the new tile`);
    const pulled = order.slice(1).filter((o) => inCorner(s.grid) && !inCorner(slide(n, s.grid, o).grid));
    const contrast = pulled.length ? ` sliding ${pulled.map((o) => DIR_NAMES[o]).join(" or ")} would pull the ${tileValue(top)} out of its corner.` : "";
    return step(p, s, d, `slide ${DIR_NAMES[d]}: it ${reasons.join(", ")}, and looking ahead it does best on average.${contrast}`, "which slide keeps the board tidy?");
  },
  practice: false,
};

export const techniques2048: Technique2048[] = [onlyMove, reachGoal, lookAhead];
