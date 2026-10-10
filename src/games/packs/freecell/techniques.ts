import type { Plugin, Step, Technique } from "../../core/types";
import { cardName, safeHomeReason } from "../../lib/cards/deck";
import { planner } from "../../lib/plan";
import type { CardFocus } from "../../lib/cards/table";
import { describeMove, freecell, whereTo, fromPos, pileName, toPos, type FreecellAction, type FreecellInteraction, type FreecellPuzzle, type FreecellState } from "./logic";
import { applyMove, clonePos, eachSafeHomeMove, isSafeHome, solve, type Move } from "./solver";

type FreecellTechnique = Technique<FreecellPuzzle, FreecellState, FreecellAction>;

/** Nodes the hint search may expand before giving up (a few hundred milliseconds at worst). */
const HINT_BUDGET = 40_000;

const stateKey = (s: FreecellState) => s.piles.map((pl) => pl.c.join(".")).join("|");

export const plan = planner<FreecellPuzzle, FreecellState, Move>({
  key: stateKey,
  init: (p) => ({ piles: fromPos({ cols: p.cols, cells: p.cells, found: p.found }), moves: 0 }),
  step: (p, s, m) => {
    const pos = toPos(s, p.cells.length);
    applyMove(pos, m);
    return { piles: fromPos(pos), moves: s.moves + 1 };
  },
  search: (p, s) => solve(toPos(s, p.cells.length), HINT_BUDGET),
  known: (p) => p.solution,
});

type Kind = "home" | "build" | "park" | "empty";

function kindOf(p: FreecellPuzzle, s: FreecellState, m: Move): Kind {
  const C = p.cells.length;
  if (m.to >= C && m.to < C + 4) return "home";
  if (m.to < C) return "park";
  return s.piles[m.to]!.c.length ? "build" : "empty";
}

const lead = (s: FreecellState, m: Move) => s.piles[m.from]!.c[s.piles[m.from]!.c.length - m.n]!;

/** Why the first move of `path` helps, from what the next few moves of the same line do. */
function reason(p: FreecellPuzzle, s: FreecellState, path: readonly Move[]): string {
  const m = path[0]!;
  const C = p.cells.length;
  const pos = toPos(s, C);
  const card = lead(s, m);
  if (m.to >= C && m.to < C + 4) {
    return isSafeHome(pos.found, card)
      ? safeHomeReason(card)
      : "the winning line sends it home now";
  }
  const after = clonePos(pos);
  applyMove(after, m);
  const src = s.piles[m.from]!.c;
  const exposed = m.from >= C + 4 && src.length > m.n ? src[src.length - m.n - 1]! : -1;
  const movedTop = src[src.length - 1];
  for (const next of path.slice(1, 6)) {
    const st = { piles: fromPos(after), moves: 0 };
    const moved = lead(st, next);
    if (moved === exposed) return `this frees ${cardName(exposed)} under it, which then goes ${whereTo(p, st, next)}`;
    const dst = st.piles[next.to]!.c;
    if (next.to >= C + 4 && dst[dst.length - 1] === movedTop) return `so that ${cardName(moved)} can go on it next`;
    applyMove(after, next);
  }
  if (m.from >= C + 4 && src.length === m.n) return `this empties ${pileName(p, m.from)}, room to sort out another column`;
  if (m.from < C) return "this frees a cell";
  if (exposed >= 0) return `this gets at ${cardName(exposed)} under it`;
  return "it keeps the winning line going";
}

function stepFor(p: FreecellPuzzle, s: FreecellState, path: readonly Move[]): Step<FreecellAction> {
  const m = path[0]!;
  const src = s.piles[m.from]!.c;
  const rest = path.length - 1;
  const tail = rest ? ` the solver finds a win ${rest} ${rest === 1 ? "move" : "moves"} after that.` : " that wins.";
  return {
    message: `${describeMove(p, s, m)}: ${reason(p, s, path)}.${tail}`,
    nudge: `look at ${pileName(p, m.from)}`,
    focus: { cards: src.slice(src.length - m.n), to: m.to } satisfies CardFocus,
    nudgeFocus: { piles: [m.from] } satisfies CardFocus,
    actions: [{ type: "move", ...m }],
  };
}

