import { hintFrom } from "../../core/define";
import type { Hint, Step, Technique } from "../../core/types";
import { fireAt } from "./beam";
import { blackbox, cellList, entryName, type BlackboxAction, type BlackboxFocus, type BlackboxPuzzle, type BlackboxState } from "./logic";
import { expand, families, familySize, signature, type Evidence, type Families } from "./reason";

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
const total = (k: Families) => k.list.reduce((a, f) => a + familySize(f), 0);

type CellTarget = { cell: number };
type Visit = (step: Step<BlackboxAction>) => boolean | void;

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
  findAt: (p, s, t) => certainBallAt(p, s, (t as CellTarget).cell),
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
  findAt: (p, s, t) => certainEmptyAt(p, s, (t as CellTarget).cell),
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

/** Largest number of layouts compared laser by laser. */
const COMPARE_LIMIT = 600;

function allAgreeSteps(p: BlackboxPuzzle, s: BlackboxState, visit: Visit): void {
  if (s.solved) return;
  const k = knowledge(p, s);
  if (!k.complete || !k.list.length || total(k) > COMPARE_LIMIT) return;
  const all = expand(k.list, COMPARE_LIMIT);
  const sig = signature(p.w, p.h, all[0]!);
  if (!all.every((l) => signature(p.w, p.h, l) === sig)) return;
  const mine = s.guesses.flatMap((g, c) => (g ? [c] : []));
  const layout = all[0]!;
  const same = signature(p.w, p.h, mine) === sig && mine.length >= p.minBalls && mine.length <= p.maxBalls;
  const actions: BlackboxAction[] = same ? [] : [
    { type: "lock", cells: layout.filter((c) => s.locks[c]), value: false },
    { type: "ball", cells: mine.filter((c) => !layout.includes(c)), value: false },
    { type: "ball", cells: layout, value: true },
  ];
  actions.push({ type: "check" });
  visit({
    message: same
      ? "your balls give the same result as every placement that still fits, for every laser: check them"
      : `every placement that still fits gives the same result for every laser, so balls at ${cellList(p, layout)} are as good as any: place them and check`,
    nudge: "could another laser still tell the possible placements apart?",
    focus: { cells: same ? mine : layout, entries: [] } satisfies BlackboxFocus,
    nudgeFocus: { cells: [], entries: fired(s) } satisfies BlackboxFocus,
    actions: actions.filter((a) => a.type === "check" || ("cells" in a && a.cells.length > 0)),
  });
}

/** Largest number of layouts weighed when choosing a laser. */
const SAMPLE_LIMIT = 3000;

function bestShotSteps(p: BlackboxPuzzle, s: BlackboxState, visit: Visit): void {
  if (s.solved) return;
  const k = knowledge(p, s);
  const sample = expand(k.list, SAMPLE_LIMIT);
  if (!sample.length) return;
  const sets = sample.map((l) => new Set(l));
  const shots: { entry: number; worst: number }[] = [];
  for (let e = 0; e < 2 * (p.w + p.h); e++) {
    if (s.shots[e] !== -1) continue;
    const groups = new Map<number, number>();
    let worst = 0;
    for (const set of sets) {
      const r = fireAt(p.w, p.h, set, e);
      const c = (groups.get(r) ?? 0) + 1;
      groups.set(r, c);
      if (c > worst) worst = c;
      if (worst >= sample.length) break;
    }
    if (worst < sample.length) shots.push({ entry: e, worst });
  }
  shots.sort((a, b) => a.worst - b.worst);
  const exact = k.complete && sample.length === total(k);
  for (const { entry, worst } of shots) {
    const hit = visit({
      message: exact
        ? `${sample.length} placements still fit the lasers. firing ${entryName(p, entry)} leaves at most ${worst} of them, whatever comes out`
        : `there are too many placements that fit to count them all, but of the ${sample.length} found, firing ${entryName(p, entry)} leaves at most ${worst}`,
      nudge: "which laser's result can you predict least?",
      focus: { cells: [], entries: [entry] } satisfies BlackboxFocus,
      nudgeFocus: { cells: [], entries: fired(s) } satisfies BlackboxFocus,
      actions: [{ type: "fire", entry }],
    });
    if (hit === true) return;
  }
}

export const blackboxTechniques: BlackboxTechnique[] = [certainBall, certainEmpty];

/** The puzzle's hint: the first step from "nothing left to learn", then "most telling laser", else the puzzle's own hint. */
export function blackboxHint(p: BlackboxPuzzle, s: BlackboxState): Hint<BlackboxAction> | null {
  let hit: Step<BlackboxAction> | null = null;
  const valid = (step: Step<BlackboxAction>) => {
    if (step.actions.length === 0 || Object.is(step.actions.reduce((t, a) => blackbox.reduce(p, t, a), s), s)) return false;
    hit = step;
    return true;
  };
  for (const find of [allAgreeSteps, bestShotSteps]) {
    find(p, s, valid);
    if (hit) return hintFrom(null, hit, 1) as Hint<BlackboxAction>;
  }
  return blackbox.hint?.(p, s) ?? null;
}
