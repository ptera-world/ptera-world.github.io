import type { Hint, PuzzleDef, Rating } from "../../core/types";
import { formats } from "./formats";
import { generate, params, tierNeeded } from "./generate";
import { coord, isTree, rotate, turnsBetween, type NetPuzzle } from "./grid";
import { RULE_TIER, TIER_LABEL, searchSolutions, solveLogic, type Rule, type Step } from "./solver";

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
  /** The tile the hint is about. */
  cell: number;
  /** Tiles that justify it. */
  cells: number[];
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

const REASON: Record<Rule, string> = {
  local: "it's the only way it fits the walls and the tiles around it",
  deadend: "any other way joins two dead ends into a pair that's cut off from everything",
  loop: "the other ways it could turn would close a loop",
  island: "the other ways it could turn would seal off a group from the rest of the network",
  lookahead: "try any other way and it runs into a contradiction a few moves later",
};

function hint(p: NetPuzzle, s: NetState): Hint<NetAction> | null {
  if (isTree(p, s.tiles)) return null;
  const a = analyse(p);
  if (!a.solution) return { message: "this puzzle has no solution" };
  const sol = a.solution;
  if (a.unique) {
    const wrong = s.locked.flatMap((l, i) => (l && s.tiles[i] !== sol[i] ? [i] : []));
    if (wrong.length) {
      return {
        message: `${coord(p, wrong[0]!)} is locked the wrong way round`,
        focus: { cell: wrong[0]!, cells: wrong } satisfies NetHintFocus,
        action: { type: "lock", cells: [wrong[0]!], on: false },
      };
    }
  }
  const givens = s.tiles.map((m, i) => (s.locked[i] ? m : -1));
  const r = solveLogic(p, { givens, trace: true });
  if (r.status === "contradiction") {
    const locked = s.locked.flatMap((l, i) => (l ? [i] : []));
    return { message: "the locked tiles can't all be right", focus: { cell: locked[0] ?? 0, cells: locked } satisfies NetHintFocus };
  }
  const steps = r.steps;
  for (let k = 0; k < steps.length; k++) {
    for (const c of steps[k]!.determined) {
      if (s.locked[c] || s.tiles[c] === r.masks[c]) continue;
      return explain(p, c, r.masks[c]!, steps.slice(0, k + 1));
    }
  }
  const c = s.tiles.findIndex((m, i) => !s.locked[i] && m !== sol[i]);
  if (c < 0) return null;
  return {
    message: `logic gets stuck here, so this one's straight from the solution: turn ${coord(p, c)} like this`,
    focus: { cell: c, cells: [c] } satisfies NetHintFocus,
    action: { type: "set", cell: c, mask: sol[c]!, lock: true },
  };
}

function explain(p: NetPuzzle, c: number, mask: number, steps: Step[]): Hint<NetAction> {
  let rule: Rule = "local";
  const focus = new Set<number>([c]);
  for (const st of steps) {
    if (!st.cells.includes(c)) continue;
    if (RULE_TIER[st.rule] >= RULE_TIER[rule]) rule = st.rule;
  }
  for (const st of steps) if (st.cells.includes(c) && st.rule === rule) for (const f of st.focus) focus.add(f);
  return {
    message: `turn ${coord(p, c)} like this: ${REASON[rule]}`,
    focus: { cell: c, cells: [...focus] } satisfies NetHintFocus,
    action: { type: "set", cell: c, mask, lock: true },
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
  name: "net",
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
  rate,
  describe: (p) => `${p.w}×${p.h}${p.wrap ? " wrapping" : ""}${p.barriers.some((b) => b) ? " with walls" : ""}`,
};
