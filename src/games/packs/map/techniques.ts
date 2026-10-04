import type { Step, Technique } from "../../core/types";
import { ALL, geometry } from "./grid";
import { map, COLOUR_NAMES, colourList, regionList, regionName, type MapAction, type MapFocus, type MapPuzzle, type MapState } from "./logic";
import { analyze, assign, scanSteps, startKnowledge, type Knowledge, type Step as SolverStep, type StepKind } from "./solver";

type MapTechnique = Technique<MapPuzzle, MapState, MapAction>;

/** What a technique can be aimed at: a region. */
export type MapTarget = { region: number };

const knowledgeCache = new WeakMap<MapState, Knowledge | null>();

/**
 * What the board establishes: colors and pencil marks, each counted only when it agrees with the
 * unique solution (all of them when there isn't one). Null when the counted ones clash.
 */
export function knowledge(p: MapPuzzle, s: MapState): Knowledge | null {
  if (knowledgeCache.has(s)) return knowledgeCache.get(s)!;
  const g = geometry(p);
  const a = analyze(p);
  const sol = a.count === 1 ? a.solution : null;
  let k = startKnowledge(p);
  for (let r = 0; r < p.n && k; r++) {
    if (p.given[r]! >= 0) continue;
    const c = s.colours[r]!;
    if (c >= 0 && (!sol || sol[r] === c) && !assign(g, k, r, c)) k = null;
  }
  for (let r = 0; r < p.n && k; r++) {
    if (s.colours[r]! >= 0 || !s.marks[r]) continue;
    if (sol && !(s.marks[r]! & (1 << sol[r]!))) continue;
    k.dom[r] = k.dom[r]! & s.marks[r]!;
    if (!k.dom[r]) k = null;
  }
  knowledgeCache.set(s, k);
  return k;
}

const single = (m: number): number => (m === 1 ? 0 : m === 2 ? 1 : m === 4 ? 2 : m === 8 ? 3 : -1);

/** Colors the board would show for a region before this step: its pencil marks, or every color no colored neighbor uses. */
function shown(p: MapPuzzle, s: MapState, r: number): number {
  let dom = s.marks[r] || ALL;
  for (const o of geometry(p).adj[r]!) if (s.colours[o]! >= 0) dom &= ~(1 << s.colours[o]!);
  return dom;
}

function changes(p: MapPuzzle, s: MapState, st: SolverStep): { regions: number[]; actions: MapAction[] } {
  const colour = new Map<number, number[]>(), marks = new Map<number, number[]>();
  const regions: number[] = [];
  for (const r of st.regions) {
    if (p.given[r]! >= 0 || s.colours[r]! >= 0) continue;
    const before = shown(p, s, r);
    const after = st.kind === "only-colour" ? 1 << st.colour! : before & ~st.remove;
    if (after === 0 || (after === before && st.kind !== "only-colour")) continue;
    regions.push(r);
    const c = single(after);
    if (c >= 0) colour.set(c, [...(colour.get(c) ?? []), r]);
    else marks.set(after, [...(marks.get(after) ?? []), r]);
  }
  return {
    regions,
    actions: [
      ...[...colour].map(([c, list]): MapAction => ({ type: "colour", regions: list, colour: c })),
      ...[...marks].map(([m, list]): MapAction => ({ type: "marks", regions: list, marks: m })),
    ],
  };
}

function first(p: MapPuzzle, s: MapState, kinds: readonly StepKind[], target?: MapTarget) {
  const k = knowledge(p, s);
  if (!k) return null;
  let ch: ReturnType<typeof changes> = { regions: [], actions: [] };
  const raw = scanSteps(geometry(p), k, kinds, (st) => (!target || st.regions.includes(target.region) || st.because.includes(target.region)) && (ch = changes(p, s, st)).regions.length > 0);
  return raw ? { raw, ...ch } : null;
}

type Finder = (p: MapPuzzle, s: MapState, target?: MapTarget) => Step<MapAction> | null;

function technique(def: Omit<MapTechnique, "find" | "findAt" | "puzzles">, find: Finder): MapTechnique {
  return { ...def, puzzles: [map], find: (p, s) => find(p, s), findAt: (p, s, t) => find(p, s, t as MapTarget) };
}

/** "the region at C5 is red, the region at D2 can't be blue". */
function outcome(p: MapPuzzle, s: MapState, st: SolverStep, regions: readonly number[]): string {
  return regions.map((r) => {
    const before = shown(p, s, r);
    const after = st.kind === "only-colour" ? 1 << st.colour! : before & ~st.remove;
    const c = single(after);
    return c >= 0 ? `${regionName(p, r)} is ${COLOUR_NAMES[c]}` : `${regionName(p, r)} can't be ${colourList(before & ~after)}`;
  }).join(", ");
}

const EASY = { width: 10, height: 8, regions: 14, difficulty: "easy" };
const MEDIUM = { width: 12, height: 10, regions: 20, difficulty: "medium" };
const HARD = { width: 12, height: 10, regions: 20, difficulty: "hard" };

export const onlyColour = technique({
  id: "map.only-colour",
  name: "one color left",
  level: 1,
  description: "a region whose neighbors (and your pencil marks) leave it just one color has that color.",
  practice: { params: EASY },
}, (p, s, target) => {
  const hit = first(p, s, ["only-colour"], target);
  if (!hit) return null;
  const r = hit.raw.regions[0]!;
  return {
    message: `${outcome(p, s, hit.raw, hit.regions)}: it's the only color left once its neighbors are counted`,
    nudge: `which colors can ${regionName(p, r)} still take?`,
    focus: { regions: hit.regions, because: hit.raw.because } satisfies MapFocus,
    nudgeFocus: { regions: [], because: [r] } satisfies MapFocus,
    actions: hit.actions,
  };
});

export const pair = technique({
  id: "map.pair",
  name: "pair of neighbors",
  level: 2,
  description: "two neighboring regions that can only be the same two colors must use both of them, one each. any region touching both of them can't be either color.",
  practice: { params: MEDIUM },
}, (p, s, target) => {
  const hit = first(p, s, ["pair"], target);
  if (!hit) return null;
  const [a, b] = hit.raw.because as [number, number];
  return {
    message: `${regionList(p, [a, b])} touch and can only be ${colourList(hit.raw.remove, "and")}, so they use both. anything touching both can't be either: ${outcome(p, s, hit.raw, hit.regions)}`,
    nudge: `look at ${regionList(p, [a, b])}`,
    focus: { regions: hit.regions, because: [a, b] } satisfies MapFocus,
    nudgeFocus: { regions: [], because: [a, b] } satisfies MapFocus,
    actions: hit.actions,
  };
});

export const trial = technique({
  id: "map.trial",
  name: "try a color",
  level: 3,
  description: "pretend a region has a color and follow the easier techniques from there. if some region ends up with no color left, the first region can't have that color.",
  practice: { params: HARD },
}, (p, s, target) => {
  const hit = first(p, s, ["trial"], target);
  if (!hit) return null;
  const r = hit.raw.regions[0]!;
  return {
    message: `if ${regionName(p, r)} were ${COLOUR_NAMES[hit.raw.colour!]}, the easier techniques would leave some region with no color, so ${outcome(p, s, hit.raw, hit.regions)}`,
    nudge: `try ${COLOUR_NAMES[hit.raw.colour!]} on ${regionName(p, r)}`,
    focus: { regions: hit.regions, because: [] } satisfies MapFocus,
    nudgeFocus: { regions: [], because: [r] } satisfies MapFocus,
    actions: hit.actions,
  };
});

export const mapTechniques: MapTechnique[] = [onlyColour, pair, trial];
