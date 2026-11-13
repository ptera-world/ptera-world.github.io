import type { Step, Technique } from "../../core/types";
import { BLOCK, DIR_NAMES, best, canSlide, gameMerge, landing, mergeOf, move, type ActionMerge, type FocusMerge, type Moved, type PuzzleMerge, type StateMerge } from "./logic";
import { expected, weighSlides } from "./weigh";

type TechniqueMerge = Technique<PuzzleMerge, StateMerge, ActionMerge>;

// --- what a strategy reads off the board ---

export const corners = (n: number): number[] => [0, n - 1, n * (n - 1), n * n - 1];

/** A corner holding the biggest tile, or -1 (none, or an empty board). */
export function cornerHolding(n: number, grid: readonly number[]): number {
  const b = best(grid);
  return b > 0 ? corners(n).find((c) => grid[c] === b) ?? -1 : -1;
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
  if (b <= 0) return top;
  for (const c of corners(n)) {
    if (grid[c] !== b) continue;
    for (const along of [0, 1] as const) {
      const path = snakePath(n, c, along);
      let len = 0;
      while (len < path.length && grid[path[len]!]! > 0 && (len === 0 || grid[path[len]!]! <= grid[path[len - 1]!]!)) len++;
      if (len > top.length) top = path.slice(0, len);
    }
  }
  return top;
}

const steps = (n: number, a: number, b: number): number => Math.abs(Math.floor(a / n) - Math.floor(b / n)) + Math.abs((a % n) - (b % n));

/** How far the nearest biggest tile is from its nearest corner, in steps along rows and columns. */
export function cornerDistance(n: number, grid: readonly number[]): number {
  const b = best(grid);
  let out = Infinity;
  grid.forEach((v, c) => {
    if (v !== b || b <= 0) return;
    for (const k of corners(n)) out = Math.min(out, steps(n, c, k));
  });
  return out;
}

/** The corner a biggest tile is in, else the corner nearest to one. */
export function aimCorner(n: number, grid: readonly number[]): number {
  const home = cornerHolding(n, grid);
  if (home >= 0) return home;
  const b = best(grid);
  let top = -1, dist = Infinity;
  grid.forEach((v, c) => {
    if (v !== b || b <= 0) return;
    for (const k of corners(n)) {
      const d = steps(n, c, k);
      if (d < dist) { dist = d; top = k; }
    }
  });
  return top;
}

/** The cells next to `c` along rows and columns. */
export function around(n: number, c: number): number[] {
  const x = c % n, y = Math.floor(c / n);
  return [x > 0 ? c - 1 : -1, x < n - 1 ? c + 1 : -1, y > 0 ? c - n : -1, y < n - 1 ? c + n : -1].filter((i) => i >= 0);
}

/** Pairs of neighbouring tiles that merge when slid together, as [cell, cell]. */
export function pairs(p: PuzzleMerge, grid: readonly number[]): [number, number][] {
  const m = mergeOf(p), n = p.size;
  const out: [number, number][] = [];
  grid.forEach((v, c) => {
    for (const o of [c + 1, c + n]) {
      if (o >= grid.length || (o === c + 1 && c % n === n - 1)) continue;
      if (m.merge(v, grid[o]!)) out.push([c, o]);
    }
  });
  return out;
}

/** The tile that comes next if the board shows it (a bonus tile shows only as +), else 0. */
export const shownNext = (p: PuzzleMerge, s: StateMerge): number => (p.rules.preview && !s.bonus ? s.next : 0);

/** True if the tile in corner `c` is still in that corner (or merged into there) after the slide. */
const holds = (before: readonly number[], r: Moved, c: number): boolean => r.grid[c]! >= before[c]!;

const unique = (cells: number[]): number[] => [...new Set(cells)];
const merged = (r: Moved): number[] => unique(r.moves.filter((m) => m.merged).flatMap((m) => [m.from, m.to]));
const biggest = (grid: readonly number[]): number[] => grid.flatMap((v, i) => (v === best(grid) && v > 0 ? [i] : []));
const dirs = (ds: number[]): string => ds.map((d) => DIR_NAMES[d]).join(" or ");
const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** Merges of a slide, each as the two tiles that meet, what they make, and the cells they meet on. */
function merges(before: readonly number[], r: Moved): { a: number; b: number; made: number; cells: number[] }[] {
  return r.moves.filter((m) => m.merged).map((m) => ({ a: before[m.from]!, b: before[m.to]!, made: r.grid[m.to]!, cells: [m.from, m.to] }));
}

