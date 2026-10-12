import type { Step, Technique } from "../../core/types";
import { blackbox, cellList, type BlackboxAction, type BlackboxFocus, type BlackboxPuzzle, type BlackboxState } from "./logic";
import { families, type Evidence, type Families } from "./reason";

type BlackboxTechnique = Technique<BlackboxPuzzle, BlackboxState, BlackboxAction>;

export function evidence(p: BlackboxPuzzle, s: BlackboxState): Evidence {
  const shots: [number, number][] = [];
  const seen = new Set<number>();
  for (const e of s.order) {
    if (seen.has(e)) continue;
    seen.add(e);
    shots.push([e, s.shots[e]!]);
  }
  return { w: p.w, h: p.h, minBalls: p.minBalls, maxBalls: p.maxBalls, shots };
}

const familyCache = new WeakMap<BlackboxState, Families>();

/** Layouts that agree with every laser fired so far (only what the player has seen). */
export function knowledge(p: BlackboxPuzzle, s: BlackboxState): Families {
  let f = familyCache.get(s);
  if (!f) familyCache.set(s, f = families(evidence(p, s)));
  return f;
}

/** Cells that hold a ball in every layout that fits, and cells that are empty in every one. */
export function certain(p: BlackboxPuzzle, s: BlackboxState): { balls: number[]; empty: number[] } | null {
  const k = knowledge(p, s);
  if (!k.complete || !k.list.length) return null;
  const n = p.w * p.h;
  const always = new Uint8Array(n).fill(1), never = new Uint8Array(n).fill(1);
  for (const f of k.list) {
    const isBall = new Uint8Array(n), maybe = new Uint8Array(n);
    for (const c of f.balls) isBall[c] = 1;
    for (const c of f.free) {
      if (f.least === f.free.length) isBall[c] = 1;
      else if (f.most > 0) maybe[c] = 1;
    }
    for (let c = 0; c < n; c++) {
      if (!isBall[c]) always[c] = 0;
      if (isBall[c] || maybe[c]) never[c] = 0;
    }
  }
  const balls: number[] = [], empty: number[] = [];
  for (let c = 0; c < n; c++) {
    if (always[c]) balls.push(c);
    if (never[c]) empty.push(c);
  }
  return { balls, empty };
}

/** "the laser above column C". */
const fired = (s: BlackboxState) => s.shots.flatMap((v, e) => (v !== -1 ? [e] : []));

type CellTarget = { cell: number };

const cellOf = (t: unknown): number | null => (t && typeof (t as CellTarget).cell === "number" ? (t as CellTarget).cell : null);

/** Aimed finds for a technique that decides cells one at a time: the pointed cell's step, its only instance there. */
function aimed(at: (p: BlackboxPuzzle, s: BlackboxState, only: number) => Step<BlackboxAction> | null): Pick<BlackboxTechnique, "findAt" | "instancesAt" | "cellAt"> {
  const find = (p: BlackboxPuzzle, s: BlackboxState, t: unknown) => { const c = cellOf(t); return c === null ? null : at(p, s, c); };
  return {
    findAt: find,
    instancesAt: (p, s, t, visit) => { const step = find(p, s, t); if (step) visit(step); },
    cellAt: find,
  };
}

export const certainBall: BlackboxTechnique = {
  id: "blackbox.certain-ball",
  name: "ball for sure",
  puzzles: [blackbox],
  level: 1,
  description: "go through every way the balls could be placed that gives exactly the laser results so far. a cell that holds a ball in all of them certainly has one.",
  instances(p, s, visit) {
    const step = certainBallAt(p, s);
    if (step) visit(step);
  },
  ...aimed(certainBallAt),
};

function certainBallAt(p: BlackboxPuzzle, s: BlackboxState, only?: number) {
  if (s.solved) return null;
  const c = certain(p, s);
  const cells = c?.balls.filter((x) => !s.guesses[x] && !s.locks[x] && (only === undefined || x === only)) ?? [];
  if (!cells.length) return null;
  return {
    message: `every way of placing the balls that fits the lasers so far has a ball at ${cellList(p, cells)}`,
    nudge: "some cell has a ball however the rest are placed",
    focus: { cells, entries: fired(s) } satisfies BlackboxFocus,
    nudgeFocus: { cells: [], entries: fired(s) } satisfies BlackboxFocus,
    actions: [{ type: "ball" as const, cells, value: true }],
  };
}

export const certainEmpty: BlackboxTechnique = {
  id: "blackbox.certain-empty",
  name: "empty for sure",
  puzzles: [blackbox],
  level: 2,
  description: "a cell that is empty in every way the balls could be placed to give the laser results so far can't hold a ball. it gets locked so you don't put one there.",
  instances(p, s, visit) {
    const step = certainEmptyAt(p, s);
    if (step) visit(step);
  },
  ...aimed(certainEmptyAt),
};

function certainEmptyAt(p: BlackboxPuzzle, s: BlackboxState, only?: number) {
  if (s.solved) return null;
  const c = certain(p, s);
  const cells = c?.empty.filter((x) => !s.guesses[x] && !s.locks[x] && (only === undefined || x === only)) ?? [];
  if (!cells.length) return null;
  return {
    message: `no way of placing the balls that fits the lasers so far puts one at ${cellList(p, cells)}, so ${cells.length === 1 ? "it's" : "they're"} empty`,
    nudge: "some cells can't hold a ball whatever the rest do",
    focus: { cells, entries: fired(s) } satisfies BlackboxFocus,
    nudgeFocus: { cells: [], entries: fired(s) } satisfies BlackboxFocus,
    actions: [{ type: "lock" as const, cells, value: true }],
  };
}

export const blackboxTechniques: BlackboxTechnique[] = [certainBall, certainEmpty];
