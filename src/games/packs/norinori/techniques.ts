import type { Technique } from "../../core/types";
import type { Deduction } from "../../lib/grid-kit/csp";
import { cellList, cellName, technique, type Focus, type Reading } from "../../lib/grid-kit/names";
import { B, BLACK, DOT, NONE, type Mark, type ShadeAction, type ShadeState } from "../../lib/shade-kit/state";
import { model, norinori, readMarks, type NorinoriPuzzle } from "./logic";

type NorinoriTechnique = Technique<NorinoriPuzzle, ShadeState, ShadeAction>;

const readings = new WeakMap<ShadeState, Reading>();

/** Marks that agree with the unique solution (all of them when there isn't one), so steps never build on a mistake. */
function read(p: NorinoriPuzzle, s: ShadeState): Reading {
  let r = readings.get(s);
  if (!r) readings.set(s, r = { model: model(p), k: readMarks(p, s) });
  return r;
}

const changes = (_p: NorinoriPuzzle, s: ShadeState, d: Deduction): number[] => d.vars.filter((c) => s.marks[c] === NONE);

function step(p: NorinoriPuzzle, d: Deduction, vars: number[], why: string, nudge: string, nudgeFocus: Focus) {
  const shade = d.keep === B;
  const one = vars.length === 1;
  return {
    message: `${why}, so ${cellList(p, vars)} ${shade ? (one ? "is shaded" : "are shaded") : (one ? "stays unshaded" : "stay unshaded")}`,
    nudge,
    focus: { cells: vars, because: d.because, related: d.related ?? [] } satisfies Focus,
    nudgeFocus,
    actions: [{ type: "set" as const, cells: vars, value: (shade ? BLACK : DOT) as Mark }],
  };
}

const regionCells = (p: NorinoriPuzzle, d: Deduction) => {
  const r = (d.data as { region: number }).region;
  return p.regions.flatMap((x, c) => (x === r ? [c] : []));
};

const base = { puzzle: norinori, read, changes };
const EASY = { width: 6, height: 6, difficulty: "easy" };
const NORMAL = { width: 8, height: 8, difficulty: "normal" };
const HARD = { width: 8, height: 8, difficulty: "hard" };

export const regionFull: NorinoriTechnique = technique<NorinoriPuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "norinori.region-full",
  name: "region full",
  level: 1,
  kinds: ["region-full"],
  description: "a region that already has its two shaded cells has no more: the rest of it stays unshaded.",
  explain: (p, _s, d, vars) => step(p, d, vars, `the region with ${cellList(p, d.because)} already has its two shaded cells`, `count the shaded cells in the region around ${cellName(p, vars[0]!)}`, { cells: [], because: [], related: regionCells(p, d) }),
  practice: { params: HARD },
});

export const regionFill: NorinoriTechnique = technique<NorinoriPuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "norinori.region-fill",
  name: "every cell needed",
  level: 2,
  kinds: ["region-fill"],
  description: "a region with exactly as many open cells as shaded cells it still needs: every one of them is shaded.",
  explain: (p, _s, d, vars) => step(p, d, vars, `the region around ${cellName(p, vars[0]!)} needs every open cell it has left to reach two`, `how many open cells does the region around ${cellName(p, vars[0]!)} have left?`, { cells: [], because: [], related: regionCells(p, d) }),
  practice: { params: EASY },
});

export const dominoDone: NorinoriTechnique = technique<NorinoriPuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "norinori.domino-done",
  name: "finished domino",
  level: 3,
  kinds: ["domino-done"],
  description: "two shaded cells side by side make a finished domino, so nothing else beside them can be shaded.",
  explain: (p, _s, d, vars) => step(p, d, vars, `${cellList(p, d.because)} already make a domino`, `look around the domino on ${cellList(p, d.because)}`, { cells: [], because: d.because }),
  practice: { params: EASY },
});

export const dominoForced: NorinoriTechnique = technique<NorinoriPuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "norinori.domino-forced",
  name: "only partner",
  level: 4,
  kinds: ["domino-forced"],
  description: "a shaded cell needs exactly one shaded neighbor. when only one neighbor is still open, that one is its partner.",
  explain: (p, _s, d, vars) => step(p, d, vars, `${cellName(p, d.because[0]!)} is shaded and ${cellName(p, vars[0]!)} is the only neighbor left to pair with`, `which neighbor can ${cellName(p, d.because[0]!)} still pair with?`, { cells: [], because: d.because }),
  practice: { params: HARD },
});

export const noPartner: NorinoriTechnique = technique<NorinoriPuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "norinori.no-partner",
  name: "no room for a domino",
  level: 5,
  kinds: ["no-partner"],
  description: "a cell can only be shaded together with a neighbor. if every neighbor is unshaded, or pairing with it would put too many shaded cells in a region, the cell stays unshaded.",
  explain: (p, _s, d, vars) => step(p, d, vars, `${cellName(p, vars[0]!)} has no neighbor it could make a domino with without overfilling a region`, `could ${cellName(p, vars[0]!)} make a domino with any neighbor?`, { cells: [vars[0]!], because: [] }),
  practice: { params: NORMAL },
});

export const trial: NorinoriTechnique = technique<NorinoriPuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "norinori.trial",
  name: "try it both ways",
  level: 9,
  kinds: ["trial"],
  description: "pretend a cell is shaded (or not) and follow the other techniques from there. if that breaks a rule, the cell must be the other way.",
  explain(p, _s, d, vars) {
    const c = vars[0]!;
    const tried = (d.data as { value: number }).value === 1 ? "were shaded" : "stayed unshaded";
    return step(p, d, vars, `if ${cellName(p, c)} ${tried}, following the other techniques would break a rule`, `try ${cellName(p, c)} both ways`, { cells: [c], because: [] });
  },
  practice: { params: HARD },
});

export const norinoriTechniques: NorinoriTechnique[] = [regionFull, regionFill, dominoDone, dominoForced, noPartner, trial];