// --- steps ---

interface Look {
  p: PuzzleMerge;
  s: StateMerge;
  n: number;
  before: readonly number[];
  d: number;
  r: Moved;
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
  /** Cells the next tile can land on, drawn with the explanation. */
  entries?: number[];
}

/**
 * The slide that weighs best (see weigh.ts) when `judge` finds this strategy in it. Every
 * strategy names a reason for that one slide, so a strategy never advises a slide that leaves the
 * board worse than another would, and auto play with any set of strategies plays as well as the
 * weighing does.
 */
function bestIf(p: PuzzleMerge, s: StateMerge, judge: (l: Look) => Verdict | null, visit: (step: Step<ActionMerge>) => boolean | void): void {
  const top = weighSlides(p, s)[0];
  if (!top) return;
  const n = p.size;
  const v = judge({ p, s, n, before: s.grid, d: top.dir, r: top.r, anchor: cornerHolding(n, s.grid) });
  if (!v) return;
  visit({
    message: v.message,
    nudge: v.nudge,
    actions: [{ type: "slide", dir: top.dir }],
    focus: { dir: top.dir, cells: v.cells, entries: v.entries } satisfies FocusMerge,
    nudgeFocus: { cells: v.look ?? [] } satisfies FocusMerge,
  });
}

export const onlyMove: TechniqueMerge = {
  id: "sliding-merge.only-move",
  name: "only move",
  puzzles: [gameMerge],
  level: 1,
  description: "when sliding just one way moves anything, that's the move.",
  instances(p, s, visit) {
    const ways = [0, 1, 2, 3].filter((d) => canSlide(p, s.grid, d));
    if (ways.length !== 1) return;
    const d = ways[0]!;
    visit({
      message: `only sliding ${DIR_NAMES[d]} moves any tile.`,
      nudge: "which slide moves anything at all?",
      actions: [{ type: "slide", dir: d }],
      focus: { dir: d, cells: merged(move(p, s.grid, d)) } satisfies FocusMerge,
      nudgeFocus: { dir: d } satisfies FocusMerge,
    });
  },
  practice: { params: { size: 3, goal: "128" } },
};

export const reachGoal: TechniqueMerge = {
  id: "sliding-merge.goal",
  name: "make the goal tile",
  puzzles: [gameMerge],
  level: 2,
  description: "when a slide merges two tiles into the goal tile, make it.",
  instances(p, s, visit) {
    const goal = p.rules.goal;
    if (!goal || best(s.grid) >= goal) return;
    for (let d = 0; d < 4; d++) {
      const r = move(p, s.grid, d);
      if (!r.changed || best(r.grid) < goal) continue;
      const stop = visit({
        message: `slide ${DIR_NAMES[d]}: it makes the ${goal}.`,
        nudge: `can two tiles make ${goal}?`,
        actions: [{ type: "slide", dir: d }],
        focus: { dir: d, cells: merged(r) } satisfies FocusMerge,
        nudgeFocus: { dir: d } satisfies FocusMerge,
      });
      if (stop) return;
    }
  },
  practice: { params: { size: 3, goal: "64" } },
};

export const smallPair: TechniqueMerge = {
  id: "sliding-merge.small-pair",
  name: "pair the small tiles",
  puzzles: [gameMerge],
  requires: ["starter-pair"],
  level: 3,
  description: "the two smallest tiles (1 and 2 in threes, 2 and 3 in fives) are worth nothing on their own and merge only with each other. when the best slide pushes one into the other, it makes the first real tile and frees a cell.",
  instances: (p, s, visit) => bestIf(p, s, ({ before, d, r }) => {
    const first = mergeOf(p).value(1);
    const hit = merges(before, r).filter((m) => m.made === first && m.a !== m.b);
    if (!hit.length) return null;
    const [lo, hi] = mergeOf(p).bases;
    return {
      message: `slide ${DIR_NAMES[d]}: ${hit.length === 1 ? `a ${lo} meets a ${hi} and they make a ${first}` : `${hit.length} pairs of ${lo} and ${hi} meet and make ${first}s`}.`,
      nudge: `is a ${lo} next to a ${hi} in a line? which slide pushes them together?`,
      cells: unique(hit.flatMap((m) => m.cells)),
    };
  }, visit),
  practice: { params: { rule: "threes", slide: "step", entry: "edge", source: "stack", bonus: true, preview: true, score: "worth", size: 4, start: 9 } },
};

