import type { Step, Technique } from "../../core/types";
import { N, DIR_NAMES, best, canSlide, gameThrees, mergeable, shift, type ActionThrees, type FocusThrees, type PuzzleThrees, type Shifted, type StateThrees } from "./logic";

type TechniqueThrees = Technique<PuzzleThrees, StateThrees, ActionThrees>;

// --- what a strategy reads off the board ---

const corners = [0, N - 1, N * (N - 1), N * N - 1];

/** The tile that comes next if the board shows it (a bonus tile shows only as +), else 0. */
export const shownNext = (s: StateThrees): number => (s.bonus ? 0 : s.next);

/** The cells next to `c` along rows and columns. */
export function around(c: number): number[] {
  const x = c % N, y = Math.floor(c / N);
  return [x > 0 ? c - 1 : -1, x < N - 1 ? c + 1 : -1, y > 0 ? c - N : -1, y < N - 1 ? c + N : -1].filter((i) => i >= 0);
}

/** Pairs of neighbouring tiles that merge when slid together, as [cell, cell]. */
export function pairs(grid: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  grid.forEach((v, c) => {
    for (const o of [c + 1, c + N]) {
      if (o >= grid.length || (o === c + 1 && c % N === N - 1)) continue;
      if (mergeable(v, grid[o]!)) out.push([c, o]);
    }
  });
  return out;
}

/** The corner holding the biggest tile, or -1. */
export function cornerHolding(grid: readonly number[]): number {
  const b = best(grid);
  return b ? corners.find((c) => grid[c] === b) ?? -1 : -1;
}

export const cornerName = (c: number): string => `${c < N ? "top" : "bottom"} ${c % N === 0 ? "left" : "right"}`;

/** The snake from a corner: along one edge, then back along the next line in, and so on. `along` 0: the edge row first, 1: the edge column first. */
export function snakePath(c: number, along: 0 | 1): number[] {
  const r = Math.floor(c / N), col = c % N;
  const dr = r === 0 ? 1 : -1, dc = col === 0 ? 1 : -1;
  const out: number[] = [];
  for (let k = 0; k < N; k++) {
    for (let j = 0; j < N; j++) {
      const m = k % 2 === 0 ? j : N - 1 - j;
      out.push(along === 0 ? (r + dr * k) * N + col + dc * m : (r + dr * m) * N + col + dc * k);
    }
  }
  return out;
}

/** The longest snake from a corner holding the biggest tile whose tiles never grow along it; its cells, [] if there is none. */
export function longestSnake(grid: readonly number[]): number[] {
  const b = best(grid);
  let top: number[] = [];
  if (!b) return top;
  for (const c of corners) {
    if (grid[c] !== b) continue;
    for (const along of [0, 1] as const) {
      const path = snakePath(c, along);
      let len = 0;
      while (len < path.length && grid[path[len]!] && (len === 0 || grid[path[len]!]! <= grid[path[len - 1]!]!)) len++;
      if (len > top.length) top = path.slice(0, len);
    }
  }
  return top;
}

// --- steps ---

interface Look {
  before: readonly number[];
  state: StateThrees;
  d: number;
  r: Shifted;
}

interface Verdict {
  message: string;
  nudge: string;
  /** Cells the full explanation points at. */
  cells: number[];
  /** Cells the nudge points at, if any. */
  look?: number[];
  /** Cells the next tile can come in on, drawn with the explanation. */
  entries?: number[];
  /** Higher is visited first among this technique's instances. */
  rank?: number;
}

const unique = (cells: number[]): number[] => [...new Set(cells)];

