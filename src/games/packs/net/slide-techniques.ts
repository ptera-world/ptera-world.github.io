import { cellName as at } from "../../lib/grid-kit/names";
import type { Step, Technique } from "../../core/types";
import type { PermStep, StepKind } from "../../lib/perm";
import { GLYPHS } from "./formats";
import type { NetPuzzle } from "./grid";
import { net, type NetAction, type NetState } from "./logic";
import { describeShift, slideHint, target, type ShiftAction, type SlideFocus } from "./slide";

type NetTechnique = Technique<NetPuzzle, NetState, NetAction>;

const moves = (n: number) => (n === 1 ? "1 more slide" : `${n} more slides`);
const does = (n: number, verb: string) => `${moves(n)} ${n === 1 ? `${verb}s` : verb}`;
const sequence = (actions: ShiftAction[]) => actions.map(describeShift).join(", then ");
const piece = (p: NetPuzzle, c: number) => `a ${GLYPHS[target(p)![c]!]} piece`;

function step(p: NetPuzzle, s: NetState, visit: (step: Step<NetAction>) => boolean | void, kinds: StepKind[], explain: (h: PermStep<ShiftAction>) => { message: string; nudge: string }): void {
  if (!p.slide) return;
  const h = slideHint(p, s.tiles);
  if (!h || !kinds.includes(h.kind)) return;
  const { message, nudge } = explain(h);
  visit({
    message,
    nudge,
    focus: { moving: h.support, home: h.cell, tile: h.from >= 0 ? h.from : undefined } satisfies SlideFocus,
    nudgeFocus: { home: h.cell } satisfies SlideFocus,
    actions: h.actions,
  });
}

export const slideHome: NetTechnique = {
  id: "net.slide-home",
  name: "slide it into place",
  puzzles: [net],
  requires: ["slide"],
  level: 1,
  description: "pick a finished network the pieces can make, then fill it in square by square: bring the right piece to each spot by sliding rows and columns that hold nothing already placed.",
  instances: (p, s, visit) => step(p, s, visit, ["move"], (h) => ({
    message: `${piece(p, h.cell)} fits at ${at(p, h.cell)}: slide ${sequence(h.actions)}.${h.left ? ` ${does(h.left, "bring")} it there` : " that puts it there"}, never moving a piece already placed.`,
    nudge: `find ${piece(p, h.cell)} for ${at(p, h.cell)}`,
  })),
  practice: { params: { moves: "slide", width: 4, height: 4, barriers: 100 } },
};

export const slideCycle: NetTechnique = {
  id: "net.slide-cycle",
  name: "three-piece cycle",
  puzzles: [net],
  requires: ["slide"],
  level: 2,
  description: "slide a column, then a row, then the column back, then the row back: only three pieces end up swapped round. that moves a piece next to placed ones without disturbing them.",
  instances: (p, s, visit) => step(p, s, visit, ["cycle"], (h) => ({
    message: `${piece(p, h.cell)} fits at ${at(p, h.cell)}, but any single slide would knock placed pieces out. slide ${sequence(h.actions)}: only the ${h.support.length} highlighted pieces change places${h.left ? `, and ${does(h.left, "finish")} the job` : ", which puts it there"}.`,
    nudge: `${piece(p, h.cell)} needs to reach ${at(p, h.cell)} without moving the placed pieces`,
  })),
  practice: { params: { moves: "slide", width: 4, height: 4, barriers: 0 } },
};

export const slideTechniques: NetTechnique[] = [slideHome, slideCycle];
