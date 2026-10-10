import { hintFrom } from "../../core/define";
import type { Hint, Plugin, Step, Technique } from "../../core/types";
import { flood, COLOUR_NAMES, bestFill, fill, isComplete, region, solverMoves, type FloodAction, type FloodFocus, type FloodPuzzle, type FloodState } from "./logic";

type FloodTechnique = Technique<FloodPuzzle, FloodState, FloodAction>;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Cells a fill of `color` adds to the flooded area. */
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
  name: "wipe out a color",
  puzzles: [flood],
  level: 1,
  description: "if every cell of some color left on the board touches your area (or joins it through others of that color), flooding with it takes that color off the board for good: one fewer color to come back for.",
  instances(p, s, visit) {
    if (!playable(p, s)) return;
    const found: { colour: number; got: number[] }[] = [];
    for (let c = 0; c < p.colours; c++) {
      if (c === s.grid[0] || !s.grid.includes(c)) continue;
      const next = fill(p.w, p.h, s.grid, c);
      const area = region(p.w, p.h, next);
      if (next.some((v, i) => v === c && !area[i])) continue;
      found.push({ colour: c, got: gained(p, s.grid, c) });
    }
    found.sort((a, b) => b.got.length - a.got.length);
    for (const best of found) {
      const name = COLOUR_NAMES[best.colour]!;
      if (visit({
        message: `flood ${name}: every ${name} cell left joins your area (${plural(best.got.length, "cell", "cells")}), so ${name} is gone from the board for good.`,
        nudge: `one color can be wiped out completely right now`,
        focus: { gained: best.got } satisfies FloodFocus,
        actions: [{ type: "fill", colour: best.colour }],
      })) return;
    }
  },
};

export const floodTechniques: FloodTechnique[] = [clearColour];

/** The first fill of the built-in three-moves-ahead method, else the puzzle's own hint. */
export function hint(p: FloodPuzzle, s: FloodState): Hint<FloodAction> | null {
  const c = playable(p, s) ? bestFill(p, s.grid) : -1;
  if (c < 0) return flood.hint?.(p, s) ?? null;
  const name = COLOUR_NAMES[c]!;
  const got = gained(p, s.grid, c);
  const finishes = isComplete(fill(p.w, p.h, s.grid, c));
  const left = solverMoves(p, s.grid).length;
  const found: Step<FloodAction> = {
    message: finishes
      ? `flood ${name}: that finishes the board.`
      : `flood ${name} (${plural(got.length, "cell joins", "cells join")}): of every three-fill sequence, starting with ${name} brings the farthest cells closest. the method finishes in ${plural(left, "fill", "fills")} from here.`,
    nudge: "look for the color that opens up the most of the board, a few moves ahead",
    focus: { gained: got } satisfies FloodFocus,
    actions: [{ type: "fill", colour: c }],
  };
  return hintFrom(null, found, 1) as Hint<FloodAction>;
}

/** Runs ahead of technique hints (priority 100), so falling behind the limit is pointed out first. */
export const behindPace: Plugin<FloodPuzzle, FloodState, FloodAction, null> = {
  id: "flood.behind",
  name: "hints warn when you fall behind",
  description: "asking for a hint first says so if even the built-in method can no longer finish within the move limit from here",
  category: "assists",
  appliesTo: [flood],
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
