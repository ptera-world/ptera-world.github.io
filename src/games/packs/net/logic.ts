import { featureTests } from "../../core/define";
import type { Ids } from "../../core/commands";
import type { PuzzleDef, Rating } from "../../core/types";
import { formats } from "./formats";
import { generate, params, tierNeeded } from "./generate";
import { coord, isTree, rotate, turnsBetween, type NetPuzzle } from "./grid";
import { TIER_LABEL, searchSolutions, solveLogic, type Rule } from "./solver";
import { listOf } from "../../lib/edge-names";
import { allJoined, describeShift, shift, shiftOk, slideSolve, type ShiftAction } from "./slide";

export interface NetState {
  /** Current mask per cell: a rotation of the puzzle's tile there, or (sliding) the tile slid there. */
  tiles: number[];
  /** 1 = locked (can't be rotated until unlocked). Never set while sliding. */
  locked: number[];
  /** Sliding: slides made so far. */
  moves?: number;
}

export type NetAction =
  /** Sliding only: a whole row or column slides round. */
  | ShiftAction
  /** Rotate by `turns` quarter turns clockwise (negative = counterclockwise). No-op on locked tiles. */
  | { type: "rotate"; cell: number; turns: number }
  | { type: "rotateMany"; cells: number[]; turns: number[] }
  /** Turn a tile to `mask` (must be a rotation of it), optionally locking it. No-op on locked tiles. */
  | { type: "set"; cell: number; mask: number; lock?: boolean }
  /** Lock or unlock; `on` omitted toggles each cell. */
  | { type: "lock"; cells: number[]; on?: boolean };

export interface NetInteraction {
  cursor: number;
  /** Display offset of the wrapped view, in cells. */
  ox: number;
  oy: number;
  /** Cell power flows from (display only; doesn't affect what counts as solved). */
  source: number;
  /** Lock-painting drag in progress. */
  drag: { on: boolean; cells: number[] } | null;
  /** What a tap or plain click on a tile does. Missing in games saved before it existed: treat as "cw". */
  tap?: TapMode;
}

export type TapMode = "cw" | "ccw" | "lock";

export interface NetHintFocus {
  /** The tile the hint is about; -1 when the hint only points at an area. */
  cell: number;
  /** Tiles that justify it. */
  cells: number[];
  /** Orientation `cell` should take, shown as a ghost. */
  mask?: number;
}

interface Analysis {
  solution: number[] | null;
  unique: boolean;
  tier: number;
  used: Record<Rule, number>;
}

const analyses = new WeakMap<NetPuzzle, Analysis>();

/** Solution + uniqueness + difficulty, computed once per puzzle object. */
export function analyse(p: NetPuzzle): Analysis {
  let a = analyses.get(p);
  if (a) return a;
  const logic = solveLogic(p, { tier: 3 });
  if (logic.status === "solved") {
    a = { solution: logic.masks, unique: true, tier: tierNeeded(p), used: logic.used };
  } else {
    const found = searchSolutions(p, 2);
    a = { solution: found.first, unique: found.count === 1, tier: 4, used: logic.used };
  }
  analyses.set(p, a);
  return a;
}

function reduce(p: NetPuzzle, s: NetState, a: NetAction): NetState {
  if (p.slide) {
    if (a.type !== "shift" || !shiftOk(p, a)) return s;
    return { ...s, tiles: shift(p.w, p.h, s.tiles, a), moves: (s.moves ?? 0) + 1 };
  }
  const n = p.w * p.h;
  const ok = (c: number) => Number.isInteger(c) && c >= 0 && c < n;
  switch (a.type) {
    case "rotate":
      return reduce(p, s, { type: "rotateMany", cells: [a.cell], turns: [a.turns] });
    case "rotateMany": {
      let tiles: number[] | null = null;
      a.cells.forEach((c, k) => {
        if (!ok(c) || s.locked[c]) return;
        const next = rotate(s.tiles[c]!, a.turns[k] ?? 0);
        if (next === s.tiles[c]) return;
        tiles ??= s.tiles.slice();
        tiles[c] = next;
      });
      return tiles ? { ...s, tiles } : s;
    }
    case "set": {
      if (!ok(a.cell) || s.locked[a.cell] || turnsBetween(p.tiles[a.cell]!, a.mask) < 0) return s;
      const lock = a.lock === true;
      if (s.tiles[a.cell] === a.mask && !lock) return s;
      const tiles = s.tiles.slice();
      tiles[a.cell] = a.mask;
      const locked = lock ? s.locked.slice() : s.locked;
      if (lock) locked[a.cell] = 1;
      return { tiles, locked };
    }
    case "lock": {
      let locked: number[] | null = null;
      for (const c of a.cells) {
        if (!ok(c)) continue;
        const v = a.on === undefined ? (s.locked[c] ? 0 : 1) : a.on ? 1 : 0;
        if (s.locked[c] === v) continue;
        locked ??= s.locked.slice();
        locked[c] = v;
      }
      return locked ? { ...s, locked } : s;
    }
    default:
      return s;
  }
}

const slideRatings = new WeakMap<NetPuzzle, Rating | null>();

function rate(p: NetPuzzle): Rating | null {
  if (p.slide) {
    if (!slideRatings.has(p)) {
      const moves = slideSolve(p, p.tiles);
      slideRatings.set(p, moves ? { label: `${moves.length} slides`, score: moves.length } : null);
    }
    return slideRatings.get(p)!;
  }
  const a = analyse(p);
  const u = a.used;
  if (a.tier > 3) return { label: a.unique ? "needs guessing" : "several solutions", score: 1000 };
  const score = 100 * a.tier + 3 * (u.loop + u.island) + 20 * u.lookahead + Math.round(p.tiles.length / 10);
  return { label: TIER_LABEL[a.tier as 1 | 2 | 3], score };
}

