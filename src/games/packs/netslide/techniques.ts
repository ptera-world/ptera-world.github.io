import { cellName } from "../../core/names";
import type { Step, Technique } from "../../core/types";
import { GLYPHS, describeShift, hintFor, target, type NetslideAction, type NetslideFocus, type NetslidePuzzle, type NetslideState } from "./logic";
import type { PermStep, StepKind } from "./perm";

type NetslideTechnique = Technique<NetslidePuzzle, NetslideState, NetslideAction>;

const at = (p: NetslidePuzzle, c: number) => cellName(c % p.w, Math.floor(c / p.w));
const moves = (n: number) => (n === 1 ? "1 more slide" : `${n} more slides`);
const does = (n: number, verb: string) => `${moves(n)} ${n === 1 ? `${verb}s` : verb}`;
const sequence = (actions: NetslideAction[]) => actions.map(describeShift).join(", then ");
const piece = (p: NetslidePuzzle, c: number) => `a ${GLYPHS[target(p)![c]!]} piece`;

function step(p: NetslidePuzzle, s: NetslideState, kinds: StepKind[], explain: (h: PermStep<NetslideAction>) => { message: string; nudge: string }): Step<NetslideAction> | null {
  const h = hintFor(p, s);
  if (!h || !kinds.includes(h.kind)) return null;
  const { message, nudge } = explain(h);
  return {
    message,
    nudge,
    focus: { moving: h.support, home: h.cell, tile: h.from >= 0 ? h.from : undefined } satisfies NetslideFocus,
    nudgeFocus: { home: h.cell } satisfies NetslideFocus,
    actions: h.actions,
  };
}

export const slideHome: NetslideTechnique = {
  id: "netslide.slide-home",
  name: "slide it into place",
  puzzles: ["netslide"],
  level: 1,
  description: "pick a finished network the pieces can make, then fill it in square by square: bring the right piece to each spot by sliding rows and columns that hold nothing already placed.",
  find: (p, s) => step(p, s, ["move"], (h) => ({
    message: `${piece(p, h.cell)} fits at ${at(p, h.cell)}: slide ${sequence(h.actions)}.${h.left ? ` ${does(h.left, "bring")} it there` : " that puts it there"}, never moving a piece already placed.`,
    nudge: `find ${piece(p, h.cell)} for ${at(p, h.cell)}`,
  })),
};

export const threeCycle: NetslideTechnique = {
  id: "netslide.cycle",
  name: "three-piece cycle",
  puzzles: ["netslide"],
  level: 2,
  description: "slide a column, then a row, then the column back, then the row back: only three pieces end up swapped round. that moves a piece next to placed ones without disturbing them.",
  find: (p, s) => step(p, s, ["cycle"], (h) => ({
    message: `${piece(p, h.cell)} fits at ${at(p, h.cell)}, but any single slide would knock placed pieces out. slide ${sequence(h.actions)}: only the ${h.support.length} highlighted pieces change places${h.left ? `, and ${does(h.left, "finish")} the job` : ", which puts it there"}.`,
    nudge: `${piece(p, h.cell)} needs to reach ${at(p, h.cell)} without moving the placed pieces`,
  })),
  practice: { params: { width: 4, height: 4, barriers: 0 } },
};

export const lastPieces: NetslideTechnique = {
  id: "netslide.last-pieces",
  name: "last pieces",
  puzzles: ["netslide"],
  level: 3,
  description: "the last few pieces are sorted together, using slides and short cycles that stay among them.",
  find: (p, s) => step(p, s, ["endgame", "parity"], (h) => ({
    message: `the last pieces are sorted together: slide ${sequence(h.actions)}${h.left ? `, then ${moves(h.left)}` : ", and the network is whole"}.`,
    nudge: "sort the last few pieces together",
  })),
  practice: { params: { width: 3, height: 3, barriers: 0 } },
};

export const netslideTechniques: NetslideTechnique[] = [slideHome, threeCycle, lastPieces];
