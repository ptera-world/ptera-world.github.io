import { cellName as at } from "../../lib/grid-kit/names";
import { hintFrom } from "../../core/define";
import type { Hint, Step, Technique } from "../../core/types";
import { netslide, GLYPHS, describeShift, hintFor, target, type NetslideAction, type NetslideFocus, type NetslidePuzzle, type NetslideState } from "./logic";
import type { PermStep, StepKind } from "../../lib/perm";

type NetslideTechnique = Technique<NetslidePuzzle, NetslideState, NetslideAction>;

const moves = (n: number) => (n === 1 ? "1 more slide" : `${n} more slides`);
const does = (n: number, verb: string) => `${moves(n)} ${n === 1 ? `${verb}s` : verb}`;
const sequence = (actions: NetslideAction[]) => actions.map(describeShift).join(", then ");
const piece = (p: NetslidePuzzle, c: number) => `a ${GLYPHS[target(p)![c]!]} piece`;

function step(p: NetslidePuzzle, s: NetslideState, visit: (step: Step<NetslideAction>) => boolean | void, kinds: StepKind[], explain: (h: PermStep<NetslideAction>) => { message: string; nudge: string }): void {
  const h = hintFor(p, s);
  if (!h || !kinds.includes(h.kind)) return;
  const { message, nudge } = explain(h);
  visit({
    message,
    nudge,
    focus: { moving: h.support, home: h.cell, tile: h.from >= 0 ? h.from : undefined } satisfies NetslideFocus,
    nudgeFocus: { home: h.cell } satisfies NetslideFocus,
    actions: h.actions,
  });
}

export const slideHome: NetslideTechnique = {
  id: "netslide.slide-home",
  name: "slide it into place",
  puzzles: [netslide],
  level: 1,
  description: "pick a finished network the pieces can make, then fill it in square by square: bring the right piece to each spot by sliding rows and columns that hold nothing already placed.",
  instances: (p, s, visit) => step(p, s, visit, ["move"], (h) => ({
    message: `${piece(p, h.cell)} fits at ${at(p, h.cell)}: slide ${sequence(h.actions)}.${h.left ? ` ${does(h.left, "bring")} it there` : " that puts it there"}, never moving a piece already placed.`,
    nudge: `find ${piece(p, h.cell)} for ${at(p, h.cell)}`,
  })),
};

export const threeCycle: NetslideTechnique = {
  id: "netslide.cycle",
  name: "three-piece cycle",
  puzzles: [netslide],
  level: 2,
  description: "slide a column, then a row, then the column back, then the row back: only three pieces end up swapped round. that moves a piece next to placed ones without disturbing them.",
  instances: (p, s, visit) => step(p, s, visit, ["cycle"], (h) => ({
    message: `${piece(p, h.cell)} fits at ${at(p, h.cell)}, but any single slide would knock placed pieces out. slide ${sequence(h.actions)}: only the ${h.support.length} highlighted pieces change places${h.left ? `, and ${does(h.left, "finish")} the job` : ", which puts it there"}.`,
    nudge: `${piece(p, h.cell)} needs to reach ${at(p, h.cell)} without moving the placed pieces`,
  })),
  practice: { params: { width: 4, height: 4, barriers: 0 } },
};

export const netslideTechniques: NetslideTechnique[] = [slideHome, threeCycle];

/** The hint: the endgame step when there is one, else the puzzle's own hint. */
export function hint(p: NetslidePuzzle, s: NetslideState): Hint<NetslideAction> | null {
  let found: Step<NetslideAction> | null = null;
  step(p, s, (st) => { found = st; return true; }, ["endgame", "parity"], (h) => ({
    message: `the last pieces are sorted together: slide ${sequence(h.actions)}${h.left ? `, then ${moves(h.left)}` : ", and the network is whole"}.`,
    nudge: "sort the last few pieces together",
  }));
  return found ? (hintFrom(null, found, 1) as Hint<NetslideAction>) : netslide.hint!(p, s);
}