export const growCorner: TechniqueMerge = {
  id: "sliding-merge.grow-corner",
  name: "grow the corner",
  puzzles: [gameMerge],
  level: 4,
  description: "when the biggest tiles can merge into a bigger one that ends up in a corner, do it. the corner is where the biggest tile lives, so every new biggest tile should be made there.",
  instances: (p, s, visit) => bestIf(p, s, ({ n, before, d, r }) => {
    const c = cornerHolding(n, r.grid);
    if (best(r.grid) <= best(before) || c < 0) return null;
    return {
      message: `slide ${DIR_NAMES[d]}: the biggest tiles merge into a ${best(r.grid)} in the ${cornerName(n, c)} corner.`,
      nudge: "can the biggest tiles merge so the new biggest sits in a corner?",
      cells: unique([...merged(r), c]),
      look: biggest(before),
    };
  }, visit),
};

export const bigMerge: TechniqueMerge = {
  id: "sliding-merge.big-merge",
  name: "make the biggest merge",
  puzzles: [gameMerge],
  level: 5,
  description: "take the biggest merge on offer: it is worth the most and clears the most room.",
  instances: (p, s, visit) => bestIf(p, s, ({ before, d, r }) => {
    const hit = merges(before, r).filter((m) => mergeOf(p).rank(m.made) >= 2);
    if (!hit.length) return null;
    const top = hit.reduce((a, b) => (b.made > a.made ? b : a));
    const offered = Math.max(...[0, 1, 2, 3].flatMap((e) => merges(before, move(p, before, e)).map((m) => m.made)));
    if (top.made < offered) return null;
    return {
      message: `slide ${DIR_NAMES[d]}: ${hit.length === 1 ? `a ${top.a} and a ${top.b} meet and make a ${top.made}` : `${hit.length} merges, the biggest a ${top.a} and a ${top.b} into a ${top.made}`}.`,
      nudge: "which tiles next to each other in a line merge into the biggest tile?",
      cells: unique(hit.flatMap((m) => m.cells)),
    };
  }, visit),
};

export const claimCorner: TechniqueMerge = {
  id: "sliding-merge.claim-corner",
  name: "claim a corner",
  puzzles: [gameMerge],
  level: 7,
  description: "the biggest tile belongs in a corner, and it stays there for the whole game. when no corner has it yet, a slide that puts it in one claims it, and one that brings it closer to a corner heads that way.",
  instances: (p, s, visit) => bestIf(p, s, ({ n, before, d, r, anchor }) => {
    const was = cornerDistance(n, before), now = cornerDistance(n, r.grid);
    if (anchor >= 0 || now >= was) return null;
    const c = cornerHolding(n, r.grid);
    return {
      message: now === 0
        ? `no corner holds the ${best(before)} yet. slide ${DIR_NAMES[d]}: it goes to the ${cornerName(n, c)} corner.`
        : `no corner holds the ${best(before)} yet. slide ${DIR_NAMES[d]}: it gets closer to one.`,
      nudge: "is the biggest tile in a corner? can a slide put it in one, or closer to one?",
      cells: c >= 0 ? [c] : biggest(r.grid),
      look: biggest(before),
    };
  }, visit),
};

export const farSide: TechniqueMerge = {
  id: "sliding-merge.far-side",
  name: "merge on the far side",
  puzzles: [gameMerge],
  level: 8,
  description: "a merge far from the biggest tile (at least two lines away from the line it sits on, along the way you slide) cleans up the far side and leaves the chain by the corner untouched.",
  instances: (p, s, visit) => bestIf(p, s, ({ n, before, d, r, anchor }) => {
    if (anchor < 0 || !holds(before, r, anchor)) return null;
    const lineOf = (c: number) => (d % 2 === 0 ? c % n : Math.floor(c / n));
    const ends = r.moves.filter((m) => m.merged).map((m) => m.to);
    if (!ends.length || ends.some((c) => Math.abs(lineOf(c) - lineOf(anchor)) < 2)) return null;
    return {
      message: `slide ${DIR_NAMES[d]}: everything it merges is two or more ${d % 2 === 0 ? "columns" : "rows"} away from the ${best(before)}, so the corner stays as it is.`,
      nudge: "which merges are far from the corner with the biggest tile?",
      cells: merged(r),
      look: [anchor],
    };
  }, visit),
};

