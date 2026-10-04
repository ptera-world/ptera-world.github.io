import type { Plugin, Technique } from "../../core/types";
import { COLOUR_NAMES, bestFill, fill, isComplete, region, solverMoves, type FloodAction, type FloodFocus, type FloodPuzzle, type FloodState } from "./logic";

type FloodTechnique = Technique<FloodPuzzle, FloodState, FloodAction>;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Cells a fill of `colour` adds to the flooded area. */
function gained(p: FloodPuzzle, grid: readonly number[], colour: number): number[] {
  const before = region(p.w, p.h, grid);
  const after = region(p.w, p.h, fill(p.w, p.h, grid, colour));
  return [...after.keys()].filter((i) => after[i] && !before[i]);
}

function playable(p: FloodPuzzle, s: FloodState): boolean {
  return !isComplete(s.grid) && s.moves < p.limit;
}

export const clearColour: FloodTechnique = {
  id: "flood.clear-colour",
  name: "wipe out a colour",
  puzzles: ["flood"],
  level: 1,
  description: "if every cell of some colour left on the board touches your area (or joins it through others of that colour), flooding with it takes that colour off the board for good: one fewer colour to come back for.",
  find(p, s) {
    if (!playable(p, s)) return null;
    let best: { colour: number; got: number[] } | null = null;
    for (let c = 0; c < p.colours; c++) {
      if (c === s.grid[0] || !s.grid.includes(c)) continue;
      const next = fill(p.w, p.h, s.grid, c);
      const area = region(p.w, p.h, next);
      if (next.some((v, i) => v === c && !area[i])) continue;
      const got = gained(p, s.grid, c);
      if (!best || got.length > best.got.length) best = { colour: c, got };
    }
    if (!best) return null;
    const name = COLOUR_NAMES[best.colour]!;
    return {
      message: `flood ${name}: every ${name} cell left joins your area (${plural(best.got.length, "cell", "cells")}), so ${name} is gone from the board for good.`,
      nudge: `one colour can be wiped out completely right now`,
      focus: { gained: best.got } satisfies FloodFocus,
      actions: [{ type: "fill", colour: best.colour }],
    };
  },
};

export const lookahead: FloodTechnique = {
  id: "flood.lookahead",
  name: "three moves ahead",
  puzzles: ["flood"],
  level: 2,
  description: "think of each cell's distance as how many fills it takes to reach it. try every sequence of three fills and pick the start that leaves the farthest cell nearest (then the fewest cells that far, then the biggest area). this is the method the move limit is set from.",
  find(p, s) {
    if (!playable(p, s)) return null;
    const c = bestFill(p, s.grid);
    if (c < 0) return null;
    const name = COLOUR_NAMES[c]!;
    const got = gained(p, s.grid, c);
    const finishes = isComplete(fill(p.w, p.h, s.grid, c));
    const left = solverMoves(p, s.grid).length;
    return {
      message: finishes
        ? `flood ${name}: that finishes the board.`
        : `flood ${name} (${plural(got.length, "cell joins", "cells join")}): of every three-fill sequence, starting with ${name} brings the farthest cells closest. the method finishes in ${plural(left, "fill", "fills")} from here.`,
      nudge: "look for the colour that opens up the most of the board, a few moves ahead",
      focus: { gained: got } satisfies FloodFocus,
      actions: [{ type: "fill", colour: c }],
    };
  },
  practice: { params: { width: 8, height: 8, colours: 5, leniency: 0 } },
};

export const floodTechniques: FloodTechnique[] = [clearColour, lookahead];

/** Runs ahead of technique hints (priority 100), so falling behind the limit is pointed out first. */
export const behindPace: Plugin<FloodPuzzle, FloodState, FloodAction, null> = {
  id: "flood.behind",
  name: "hints warn when you fall behind",
  description: "asking for a hint first says so if even the built-in method can no longer finish within the move limit from here",
  category: "assists",
  appliesTo: ["flood"],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => {
      if (isComplete(state.grid)) return undefined;
      const left = puzzle.limit - state.moves;
      const need = solverMoves(puzzle, state.grid).length;
      if (need <= left) return undefined;
      return {
        message: left <= 0
          ? "out of moves. undo to step back"
          : `the built-in method needs ${plural(need, "more fill", "more fills")} from here but only ${left} ${left === 1 ? "is" : "are"} left. undoing a few moves may get you back under the limit.`,
      };
    }, { owner, priority: 90 });
  },
};
