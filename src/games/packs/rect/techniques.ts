import type { Step, Technique } from "../../core/types";
import { cellList, cellName, type Focus } from "../../lib/grid-kit/names";
import {
  rect, edgeCells, geometry, puzzleLayout, readBoard, wallFacts,
  type RectAction, type RectPuzzle, type RectState,
} from "./logic";
import { easyRules, trialRule, type Alive, type Kill, type Layout } from "./solver";

type RectTechnique = Technique<RectPuzzle, RectState, RectAction>;

/** Focus with the edges a step draws. */
export type RectFocus = Focus & { edges?: number[] };

type Kind = Kill["kind"];
const ORDER: readonly Kind[] = ["owned", "only-cover", "trial"];

const kill = (a: Alive, boxes: readonly [number, number][]): boolean => {
  let changed = false;
  for (const [ci, bi] of boxes) {
    if (a[ci]![bi]) {
      a[ci]![bi] = 0;
      changed = true;
    }
  }
  return changed;
};

/** Rules of these kinds to a fixpoint, in place; false on contradiction. */
function fixpoint(l: Layout, a: Alive, kinds: readonly Kind[]): boolean {
  for (;;) {
    let changed = false;
    const snap = a.map((x) => x.slice());
    const easy = kinds.filter((k) => k !== "trial");
    if (!easyRules(l, snap, (k) => {
      changed = kill(a, k.boxes) || changed;
      return false;
    }, easy)) return false;
    if (!changed && kinds.includes("trial")) {
      if (!trialRule(l, a.map((x) => x.slice()), (k) => {
        changed = kill(a, k.boxes) || changed;
        return false;
      })) return false;
    }
    if (!changed) return true;
  }
}

/** The first finding of `kind` that rules out a live box (and is about `target`, if given). */
function one(l: Layout, a: Alive, kind: Kind, target: number | undefined): Kill | null {
  let found: Kill | null = null;
  const accept = (k: Kill) => {
    if (k.kind !== kind || !k.boxes.some(([ci, bi]) => a[ci]![bi])) return false;
    if (target !== undefined && !k.cells.includes(target) && l.clues[k.clue] !== target) return false;
    found = k;
    return true;
  };
  if (kind === "trial") trialRule(l, a.map((x) => x.slice()), accept);
  else easyRules(l, a.map((x) => x.slice()), accept, [kind]);
  return found;
}

function find(p: RectPuzzle, s: RectState, kind: Kind, target?: number): Step<RectAction> | null {
  const l = puzzleLayout(p), g = geometry(p);
  const a = readBoard(p, s);
  const easier = ORDER.slice(0, ORDER.indexOf(kind));
  if (!fixpoint(l, a, easier)) return null;
  const base = wallFacts(p, a);
  let last: Kill | null = null;
  for (let guard = 0; guard < 1000; guard++) {
    const k = one(l, a, kind, guard === 0 ? target : undefined);
    if (!k) return null;
    kill(a, k.boxes);
    last ??= k;
    if (!fixpoint(l, a, easier)) return null;
    const facts = wallFacts(p, a);
    const fresh = g.edges.flatMap((_, e) => (facts[e] && !base[e] && !s.walls[e] ? [e] : []));
    if (fresh.length) return explain(p, kind, last, fresh);
  }
  return null;
}

