import type { Step as CoreStep, Technique } from "../../core/types";
import {
  findChain, findLocked, findRuleStep, fish, fullHouse, hiddenSingle, hiddenSubset, nakedSingle, nakedSubset, trial,
  type Grid, type Step as EngineStep, type Technique as EngineTechnique,
} from "./engine/human";
import { modelOf } from "./engine/model";
import { constraintTypes } from "./engine/registry";
import type { ConstraintType } from "./engine/types";
import { LATIN_IDS } from "./defs";
import { gridOf, type GridAction, type GridState, type HintFocus, type LatinPuzzle } from "./puzzle";

export type LatinTechnique = Technique<LatinPuzzle, GridState, GridAction>;

/** An engine deduction as core actions: placements become `set`, eliminations one `strike`. */
export function toStep(es: EngineStep): CoreStep<GridAction> {
  const actions: GridAction[] = es.place.map(([c, d]) => ({ type: "set", cells: [c], digit: d }));
  if (es.eliminate.length) actions.push({ type: "strike", marks: es.eliminate, on: true });
  const prefix = `${es.name}: `;
  const message = es.message.startsWith(prefix) ? es.message.slice(prefix.length) : es.message;
  const focus: HintFocus = { cells: es.cells, areas: es.areas, place: es.place, eliminate: es.eliminate, level: 2 };
  const nudgeFocus: HintFocus = { cells: es.nudgeCells ?? (es.areas.length ? [] : es.cells), areas: es.areas, place: [], eliminate: [], level: 0 };
  return { message, nudge: es.nudge, focus, nudgeFocus, actions };
}

export interface LatinTechniqueSpec {
  /** Suffix of the technique id ("sudoku.<key>"). */
  key: string;
  name: string;
  level: number;
  description: string;
  requires?: readonly string[];
  /** Generation params for practice boards. */
  practice?: Record<string, unknown>;
  find(g: Grid, p: LatinPuzzle): EngineStep | null;
}

/** A core technique for every puzzle on the engine, reasoning over gridOf(puzzle, state). */
export function latinTechnique(spec: LatinTechniqueSpec): LatinTechnique {
  return {
    id: `sudoku.${spec.key}`,
    name: spec.name,
    puzzles: LATIN_IDS,
    requires: spec.requires,
    level: spec.level,
    description: spec.description,
    find(p, s) {
      const es = spec.find(gridOf(p, s), p);
      return es ? toStep(es) : null;
    },
    practice: spec.practice ? { params: spec.practice } : undefined,
  };
}

const of = (t: EngineTechnique) => (g: Grid) => t.find(g);

const EASY = { difficulty: "easy" };
const MEDIUM = { difficulty: "medium" };
const HARD = { difficulty: "hard" };
const EXPERT = { difficulty: "expert" };

function typeOfRule(p: LatinPuzzle, rule: number): string {
  const m = modelOf(p);
  return p.constraints[m.ruleSource[rule]!]!.type;
}

/** The technique for one constraint type's rules (null if the type has no `logic`). */
export function clueTechnique(t: ConstraintType): LatinTechnique | null {
  if (!t.logic) return null;
  return latinTechnique({
    key: `clue.${t.type}`,
    name: t.logic.name,
    level: t.logic.level ?? 2,
    description: t.rule ? `${t.rule}. ${t.logic.description}` : t.logic.description,
    requires: [t.type],
    practice: { variants: [t.type], difficulty: "any" },
    find: (g, p) => findRuleStep(g, (r) => typeOfRule(p, r) === t.type),
  });
}

const otherClues = latinTechnique({
  key: "clue.other",
  name: "other clue logic",
  level: 2.2,
  description: "every clue limits which digits its cells can hold. look at one clue at a time and cross out what it can't allow, given the candidates still left around it.",
  requires: ["unnamed-rules"],
  find: (g, p) => findRuleStep(g, (r) => !constraintTypes.get(typeOfRule(p, r))?.logic),
});