export const makeRoom: TechniqueMerge = {
  id: "sliding-merge.make-room",
  name: "merge to make room",
  puzzles: [gameMerge],
  level: 9,
  description: "every merge frees a cell. a slide that merges tiles and keeps the biggest tile in its corner buys room; the more it merges, the more room.",
  instances: (p, s, visit) => bestIf(p, s, ({ before, d, r, anchor }) => {
    const count = r.moves.filter((m) => m.merged).length;
    if (!count || (anchor >= 0 && !holds(before, r, anchor))) return null;
    return {
      message: `slide ${DIR_NAMES[d]}: ${count === 1 ? "one merge" : `${count} merges`}, so ${count === 1 ? "a cell opens" : `${count} cells open`}${anchor >= 0 ? ` and the ${best(before)} stays in its corner` : ""}.`,
      nudge: "which slide merges the most tiles without moving the biggest one?",
      cells: merged(r),
      look: anchor >= 0 ? [anchor] : [],
    };
  }, visit),
};

export const feedNext: TechniqueMerge = {
  id: "sliding-merge.feed-next",
  name: "feed the next tile",
  puzzles: [gameMerge],
  requires: ["preview"],
  level: 10,
  description: "the board shows the tile that comes in next. when every place it can land after a slide is right next to a tile it merges with, the slide sets up a merge for free.",
  instances: (p, s, visit) => {
    const v = shownNext(p, s);
    if (!v) return;
    bestIf(p, s, ({ n, d, r }) => {
      const spots = landing(p, r);
      const partners = spots.map((e) => around(n, e).filter((o) => r.grid[o]! > 0 && mergeOf(p).merge(r.grid[o]!, v)));
      if (!spots.length || partners.some((o) => !o.length)) return null;
      const one = spots.length === 1;
      return {
        message: `the next tile is a ${v}. slide ${DIR_NAMES[d]}: ${one ? "the one spot it can land on is" : "every spot it can land on is"} next to a tile it merges with.`,
        nudge: "look at the next tile. where could it land after a slide, and what is next to those spots?",
        cells: unique([...spots, ...partners.flat()]),
        look: [],
        entries: spots,
      };
    }, visit);
  },
  practice: { params: { rule: "threes", slide: "step", entry: "edge", source: "stack", bonus: true, preview: true, score: "worth", size: 4, start: 9 } },
};

export const buildSnake: TechniqueMerge = {
  id: "sliding-merge.snake",
  name: "build the snake",
  puzzles: [gameMerge],
  level: 11,
  description: "from the corner tile, keep the tiles in a chain that only gets smaller: along the edge, then back along the next line in, and so on. then the smaller tiles merge their way up the chain into the corner. a slide that makes the chain longer builds it.",
  instances: (p, s, visit) => bestIf(p, s, ({ n, before, d, r, anchor }) => {
    const was = longestSnake(n, before), now = longestSnake(n, r.grid);
    if (anchor < 0 || !holds(before, r, anchor) || now.length <= was.length || !was.length) return null;
    return {
      message: `slide ${DIR_NAMES[d]}: the chain from the corner grows from ${was.length} tiles to ${now.length}, each one no bigger than the one before it.`,
      nudge: "how long is the chain of shrinking tiles from the corner? what makes it longer?",
      cells: now,
      look: was,
    };
  }, visit),
};

export const lineUp: TechniqueMerge = {
  id: "sliding-merge.line-up",
  name: "line up a pair",
  puzzles: [gameMerge],
  level: 12,
  description: "when nothing merges yet, set it up: a slide that leaves tiles that merge side by side means the next slide along them merges. more pairs lined up is better.",
  instances: (p, s, visit) => bestIf(p, s, ({ before, d, r }) => {
    const was = pairs(p, before), now = pairs(p, r.grid);
    if (now.length <= was.length) return null;
    const had = new Set(was.map((q) => `${q}`));
    return {
      message: `slide ${DIR_NAMES[d]}: it leaves ${plural(now.length, "pair")} side by side that merge on the next slide along them.`,
      nudge: "which tiles would merge if they were side by side? which slide brings them together?",
      cells: unique(now.filter((q) => !had.has(`${q}`)).flat()),
    };
  }, visit),
};