const FEATURES = {
  /** The board's edges wrap round. */
  wrap: (p: NetPuzzle) => p.wrap,
  /** The board has walls between some tiles. */
  walls: (p: NetPuzzle) => p.barriers.some((b) => b),
  /** Tiles turn in place. */
  rotate: (p: NetPuzzle) => !p.slide,
  /** Rows and columns slide instead. */
  slide: (p: NetPuzzle) => !!p.slide,
};

export const net: PuzzleDef<NetPuzzle, NetState, NetAction, NetInteraction, typeof params> = {
  id: "net",
  name: "pipes",
  aliases: ["net", "netwalk", "network", "knetwalk", "freenet", "netslide", "sliding net"],
  tags: ["logic", "grid", "rotation", "connection", "sliding"],
  description: "every square holds a piece of pipe. turn the pieces (or, as a setting, slide whole rows and columns of them) so all the pipes join up into one single network, with no pipe ends left open and no loops.",
  generatorVersion: 2,
  params,
  presets: [
    { label: "5×5 easy", params: { width: 5, height: 5, wrap: false, barriers: 0, difficulty: "easy" } },
    { label: "7×7", params: { width: 7, height: 7, wrap: false, barriers: 0, difficulty: "normal" } },
    { label: "9×9 wrapping", params: { width: 9, height: 9, wrap: true, barriers: 0, difficulty: "normal" } },
    { label: "11×11 wrapping hard", params: { width: 11, height: 11, wrap: true, barriers: 0, difficulty: "hard" } },
    { label: "15×15 walls", params: { width: 15, height: 15, wrap: false, barriers: 30, difficulty: "normal" } },
    { label: "20×14 wrapping hard", params: { width: 20, height: 14, wrap: true, barriers: 0, difficulty: "hard" } },
    // Simon Tatham's Netslide presets: easy has every spare wall, medium none, hard wraps
    ...[3, 4, 5].flatMap((n) => [
      { label: `netslide ${n}×${n} easy`, params: { moves: "slide", width: n, height: n, wrap: false, barriers: 100 } },
      { label: `netslide ${n}×${n} medium`, params: { moves: "slide", width: n, height: n, wrap: false, barriers: 0 } },
      { label: `netslide ${n}×${n} hard`, params: { moves: "slide", width: n, height: n, wrap: true, barriers: 0 } },
    ]),
  ],
  generate,
  formats,
  init: (p) => ({ tiles: p.tiles.slice(), locked: p.tiles.map(() => 0), ...(p.slide ? { moves: 0 } : {}) }),
  initInteraction: (p) => ({ cursor: p.source, ox: 0, oy: 0, source: p.source, drag: null, tap: "cw" }),
  reduce,
  describeAction: (p, a, before, after) => {
    const turn = (k: number) => (["", "clockwise", "halfway round", "counterclockwise"][((k % 4) + 4) % 4] ?? "");
    switch (a.type) {
      case "shift": return describeShift(a);
      case "rotate": return `turn ${coord(p, a.cell)} ${turn(a.turns)}`;
      case "rotateMany": return `turn ${listOf(a.cells, (c) => coord(p, c))}`;
      case "set": {
        const k = turnsBetween(before.tiles[a.cell]!, a.mask);
        return [k > 0 ? `turn ${coord(p, a.cell)} ${turn(k)}` : "", a.lock ? `lock ${coord(p, a.cell)}` : ""].filter(Boolean).join(", ") || `keep ${coord(p, a.cell)}`;
      }
      case "lock": return `${a.on ?? after.locked[a.cells[0]!] ? "lock" : "unlock"} ${listOf(a.cells, (c) => coord(p, c))}`;
    }
  },
  isSolved: (p, s) => (p.slide ? allJoined(p, s.tiles) : isTree(p, s.tiles)),
  solve(p, s) {
    if (p.slide) {
      const moves = slideSolve(p, s.tiles);
      return moves ? { moves } : null;
    }
    const sol = analyse(p).solution;
    return sol ? { board: { tiles: sol.slice(), locked: sol.map(() => 0) } } : null;
  },
  isRetraction: (a) => a.type === "lock" && a.on === false,
  rules: (p) => p.slide ? [
    "a move slides one whole row or column along by one; the piece pushed off one end comes back on at the other.",
    "the middle row and the middle column can't slide, so the middle piece never moves.",
    `connect every piece into one network with the middle: pipe ends must meet, and can't cross the thick walls${p.wrap ? "" : " or the board's edge"}.`,
    ...(p.wrap ? ["pipes may run off one edge and come back on the opposite one."] : []),
  ] : [
    "you can only turn tiles, never move them. each tile has a fixed piece: a dead end, a straight, a bend, a T or a cross.",
    "every pipe end has to meet a pipe end on the tile next to it.",
    "all the tiles join up into one network, and there are no loops in it.",
    ...(p.barriers.some((b) => b) ? ["pipes can't cross the thick walls."] : []),
    p.wrap ? "the edges wrap round: a pipe off one side comes back on the opposite side." : "pipes can't point off the edge of the board.",
    "the small filled square marks the source: pipes joined to it light up, so you can see what's connected so far. it doesn't change the answer.",
    "lock a tile once you're sure of it, so it can't be turned by accident. locked tiles are shaded.",
  ],
  features: featureTests(FEATURES),
  rate,
  describe: (p) => `${p.w}×${p.h}${p.slide ? " sliding" : ""}${p.wrap ? " wrapping" : ""}${p.barriers.some((b) => b) ? " with walls" : ""}`,
};

declare module "../../core/types" {
  interface FeatureNames extends Ids<typeof FEATURES> {}
}