const core: LatinTechnique[] = [
  latinTechnique({
    key: "full-house", name: "full house", level: 1, practice: EASY,
    description: "a row, column or box with only one empty cell left: that cell gets the one missing digit.",
    find: of(fullHouse),
  }),
  latinTechnique({
    key: "hidden-single", name: "hidden single", level: 1.2, practice: EASY,
    description: "pick a digit and a row, column or box that still needs it. if every other spot there is blocked (it already sees that digit), the digit goes in the one spot left.",
    find: of(hiddenSingle),
  }),
  latinTechnique({
    key: "naked-single", name: "naked single", level: 1.5, practice: EASY,
    description: "a cell whose row, column, box (and any other group it belongs to) already contain every digit but one. that last digit is the only thing it can be.",
    find: of(nakedSingle),
  }),
  latinTechnique({
    key: "pointing", name: "pointing", level: 2.6, requires: ["boxes"], practice: MEDIUM,
    description: "inside a box, a digit's possible cells all lie on one row (or column). it must end up on that line inside this box, so it can't go anywhere else on that line.",
    find: (g) => findLocked(g, "pointing"),
  }),
  latinTechnique({
    key: "claiming", name: "claiming", level: 2.7, requires: ["boxes"], practice: MEDIUM,
    description: "on a row (or column), a digit's possible cells all sit inside one box. the line claims it there, so the rest of that box can't hold it.",
    find: (g) => findLocked(g, "claiming"),
  }),
  latinTechnique({
    key: "locked-candidates", name: "locked candidates", level: 2.8, practice: MEDIUM,
    description: "every possible spot for a digit in some group sees the same other cells (through a diagonal, cage or other rule). whichever spot it takes, those cells are blocked, so cross the digit out there.",
    find: (g) => findLocked(g, "locked candidates"),
  }),
  latinTechnique({
    key: "naked-pair", name: "naked pair", level: 3, practice: HARD,
    description: "two cells in one group that can each only be the same two digits. those digits are used up by the pair, so remove them from every other cell that sees both.",
    find: of(nakedSubset(2, 3)),
  }),
  latinTechnique({
    key: "hidden-pair", name: "hidden pair", level: 3.4, practice: HARD,
    description: "two digits that, within one group, can only go in the same two cells. those cells must hold that pair, so any other candidates in them can go.",
    find: of(hiddenSubset(2, 3.4)),
  }),
  latinTechnique({
    key: "naked-triple", name: "naked triple", level: 3.8, practice: HARD,
    description: "three cells in one group whose candidates, together, are only three digits (each cell may have just two of them). the three digits belong to those cells, so remove them from the rest of the group.",
    find: of(nakedSubset(3, 3.8)),
  }),
  latinTechnique({
    key: "x-wing", name: "x-wing", level: 4, practice: HARD,
    description: "a digit has exactly two spots in each of two rows, and those spots line up in the same two columns, making a rectangle. the digit takes opposite corners either way, so it can't go anywhere else in those two columns. works with rows and columns swapped too.",
    find: of(fish(2, 4.4)),
  }),
  latinTechnique({
    key: "x-chain", name: "x-chain", level: 4.1, practice: HARD,
    description: "follow one digit through groups where it has exactly two spots: if it isn't here, it must be there. a chain of these links alternating with \"these two can't both be it\" proves one end or the other holds the digit, so any cell seeing both ends can't. skyscrapers and kites are short x-chains.",
    find: (g) => findChain(g, { links: "x" }),
  }),
  latinTechnique({
    key: "hidden-triple", name: "hidden triple", level: 4.2, practice: HARD,
    description: "three digits that, within one group, only fit in the same three cells. those cells hold those digits, so their other candidates can go.",
    find: of(hiddenSubset(3, 4.2)),
  }),
  latinTechnique({
    key: "xy-wing", name: "xy-wing", level: 4.3, practice: HARD,
    description: "three cells with two candidates each: a pivot XY that sees two pincers XZ and YZ. whichever digit the pivot takes, one of the pincers becomes Z, so a cell seeing both pincers can't be Z.",
    find: (g) => findChain(g, { links: "xy", minLen: 6, maxLen: 6 }),
  }),
  latinTechnique({
    key: "xy-chain", name: "xy-chain", level: 4.8, practice: EXPERT,
    description: "a longer xy-wing: a path of two-candidate cells, each sharing a digit with the next. if the first cell isn't the end digit, the choices ripple down the chain until the last cell is. cells seeing both ends can't hold that digit.",
    find: (g) => findChain(g, { links: "xy", minLen: 8 }),
  }),
  latinTechnique({
    key: "naked-quad", name: "naked quad", level: 5, practice: EXPERT,
    description: "four cells in one group whose candidates together are only four digits. remove those digits from the rest of the group.",
    find: of(nakedSubset(4, 5)),
  }),
  latinTechnique({
    key: "hidden-quad", name: "hidden quad", level: 5.4, practice: EXPERT,
    description: "four digits that, within one group, only fit in the same four cells. those cells lose every other candidate.",
    find: of(hiddenSubset(4, 5.4)),
  }),
  latinTechnique({
    key: "swordfish", name: "swordfish", level: 5.6, practice: EXPERT,
    description: "an x-wing over three rows: a digit's spots in three rows all fall in the same three columns. the digit fills one spot per row and per column, so it can't go elsewhere in those columns.",
    find: of(fish(3, 5.6)),
  }),
  latinTechnique({
    key: "jellyfish", name: "jellyfish", level: 6.5, practice: EXPERT,
    description: "the same idea over four rows and four columns.",
    find: of(fish(4, 6.5)),
  }),
  latinTechnique({
    key: "alternating-chain", name: "alternating chain", level: 6.8, practice: EXPERT,
    description: "the general chain: mix either-or links of a digit within a group and of the two candidates in a cell. a chain that starts and ends on such a link means one of its ends is true, so anything that conflicts with both ends goes.",
    find: (g) => findChain(g),
  }),
  latinTechnique({
    key: "trial", name: "trial and error", level: 8, practice: { difficulty: "extreme" },
    description: "the last resort: assume a digit, follow the simple consequences, and if they break a rule, that digit was wrong.",
    find: of(trial),
  }),
];

/** Every built-in technique, including one per constraint type that describes its logic. */
export function latinTechniques(): LatinTechnique[] {
  const clues = constraintTypes.list().flatMap((t) => clueTechnique(t) ?? []);
  return [...core, ...clues, otherClues];
}
