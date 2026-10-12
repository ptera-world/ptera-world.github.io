import { cellName as at } from "../../lib/grid-kit/names";
import type { Step, Technique } from "../../core/types";
import { sixteen, describeShift, hintFor, type SixteenAction, type SixteenFocus, type SixteenPuzzle, type SixteenState } from "./logic";
import type { PermStep, StepKind } from "../../lib/perm";

type SixteenTechnique = Technique<SixteenPuzzle, SixteenState, SixteenAction>;

const moves = (n: number) => (n === 1 ? "1 more move" : `${n} more moves`);
const does = (n: number, verb: string) => `${moves(n)} ${n === 1 ? `${verb}s` : verb}`;
export const sequence = (actions: SixteenAction[]) => actions.map(describeShift).join(", then ");

function step(p: SixteenPuzzle, s: SixteenState, visit: (step: Step<SixteenAction>) => boolean | void, kinds: StepKind[], explain: (h: PermStep<SixteenAction>) => { message: string; nudge: string }): void {
  const h = hintFor(p, s);
  if (!h || !kinds.includes(h.kind)) return;
  const { message, nudge } = explain(h);
  visit({
    message,
    nudge,
    focus: { moving: h.support, home: h.cell, tile: h.from >= 0 ? h.from : undefined } satisfies SixteenFocus,
    nudgeFocus: { home: h.cell } satisfies SixteenFocus,
    actions: h.actions,
  });
}

export const slideHome: SixteenTechnique = {
  id: "sixteen.slide-home",
  name: "slide it home",
  puzzles: [sixteen],
  level: 1,
  description: "fill the grid in reading order. to bring the next number to its spot, slide rows and columns that hold nothing already finished.",
  instances: (p, s, visit) => step(p, s, visit, ["move"], (h) => {
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
  puzzles: [sixteen],
  level: 2,
  description: "slide a column, then a row, then the column back, then the row back. almost everything returns to where it was; just three tiles have swapped round. that lets you move a number next to finished ones without disturbing them.",
  instances: (p, s, visit) => step(p, s, visit, ["cycle"], (h) => {
    const tile = h.cell + 1;
    return {
      message: `${tile} goes at ${at(p, h.cell)}, but any single slide would knock finished numbers out. slide ${sequence(h.actions)}: only the ${h.support.length} highlighted tiles change places${h.left ? `, and ${does(h.left, "finish")} the job` : ", which puts it home"}.`,
      nudge: `${tile} needs to get to ${at(p, h.cell)} without moving the finished numbers`,
    };
  }),
  practice: { params: { width: 4, height: 4 } },
};

export const sixteenTechniques: SixteenTechnique[] = [slideHome, threeCycle];
