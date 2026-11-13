import type { Ids } from "../../core/commands";
import { featureTests } from "../../core/define";
import { defineSchema, type Values } from "../../core/schema";
import type { GenerateContext, PuzzleDef, Rating } from "../../core/types";
import type { Rng } from "../../core/rng";
import { gridFormat, sgtFormat } from "./formats";
import { goalProblem, goalText, type Goal } from "./goal";
import { describeShift, generateShift, shift, shiftOk, shiftSolve, shiftSolved, type ShiftAction, type ShiftPuzzle, type ShiftState } from "./shift";
import { applyMove, describeSlide, generateSlide, slideSolved, type SlideAction, type SlidePuzzle, type SlideState } from "./slide";
import { fullPlan } from "./solver";
import { canTurn, describeTurn, generateTurn, rotate, turnSolve, turnSolved, type TurnAction, type TurnPuzzle, type TurnState } from "./turn";

export const params = defineSchema({
  moves: {
    type: "enum", label: "moves", default: "slide",
    options: [
      { value: "slide", label: "slide into the gap", description: "one tile is missing; tiles next to the gap slide into it (the 15 puzzle)" },
      { value: "shift", label: "shift rows and columns", description: "a whole row or column slides along and wraps round (sixteen, loopover)" },
      { value: "turn", label: "turn blocks", description: "a square block of tiles turns a quarter turn (twiddle, gripple)" },
    ],
  },
  width: { type: "int", label: "width", default: 4, min: 2, max: 8 },
  height: { type: "int", label: "height", default: 4, min: 2, max: 8 },
  block: { type: "int", label: "block size", default: 2, min: 2, max: 8, when: (v) => v.moves === "turn", description: "how many tiles across a turning block is; at most the board's shorter side" },
  blocks: {
    type: "enum", label: "blocks that turn", default: "all", when: (v) => v.moves === "turn",
    options: [
      { value: "all", label: "every block" },
      { value: "corners", label: "corners and middle", description: "only the four corner blocks and the middle one (gripple)" },
    ],
  },
  goal: {
    type: "enum", label: "finished board", default: "order",
    options: [
      { value: "order", label: "in reading order", description: "left to right, top to bottom (with a gap, it ends the last row)" },
      { value: "gap-first", label: "gap first", description: "the gap in the top-left corner, then the tiles in reading order (slide only)" },
      { value: "spiral", label: "spiral", description: "clockwise round the edge from the top left and inwards" },
      { value: "rows", label: "one number per row", description: "every tile in a row is the same number, so only which row a tile ends up in matters (not slide)" },
      { value: "quadrants", label: "one number per quarter", description: "four numbers, one for each quarter of the board (not slide; even sides)" },
    ],
  },
  orientable: { type: "bool", label: "tiles must end upright", default: false, when: (v) => v.moves === "turn", description: "tiles turn with the block, and each must finish pointing up" },
  shuffle: {
    type: "int", label: "scramble moves (0 = thorough)", default: 0, min: 0, max: 2000,
    description: "fully random boards are any arrangement that can be reached; a few random moves give an easier board",
  },
});

export type FifteenParams = Values<typeof params>;

export type FifteenPuzzle = SlidePuzzle | ShiftPuzzle | TurnPuzzle;
export type FifteenState = SlideState | ShiftState | TurnState;
export type FifteenAction = SlideAction | ShiftAction | TurnAction;

export interface FifteenInteraction {
  /** Keyboard cursor: a cell (shift) or a block's top-left cell (turn). */
  cursor: number;
}

export type Moves = "slide" | "shift" | "turn";
/** Boards saved before the games were merged have no `moves`: they slide. */
export const movesOf = (p: FifteenPuzzle): Moves => p.moves ?? "slide";
export const goalOf = (p: FifteenPuzzle): Goal => p.goal ?? "order";

async function generate(v: FifteenParams, rng: Rng, ctx: GenerateContext): Promise<FifteenPuzzle> {
  const moves = v.moves as Moves, goal = v.goal as Goal;
  const problem = goalProblem({ w: v.width, h: v.height, goal, gap: moves === "slide" });
  if (problem) throw new Error(problem);
  if (moves === "shift") return generateShift(v.width, v.height, goal, v.shuffle, rng);
  if (moves === "turn") {
    const n = v.block;
    if (n > Math.min(v.width, v.height)) throw new Error(`a ${n}×${n} block doesn't fit on a ${v.width}×${v.height} board`);
    return generateTurn({ w: v.width, h: v.height, n, blocks: v.blocks as "all" | "corners", goal, orientable: v.orientable, shuffle: v.shuffle }, rng, ctx);
  }
  return generateSlide(v.width, v.height, goal, v.shuffle, rng);
}

