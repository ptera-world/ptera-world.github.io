import type { Step, Technique } from "../../core/types";
import { fifteen, type FifteenAction, type FifteenFocus, type FifteenPuzzle, type FifteenState } from "./logic";
import { groupTiles, nextPlan, type GroupKind, type Plan } from "./solver";

type FifteenTechnique = Technique<FifteenPuzzle, FifteenState, FifteenAction>;

const list = (xs: number[]) => (xs.length === 1 ? String(xs[0]) : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function step(p: FifteenPuzzle, s: FifteenState, kind: GroupKind, explain: (tiles: string, plan: Plan) => string): Step<FifteenAction> | null {
  const plan = nextPlan(p, s);
  if (!plan || plan.group.kind !== kind || !plan.path.length) return null;
  const n = p.w * p.h;
  const tiles = groupTiles(n, plan.group);
  const cell = plan.path[0]!;
  const moving = s.tiles[cell]!;
  const left = plan.path.length;
  const names = list(tiles);
  const homes = tiles.map((t) => t - 1);
  return {
    message: `${explain(names, plan)} slide ${moving} into the gap: ${left === 1 ? "that finishes it" : `${left} moves finish it`} without touching anything already in place.`,
    nudge: `work on ${tiles.length === 1 ? "tile" : "tiles"} ${names}`,
    focus: { press: [cell], homes, tiles: tiles.map((t) => s.tiles.indexOf(t)) } satisfies FifteenFocus,
    nudgeFocus: { homes } satisfies FifteenFocus,
    actions: [{ type: "move", cell }],
  };
}

export const placeTile: FifteenTechnique = {
  id: "fifteen.place",
  name: "next tile home",
  puzzles: [fifteen],
  level: 1,
  description: "fill the board a line at a time: the top row or left column of what's left, whichever is longer. bring each tile to its spot by walking the gap round it, never moving a tile that's already finished.",
  find: (p, s) => step(p, s, "single", (t) => `tile ${t} is next.`),
};

export const lineEnd: FifteenTechnique = {
  id: "fifteen.line-end",
  name: "last two of a line",
  puzzles: [fifteen],
  level: 2,
  description: "the last two tiles of a row (or column) can't go in one after the other: the second would knock the first out. park them side by side just below (or beside) their spots, then swing both in together.",
  find: (p, s) => step(p, s, "pair", (t) => `tiles ${t} finish this line and go in together.`),
  practice: { params: { width: 4, height: 4 } },
};

export const lastSquare: FifteenTechnique = {
  id: "fifteen.last-square",
  name: "last square",
  puzzles: [fifteen],
  level: 3,
  description: "once only a 2×2 corner is left, its three tiles just go round in a circle: keep turning them the same way until they line up.",
  find: (p, s) => step(p, s, "last", (t) => `only ${t} are left, in the last corner.`),
  practice: { params: { width: 3, height: 3 } },
};

export const fifteenTechniques: FifteenTechnique[] = [placeTile, lineEnd, lastSquare];