export const fullEdge: TechniqueMerge = {
  id: "sliding-merge.full-edge",
  name: "keep the edge full",
  puzzles: [gameMerge],
  level: 13,
  description: "keep a whole edge through the corner filled with tiles. a full line can't slide along itself, so the corner tile can't be pushed out of it, and sliding along that edge is safe.",
  instances: (p, s, visit) => bestIf(p, s, ({ n, before, d, r, anchor }) => {
    const c = cornerHolding(n, r.grid);
    if (c < 0 || (anchor >= 0 && !holds(before, r, anchor))) return null;
    const line = edgeLines(n, c).find((l) => l.every((i) => r.grid[i]! > 0));
    if (!line) return null;
    const was = edgeLines(n, c).some((l) => l.every((i) => before[i]! > 0));
    return {
      message: `slide ${DIR_NAMES[d]}: the edge from the ${cornerName(n, c)} corner ${was ? "stays full" : "is full"}, so the ${best(r.grid)} can't be pushed out along it.`,
      nudge: "is an edge through the biggest tile's corner full? which slide keeps it that way?",
      cells: line,
      look: edgeLines(n, c).flat(),
    };
  }, visit),
};

export const keepCorner: TechniqueMerge = {
  id: "sliding-merge.keep-corner",
  name: "the safe third slide",
  puzzles: [gameMerge],
  level: 6,
  description: "when the two slides toward the corner move nothing, take a third that still keeps the biggest tile in its corner. never take one that pulls it out unless it's the only slide left.",
  instances: (p, s, visit) => bestIf(p, s, ({ n, before, d, r, anchor }) => {
    if (anchor < 0 || toward(n, anchor).some((t) => t === d || canSlide(p, before, t)) || !holds(before, r, anchor)) return null;
    const out = [0, 1, 2, 3].filter((e) => { const q = move(p, before, e); return q.changed && !holds(before, q, anchor); });
    return {
      message: `the ${best(before)} is in the ${cornerName(n, anchor)} corner and ${dirs(toward(n, anchor))} move nothing. slide ${DIR_NAMES[d]}: it keeps the ${best(before)} in the corner${out.length ? `; ${dirs(out)} would pull it out` : ""}.`,
      nudge: "where is the biggest tile? which slides would move it out of its corner?",
      cells: [anchor],
      look: [anchor],
    };
  }, visit),
};

export const towardCorner: TechniqueMerge = {
  id: "sliding-merge.toward-corner",
  name: "use two directions",
  puzzles: [gameMerge],
  level: 14,
  description: "play with the two slides that push toward the biggest tile's corner (say down and left for the bottom left) and keep to them. a third slide is for when those two move nothing, and the one pointing away from the corner is the last resort.",
  instances: (p, s, visit) => bestIf(p, s, ({ n, before, d }) => {
    const aim = aimCorner(n, before);
    if (aim < 0) return null;
    const pair = toward(n, aim);
    if (!pair.includes(d)) return null;
    return {
      message: `${cornerHolding(n, before) >= 0 ? "the biggest tile is in" : "the biggest tile is nearest to"} the ${cornerName(n, aim)} corner, so ${dirs(pair)} are the slides that push toward it. ${DIR_NAMES[d]} moves something.`,
      nudge: "where is the biggest tile? which two slides push toward it?",
      cells: [aim],
      look: [aim],
    };
  }, visit),
};

export const weighUp: TechniqueMerge = {
  id: "sliding-merge.weigh-up",
  name: "weigh it up",
  puzzles: [gameMerge],
  level: 15,
  description: "when no single reason decides, look at what each slide leaves and where the new tile could land: the most room, tiles that merge side by side, rows and columns that run one way from big to small, and the fewest big tiles left unmerged. take the slide that leaves the tidiest board.",
  instances: (p, s, visit) => bestIf(p, s, ({ d, r }) => {
    const room = r.grid.filter((v) => v === 0).length;
    const ps = pairs(p, r.grid);
    const comes = expected(p, s);
    return {
      message: `slide ${DIR_NAMES[d]}: it leaves ${plural(room, "empty cell")} and ${plural(ps.length, "pair")} side by side, with rows and columns that run most evenly from big to small${comes.length === 1 ? ` wherever the ${comes[0]} lands` : ""}.`,
      nudge: "which slide leaves the most room, the most pairs, and rows that run one way?",
      cells: unique(ps.flat()),
      entries: landing(p, r).filter((c) => r.grid[c] !== BLOCK),
    };
  }, visit),
};

export const techniquesMerge: TechniqueMerge[] = [
  onlyMove, reachGoal, smallPair, growCorner, bigMerge, keepCorner, claimCorner, farSide, makeRoom, feedNext, buildSnake, lineUp, fullEdge, towardCorner, weighUp,
];
