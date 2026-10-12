import type { Step, Technique } from "../../core/types";
import { game2048, DIR_NAMES, best, canSlide, slide, tileValue, type Action2048, type Focus2048, type Puzzle2048, type Slid, type State2048 } from "./logic";

type Technique2048 = Technique<Puzzle2048, State2048, Action2048>;

// --- what a strategy reads off the board ---

export const corners = (n: number): number[] => [0, n - 1, n * (n - 1), n * n - 1];

/** A corner holding the biggest tile, or -1 (none, or an empty board). */
export function cornerHolding(n: number, grid: readonly number[]): number {
  const b = best(grid);
  return b ? corners(n).find((c) => grid[c] === b) ?? -1 : -1;
}

export const cornerName = (n: number, c: number): string => `${c < n ? "top" : "bottom"} ${c % n === 0 ? "left" : "right"}`;

/** The two slides that push toward a corner: vertical first, then horizontal. */
export const toward = (n: number, c: number): [number, number] => [c < n ? 0 : 2, c % n === 0 ? 3 : 1];

/** The two edge lines through a corner, each as cells from the corner outward. */
export function edgeLines(n: number, c: number): number[][] {
  const r = Math.floor(c / n), col = c % n;
  const dr = r === 0 ? 1 : -1, dc = col === 0 ? 1 : -1;
  return [
    Array.from({ length: n }, (_, k) => r * n + col + dc * k),
    Array.from({ length: n }, (_, k) => (r + dr * k) * n + col),
  ];
}

/** The snake from a corner: along one edge, then back along the next line in, and so on. `along` 0: the edge row first, 1: the edge column first. */
export function snakePath(n: number, c: number, along: 0 | 1): number[] {
  const r = Math.floor(c / n), col = c % n;
  const dr = r === 0 ? 1 : -1, dc = col === 0 ? 1 : -1;
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      const m = k % 2 === 0 ? j : n - 1 - j;
      out.push(along === 0 ? (r + dr * k) * n + col + dc * m : (r + dr * m) * n + col + dc * k);
    }
  }
  return out;
}

/** The longest snake from a corner holding the biggest tile whose tiles never grow along it; its cells, [] if there is none. */
export function longestSnake(n: number, grid: readonly number[]): number[] {
  const b = best(grid);
  let top: number[] = [];
  if (!b) return top;
  for (const c of corners(n)) {
    if (grid[c] !== b) continue;
    for (const along of [0, 1] as const) {
      const path = snakePath(n, c, along);
      let len = 0;
      while (len < path.length && grid[path[len]!] && (len === 0 || grid[path[len]!]! <= grid[path[len - 1]!]!)) len++;
      if (len > top.length) top = path.slice(0, len);
    }
  }
  return top;
}

/** True if the tile in corner `c` is still in that corner (or merged into there) after the slide. */
const holds = (before: readonly number[], r: Slid, c: number): boolean => r.grid[c]! >= before[c]!;

// --- steps ---

interface Look {
  n: number;
  before: readonly number[];
  d: number;
  r: Slid;
  /** The corner holding the biggest tile before the slide, or -1. */
  anchor: number;
}

interface Verdict {
  message: string;
  nudge: string;
  /** Cells the full explanation points at. */
  cells: number[];
  /** Cells the nudge points at, if any. */
  look?: number[];
  /** Higher is visited first among this technique's instances. */
  rank?: number;
}

const unique = (cells: number[]): number[] => [...new Set(cells)];
const merged = (r: Slid): number[] => unique(r.moves.filter((m) => m.merged).flatMap((m) => [m.from, m.to]));
const dirs = (ds: number[]): string => ds.map((d) => DIR_NAMES[d]).join(" or ");

/** The slides that move something, each judged by `judge`; offered best-ranked first. */
function slides(p: Puzzle2048, s: State2048, judge: (l: Look) => Verdict | null, visit: (step: Step<Action2048>) => boolean | void): void {
  const n = p.size;
  const anchor = cornerHolding(n, s.grid);
  const found: { d: number; v: Verdict }[] = [];
  for (let d = 0; d < 4; d++) {
    const r = slide(n, s.grid, d);
    if (!r.changed) continue;
    const v = judge({ n, before: s.grid, d, r, anchor });
    if (v) found.push({ d, v });
  }
  found.sort((a, b) => (b.v.rank ?? 0) - (a.v.rank ?? 0));
  for (const { d, v } of found) {
    const stop = visit({
      message: v.message,
      nudge: v.nudge,
      actions: [{ type: "slide", dir: d }],
      focus: { dir: d, cells: v.cells } satisfies Focus2048,
      nudgeFocus: { cells: v.look ?? [] } satisfies Focus2048,
    });
    if (stop) return;
  }
}

/** The slides from the corner holding the biggest tile that would pull it out, as words. */
function pulling(l: Look, s: readonly number[]): number[] {
  const out: number[] = [];
  for (let d = 0; d < 4; d++) {
    const r = slide(l.n, s, d);
    if (r.changed && !holds(s, r, l.anchor)) out.push(d);
  }
  return out;
}

