import type { Step, Technique } from "../../core/types";
import { cellList, cellName, dotName, type GalaxiesAction, type GalaxiesFocus, type GalaxiesPuzzle, type GalaxiesState } from "./logic";
import { analyze, freshOwners, geometry, scanSteps, type Owners, type Step as SolverStep, type StepKind } from "./solver";

type GalaxiesTechnique = Technique<GalaxiesPuzzle, GalaxiesState, GalaxiesAction>;

/** What a technique can be aimed at: a tile. */
export type GalaxiesTarget = { tile: number };

const knowledgeCache = new WeakMap<GalaxiesState, Owners>();

/** The board's galaxies, counting a tile only when it is in the right one (every tile when there isn't a unique answer). */
export function knowledge(p: GalaxiesPuzzle, s: GalaxiesState): Owners {
  const hit = knowledgeCache.get(s);
  if (hit) return hit;
  const a = analyze(p);
  const sol = a.count === 1 ? a.solution : null;
  const own = freshOwners(geometry(p));
  s.owner.forEach((d, t) => { if (d >= 0 && own[t] === -1 && (!sol || sol[t] === d)) own[t] = d; });
  knowledgeCache.set(s, own);
  return own;
}

function first(p: GalaxiesPuzzle, s: GalaxiesState, kinds: readonly StepKind[], target?: GalaxiesTarget): { raw: SolverStep; tiles: number[] } | null {
  const own = knowledge(p, s);
  let tiles: number[] = [];
  const raw = scanSteps(p, own, kinds, (st) => (!target || st.tiles.includes(target.tile) || st.because.includes(target.tile))
    && (tiles = st.tiles.filter((t) => s.owner[t] === -1)).length > 0);
  return raw ? { raw, tiles } : null;
}

function build(raw: SolverStep, tiles: number[], message: string, nudge: string, nudgeFocus: GalaxiesFocus): Step<GalaxiesAction> {
  return {
    message, nudge, nudgeFocus,
    focus: { tiles, because: raw.because, dots: [raw.dot] } satisfies GalaxiesFocus,
    actions: [{ type: "paint", tiles, dot: raw.dot }],
  };
}

type Finder = (p: GalaxiesPuzzle, s: GalaxiesState, target?: GalaxiesTarget) => Step<GalaxiesAction> | null;

function technique(def: Omit<GalaxiesTechnique, "find" | "findAt" | "puzzles">, find: Finder): GalaxiesTechnique {
  return { ...def, puzzles: ["galaxies"], find: (p, s) => find(p, s), findAt: (p, s, t) => find(p, s, t as GalaxiesTarget) };
}

const EASY = { width: 5, height: 5, difficulty: "easy" };
const MEDIUM = { width: 7, height: 7, difficulty: "medium" };
const HARD = { width: 7, height: 7, difficulty: "hard" };

export const mirror = technique({
  id: "galaxies.mirror", name: "mirror image", level: 1, practice: { params: EASY },
  description: "a galaxy looks the same turned half a turn around its dot, so every tile in it brings its mirror image (the tile directly opposite, the same distance past the dot) along.",
}, (p, s, target) => {
  const hit = first(p, s, ["mirror"], target);
  if (!hit) return null;
  const t = hit.raw.because[0]!, d = hit.raw.dot;
  return build(hit.raw, hit.tiles,
    `${cellName(p, t)} is in the galaxy of ${dotName(p, d)}, so its mirror image ${cellList(p, hit.tiles)} is too`,
    `turn the galaxy of ${dotName(p, d)} half a turn`, { tiles: [], because: [t], dots: [d] });
});

export const onlyDot = technique({
  id: "galaxies.only-dot", name: "only one dot fits", level: 2, practice: { params: EASY },
  description: "a tile can only join a dot whose galaxy could hold it: its mirror image through that dot must be on the board and free, and the galaxy must be able to reach it. if only one dot is left, the tile is that dot's.",
}, (p, s, target) => {
  const hit = first(p, s, ["only-dot"], target);
  if (!hit) return null;
  const t = hit.tiles[0]!, d = hit.raw.dot;
  return build(hit.raw, hit.tiles,
    `every other dot is ruled out for ${cellName(p, t)} (its mirror image would fall off the board or land in another galaxy, or the galaxy can't reach it), so it belongs to ${dotName(p, d)}`,
    `which dots could ${cellName(p, t)} belong to?`, { tiles: [], because: [t], dots: [] });
});

export const cut = technique({
  id: "galaxies.cut", name: "only way through", level: 3, practice: { params: MEDIUM },
  description: "if part of a galaxy can only be joined to its dot through one tile, that tile is in the galaxy too.",
}, (p, s, target) => {
  const hit = first(p, s, ["cut"], target);
  if (!hit) return null;
  const t = hit.tiles[0]!, d = hit.raw.dot;
  return build(hit.raw, hit.tiles,
    `${cellList(p, hit.raw.because)} can only be joined to ${dotName(p, d)} through ${cellName(p, t)}, so it is in that galaxy too`,
    `how does ${cellList(p, hit.raw.because)} reach ${dotName(p, d)}?`, { tiles: [], because: hit.raw.because, dots: [d] });
});

export const trial = technique({
  id: "galaxies.trial", name: "try each dot", level: 4, practice: { params: HARD },
  description: "give a tile to each dot that could take it in turn and follow the easier techniques. if all but one run into trouble, the tile belongs to the one left.",
}, (p, s, target) => {
  const hit = first(p, s, ["trial"], target);
  if (!hit) return null;
  const t = hit.tiles[0]!, d = hit.raw.dot;
  return build(hit.raw, hit.tiles,
    `giving ${cellName(p, t)} to any other dot breaks a galaxy, so it belongs to ${dotName(p, d)}`,
    `try each dot for ${cellName(p, t)}`, { tiles: [t], because: [], dots: [] });
});

export const galaxiesTechniques: GalaxiesTechnique[] = [mirror, onlyDot, cut, trial];