function solveMoves(p: FifteenPuzzle, s: FifteenState): FifteenAction[] | null {
  switch (p.moves) {
    case "shift": return shiftSolve(p, s.tiles);
    case "turn": return turnSolve(p, s as TurnState);
    default: {
      const cells = fullPlan(p, s);
      return cells ? cells.map((cell) => ({ type: "move" as const, cell })) : null;
    }
  }
}

const ratingCache = new WeakMap<FifteenPuzzle, Rating | null>();

function rate(p: FifteenPuzzle): Rating | null {
  if (ratingCache.has(p)) return ratingCache.get(p)!;
  const moves = solveMoves(p, init(p));
  const unit = p.moves === "turn" ? "turns" : "moves";
  const r = moves ? { label: `${moves.length} ${unit}`, score: moves.length } : null;
  ratingCache.set(p, r);
  return r;
}

function init(p: FifteenPuzzle): FifteenState {
  return p.moves === "turn" ? { tiles: p.tiles.slice(), turns: p.turns.slice(), moves: 0 } : { tiles: p.tiles.slice(), moves: 0 };
}

function reduce(p: FifteenPuzzle, s: FifteenState, a: FifteenAction): FifteenState {
  switch (p.moves) {
    case "shift":
      if (a.type !== "shift" || !shiftOk(p, a)) return s;
      return { tiles: shift(p.w, p.h, s.tiles, a), moves: s.moves + 1 };
    case "turn": {
      if (a.type !== "rotate" || !canTurn(p, a.x, a.y)) return s;
      return { ...rotate(p, s as TurnState, a), moves: s.moves + 1 };
    }
    default:
      return a.type === "move" ? applyMove(p.w, s, a.cell) : s;
  }
}

function rules(p: FifteenPuzzle): string[] {
  const goal = goalText({ w: p.w, h: p.h, goal: goalOf(p), gap: movesOf(p) === "slide" });
  switch (p.moves) {
    case "shift": return [
      goalOf(p) === "order" || goalOf(p) === "spiral" ? `the numbers 1 to ${p.w * p.h} fill a ${p.w}×${p.h} grid.` : `the tiles fill a ${p.w}×${p.h} grid.`,
      "a move slides one whole row or column along by one; the tile pushed off one end comes back on at the other.",
      goal,
    ];
    case "turn": return [
      p.blocks === "corners"
        ? `a move turns one of the five ${p.n}×${p.n} blocks (the four corners and the middle) a quarter turn, either way.`
        : `a move turns one ${p.n}×${p.n} block of tiles a quarter turn, either way.`,
      goal,
      ...(p.orientable ? ["tiles turn with their block: every tile must also end up pointing upright."] : []),
    ];
    default: return [
      `the tiles 1 to ${p.w * p.h - 1} sit in a ${p.w}×${p.h} frame with one gap.`,
      "a tile next to the gap can slide into it. clicking a tile further along the gap's row or column slides the whole line.",
      goal,
    ];
  }
}

const GOAL_WORDS: Record<Goal, string> = { order: "", "gap-first": ", gap first", spiral: ", spiral", rows: ", rows only", quadrants: ", quarters" };

function describe(p: FifteenPuzzle): string {
  const size = `${p.w}×${p.h}`, goal = GOAL_WORDS[goalOf(p)];
  switch (p.moves) {
    case "shift": return `${size} shifting${goal}`;
    case "turn": return `${size} turning ${p.n}×${p.n}${p.blocks === "corners" ? " corners and middle" : ""}${goal}${p.orientable ? ", upright" : ""}`;
    default: return `${size}${goal}`;
  }
}

const FEATURES = {
  /** Tiles slide into a gap. */
  slide: (p: FifteenPuzzle) => movesOf(p) === "slide",
  /** Whole rows and columns shift round. */
  shift: (p: FifteenPuzzle) => p.moves === "shift",
  /** Square blocks turn. */
  turn: (p: FifteenPuzzle) => p.moves === "turn",
};

