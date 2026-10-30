import type { Plugin, PuzzleRef, Step, Technique } from "../../core/types";
import type { PokemonDataset } from "../../lib/pokemon/types";
import { candidates, fits, isOver, wordsOf, type WordleAction, type WordleFocus, type WordlePuzzle, type WordleState } from "./logic";

type WT = Technique<WordlePuzzle, WordleState, WordleAction>;

const ordinal = (i: number) => `${i + 1}${i === 0 ? "st" : i === 1 ? "nd" : i === 2 ? "rd" : "th"}`;
const allRows = (s: WordleState) => s.done.map((_, i) => i);

/** Letters the same in every name that still fits, and the techniques and checks built on that. */
export function makeTechniques(def: PuzzleRef, dataset: () => PokemonDataset | undefined): { techniques: WT[]; plugins: Plugin<WordlePuzzle, WordleState, WordleAction>[] } {
  const left = (p: WordlePuzzle, s: WordleState): string[] | null => {
    const d = dataset();
    if (!d || isOver(p, s) || !s.done.length) return null;
    const c = candidates(wordsOf(d), p, s);
    return c.length ? c : null;
  };

  const knownStep = (p: WordlePuzzle, s: WordleState): Step<WordleAction> | null => {
    const c = left(p, s);
    if (!c || c.length < 2) return null;
    const slots = s.row.flatMap((have, i) => (c.every((w) => w[i] === c[0]![i]) && have !== c[0]![i] ? [i] : []));
    if (!slots.length) return null;
    const row = s.row.slice();
    for (const i of slots) row[i] = c[0]![i]!;
    const what = slots.map((i) => `${c[0]![i]!.toUpperCase()} ${ordinal(i)}`).join(", ");
    return {
      message: `all ${c.length} names that still fit every mark have ${what}`,
      nudge: "some letter is the same in every name that still fits",
      focus: { slots, rows: allRows(s) } satisfies WordleFocus,
      nudgeFocus: { slots: [], rows: allRows(s) } satisfies WordleFocus,
      actions: [{ type: "row", row }],
    };
  };

  const known: WT = {
    id: "pokewordle.known-letter",
    name: "known letter",
    puzzles: [def],
    level: 1,
    description: "think of every pokémon name of this length that fits all the marks so far. a letter they all have in the same place is settled, even if no guess has turned it green yet.",
    instances(p, s, visit) { const st = knownStep(p, s); if (st) visit(st); },
  };

  const last: WT = {
    id: "pokewordle.last-name",
    name: "only one name left",
    puzzles: [def],
    level: 2,
    description: "when exactly one pokémon name fits all the marks so far, it is the answer: guess it.",
    instances(p, s, visit) {
      const c = left(p, s);
      if (!c || c.length !== 1) return;
      visit({
        message: `only one name fits every mark: ${c[0]!.toUpperCase()}`,
        nudge: "how many names still fit every mark?",
        focus: { slots: s.row.map((_, i) => i), rows: allRows(s) } satisfies WordleFocus,
        nudgeFocus: { slots: [], rows: allRows(s) } satisfies WordleFocus,
        actions: [{ type: "row", row: c[0]!.split("") }, { type: "submit" }],
      });
    },
  };

  /** Runs ahead of technique hints: a typed name that can't be the answer is pointed out first. */
  const checkRow: Plugin<WordlePuzzle, WordleState, WordleAction> = {
    id: "pokewordle.check-row",
    name: "hints check your guess first",
    description: "asking for a hint first says whether the name you've typed can't be the answer, because an earlier guess would have been marked differently",
    category: "assists",
    appliesTo: [def],
    enabledByDefault: true,
    setup({ session, owner }) {
      session.hooks.hint.tap(({ puzzle, state }) => {
        if (isOver(puzzle, state) || state.row.some((c) => !c)) return undefined;
        const word = state.row.join("");
        const i = state.done.findIndex((g) => !fits(g, word));
        if (i < 0) return undefined;
        return {
          message: `${word.toUpperCase()} can't be the answer: against it, ${state.done[i]!.word.toUpperCase()} would have been marked differently`,
          focus: { slots: state.row.map((_, j) => j), rows: [i] } satisfies WordleFocus,
        };
      }, { owner, priority: 90 });
    },
  };

  return { techniques: [known, last], plugins: [checkRow] };
}