export const onlyMove: Technique2048 = {
  id: "2048.only-move",
  name: "only move",
  puzzles: [game2048],
  level: 1,
  description: "when sliding just one way moves anything, that's the move.",
  instances(p, s, visit) {
    const ways = [0, 1, 2, 3].filter((d) => canSlide(p.size, s.grid, d));
    if (ways.length !== 1) return;
    const d = ways[0]!;
    const r = slide(p.size, s.grid, d);
    visit({
      message: `only sliding ${DIR_NAMES[d]} moves any tile.`,
      nudge: "which slide moves anything at all?",
      actions: [{ type: "slide", dir: d }],
      focus: { dir: d, cells: merged(r) } satisfies Focus2048,
      nudgeFocus: { dir: d } satisfies Focus2048,
    });
  },
  practice: { params: { size: 3, target: "128" } },
};

export const reachGoal: Technique2048 = {
  id: "2048.goal",
  name: "make the goal tile",
  puzzles: [game2048],
  level: 2,
  description: "when a slide merges two tiles into the goal tile, make it.",
  instances(p, s, visit) {
    if (best(s.grid) >= p.target) return;
    for (let d = 0; d < 4; d++) {
      const r = slide(p.size, s.grid, d);
      if (!r.changed || best(r.grid) < p.target) continue;
      const stop = visit({
        message: `slide ${DIR_NAMES[d]}: it makes the ${tileValue(p.target)}.`,
        nudge: `can two tiles make ${tileValue(p.target)}?`,
        actions: [{ type: "slide", dir: d }],
        focus: { dir: d, cells: merged(r) } satisfies Focus2048,
        nudgeFocus: { dir: d } satisfies Focus2048,
      });
      if (stop) return;
    }
  },
  practice: { params: { size: 3, target: "64" } },
};

export const growCorner: Technique2048 = {
  id: "2048.grow-corner",
  name: "grow the corner",
  puzzles: [game2048],
  level: 3,
  description: "when the biggest tiles can merge into a bigger one that ends up in a corner, do it. the corner is where the biggest tile lives, so every new biggest tile should be made there.",
  instances: (p, s, visit) => slides(p, s, ({ n, before, d, r }) => {
    const c = cornerHolding(n, r.grid);
    if (best(r.grid) <= best(before) || c < 0) return null;
    return {
      message: `slide ${DIR_NAMES[d]}: the biggest tiles merge into a ${tileValue(best(r.grid))} in the ${cornerName(n, c)} corner.`,
      nudge: "can the biggest tiles merge so the new biggest sits in a corner?",
      cells: unique([...merged(r), c]),
      look: unique(before.flatMap((v, i) => (v === best(before) ? [i] : []))),
    };
  }, visit),
  practice: {},
};

export const claimCorner: Technique2048 = {
  id: "2048.claim-corner",
  name: "claim a corner",
  puzzles: [game2048],
  level: 4,
  description: "the biggest tile belongs in a corner, and it stays there for the whole game. when no corner has it yet, a slide that puts it in one claims it.",
  instances: (p, s, visit) => slides(p, s, ({ n, before, d, r, anchor }) => {
    const c = cornerHolding(n, r.grid);
    if (anchor >= 0 || c < 0) return null;
    return {
      message: `no corner holds the ${tileValue(best(before))} yet. slide ${DIR_NAMES[d]}: it goes to the ${cornerName(n, c)} corner.`,
      nudge: "is the biggest tile in a corner? can a slide put it in one?",
      cells: [c],
      look: unique(before.flatMap((v, i) => (v === best(before) ? [i] : []))),
    };
  }, visit),
  practice: {},
};

export const buildSnake: Technique2048 = {
  id: "2048.snake",
  name: "build the snake",
  puzzles: [game2048],
  level: 6,
  description: "from the corner tile, keep the tiles in a chain that only gets smaller: along the edge, then back along the next line in, and so on. then the smaller tiles merge their way up the chain into the corner. a slide that makes the chain longer builds it.",
  instances: (p, s, visit) => slides(p, s, ({ n, before, d, r, anchor }) => {
    const was = longestSnake(n, before), now = longestSnake(n, r.grid);
    if (anchor < 0 || now.length <= was.length || was.length === 0) return null;
    return {
      message: `slide ${DIR_NAMES[d]}: the chain from the corner grows from ${was.length} tiles to ${now.length}, each one no bigger than the one before it.`,
      nudge: "how long is the chain of shrinking tiles from the corner? what makes it longer?",
      cells: now,
      look: was,
      rank: now.length,
    };
  }, visit),
  practice: {},
};

