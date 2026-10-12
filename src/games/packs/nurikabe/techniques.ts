import type { Technique } from "../../core/types";
import type { Deduction } from "../../lib/grid-kit/csp";
import { cellList, cellName, technique, type Focus, type Reading } from "../../lib/grid-kit/names";
import { B, BLACK, DOT, NONE, WHITE, type Mark, type ShadeAction, type ShadeState } from "../../lib/shade-kit/state";
import { model, nurikabe, readMarks, type NurikabePuzzle } from "./logic";

type NurikabeTechnique = Technique<NurikabePuzzle, ShadeState, ShadeAction>;

const readings = new WeakMap<ShadeState, Reading>();

/** Every shaded cell and dot on the board counts. */
function read(p: NurikabePuzzle, s: ShadeState): Reading {
  let r = readings.get(s);
  if (!r) readings.set(s, r = { model: model(p), k: readMarks(p, s) });
  return r;
}

const changes = (p: NurikabePuzzle, s: ShadeState, d: Deduction): number[] => d.vars.filter((c) => p.nums[c] === 0 && s.marks[c] === NONE);

function step(p: NurikabePuzzle, d: Deduction, vars: number[], why: string, nudge: string, nudgeFocus: Focus) {
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

const num = (p: NurikabePuzzle, q: number) => `the ${p.nums[q]} on ${cellName(p, q)}`;
const base = { puzzle: nurikabe, read, changes };
const EASY = { width: 7, height: 7, difficulty: "easy" };

export const islandFull: NurikabeTechnique = technique<NurikabePuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "nurikabe.island-full",
  name: "finished island",
  level: 1,
  kinds: ["island-full"],
  description: "an island that already has as many cells as its number can't grow: every cell around it is sea. a 1 is finished from the start.",
  explain: (p, _s, d, vars) => step(p, d, vars, `the island of ${num(p, d.because[0]!)} is complete`, `count the island of ${num(p, d.because[0]!)}`, { cells: [], because: d.because }),
  practice: { params: EASY },
});

export const joinTwo: NurikabeTechnique = technique<NurikabePuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "nurikabe.join-two",
  name: "between two numbers",
  level: 2,
  kinds: ["join-two"],
  description: "a cell next to two different numbered islands would join them into one island with two numbers, so it is sea.",
  explain: (p, _s, d, vars) => step(p, d, vars, `${cellName(p, vars[0]!)} touches the islands of ${cellList(p, d.because)}, which can't join`, `which cell touches two numbered islands?`, { cells: [], because: d.because }),
  practice: { params: EASY },
});

export const unreachable: NurikabeTechnique = technique<NurikabePuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "nurikabe.unreachable",
  name: "out of reach",
  level: 3,
  kinds: ["unreachable"],
  unit: (_p, _d, vars, target) => (typeof target === "number" && vars.includes(target) ? [target] : vars),
  description: "a cell that no number's island can reach, with the cells that island has left, is sea.",
  explain: (p, _s, d, vars) => step(p, d, vars, `no island can grow far enough to reach ${vars.length === 1 ? "it" : "them"}`, "which cells are too far from every number?", { cells: [], because: [] }),
  practice: { params: EASY },
});

export const pool: NurikabeTechnique = technique<NurikabePuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "nurikabe.pool",
  name: "no 2×2 sea",
  level: 4,
  kinds: ["pool"],
  description: "the sea may not fill a 2×2 block, so when three cells of a block are sea, the fourth is island.",
  explain: (p, _s, d, vars) => step(p, d, vars, `${cellList(p, d.because)} are sea and the sea can't fill a 2×2 block`, `look at the 2×2 block with ${cellName(p, d.because[0]!)}`, { cells: [], because: d.because }),
  practice: { params: EASY },
});

export const islandGrow: NurikabeTechnique = technique<NurikabePuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "nurikabe.island-grow",
  name: "island's only way out",
  level: 5,
  kinds: ["island-grow"],
  description: "an island that still needs cells (or has no number yet) and can only grow through one cell must take that cell.",
  explain: (p, _s, d, vars) => step(p, d, vars, `the island on ${cellList(p, d.because)} still needs to grow and ${cellName(p, vars[0]!)} is its only way out`, `where can the island on ${cellName(p, d.because[0]!)} grow?`, { cells: [], because: d.because }),
  practice: { params: EASY },
});

export const seaGrow: NurikabeTechnique = technique<NurikabePuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "nurikabe.sea-grow",
  name: "sea's only way out",
  level: 6,
  kinds: ["sea-grow"],
  description: "a piece of sea that has to join the rest of the sea and can only grow through one cell must take that cell.",
  explain: (p, _s, d, vars) => step(p, d, vars, `the sea on ${cellList(p, d.because)} has to join the rest and ${cellName(p, vars[0]!)} is its only way out`, `how can the sea on ${cellName(p, d.because[0]!)} reach the rest?`, { cells: [], because: d.because }),
  practice: { params: EASY },
});

export const seaSplit: NurikabeTechnique = technique<NurikabePuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "nurikabe.sea-split",
  name: "would cut the sea",
  level: 7,
  kinds: ["sea-split"],
  description: "a cell whose staying unshaded would cut the sea into two separate pieces must be sea, because the sea is one connected piece.",
  explain: (p, _s, d, vars) => step(p, d, vars, `leaving ${cellName(p, vars[0]!)} unshaded would cut the sea in two`, "which cell holds the sea together?", { cells: [], because: [] }),
  practice: { params: { width: 8, height: 8, difficulty: "normal" } },
});

export const trial: NurikabeTechnique = technique<NurikabePuzzle, ShadeState, ShadeAction>({
  ...base,
  id: "nurikabe.trial",
  name: "try it both ways",
  level: 8,
  kinds: ["trial"],
  description: "pretend a cell is sea (or island) and follow the other techniques from there. if that breaks a rule, the cell must be the other way.",
  explain(p, _s, d, vars) {
    const c = vars[0]!;
    const tried = (d.data as { value: number }).value === WHITE ? "stayed unshaded" : "were shaded";
    return step(p, d, vars, `if ${cellName(p, c)} ${tried}, following the other techniques would break a rule`, `try ${cellName(p, c)} both ways`, { cells: [c], because: [] });
  },
  practice: { params: { width: 8, height: 8, difficulty: "hard" } },
});

export const nurikabeTechniques: NurikabeTechnique[] = [islandFull, joinTwo, unreachable, pool, islandGrow, seaGrow, seaSplit, trial];
