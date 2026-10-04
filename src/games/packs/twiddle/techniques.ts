import { cellName as at } from "../../lib/grid-kit/names";
import type { Step, Technique } from "../../core/types";
import { describeTurn, goalTile, hintFor, type TwiddleAction, type TwiddleFocus, type TwiddlePuzzle, type TwiddleState } from "./logic";
import type { PermStep, StepKind } from "../../lib/perm";

type TwiddleTechnique = Technique<TwiddlePuzzle, TwiddleState, TwiddleAction>;

const moves = (n: number) => (n === 1 ? "1 more turn" : `${n} more turns`);
const does = (n: number, verb: string) => `${moves(n)} ${n === 1 ? `${verb}s` : verb}`;
export const sequence = (p: TwiddlePuzzle, actions: TwiddleAction[]) => actions.map((a) => describeTurn(p, a)).join(", then ");
const tileName = (p: TwiddlePuzzle, c: number) => (p.rowsOnly ? `a ${goalTile(p, c)}` : String(goalTile(p, c)));
const upright = (p: TwiddlePuzzle) => (p.orientable ? " upright" : "");

function step(p: TwiddlePuzzle, s: TwiddleState, kinds: StepKind[], explain: (h: PermStep<TwiddleAction>) => { message: string; nudge: string }): Step<TwiddleAction> | null {
  const h = hintFor(p, s);
  if (!h || !kinds.includes(h.kind)) return null;
  const { message, nudge } = explain(h);
  return {
    message,
    nudge,
    focus: { moving: h.support, blocks: h.actions.map((a) => a.y * p.w + a.x), home: h.cell, tile: h.from >= 0 ? h.from : undefined } satisfies TwiddleFocus,
    nudgeFocus: { home: h.cell } satisfies TwiddleFocus,
    actions: h.actions,
  };
}

export const turnHome: TwiddleTechnique = {
  id: "twiddle.turn-home",
  name: "turn it home",
  puzzles: ["twiddle"],
  level: 1,
  description: "fill the board in order: the top rows left to right, then the last two rows a column at a time. bring each tile to its spot by turning blocks that hold nothing already finished.",
  find: (p, s) => step(p, s, ["move"], (h) => ({
    message: `${tileName(p, h.cell)} goes at ${at(p, h.cell)}${upright(p)}: ${sequence(p, h.actions)}.${h.left ? ` ${does(h.left, "bring")} it home` : " that puts it home"}, never moving a finished tile.`,
    nudge: `bring ${tileName(p, h.cell)} to ${at(p, h.cell)}${upright(p)}`,
  })),
};

export const blockCycle: TwiddleTechnique = {
  id: "twiddle.cycle",
  name: "turn and turn back",
  puzzles: ["twiddle"],
  level: 2,
  description: "turn one block, then an overlapping one, then undo the first turn and then the second. most tiles come back where they were; only a few, where the blocks overlap, have moved round. that shifts a tile next to finished ones without disturbing them.",
  find: (p, s) => step(p, s, ["cycle"], (h) => ({
    message: `${tileName(p, h.cell)} goes at ${at(p, h.cell)}${upright(p)}, but every block that reaches it holds finished tiles. ${sequence(p, h.actions)}: only the ${h.support.length} highlighted tiles end up moved${h.left ? `, and ${does(h.left, "finish")} the job` : ", which puts it home"}.`,
    nudge: `${tileName(p, h.cell)} needs to reach ${at(p, h.cell)} without moving the finished tiles`,
  })),
  practice: { params: { width: 4, height: 4 } },
};

export const lastTiles: TwiddleTechnique = {
  id: "twiddle.last-tiles",
  name: "last tiles",
  puzzles: ["twiddle"],
  level: 3,
  description: "the last few tiles in the bottom-right corner are sorted together, by turning just the blocks there.",
  find: (p, s) => step(p, s, ["endgame", "parity"], (h) => ({
    message: `the last tiles are sorted together: ${sequence(p, h.actions)}${h.left ? `, then ${moves(h.left)}` : ", and the board is done"}.`,
    nudge: "sort the last few tiles in the corner together",
  })),
  practice: { params: { width: 3, height: 3 } },
};

export const twiddleTechniques: TwiddleTechnique[] = [turnHome, blockCycle, lastTiles];