declare module "../../core/types" {
  interface FeatureNames extends Ids<typeof FEATURES> {}
}

/**
 * Every sliding and permutation puzzle on a grid of numbered tiles, by what a move does: tiles slide
 * into a gap (the 15 puzzle), whole lines shift round (Sixteen, Loopover), or blocks turn (Twiddle,
 * Gripple). The finished arrangement is its own setting.
 */
export const fifteen: PuzzleDef<FifteenPuzzle, FifteenState, FifteenAction, FifteenInteraction, typeof params> = {
  id: "fifteen",
  name: "fifteen",
  aliases: [
    "15 puzzle", "sliding puzzle", "gem puzzle", "sliding tiles", "8-puzzle", "24-puzzle",
    "sixteen", "row and column shifting", "loopover",
    "twiddle", "rotation puzzle", "number rotation puzzle", "gripple",
  ],
  tags: ["classic", "sliding", "moves", "permutation", "rotation"],
  description: "put the numbered tiles back in order. what a move does is a setting: slide tiles into the one gap, shift whole rows and columns round, or turn square blocks of tiles.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "8-puzzle", params: { moves: "slide", width: 3, height: 3 } },
    { label: "15-puzzle", params: { moves: "slide", width: 4, height: 4 } },
    { label: "24-puzzle", params: { moves: "slide", width: 5, height: 5 } },
    { label: "8-puzzle, blank first", params: { moves: "slide", width: 3, height: 3, goal: "gap-first" } },
    { label: "8-puzzle, spiral goal", params: { moves: "slide", width: 3, height: 3, goal: "spiral" } },
    { label: "sixteen 3×3", params: { moves: "shift", width: 3, height: 3 } },
    { label: "sixteen 4×3", params: { moves: "shift", width: 4, height: 3 } },
    { label: "sixteen 4×4", params: { moves: "shift", width: 4, height: 4 } },
    { label: "sixteen 5×4", params: { moves: "shift", width: 5, height: 4 } },
    { label: "sixteen 5×5", params: { moves: "shift", width: 5, height: 5 } },
    { label: "loopover 5×5", params: { moves: "shift", width: 5, height: 5 } },
    { label: "twiddle 3×3 rows only", params: { moves: "turn", width: 3, height: 3, block: 2, goal: "rows" } },
    { label: "twiddle 3×3 normal", params: { moves: "turn", width: 3, height: 3, block: 2 } },
    { label: "twiddle 3×3 orientable", params: { moves: "turn", width: 3, height: 3, block: 2, orientable: true } },
    { label: "twiddle 4×4 normal", params: { moves: "turn", width: 4, height: 4, block: 2 } },
    { label: "twiddle 4×4 orientable", params: { moves: "turn", width: 4, height: 4, block: 2, orientable: true } },
    { label: "twiddle 4×4, rotating 3×3 blocks", params: { moves: "turn", width: 4, height: 4, block: 3 } },
    { label: "twiddle 5×5, rotating 3×3 blocks", params: { moves: "turn", width: 5, height: 5, block: 3 } },
    { label: "twiddle 6×6, rotating 4×4 blocks", params: { moves: "turn", width: 6, height: 6, block: 4 } },
    { label: "gripple", params: { moves: "turn", width: 4, height: 4, block: 2, blocks: "corners" } },
    { label: "gripple, four colours", params: { moves: "turn", width: 4, height: 4, block: 2, blocks: "corners", goal: "quadrants" } },
  ],
  generate,
  formats: [gridFormat, sgtFormat],
  init,
  initInteraction: () => ({ cursor: 0 }),
  reduce,
  describeAction: (p, a, before) => {
    switch (a.type) {
      case "shift": return describeShift(a);
      case "rotate": return describeTurn(p as TurnPuzzle, a);
      default: return describeSlide(p as SlidePuzzle, a, before);
    }
  },
  isSolved: (p, s) => {
    switch (p.moves) {
      case "shift": return shiftSolved(p, s.tiles);
      case "turn": return turnSolved(p, s as TurnState);
      default: return slideSolved(p, s.tiles);
    }
  },
  solve(p, s) {
    const moves = solveMoves(p, s);
    return moves ? { moves } : null;
  },
  rate,
  rules,
  features: featureTests(FEATURES),
  describe,
};