/** The slides that move something, each judged by `judge`; offered best-ranked first. */
function slides(s: StateThrees, judge: (l: Look) => Verdict | null, visit: (step: Step<ActionThrees>) => boolean | void): void {
  const found: { d: number; v: Verdict }[] = [];
  for (let d = 0; d < 4; d++) {
    const r = shift(N, s.grid, d);
    if (!r.changed) continue;
    const v = judge({ before: s.grid, state: s, d, r });
    if (v) found.push({ d, v });
  }
  found.sort((a, b) => (b.v.rank ?? 0) - (a.v.rank ?? 0));
  for (const { d, v } of found) {
    const stop = visit({
      message: v.message,
      nudge: v.nudge,
      actions: [{ type: "slide", dir: d }],
      focus: { dir: d, cells: v.cells, entries: v.entries } satisfies FocusThrees,
      nudgeFocus: { cells: v.look ?? [] } satisfies FocusThrees,
    });
    if (stop) return;
  }
}

/** Merges of a slide, each as the two tiles that meet and the cells they meet on. */
function merges(before: readonly number[], r: Shifted): { a: number; b: number; cells: number[] }[] {
  return r.moves.filter((m) => m.merged).map((m) => ({ a: before[m.from]!, b: before[m.to]!, cells: [m.from, m.to] }));
}

export const onlyMove: TechniqueThrees = {
  id: "threes.only-move",
  name: "only move",
  puzzles: [gameThrees],
  level: 1,
  description: "when sliding just one way moves anything, that's the move.",
  instances(p, s, visit) {
    const ways = [0, 1, 2, 3].filter((d) => canSlide(N, s.grid, d));
    if (ways.length !== 1) return;
    const d = ways[0]!;
    visit({
      message: `only sliding ${DIR_NAMES[d]} moves any tile.`,
      nudge: "which slide moves anything at all?",
      actions: [{ type: "slide", dir: d }],
      focus: { dir: d } satisfies FocusThrees,
      nudgeFocus: { dir: d } satisfies FocusThrees,
    });
  },
  practice: false,
};

export const makeThree: TechniqueThrees = {
  id: "threes.make-three",
  name: "make a three",
  puzzles: [gameThrees],
  level: 2,
  description: "a 1 and a 2 are worth nothing on their own, and the only thing that merges with a 1 is a 2. when a slide pushes a 1 into a 2 (or a 2 into a 1), it makes a 3.",
  instances: (p, s, visit) => slides(s, ({ before, d, r }) => {
    const hit = merges(before, r).filter((m) => m.a + m.b === 3);
    if (!hit.length) return null;
    return {
      message: `slide ${DIR_NAMES[d]}: ${hit.length === 1 ? "a 1 meets a 2 and they" : `${hit.length} pairs of 1 and 2 meet and`} make ${hit.length === 1 ? "a 3" : "3s"}.`,
      nudge: "is a 1 next to a 2 in a line? which slide pushes them together?",
      cells: unique(hit.flatMap((m) => m.cells)),
      rank: hit.length,
    };
  }, visit),
};

export const mergeTwins: TechniqueThrees = {
  id: "threes.merge-twins",
  name: "merge twins",
  puzzles: [gameThrees],
  level: 3,
  description: "from 3 up, two equal tiles that meet merge into their double. take the biggest merge on offer: it is worth the most and clears the most room.",
  instances: (p, s, visit) => slides(s, ({ before, d, r }) => {
    const hit = merges(before, r).filter((m) => m.a >= 3 && m.a === m.b);
    if (!hit.length) return null;
    const top = Math.max(...hit.map((m) => m.a));
    return {
      message: `slide ${DIR_NAMES[d]}: ${hit.length === 1 ? `two ${top}s meet and make a ${top * 2}` : `${hit.length} pairs of twins merge, the biggest two ${top}s into a ${top * 2}`}.`,
      nudge: "are two equal tiles, 3 or bigger, next to each other in a line? which slide pushes them together?",
      cells: unique(hit.flatMap((m) => m.cells)),
      rank: top * 100 + hit.length,
    };
  }, visit),
};

