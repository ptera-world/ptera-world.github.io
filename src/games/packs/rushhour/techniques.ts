import type { Step, Technique } from "../../core/types";
import { carName, describeSlide, type RushAction, type RushFocus, type RushPuzzle, type RushState } from "./logic";
import { cellsOf, exitAt, occupancy, plan, reach, type Slide } from "./solver";

type RushTechnique = Technique<RushPuzzle, RushState, RushAction>;

/** Cells a slide leaves empty, and cells it passes through or ends on. */
function sweep(p: RushPuzzle, pos: readonly number[], s: Slide): { left: number[]; covered: number[] } {
  const from = pos[s.car]!;
  const before = new Set(cellsOf(p, s.car, from));
  const lo = Math.min(from, s.to), hi = Math.max(from, s.to);
  const covered = new Set<number>();
  for (let at = lo; at <= hi; at++) for (const c of cellsOf(p, s.car, at)) covered.add(c);
  const after = new Set(cellsOf(p, s.car, s.to));
  return { left: [...before].filter((c) => !after.has(c)), covered: [...covered].filter((c) => !before.has(c)) };
}

/** Cells between the red car and the exit. */
function lane(p: RushPuzzle, pos: readonly number[]): number[] {
  const red = p.cars[0]!;
  const out: number[] = [];
  for (let x = pos[0]! + red.len; x < p.w; x++) out.push(red.y * p.w + x);
  return out;
}

const movesLeft = (n: number) => (n === 1 ? "that's the last move" : `${n} moves to go by the shortest way`);

function step(s: RushState, m: Slide, message: string, nudge: string, focus: RushFocus): Step<RushAction> {
  return { message, nudge, focus, nudgeFocus: { cars: [m.car] } satisfies RushFocus, actions: [{ type: "slide", car: m.car, to: m.to }] };
}

export const driveOut: RushTechnique = {
  id: "rushhour.drive-out",
  name: "drive out",
  puzzles: ["rushhour"],
  level: 1,
  description: "once nothing stands between the red car and the exit, drive it out.",
  find(p, s) {
    if (s.pos[0] === exitAt(p)) return null;
    const r = reach(p, s.pos, occupancy(p, s.pos), 0);
    if (r.max !== exitAt(p)) return null;
    const m = { car: 0, to: exitAt(p) };
    return step(s, m, "the way to the exit is clear: drive the red car out.", "look at the red car's row", { cars: [0], slide: m, cells: lane(p, s.pos) });
  },
  practice: { params: { width: 6, height: 6, difficulty: "easy" } },
};

export const clearWay: RushTechnique = {
  id: "rushhour.clear-way",
  name: "clear the way",
  puzzles: ["rushhour"],
  level: 2,
  description: "when a shortest way out starts by shifting a car out of the red car's row, do that.",
  find(p, s) {
    const route = plan(p, s.pos);
    const m = route?.[0];
    if (!m || m.car === 0) return null;
    const path = new Set(lane(p, s.pos));
    const freed = sweep(p, s.pos, m).left.filter((c) => path.has(c));
    if (!freed.length) return null;
    return step(s, m, `${describeSlide(p, s, m)}: it's blocking the red car, and moving it there is the start of the shortest way out (${movesLeft(route.length)}).`,
      `which car in the red car's way can move first?`, { cars: [m.car, 0], slide: m, cells: freed });
  },
  practice: { params: { width: 6, height: 6, difficulty: "easy" } },
};

export const makeRoom: RushTechnique = {
  id: "rushhour.make-room",
  name: "make room",
  puzzles: ["rushhour"],
  level: 3,
  description: "work backwards from the red car: what blocks it, what blocks that, and so on. a shortest way out begins by moving a car that makes room for another; this finds one by searching every position.",
  find(p, s) {
    const route = plan(p, s.pos);
    const m = route?.[0];
    if (!m || (m.car === 0 && m.to === exitAt(p))) return null;
    const { left } = sweep(p, s.pos, m);
    let pos = s.pos.slice();
    pos[m.car] = m.to;
    let because: { slide: Slide; index: number } | null = null;
    for (let i = 1; i < route.length && !because; i++) {
      const later = route[i]!;
      if (sweep(p, pos, later).covered.some((c) => left.includes(c))) because = { slide: later, index: i };
      pos = pos.slice();
      pos[later.car] = later.to;
    }
    const why = because
      ? `that makes room for ${carName(because.slide.car)}, which moves ${because.index === 1 ? "next" : `${because.index} moves later`}`
      : "it's the start of the shortest way out";
    return step(s, m, `${describeSlide(p, s, m)}: ${why} (${movesLeft(route.length)}).`, `which car is in the way of the cars blocking the red car?`,
      { cars: [m.car, ...(because ? [because.slide.car] : [])], slide: m, cells: left });
  },
  practice: { params: { width: 6, height: 6, difficulty: "medium" } },
};

export const rushTechniques: RushTechnique[] = [driveOut, clearWay, makeRoom];
