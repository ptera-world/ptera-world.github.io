import { cellName } from "../../core/names";
import type { Step, Technique } from "../../core/types";
import { describeShift, hintFor, type SixteenAction, type SixteenFocus, type SixteenPuzzle, type SixteenState } from "./logic";
import type { PermStep, StepKind } from "./perm";

type SixteenTechnique = Technique<SixteenPuzzle, SixteenState, SixteenAction>;

const at = (p: SixteenPuzzle, c: number) => cellName(c % p.w, Math.floor(c / p.w));
const moves = (n: number) => (n === 1 ? "1 more move" : `${n} more moves`);
const does = (n: number, verb: string) => `${moves(n)} ${n === 1 ? `${verb}s` : verb}`;
export const sequence = (actions: SixteenAction[]) => actions.map(describeShift).join(", then ");

function step(p: SixteenPuzzle, s: SixteenState, kinds: StepKind[], explain: (h: PermStep<SixteenAction>) => { message: string; nudge: string }): Step<SixteenAction> | null {
  const h = hintFor(p, s);
  if (!h || !kinds.includes(h.kind)) return null;
  const { message, nudge } = explain(h);
  return {
    message,
    nudge,
    focus: { moving: h.support, home: h.cell, tile: h.from >= 0 ? h.from : undefined } satisfies SixteenFocus,
    nudgeFocus: { home: h.cell } satisfies SixteenFocus,
    actions: h.actions,
  };
}

export const slideHome: SixteenTechnique = {
  id: "sixteen.slide-home",
  name: "slide it home",
  puzzles: ["sixteen"],
  level: 1,
  description: "fill the grid in reading order. to bring the next number to its spot, slide rows and columns that hold nothing already finished.",
  find: (p, s) => step(p, s, ["move"], (h) => {
    const tile = h.cell + 1;
    const after = h.left ? ` ${does(h.left, "bring")} it home` : " that brings it home";
    return {
      message: `${tile} goes at ${at(p, h.cell)}: slide ${sequence(h.actions)}.${after}, never touching a finished number.`,
      nudge: `bring ${tile} to ${at(p, h.cell)}`,
    };
  }),
};

export const threeCycle: SixteenTechnique = {
  id: "sixteen.cycle",
  name: "three-tile cycle",
  puzzles: ["sixteen"],
  level: 2,
  description: "slide a column, then a row, then the column back, then the row back. almost everything returns to where it was; just three tiles have swapped round. that lets you move a number next to finished ones without disturbing them.",
  find: (p, s) => step(p, s, ["cycle"], (h) => {
    const tile = h.cell + 1;
    return {
      message: `${tile} goes at ${at(p, h.cell)}, but any single slide would knock finished numbers out. slide ${sequence(h.actions)}: only the ${h.support.length} highlighted tiles change places${h.left ? `, and ${does(h.left, "finish")} the job` : ", which puts it home"}.`,
      nudge: `${tile} needs to get to ${at(p, h.cell)} without moving the finished numbers`,
    };
  }),
  practice: { params: { width: 4, height: 4 } },
};

export const lastTiles: SixteenTechnique = {
  id: "sixteen.last-tiles",
  name: "last tiles",
  puzzles: ["sixteen"],
  level: 3,
  description: "the last few numbers are sorted together, using row slides and three-tile cycles that stay inside them. on some sizes an arrangement can be 'odd': no amount of three-tile cycles can finish it. one slide of a whole line flips that, and is best done before anything is finished.",
  find: (p, s) => step(p, s, ["endgame", "parity"], (h) => h.kind === "parity"
    ? {
      message: `this arrangement is odd: once everything else is in place, the last two numbers would need a swap that no sequence of three-tile cycles can make. slide ${sequence(h.actions)} now, which flips that, then carry on.`,
      nudge: "this arrangement needs one extra slide before the end can work out",
    }
    : {
      message: `the last numbers are sorted together: slide ${sequence(h.actions)}${h.left ? `, then ${moves(h.left)}` : ", and the grid is done"}.`,
      nudge: "sort the last few numbers together",
    }),
  practice: { params: { width: 3, height: 3 } },
};

export const sixteenTechniques: SixteenTechnique[] = [slideHome, threeCycle, lastTiles];
