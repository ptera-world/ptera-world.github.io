import type { Step, Technique } from "../../core/types";
import { cube, direction, type CubeAction, type CubeFocus, type CubePuzzle, type CubeState } from "./logic";
import { plan, type Plan } from "./solver";

type CubeTechnique = Technique<CubePuzzle, CubeState, CubeAction>;

const rolls = (n: number) => (n === 1 ? "1 roll" : `${n} rolls`);

function step(p: CubePuzzle, s: CubeState, drops: boolean, say: (pl: Plan, d: string) => { message: string; nudge: string }): Step<CubeAction> | null {
  if (s.faces.every(Boolean)) return null;
  const pl = plan(p, s);
  if (!pl || pl.drops !== drops) return null;
  const { route } = pl;
  const { message, nudge } = say(pl, direction(p, s.square, route.squares[0]!));
  return {
    message,
    nudge,
    focus: { route: route.squares, target: route.target >= 0 ? route.target : undefined } satisfies CubeFocus,
    nudgeFocus: { route: route.squares.slice(0, 1) } satisfies CubeFocus,
    actions: [{ type: "roll", to: route.squares[0]! }],
  };
}

export const fetchBlue: CubeTechnique = {
  id: "cube.fetch",
  name: "fetch a blue square",
  puzzles: [cube],
  level: 1,
  description: "roll toward a blue square along a route that lands a plain face on it, without setting a blue face down on a plain square on the way.",
  find: (p, s) => step(p, s, false, (pl, d) => ({
    message: pl.whole
      ? `roll ${d}: it doesn't set any blue down, and ${rolls(pl.route.squares.length)} from here make every face blue.`
      : `roll ${d}: ${rolls(pl.route.squares.length)} land a plain face on the highlighted blue square, without setting a blue face down on the way.`,
    nudge: "roll toward a blue square without losing any blue",
  })),
};

export const makeRoom: CubeTechnique = {
  id: "cube.make-room",
  name: "put one down to pick two up",
  puzzles: [cube],
  level: 2,
  description: "sometimes no blue square can be reached without setting a blue face down first. drop it where it can be picked up again later: a search for a whole route to every face blue decides where.",
  find: (p, s) => step(p, s, true, (pl, d) => ({
    message: `roll ${d}: this sets a blue face down for now, but ${rolls(pl.route.squares.length)} from here make every face blue.`,
    nudge: "a blue face has to go down somewhere to get at the rest",
  })),
  practice: { params: { solid: "cube", d1: 4, d2: 4 } },
};

export const cubeTechniques: CubeTechnique[] = [fetchBlue, makeRoom];
