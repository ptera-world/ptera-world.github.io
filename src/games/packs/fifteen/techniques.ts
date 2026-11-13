import { cellName as at } from "../../lib/grid-kit/names";
import type { Step, Technique } from "../../core/types";
import type { PermStep, StepKind } from "../../lib/perm";
import { goalTiles, distinct } from "./goal";
import { fifteen, type FifteenAction, type FifteenPuzzle, type FifteenState } from "./logic";
import { describeShift, shiftHint, type ShiftAction, type ShiftFocus, type ShiftPuzzle } from "./shift";
import { slideGoal, type SlideFocus, type SlidePuzzle, type SlideState } from "./slide";
import { groupTiles, nextPlan, type GroupKind, type Plan } from "./solver";
import { describeTurn, turnHint, type TurnAction, type TurnFocus, type TurnPuzzle, type TurnState } from "./turn";

type FifteenTechnique = Technique<FifteenPuzzle, FifteenState, FifteenAction>;
type Visit = (step: Step<FifteenAction>) => boolean | void;

const list = (xs: number[]) => (xs.length === 1 ? String(xs[0]) : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// --- tiles slide into the gap ---

function slideStep(p: SlidePuzzle, s: SlideState, visit: Visit, kind: GroupKind, explain: (tiles: string, plan: Plan) => string): void {
  const plan = nextPlan(p, s);
  if (!plan || plan.group.kind !== kind || !plan.path.length) return;
  const goal = slideGoal(p);
  const tiles = groupTiles(p, plan.group);
  const cell = plan.path[0]!;
  const moving = s.tiles[cell]!;
  const left = plan.path.length;
  const names = list(tiles);
  const homes = tiles.map((t) => goal.indexOf(t));
  visit({
    message: `${explain(names, plan)} slide ${moving} into the gap: ${left === 1 ? "that finishes it" : `${left} moves finish it`} without touching anything already in place.`,
    nudge: `work on ${tiles.length === 1 ? "tile" : "tiles"} ${names}`,
    focus: { press: [cell], homes, tiles: tiles.map((t) => s.tiles.indexOf(t)) } satisfies SlideFocus,
    nudgeFocus: { homes } satisfies SlideFocus,
    actions: [{ type: "move", cell }],
  });
}

const sliding = (p: FifteenPuzzle): p is SlidePuzzle => (p.moves ?? "slide") === "slide";

export const placeTile: FifteenTechnique = {
  id: "fifteen.place",
  name: "next tile home",
  puzzles: [fifteen],
  requires: ["slide"],
  level: 1,
  description: "fill the board a line at a time: an edge row or column of what's left, whichever is longer, working away from where the gap ends up. bring each tile to its spot by walking the gap round it, never moving a tile that's already finished.",
  instances: (p, s, visit) => { if (sliding(p)) slideStep(p, s, visit, "single", (t) => `tile ${t} is next.`); },
  practice: { params: { moves: "slide" } },
};

export const lineEnd: FifteenTechnique = {
  id: "fifteen.line-end",
  name: "last two of a line",
  puzzles: [fifteen],
  requires: ["slide"],
  level: 2,
  description: "the last two tiles of a row (or column) can't go in one after the other: the second would knock the first out. park them side by side just next to their spots, then swing both in together.",
  instances: (p, s, visit) => { if (sliding(p)) slideStep(p, s, visit, "pair", (t) => `tiles ${t} finish this line and go in together.`); },
  practice: { params: { moves: "slide", width: 4, height: 4 } },
};

export const lastSquare: FifteenTechnique = {
  id: "fifteen.last-square",
  name: "last square",
  puzzles: [fifteen],
  requires: ["slide"],
  level: 3,
  description: "once only a 2×2 square is left, its three tiles just go round in a circle: keep turning them the same way until they line up.",
  instances: (p, s, visit) => { if (sliding(p)) slideStep(p, s, visit, "last", (t) => `only ${t} are left, in the last square.`); },
  practice: { params: { moves: "slide", width: 3, height: 3 } },
};

// --- rows and columns shift, blocks turn: one placement method over fixed rearrangements ---

const more = (n: number, unit: string) => (n === 1 ? `1 more ${unit}` : `${n} more ${unit}s`);
const does = (n: number, unit: string, verb: string) => `${more(n, unit)} ${n === 1 ? `${verb}s` : verb}`;

/** How a tile is named: by number, or "a 2" when several tiles share it. */
function tileName(p: ShiftPuzzle | TurnPuzzle, c: number): string {
  const goal = goalTiles({ w: p.w, h: p.h, goal: p.goal, gap: false });
  return distinct(p.goal) ? String(goal[c]) : `a ${goal[c]}`;
}

function permStep<A extends FifteenAction>(h: PermStep<A> | null, kinds: StepKind[], visit: Visit, focus: (h: PermStep<A>) => object, explain: (h: PermStep<A>) => { message: string; nudge: string }): void {
  if (!h || !kinds.includes(h.kind)) return;
  const { message, nudge } = explain(h);
  visit({ message, nudge, focus: focus(h), nudgeFocus: { home: h.cell }, actions: h.actions });
}

const shiftFocus = (h: PermStep<ShiftAction>): ShiftFocus => ({ moving: h.support, home: h.cell, tile: h.from >= 0 ? h.from : undefined });
const shiftSequence = (actions: ShiftAction[]) => actions.map(describeShift).join(", then ");
const shifting = (p: FifteenPuzzle): p is ShiftPuzzle => p.moves === "shift";

export const shiftHome: FifteenTechnique = {
  id: "fifteen.shift-home",
  name: "slide it home",
  puzzles: [fifteen],
  requires: ["shift"],
  level: 1,
  description: "fill the grid in reading order. to bring the next number to its spot, slide rows and columns that hold nothing already finished.",
  instances: (p, s, visit) => {
    if (!shifting(p)) return;
    permStep(shiftHint(p, s.tiles), ["move"], visit, shiftFocus, (h) => {
      const tile = tileName(p, h.cell);
      const after = h.left ? ` ${does(h.left, "move", "bring")} it home` : " that brings it home";
      return {
        message: `${tile} goes at ${at(p, h.cell)}: slide ${shiftSequence(h.actions)}.${after}, never touching a finished number.`,
        nudge: `bring ${tile} to ${at(p, h.cell)}`,
      };
    });
  },
  practice: { params: { moves: "shift" } },
};

export const shiftCycle: FifteenTechnique = {
  id: "fifteen.shift-cycle",
  name: "three-tile cycle",
  puzzles: [fifteen],
  requires: ["shift"],
  level: 2,
  description: "slide a column, then a row, then the column back, then the row back. almost everything returns to where it was; just three tiles have swapped round. that lets you move a number next to finished ones without disturbing them.",
  instances: (p, s, visit) => {
    if (!shifting(p)) return;
    permStep(shiftHint(p, s.tiles), ["cycle"], visit, shiftFocus, (h) => {
      const tile = tileName(p, h.cell);
      return {
        message: `${tile} goes at ${at(p, h.cell)}, but any single slide would knock finished numbers out. slide ${shiftSequence(h.actions)}: only the ${h.support.length} highlighted tiles change places${h.left ? `, and ${does(h.left, "move", "finish")} the job` : ", which puts it home"}.`,
        nudge: `${tile} needs to get to ${at(p, h.cell)} without moving the finished numbers`,
      };
    });
  },
  practice: { params: { moves: "shift", width: 4, height: 4 } },
};

const turning = (p: FifteenPuzzle): p is TurnPuzzle => p.moves === "turn";
const turnSequence = (p: TurnPuzzle, actions: TurnAction[]) => actions.map((a) => describeTurn(p, a)).join(", then ");
const upright = (p: TurnPuzzle) => (p.orientable ? " upright" : "");
const turnFocus = (p: TurnPuzzle) => (h: PermStep<TurnAction>): TurnFocus =>
  ({ moving: h.support, blocks: h.actions.map((a) => a.y * p.w + a.x), home: h.cell, tile: h.from >= 0 ? h.from : undefined });

export const turnHome: FifteenTechnique = {
  id: "fifteen.turn-home",
  name: "turn it home",
  puzzles: [fifteen],
  requires: ["turn"],
  level: 1,
  description: "fill the board in order: the top rows left to right, then the last rows a column at a time. bring each tile to its spot by turning blocks that hold nothing already finished.",
  instances: (p, s, visit) => {
    if (!turning(p)) return;
    permStep(turnHint(p, s as TurnState), ["move"], visit, turnFocus(p), (h) => ({
      message: `${tileName(p, h.cell)} goes at ${at(p, h.cell)}${upright(p)}: ${turnSequence(p, h.actions)}.${h.left ? ` ${does(h.left, "turn", "bring")} it home` : " that puts it home"}, never moving a finished tile.`,
      nudge: `bring ${tileName(p, h.cell)} to ${at(p, h.cell)}${upright(p)}`,
    }));
  },
  practice: { params: { moves: "turn", width: 3, height: 3 } },
};

export const turnCycle: FifteenTechnique = {
  id: "fifteen.turn-cycle",
  name: "turn and turn back",
  puzzles: [fifteen],
  requires: ["turn"],
  level: 2,
  description: "turn one block, then an overlapping one, then undo the first turn and then the second. most tiles come back where they were; only a few, where the blocks overlap, have moved round. that shifts a tile next to finished ones without disturbing them. with big blocks the turns themselves are such sequences, repeated until only three tiles move.",
  instances: (p, s, visit) => {
    if (!turning(p)) return;
    permStep(turnHint(p, s as TurnState), ["cycle"], visit, turnFocus(p), (h) => ({
      message: `${tileName(p, h.cell)} goes at ${at(p, h.cell)}${upright(p)}, but every block that reaches it holds finished tiles. ${turnSequence(p, h.actions)}: only the ${h.support.length} highlighted tiles end up moved${h.left ? `, and ${does(h.left, "turn", "finish")} the job` : ", which puts it home"}.`,
      nudge: `${tileName(p, h.cell)} needs to reach ${at(p, h.cell)} without moving the finished tiles`,
    }));
  },
  practice: { params: { moves: "turn", width: 4, height: 4 } },
};

export const fifteenTechniques: FifteenTechnique[] = [placeTile, lineEnd, lastSquare, shiftHome, shiftCycle, turnHome, turnCycle];