function explain(p: RectPuzzle, kind: Kind, k: Kill, walls: number[]): Step<RectAction> {
  const l = puzzleLayout(p), g = geometry(p);
  const q = l.clues[k.clue]!, n = p.nums[q]!;
  const at = `the ${n} on ${cellName(p, q)}`;
  let why: string;
  if (kind === "owned") why = `${at} covers ${cellList(p, k.cells)} whichever way it goes, so no other rectangle can`;
  else if (kind === "only-cover") why = `only ${at} can reach ${cellName(p, k.cells[0]!)}`;
  else {
    const [ci, bi] = k.boxes[0]!;
    const b = l.boxes[ci]![bi]!;
    why = `${at} can't be the ${b.w}×${b.h} from ${cellName(p, b.y * p.w + b.x)} to ${cellName(p, (b.y + b.h - 1) * p.w + b.x + b.w - 1)}: the other numbers wouldn't all fit`;
  }
  const pairs = walls.slice(0, 2).map((e) => `${cellName(p, g.edges[e]![0])} and ${cellName(p, g.edges[e]![1])}`);
  const more = walls.length > 2 ? ` and ${walls.length - 2} more` : "";
  const box = kind === "trial" ? l.boxes[k.boxes[0]![0]]![k.boxes[0]![1]]! : null;
  const boxCorners = box ? [box.y * p.w + box.x, (box.y + box.h - 1) * p.w + box.x + box.w - 1] : [];
  return {
    message: `${why}, so there's a wall between ${pairs.join(", and between ")}${more}`,
    nudge: kind === "trial" ? `try out the rectangles for ${at}` : `look at ${at}`,
    focus: { cells: edgeCells(p, walls), because: [q], related: [...k.cells, ...boxCorners], edges: walls } satisfies RectFocus,
    nudgeFocus: { cells: [], because: [q] } satisfies Focus,
    actions: [{ type: "edges", on: walls, off: [] }],
  };
}

/** Walls no rectangle could cross even before any reasoning. */
function uncrossable(p: RectPuzzle, s: RectState, target?: number): Step<RectAction> | null {
  const g = geometry(p);
  const facts = wallFacts(p, readBoard(p, s));
  const fresh = g.edges.flatMap(([a, b], e) => (facts[e] && !s.walls[e] && (target === undefined || a === target || b === target) ? [e] : []));
  if (!fresh.length) return null;
  const [a, b] = g.edges[fresh[0]!]!;
  const more = fresh.length > 1 ? `, and ${fresh.length - 1} more pair${fresh.length > 2 ? "s" : ""} like them` : "";
  return {
    message: `no rectangle can hold both ${cellName(p, a)} and ${cellName(p, b)}${more}, so there's a wall between each`,
    nudge: `which neighbors can never share a rectangle?`,
    focus: { cells: edgeCells(p, fresh), because: [], edges: fresh } satisfies RectFocus,
    nudgeFocus: { cells: [], because: [] } satisfies Focus,
    actions: [{ type: "edges", on: fresh, off: [] }],
  };
}

export const edge: RectTechnique = {
  id: "rect.edge",
  name: "no rectangle fits across",
  puzzles: [rect],
  level: 1,
  description: "two neighboring cells that no number's rectangle could ever hold together (two numbers side by side, say, or cells out of every rectangle's reach together) have a wall between them.",
  find: (p, s) => uncrossable(p, s),
  findAt: (p, s, target) => (typeof target === "number" ? uncrossable(p, s, target) : null),
  practice: { params: { width: 7, height: 7, difficulty: "normal" } },
};

const make = (kind: Kind, id: string, name: string, level: number, description: string, params: Record<string, unknown>): RectTechnique => ({
  id,
  name,
  puzzles: [rect],
  level,
  description,
  find: (p, s) => find(p, s, kind),
  findAt: (p, s, target) => (typeof target === "number" ? find(p, s, kind, target) : null),
  practice: { params },
});

export const owned = make("owned", "rect.owned", "covered either way", 2,
  "cells a number's rectangle covers however it's placed belong to it: no other number's rectangle may cover them, which rules out some of theirs and puts walls where no rectangle can cross.",
  { width: 7, height: 7, difficulty: "normal" });
export const onlyCover = make("only-cover", "rect.only-cover", "only one can reach", 3,
  "every cell is in some rectangle. a cell that only one number's rectangles can reach is in that number's rectangle, which rules out the ones that miss it.",
  { width: 7, height: 7, difficulty: "normal" });
export const trial = make("trial", "rect.trial", "try a rectangle", 4,
  "pretend a number's rectangle is one particular shape and place, and follow the other techniques from there. if the other numbers can't all fit, it isn't that one.",
  { width: 9, height: 9, difficulty: "hard" });

export const rectTechniques: RectTechnique[] = [edge, owned, onlyCover, trial];
