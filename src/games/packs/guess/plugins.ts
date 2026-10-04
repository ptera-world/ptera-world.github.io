import type { Plugin } from "../../core/types";
import { COLOUR_NAMES, mark, type GuessAction, type GuessFocus, type GuessInteraction, type GuessPuzzle, type GuessState } from "./logic";

type GuessPlugin = Plugin<GuessPuzzle, GuessState, GuessAction, GuessInteraction>;

/** The first marked guess the row would have been marked differently against, if the row were the code. */
export function contradiction(p: GuessPuzzle, s: GuessState): number {
  if (s.row.some((v) => v === 0)) return -1;
  return s.done.findIndex((g) => {
    const m = mark(g.code, s.row, p.colours);
    return m.black !== g.black || m.white !== g.white;
  });
}

/** Runs ahead of technique hints (priority 100): a full guess that can't be the code is pointed out first. */
export const checkRow: GuessPlugin = {
  id: "guess.check-row",
  name: "hints check your guess first",
  description: "asking for a hint first says whether the guess you're building can't be the code, because an earlier guess would have been marked differently",
  category: "assists",
  appliesTo: ["guess"],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => {
      const i = contradiction(puzzle, state);
      if (i < 0) return undefined;
      const g = state.done[i]!;
      return {
        message: `this guess can't be the code: against it, guess ${i + 1} (${g.code.map((c) => COLOUR_NAMES[c]).join(", ")}) would have scored differently than ${g.black} black and ${g.white} white`,
        focus: { slots: state.row.map((_, j) => j), rows: [i] } satisfies GuessFocus,
      };
    }, { owner, priority: 90 });
  },
};

export const guessPlugins: GuessPlugin[] = [checkRow];