export const feedNext: TechniqueThrees = {
  id: "threes.feed-next",
  name: "feed the next tile",
  puzzles: [gameThrees],
  level: 4,
  description: "the tile that comes in next is shown above the board, and it comes in at the edge you slide away from, on a line that moved. when every place it can land is right next to a tile it merges with, the slide sets up a merge for free.",
  instances: (p, s, visit) => {
    const v = shownNext(s);
    if (!v) return;
    slides(s, ({ d, r }) => {
      const partners = r.entries.map((e) => around(e).filter((o) => mergeable(r.grid[o]!, v)));
      if (partners.some((o) => !o.length)) return null;
      const one = r.entries.length === 1;
      return {
        message: `the next tile is a ${v}. slide ${DIR_NAMES[d]}: it comes in ${one ? "on the one line that moves" : "on one of the lines that move"}, and ${one ? "that spot is" : "every spot it can land on is"} next to a tile it merges with.`,
        nudge: "look at the next tile. where could it land after a slide, and what is next to those spots?",
        cells: unique([...r.entries, ...partners.flat()]),
        look: [],
        entries: r.entries,
      };
    }, visit);
  },
};

export const ladder: TechniqueThrees = {
  id: "threes.ladder",
  name: "build the ladder",
  puzzles: [gameThrees],
  level: 5,
  description: "from the biggest tile in a corner, keep the tiles in a chain that only gets smaller: along the edge, then back along the next line in. then the small tiles merge their way up the chain. a slide that makes the chain longer builds it.",
  instances: (p, s, visit) => slides(s, ({ before, d, r }) => {
    const was = longestSnake(before), now = longestSnake(r.grid);
    if (!was.length || now.length <= was.length) return null;
    return {
      message: `slide ${DIR_NAMES[d]}: the chain from the corner grows from ${was.length} tiles to ${now.length}, each one no bigger than the one before it.`,
      nudge: "how long is the chain of shrinking tiles from the biggest tile's corner? what makes it longer?",
      cells: now,
      look: was,
      rank: now.length,
    };
  }, visit),
};

export const lineUp: TechniqueThrees = {
  id: "threes.line-up",
  name: "line up a pair",
  puzzles: [gameThrees],
  level: 6,
  description: "when nothing merges yet, set it up: a slide that leaves a 1 beside a 2, or two equal tiles (3 or bigger) side by side, means the next slide along them merges. more pairs lined up is better.",
  instances: (p, s, visit) => slides(s, ({ before, d, r }) => {
    const was = pairs(before), now = pairs(r.grid);
    if (now.length <= was.length) return null;
    const had = new Set(was.map((q) => `${q}`));
    const fresh = now.filter((q) => !had.has(`${q}`));
    return {
      message: `slide ${DIR_NAMES[d]}: ${now.length === 1 ? "it leaves a pair" : `it leaves ${now.length} pairs`} side by side that merge on the next slide along them.`,
      nudge: "which tiles would merge if they were side by side? which slide brings them together?",
      cells: unique(fresh.flat()),
      rank: now.length - was.length,
    };
  }, visit),
};

export const cornerIt: TechniqueThrees = {
  id: "threes.corner",
  name: "keep the biggest in a corner",
  puzzles: [gameThrees],
  level: 7,
  description: "the biggest tile belongs in a corner: it can't be hemmed in there and everything else builds toward it. a slide that leaves it in a corner (or puts it in one) is good; one that drags it out is not.",
  instances: (p, s, visit) => slides(s, ({ before, d, r }) => {
    const c = cornerHolding(r.grid);
    if (c < 0 || best(r.grid) < 3) return null;
    const was = cornerHolding(before) >= 0;
    return {
      message: `slide ${DIR_NAMES[d]}: the ${best(r.grid)} ${was ? "stays" : "goes"} in the ${cornerName(c)} corner.`,
      nudge: "where is the biggest tile? is it in a corner?",
      cells: [c],
      look: before.flatMap((v, i) => (v === best(before) ? [i] : [])),
    };
  }, visit),
};

export const techniquesThrees: TechniqueThrees[] = [onlyMove, makeThree, mergeTwins, feedNext, ladder, lineUp, cornerIt];
