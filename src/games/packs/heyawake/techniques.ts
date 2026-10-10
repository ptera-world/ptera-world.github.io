import type { Technique } from "../../core/types";
import type { Deduction } from "../../lib/grid-kit/csp";
import { cellList, cellName, technique, type Focus, type Reading } from "../../lib/grid-kit/names";
import { B, BLACK, DOT, NONE, WHITE, type Mark, type ShadeAction, type ShadeState } from "../../lib/shade-kit/state";
import { heyawake, model, readMarks, type HeyawakePuzzle } from "./logic";

type HeyawakeTechnique = Technique<HeyawakePuzzle, ShadeState, ShadeAction>;

const readings = new WeakMap<ShadeState, Reading>();

/** Every shaded cell and dot on the board counts. */
function read(p: HeyawakePuzzle, s: ShadeState): Reading {
  let r = readings.get(s);
  if (!r) readings.set(s, r = { model: model(p), k: readMarks(p, s) });
  return r;
}

const changes = (_p: HeyawakePuzzle, s: ShadeState, d: Deduction): number[] => d.vars.filter((c) => s.marks[c] === NONE);

function step(p: HeyawakePuzzle, d: Deduction, vars: number[], why: string, nudge: string, nudgeFocus: Focus) {
  const black = d.keep === B;
  const one = vars.length === 1;
  return {
    message: `${why}, so ${cellList(p, vars)} ${black ? (one ? "is shaded" : "are shaded") : (one ? "stays unshaded" : "stay unshaded")}`,
    nudge,
    focus: { cells: vars, because: d.because, related: d.related ?? [] } satisfies Focus,
    nudgeFocus,
    actions: [{ type: "set" as const, cells: vars, value: (black ? BLACK : DOT) as Mark }],
  };
}

const room = (p: HeyawakePuzzle, d: Deduction) => `the room numbered ${p.clues[(d.data as { room: number }).room]} on ${cellName(p, d.because[0]!)}`;
const base = { puzzle: heyawake, read, changes };
const EASY = { width: 7, height: 7, difficulty: "easy" };

export const blackNeighbour: HeyawakeTechnique = technique<HeyawakePuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "heyawake.black-neighbour",
  name: "next to a shaded cell",
  level: 1,
  kinds: ["black-neighbour"],
  description: "shaded cells can't touch side by side, so every cell next to a shaded cell stays unshaded.",
  explain: (p, _s, d, vars) => step(p, d, vars, `${cellName(p, d.because[0]!)} is shaded and shaded cells can't touch`, `look around the shaded cell on ${cellName(p, d.because[0]!)}`, { cells: [], because: d.because }),
  practice: { params: EASY },
});

export const roomFull: HeyawakeTechnique = technique<HeyawakePuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "heyawake.room-full",
  name: "room has its count",
  level: 2,
  kinds: ["room-full"],
  description: "a numbered room that already has that many shaded cells takes no more: its other cells stay unshaded. a 0 room is all unshaded.",
  explain: (p, _s, d, vars) => step(p, d, vars, `${room(p, d)} already has all its shaded cells`, `count the shaded cells in ${room(p, d)}`, { cells: [], because: d.because }),
  practice: { params: EASY },
});

export const roomFill: HeyawakeTechnique = technique<HeyawakePuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "heyawake.room-fill",
  name: "room needs every cell left",
  level: 3,
  kinds: ["room-fill"],
  description: "when a numbered room has exactly as many open cells left as shaded cells it still needs, all of them are shaded.",
  explain: (p, _s, d, vars) => step(p, d, vars, `${room(p, d)} needs every cell it has left`, `how many cells can ${room(p, d)} still shade?`, { cells: [], because: d.because }),
  practice: { params: EASY },
});

export const span: HeyawakeTechnique = technique<HeyawakePuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "heyawake.span",
  name: "run crosses two walls",
  level: 4,
  kinds: ["span"],
  description: "a straight run of unshaded cells may not cross two room walls. when every other cell of such a stretch is unshaded, the last one must be shaded.",
  explain: (p, _s, d, vars) => step(p, d, vars, `otherwise ${cellList(p, [...d.because, ...vars])} would be an unshaded run across two walls`, `follow the run through ${cellName(p, d.because[0]!)} across the walls`, { cells: [], because: d.because }),
  practice: { params: EASY },
});

export const split: HeyawakeTechnique = technique<HeyawakePuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "heyawake.split",
  name: "would cut the unshaded area",
  level: 5,
  kinds: ["split"],
  description: "a cell whose shading would cut the cells that aren't shaded into two separate pieces stays unshaded, because the unshaded cells must stay connected.",
  explain: (p, _s, d, vars) => step(p, d, vars, `shading ${cellName(p, vars[0]!)} would cut the unshaded area in two`, "which cell holds the unshaded area together?", { cells: [], because: [] }),
  practice: { params: { width: 8, height: 8, difficulty: "normal" } },
});

export const trial: HeyawakeTechnique = technique<HeyawakePuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "heyawake.trial",
  name: "try it both ways",
  level: 6,
  kinds: ["trial"],
  description: "pretend a cell is shaded (or stays unshaded) and follow the other techniques from there. if that breaks a rule, the cell must be the other way.",
  explain(p, _s, d, vars) {
    const c = vars[0]!;
    const tried = (d.data as { value: number }).value === WHITE ? "stayed unshaded" : "were shaded";
    return step(p, d, vars, `if ${cellName(p, c)} ${tried}, following the other techniques would break a rule`, `try ${cellName(p, c)} both ways`, { cells: [c], because: [] });
  },
  practice: { params: { width: 8, height: 8, difficulty: "hard" } },
});

export const heyawakeTechniques: HeyawakeTechnique[] = [blackNeighbour, roomFull, roomFill, span, split, trial];