function solverTechnique(kind: Kind, t: Omit<FreecellTechnique, "instances" | "puzzles">): FreecellTechnique {
  return {
    ...t,
    puzzles: [freecell],
    instances(p, s, visit) {
      const path = plan(p, s).path;
      if (!path?.length || kindOf(p, s, path[0]!) !== kind) return;
      visit(stepFor(p, s, path));
    },
  };
}

export const safeHome: FreecellTechnique = {
  id: "freecell.safe-home",
  name: "safe home",
  puzzles: [freecell],
  level: 1,
  color: "#3fa34d",
  description: "a card can go home for good once nothing could ever need to sit on it: aces and twos always, and any other card once both foundations of the other color have reached one rank below it.",
  instances(p, s, visit) {
    eachSafeHomeMove(toPos(s, p.cells.length), (m) => {
      const card = lead(s, m);
      return visit({
        message: `${cardName(card)} home: ${reason(p, s, [m])}.`,
        nudge: `a card in ${pileName(p, m.from)} can go home`,
        focus: { cards: [card], to: m.to } satisfies CardFocus,
        nudgeFocus: { piles: [m.from] } satisfies CardFocus,
        actions: [{ type: "move", ...m }],
      });
    });
  },
};

export const freecellTechniques: FreecellTechnique[] = [
  safeHome,
  solverTechnique("home", {
    id: "freecell.home", name: "home now", level: 2, color: "#2f9e8f",
    description: "sending a card home early isn't always safe (something might have wanted to sit on it), but a search for a whole winning line says this one can go now.",
  }),
  solverTechnique("build", {
    id: "freecell.build", name: "build", level: 3, color: "#3b6fd6",
    description: "move a card, or an ordered run, onto a card one rank higher of the other color. the hint says what the move opens up, from a search for a whole winning line.",
  }),
  solverTechnique("park", {
    id: "freecell.park", name: "park in a cell", level: 4, color: "#e08a2c",
    description: "put a card in a free cell to get at what's under it. cells are scarce, so the hint only parks a card when a search for a whole winning line does.",
  }),
  solverTechnique("empty", {
    id: "freecell.empty-column", name: "use an empty column", level: 5, color: "#8b4fc7",
    description: "an empty column takes any card or run, and doubles how many cards can move together while it stays empty, so filling one is a real decision. the hint fills one only when a search for a whole winning line does.",
  }),
];

/** Runs ahead of technique hints: a position no line of play can win any more is pointed out first. */
export const checkWinnable: Plugin<FreecellPuzzle, FreecellState, FreecellAction, FreecellInteraction> = {
  id: "freecell.check-winnable",
  name: "hints check the game can still be won",
  description: "asking for a hint first says so if no sequence of moves can win from here any more",
  category: "assists",
  appliesTo: [freecell],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => {
      if (session.finished) return undefined;
      return plan(puzzle, state).impossible ? { message: "no sequence of moves wins from here any more. undo to get back to a winnable position." } : undefined;
    }, { owner, priority: 90 });
  },
};

export function fallbackHint(p: FreecellPuzzle, s: FreecellState) {
  const r = plan(p, s);
  if (r.path || r.impossible) return null;
  return { message: "the search for a win ran out of time from here, so there's no suggestion. undoing a move or two may help." };
}

/** The moves of a winning line from `s`, or null if none is known. */
export function solveFrom(p: FreecellPuzzle, s: FreecellState): { moves: FreecellAction[] } | null {
  const path = plan(p, s).path;
  return path ? { moves: path.map((m): FreecellAction => ({ type: "move", ...m })) } : null;
}
