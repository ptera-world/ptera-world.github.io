import type { Step, Technique } from "../../core/types";
import { boardFrom, dotRule, faceRule, loopEarly, type Board, type Deduction } from "./board";
import { cluesOf, gridOf, loopy, type LoopyAction, type LoopyFocus, type LoopyPuzzle, type LoopyState } from "./def";
import type { Grid } from "./grid";
import { clueRef, dotRef, edgeRef } from "./names";
import { findParity, findTrial, findWindow, type WindowKind } from "./solver";

type LoopyTechnique = Technique<LoopyPuzzle, LoopyState, LoopyAction>;

/** Board for (puzzle, state), shared by every technique asked about the same state. Never mutated. */
const boards = new WeakMap<LoopyState, { p: LoopyPuzzle; b: Board }>();

function boardOf(p: LoopyPuzzle, s: LoopyState): Board {
  const hit = boards.get(s);
  if (hit && hit.p === p) return hit.b;
  const b = boardFrom(gridOf(p), cluesOf(p), s.edges);
  boards.set(s, { p, b });
  return b;
}

const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** Where-to-look text naming everything the nudge highlights, without the answer. */
function lookAt(g: Grid, clues: ArrayLike<number>, f: LoopyFocus): string {
  const things = [
    ...(f.vertices ?? []).map((v) => dotRef(g, v)),
    ...(f.faces ?? []).map((x) => clueRef(g, clues[x]!, x)),
    ...(f.edges ?? []).map((e) => edgeRef(g, e)),
  ];
  return things.length ? `look at ${list(things)}` : "look at the highlighted part of the board";
}

function stepOf(b: Board, d: Deduction, nudge?: { text: string; focus: LoopyFocus }): Step<LoopyAction> {
  const x = d.explain();
  const where: LoopyFocus = { faces: x.faces, vertices: x.vertices };
  return {
    message: x.message,
    nudge: nudge?.text ?? lookAt(b.g, b.clues, where),
    focus: { faces: x.faces, vertices: x.vertices, edges: d.edges } satisfies LoopyFocus,
    nudgeFocus: nudge?.focus ?? where,
    actions: [{ type: "set", edges: d.edges, value: d.value }],
  };
}

/**
 * Single-clue / single-dot rules. They only read the clue or dot they name, so they keep working
 * next to a mistake elsewhere on the board (auto-apply never stalls because of one).
 */
function local(kind: string, scan: "faces" | "dots"): (p: LoopyPuzzle, s: LoopyState) => Step<LoopyAction> | null {
  return (p, s) => {
    const b = boardOf(p, s);
    const n = scan === "faces" ? b.g.nf : b.g.nv;
    for (let i = 0; i < n; i++) {
      const d = scan === "faces" ? faceRule(b, i) : dotRule(b, i);
      if (d && d.technique === kind) return stepOf(b, d);
    }
    return null;
  };
}

/** Rules that need the whole board to be consistent; null while it has a contradiction. */
function whole(find: (b: Board) => Deduction | null, nudge?: (g: Grid, d: Deduction) => { text: string; focus: LoopyFocus }) {
  return (p: LoopyPuzzle, s: LoopyState): Step<LoopyAction> | null => {
    const base = boardOf(p, s);
    if (base.conflict) return null;
    const d = find(base.clone());
    return d ? stepOf(base, d, nudge?.(base.g, d)) : null;
  };
}

const windowFind = (kind: WindowKind) => whole((b) => findWindow(b, kind));

const EASY = { difficulty: "easy", width: 6, height: 6 };
const NORMAL = { difficulty: "normal", width: 7, height: 7 };
const TRICKY = { difficulty: "tricky", width: 7, height: 7 };
const HARD = { difficulty: "hard", width: 6, height: 6 };

const def = (t: Omit<LoopyTechnique, "puzzles" | "id"> & { id: string }): LoopyTechnique => ({ ...t, id: `loopy.${t.id}`, puzzles: [loopy] });

