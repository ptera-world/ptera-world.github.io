import type { Step, Technique } from "../../core/types";
import { rushhour, type RushAction, type RushFocus, type RushPuzzle, type RushState } from "./logic";
import { exitAt, occupancy, reach, type Slide } from "./solver";

type RushTechnique = Technique<RushPuzzle, RushState, RushAction>;

/** Cells between the red car and the exit. */
function lane(p: RushPuzzle, pos: readonly number[]): number[] {
  const red = p.cars[0]!;
  const out: number[] = [];
  for (let x = pos[0]! + red.len; x < p.w; x++) out.push(red.y * p.w + x);
  return out;
}

function step(s: RushState, m: Slide, message: string, nudge: string, focus: RushFocus): Step<RushAction> {
  return { message, nudge, focus, nudgeFocus: { cars: [m.car] } satisfies RushFocus, actions: [{ type: "slide", car: m.car, to: m.to }] };
}

export const driveOut: RushTechnique = {
  id: "rushhour.drive-out",
  name: "drive out",
  puzzles: [rushhour],
  level: 1,
  description: "once nothing stands between the red car and the exit, drive it out.",
  instances(p, s, visit) {
    if (s.pos[0] === exitAt(p)) return;
    const r = reach(p, s.pos, occupancy(p, s.pos), 0);
    if (r.max !== exitAt(p)) return;
    const m = { car: 0, to: exitAt(p) };
    visit(step(s, m, "the way to the exit is clear: drive the red car out.", "look at the red car's row", { cars: [0], slide: m, cells: lane(p, s.pos) }));
  },
  practice: { params: { width: 6, height: 6, difficulty: "easy" } },
};

export const rushTechniques: RushTechnique[] = [driveOut];
