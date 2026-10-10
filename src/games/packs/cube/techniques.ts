import { hintFrom } from "../../core/define";
import type { Hint, Step } from "../../core/types";
import { cube, direction, type CubeAction, type CubeFocus, type CubePuzzle, type CubeState } from "./logic";
import { plan, type Plan } from "./solver";

const rolls = (n: number) => (n === 1 ? "1 roll" : `${n} rolls`);

function step(p: CubePuzzle, s: CubeState, visit: (step: Step<CubeAction>) => boolean | void, drops: boolean, say: (pl: Plan, d: string) => { message: string; nudge: string }): void {
  if (s.faces.every(Boolean)) return;
  const pl = plan(p, s);
  if (!pl || pl.drops !== drops) return;
  const { route } = pl;
  const { message, nudge } = say(pl, direction(p, s.square, route.squares[0]!));
  visit({
    message,
    nudge,
    focus: { route: route.squares, target: route.target >= 0 ? route.target : undefined } satisfies CubeFocus,
    nudgeFocus: { route: route.squares.slice(0, 1) } satisfies CubeFocus,
    actions: [{ type: "roll", to: route.squares[0]! }],
  });
}

const fetchBlue = (pl: Plan, d: string) => ({
  message: pl.whole
    ? `roll ${d}: it doesn't set any blue down, and ${rolls(pl.route.squares.length)} from here make every face blue.`
    : `roll ${d}: ${rolls(pl.route.squares.length)} land a plain face on the highlighted blue square, without setting a blue face down on the way.`,
  nudge: "roll toward a blue square without losing any blue",
});

const makeRoom = (pl: Plan, d: string) => ({
  message: `roll ${d}: this sets a blue face down for now, but ${rolls(pl.route.squares.length)} from here make every face blue.`,
  nudge: "a blue face has to go down somewhere to get at the rest",
});

/** The next roll of a whole route to every face blue (no blue set down first, else with one), else the puzzle's own hint. */
export function hint(p: CubePuzzle, s: CubeState): Hint<CubeAction> | null {
  for (const [drops, say] of [[false, fetchBlue], [true, makeRoom]] as const) {
    let found: Step<CubeAction> | null = null;
    step(p, s, (st) => { found = st; return true; }, drops, say);
    if (found) return hintFrom(null, found, 1) as Hint<CubeAction>;
  }
  return cube.hint?.(p, s) ?? null;
}
