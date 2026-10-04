import type { Hint, PuzzleDef, Rating } from "../../core/types";
import { formats } from "./formats";
import { generate, params, tierNeeded } from "./generate";
import { coord, isTree, rotate, turnsBetween, type NetPuzzle } from "./grid";
import { TIER_LABEL, searchSolutions, solveLogic, type Rule } from "./solver";

export interface NetState {
  /** Current mask per cell; always a rotation of the puzzle's tile there. */
  tiles: number[];
  /** 1 = locked (can't be rotated until unlocked). */
  locked: number[];
}

export type NetAction =
  /** Rotate by `turns` quarter turns clockwise (negative = anticlockwise). No-op on locked tiles. */
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
}

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

/** Last resort when no hint-enabled technique applies: one tile straight from the solution. */
function hint(p: NetPuzzle, s: NetState): Hint<NetAction> | null {
  if (isTree(p, s.tiles)) return null;
  const sol = analyse(p).solution;
  if (!sol) return { message: "this puzzle has no solution" };
  const c = s.tiles.findIndex((m, i) => !s.locked[i] && m !== sol[i]);
  if (c < 0) return null;
  return {
    message: `no technique you have hints on finds anything here, so this one's straight from the solution: turn ${coord(p, c)} like this`,
    focus: { cell: c, cells: [c], mask: sol[c]! } satisfies NetHintFocus,
    actions: [{ type: "set", cell: c, mask: sol[c]!, lock: true }],
  };
}

function rate(p: NetPuzzle): Rating {
  const a = analyse(p);
  const u = a.used;
  if (a.tier > 3) return { label: a.unique ? "needs guessing" : "several solutions", score: 1000 };
  const score = 100 * a.tier + 3 * (u.loop + u.island) + 20 * u.lookahead + Math.round(p.tiles.length / 10);
  return { label: TIER_LABEL[a.tier as 1 | 2 | 3], score };
}

export const net: PuzzleDef<NetPuzzle, NetState, NetAction, NetInteraction, typeof params> = {
  id: "net",
  name: "pipes",
  aliases: ["net", "netwalk", "network", "knetwalk", "freenet"],
  tags: ["logic", "grid", "rotation", "connection"],
  description: "turn the tiles so every pipe joins up into one network, with no loops and no loose ends.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "5×5 easy", params: { width: 5, height: 5, wrap: false, barriers: 0, difficulty: "easy" } },
    { label: "7×7", params: { width: 7, height: 7, wrap: false, barriers: 0, difficulty: "normal" } },
    { label: "9×9 wrapping", params: { width: 9, height: 9, wrap: true, barriers: 0, difficulty: "normal" } },
    { label: "11×11 wrapping hard", params: { width: 11, height: 11, wrap: true, barriers: 0, difficulty: "hard" } },
    { label: "15×15 walls", params: { width: 15, height: 15, wrap: false, barriers: 30, difficulty: "normal" } },
    { label: "20×14 wrapping hard", params: { width: 20, height: 14, wrap: true, barriers: 0, difficulty: "hard" } },
  ],
  generate,
  formats,
  init: (p) => ({ tiles: p.tiles.slice(), locked: p.tiles.map(() => 0) }),
  initInteraction: (p) => ({ cursor: p.source, ox: 0, oy: 0, source: p.source, drag: null }),
  reduce,
  isSolved: (p, s) => isTree(p, s.tiles),
  solve(p) {
    const sol = analyse(p).solution;
    return sol ? { tiles: sol.slice(), locked: sol.map(() => 0) } : null;
  },
  hint,
  isRetraction: (a) => a.type === "lock" && a.on === false,
  rules: (p) => [
    "turn the tiles. every pipe end has to meet a pipe end on the next tile.",
    "everything joins up into one network, with no loops.",
    ...(p.barriers.some((b) => b) ? ["pipes can't cross the thick walls."] : []),
    p.wrap ? "the edges wrap round: a pipe off one side comes back on the opposite side." : "pipes can't point off the edge of the board.",
  ],
  features: (p) => [...(p.wrap ? ["wrap"] : []), ...(p.barriers.some((b) => b) ? ["walls"] : [])],
  rate,
  describe: (p) => `${p.w}×${p.h}${p.wrap ? " wrapping" : ""}${p.barriers.some((b) => b) ? " with walls" : ""}`,
};