export const farSide: Technique2048 = {
  id: "2048.far-side",
  name: "merge on the far side",
  puzzles: [game2048],
  level: 7,
  description: "when there are merges to make, make the ones farthest from the biggest tile first: at least two lines away from the line it sits on, along the way you slide. the chain by the corner stays untouched while the far side gets cleaned up.",
  instances: (p, s, visit) => slides(p, s, ({ n, before, d, r, anchor }) => {
    if (anchor < 0 || !holds(before, r, anchor)) return null;
    const lineOf = (c: number) => (d % 2 === 0 ? c % n : Math.floor(c / n));
    const ends = r.moves.filter((m) => m.merged).map((m) => m.to);
    if (!ends.length || ends.some((c) => Math.abs(lineOf(c) - lineOf(anchor)) < 2)) return null;
    return {
      message: `slide ${DIR_NAMES[d]}: everything it merges is two or more ${d % 2 === 0 ? "columns" : "rows"} away from the ${tileValue(best(before))}, so the corner stays as it is.`,
      nudge: "which merges are far from the corner with the biggest tile?",
      cells: merged(r),
      look: [anchor],
    };
  }, visit),
  practice: {},
};

export const fullEdge: Technique2048 = {
  id: "2048.full-edge",
  name: "keep the edge full",
  puzzles: [game2048],
  level: 8,
  description: "keep a whole edge through the corner filled with tiles. a full line can't slide along itself, so the corner tile can't be pushed out of it, and sliding along that edge is safe.",
  instances: (p, s, visit) => slides(p, s, ({ n, before, d, r }) => {
    const c = cornerHolding(n, r.grid);
    if (c < 0) return null;
    const line = edgeLines(n, c).find((l) => l.every((i) => r.grid[i]));
    if (!line) return null;
    const was = edgeLines(n, c).some((l) => l.every((i) => before[i]));
    return {
      message: `slide ${DIR_NAMES[d]}: the edge from the ${cornerName(n, c)} corner ${was ? "stays full" : "is full"}, so the ${tileValue(best(r.grid))} can't be pushed out along it.`,
      nudge: "is an edge through the biggest tile's corner full? which slide keeps it that way?",
      cells: line,
      look: edgeLines(n, c).flat(),
      rank: was ? 0 : 1,
    };
  }, visit),
  practice: {},
};

export const makeRoom: Technique2048 = {
  id: "2048.make-room",
  name: "merge to make room",
  puzzles: [game2048],
  level: 9,
  description: "every merge frees a square. when a slide merges tiles and keeps the biggest tile in its corner, it buys room; the more it merges, the more room.",
  instances: (p, s, visit) => slides(p, s, ({ before, d, r, anchor }) => {
    const count = r.moves.filter((m) => m.merged).length;
    if (!count || (anchor >= 0 && !holds(before, r, anchor))) return null;
    return {
      message: `slide ${DIR_NAMES[d]}: ${count === 1 ? "one merge" : `${count} merges`}, so ${count === 1 ? "a square opens" : `${count} squares open`}${anchor >= 0 ? ` and the ${tileValue(best(before))} stays in its corner` : ""}.`,
      nudge: "which slide merges the most tiles without moving the biggest one?",
      cells: merged(r),
      look: anchor >= 0 ? [anchor] : [],
      rank: count,
    };
  }, visit),
  practice: {},
};

export const towardCorner: Technique2048 = {
  id: "2048.toward-corner",
  name: "use two directions",
  puzzles: [game2048],
  level: 10,
  description: "play with the two slides that push toward the biggest tile's corner (say down and left for the bottom left) and keep to them. a third slide is for when those two move nothing, and the one pointing away from the corner is the last resort.",
  instances: (p, s, visit) => slides(p, s, ({ n, d, anchor }) => {
    if (anchor < 0) return null;
    const pair = toward(n, anchor);
    if (!pair.includes(d)) return null;
    return {
      message: `the biggest tile is in the ${cornerName(n, anchor)} corner, so ${dirs(pair)} are the slides that push toward it. ${DIR_NAMES[d]} moves something.`,
      nudge: "where is the biggest tile? which two slides push toward it?",
      cells: [anchor],
      look: [anchor],
    };
  }, visit),
  practice: {},
};

export const keepCorner: Technique2048 = {
  id: "2048.keep-corner",
  name: "the safe third slide",
  puzzles: [game2048],
  level: 5,
  description: "when the two slides toward the corner move nothing, take a third that still keeps the biggest tile in its corner. never take one that pulls it out; the last resort is the only slide left.",
  instances: (p, s, visit) => slides(p, s, (l) => {
    const { n, before, d, r, anchor } = l;
    if (anchor < 0 || toward(n, anchor).some((t) => t === d || canSlide(n, before, t)) || !holds(before, r, anchor)) return null;
    const out = pulling(l, before);
    return {
      message: `the ${tileValue(best(before))} is in the ${cornerName(n, anchor)} corner and ${dirs(toward(n, anchor))} move nothing. slide ${DIR_NAMES[d]}: it keeps the ${tileValue(best(before))} in the corner${out.length ? `; ${dirs(out)} would pull it out` : ""}.`,
      nudge: "where is the biggest tile? which slides would move it out of its corner?",
      cells: [anchor],
      look: [anchor],
    };
  }, visit),
  practice: {},
};

export const techniques2048: Technique2048[] = [onlyMove, reachGoal, growCorner, claimCorner, keepCorner, buildSnake, farSide, fullEdge, makeRoom, towardCorner];