/** Every loopy deduction, easiest first. Levels 0-9 are "easy", 10-19 "normal", 20-29 "tricky", 30+ "hard". */
export const techniques: LoopyTechnique[] = [
  def({
    id: "clue-full", name: "finished number", level: 1,
    description: "once a number has as many lines around it as it says, the rest of its edges can't be lines: cross them.",
    find: local("clue-full", "faces"),
    practice: { params: EASY },
  }),
  def({
    id: "dot-full", name: "full dot", level: 2,
    description: "the loop passes through a dot at most once, so a dot never has more than two lines. once it has two, cross its other edges.",
    find: local("dot-full", "dots"),
    practice: { params: EASY },
  }),
  def({
    id: "dot-dead-end", name: "dead end", level: 3,
    description: "the loop never stops. a dot with no lines and only one undecided edge can't use that edge, because a line there would have nowhere to go: cross it.",
    find: local("dot-dead-end", "dots"),
    practice: { params: EASY },
  }),
  def({
    id: "clue-needs-all", name: "number needs every edge", level: 4,
    description: "if a number still needs as many lines as it has undecided edges, every one of them is a line.",
    find: local("clue-needs-all", "faces"),
    practice: { params: EASY },
  }),
  def({
    id: "dot-continue", name: "only way on", level: 5,
    description: "a line that reaches a dot must carry on. if only one edge is left at that dot, the line goes that way.",
    find: local("dot-continue", "dots"),
    practice: { params: EASY },
  }),
  def({
    id: "loop-early", name: "no early loop", level: 6,
    description: "there's only one loop. joining the two ends of a line closes it, so unless that would finish the whole puzzle, the edge between the two ends is crossed.",
    find: whole(loopEarly),
    practice: { params: EASY },
  }),
  def({
    id: "window-face", name: "number and its corners", level: 10,
    description: "look at one number together with the dots at its corners. try every way to fill in its edges that gives each corner dot zero or two lines and doesn't close a small loop. an edge that comes out the same every time is decided. this is where patterns like a 3 in a corner or two 3s side by side come from.",
    find: windowFind("face"),
    practice: { params: NORMAL },
  }),
  def({
    id: "window-dot", name: "dot and its numbers", level: 11,
    description: "look at one dot together with the numbers in the cells around it. try every way to fill in those edges that keeps the dot at zero or two lines and gives each number its count. an edge that comes out the same every time is decided.",
    find: windowFind("dot"),
    practice: { params: NORMAL },
  }),
  def({
    id: "inside-outside", name: "inside and outside", level: 20,
    description: "every cell is either inside the loop or outside it. a line separates the two sides; a cross joins cells on the same side. follow the lines and crosses from cell to cell: if the cells either side of an edge are already known to be on opposite sides, it's a line, and if they're on the same side, it's crossed.",
    find: whole((b) => findParity(b, "direct")),
    practice: { params: TRICKY },
  }),
  def({
    id: "inside-outside-group", name: "shading around a number", level: 21,
    description: "group the cells around a number (or a dot) by which ones the lines and crosses already tie together, then try shading each group inside or outside. a number counts the edges between differently shaded cells, and a dot needs zero or two. edges that come out the same in every shading that fits are decided.",
    find: whole((b) => findParity(b, "group")),
    practice: { params: TRICKY },
  }),
  def({
    id: "window-pair", name: "two numbers together", level: 22,
    description: "like a number and its corners, but with two neighboring numbers at once: try every way to fill in the edges of both that fits both counts and every dot between them. an edge that comes out the same every time is decided.",
    find: windowFind("pair"),
    practice: { params: TRICKY },
  }),
  def({
    id: "trial", name: "what if", level: 30,
    description: "suppose an edge is a line (or crossed) and follow the consequences with the simpler rules. if that runs into something impossible, the edge must be the other way.",
    find: whole(findTrial, (g, d) => ({ text: `suppose ${edgeRef(g, d.edges[0]!)} is a line, or crossed, and follow it through`, focus: { edges: d.edges } })),
    practice: { params: HARD },
  }),
];
