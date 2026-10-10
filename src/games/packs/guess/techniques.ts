import type { Step, Technique } from "../../core/types";
import {
  guess, COLOUR_NAMES, REASON_LIMIT, bestGuess, candidates, codeCount, isOver, rankedGuesses,
  type GuessAction, type GuessFocus, type GuessPuzzle, type GuessState,
} from "./logic";

type GuessTechnique = Technique<GuessPuzzle, GuessState, GuessAction>;

const ordinal = (i: number) => ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"][i] ?? `${i + 1}th`;
const colourName = (c: number) => COLOUR_NAMES[c] ?? `color ${c}`;
const describeCode = (code: readonly number[]) => code.map(colourName).join(", ");
const reasoning = (p: GuessPuzzle, s: GuessState) => !isOver(p, s) && codeCount(p) <= REASON_LIMIT;
const allRows = (s: GuessState) => s.done.map((_, i) => i);

export const knownPeg: GuessTechnique = {
  id: "guess.known-peg",
  name: "known peg",
  puzzles: [guess],
  level: 1,
  description: "go through every code that fits all the marks so far. if they all have the same color in some position, that peg is settled.",
  instances(p, s, visit) {
    const step = knownPegStep(p, s);
    if (step) visit(step);
  },
  findAt: (p, s, target) => knownPegStep(p, s, (target as { slot: number }).slot),
};

function knownPegStep(p: GuessPuzzle, s: GuessState, only?: number): Step<GuessAction> | null {
  if (!reasoning(p, s) || !s.done.length) return null;
  const cand = candidates(p, s);
  if (!cand.length) return null;
  const known = Array.from({ length: p.pegs }, (_, i) => (cand.every((c) => c[i] === cand[0]![i]) ? cand[0]![i]! : 0));
  const slots = known.flatMap((v, i) => (v && s.row[i] !== v && (only === undefined || only === i) ? [i] : []));
  if (!slots.length) return null;
  const what = slots.map((i) => `${colourName(known[i]!)} in the ${ordinal(i)} place`).join(", ");
  return {
    message: `every code that fits all the marks so far has ${what}`,
    nudge: "some peg is the same in every code that still fits",
    focus: { slots, rows: allRows(s) } satisfies GuessFocus,
    nudgeFocus: { slots: [], rows: allRows(s) } satisfies GuessFocus,
    actions: slots.map((i): GuessAction => ({ type: "peg", index: i, colour: known[i]! })),
  };
}

export const lastCode: GuessTechnique = {
  id: "guess.last-code",
  name: "only one code left",
  puzzles: [guess],
  level: 2,
  description: "when exactly one code fits all the marks so far, it must be the answer: guess it.",
  instances(p, s, visit) {
    if (!reasoning(p, s) || !s.done.length) return;
    const cand = candidates(p, s);
    if (cand.length !== 1) return;
    const code = cand[0]!;
    visit({
      message: `only one code fits all the marks so far: ${describeCode(code)}`,
      nudge: "how many codes still fit every mark?",
      focus: { slots: code.map((_, i) => i), rows: allRows(s) } satisfies GuessFocus,
      nudgeFocus: { slots: [], rows: allRows(s) } satisfies GuessFocus,
      actions: [{ type: "row", code }, { type: "submit" }],
    });
  },
};

function guessStep(s: GuessState, best: { code: number[]; worst: number; left: number }): Step<GuessAction> {
  return {
    message: `${best.left} codes still fit. guessing ${describeCode(best.code)} leaves at most ${best.worst} of them, whatever the marks`,
    nudge: "which guess would split the codes that still fit most evenly?",
    focus: { slots: best.code.map((_, i) => i), rows: [] } satisfies GuessFocus,
    nudgeFocus: { slots: [], rows: allRows(s) } satisfies GuessFocus,
    actions: [{ type: "row", code: best.code }, { type: "submit" }],
  };
}

export const narrowDown: GuessTechnique = {
  id: "guess.narrow-down",
  name: "narrow it down",
  puzzles: [guess],
  level: 3,
  description: "pick the guess that, whatever marks it gets, leaves the fewest codes still possible. it may even be a code that can't be the answer, if it splits the rest more evenly.",
  instances(p, s, visit) {
    if (!reasoning(p, s)) return;
    const best = bestGuess(p, s);
    if (!best) return;
    if (visit(guessStep(s, best)) === true) return;
    for (const g of rankedGuesses(p, s).slice(1)) if (visit(guessStep(s, g)) === true) return;
  },
};

export const guessTechniques: GuessTechnique[] = [knownPeg, lastCode, narrowDown];
