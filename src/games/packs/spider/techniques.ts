import { hintFrom } from "../../core/define";
import type { Hint, Plugin, Step } from "../../core/types";
import { cardName, suitOf, SUIT_NAMES } from "../../lib/cards/deck";
import { planner } from "../../lib/plan";
import type { CardFocus } from "../../lib/cards/table";
import { actionOf, dealPos, describeMove, fromPos, pileName, spider, toPos, whereTo, type SpiderAction, type SpiderInteraction, type SpiderPuzzle, type SpiderState } from "./logic";
import { applyMove, clonePos, COLS, solve, STOCK, type Move } from "./solver";

const HINT_BUDGET = 20_000;

const stateKey = (s: SpiderState) => s.piles.map((pl) => `${pl.d}:${pl.c.join(".")}`).join("|");

export const plan = planner<SpiderPuzzle, SpiderState, Move>({
  key: stateKey,
  init: (p) => fromPos(dealPos(p), 0),
  step: (p, s, m) => {
    const pos = toPos(s);
    applyMove(p.deck, pos, m);
    return fromPos(pos, s.moves + 1);
  },
  search: (p, s) => solve(p.deck, toPos(s), HINT_BUDGET),
  known: (p) => p.solution,
});

type Kind = "suit" | "reveal" | "build" | "space" | "deal";

const topFace = (p: SpiderPuzzle, s: SpiderState, pile: number) => {
  const c = s.piles[pile]!.c;
  return c.length ? p.deck[c[c.length - 1]!]! : -1;
};
const leadId = (s: SpiderState, m: Move) => s.piles[m.from]!.c[s.piles[m.from]!.c.length - m.n]!;

function kindOf(p: SpiderPuzzle, s: SpiderState, m: Move): Kind {
  if (m.from === STOCK) return "deal";
  const top = topFace(p, s, m.to);
  if (top < 0) return "space";
  const src = s.piles[m.from]!;
  if (src.d > 0 && m.n === src.c.length - src.d) return "reveal";
  return suitOf(top) === suitOf(p.deck[leadId(s, m)]!) ? "suit" : "build";
}

const doneCount = (s: SpiderState) => s.piles.slice(1, COLS).filter((pl) => pl.c.length).length;

/** Why the plan's first move helps, judged from what it uncovers and the next few moves. Never names a face-down card. */
function reason(p: SpiderPuzzle, s: SpiderState, path: readonly Move[]): string {
  const m = path[0]!;
  const pos = toPos(s);
  const after = clonePos(pos);
  applyMove(p.deck, after, m);
  const next0 = fromPos(after, 0);
  if (m.from === STOCK) return "nothing on the table is worth moving first, and the new row brings more cards into play";
  if (doneCount(next0) > doneCount(s)) return `this finishes a run of ${SUIT_NAMES[suitOf(p.deck[leadId(s, m)]!)]}, which leaves the table`;
  const src = s.piles[m.from]!;
  if (src.d > 0 && m.n === src.c.length - src.d) return `this turns over the face-down card in ${pileName(m.from)}`;
  if (src.c.length === m.n) return `this empties ${pileName(m.from)}`;
  const exposed = src.c[src.c.length - m.n - 1]!;
  const movedTop = src.c[src.c.length - 1];
  let cur = after;
  for (const next of path.slice(1, 6)) {
    const st = fromPos(cur, 0);
    if (next.from !== STOCK) {
      if (leadId(st, next) === exposed) return `this frees ${cardName(p.deck[exposed]!)} under it, which then goes ${whereTo(p, st, next.to)}`;
      const dst = st.piles[next.to]!.c;
      if (dst[dst.length - 1] === movedTop) return `so that ${cardName(p.deck[leadId(st, next)]!)} can go on it next`;
    }
    cur = clonePos(cur);
    applyMove(p.deck, cur, next);
  }
  if (kindOf(p, s, m) === "suit") return "it joins a run of the same suit";
  return "it keeps the winning line going";
}

function stepFor(p: SpiderPuzzle, s: SpiderState, path: readonly Move[]): Step<SpiderAction> {
  const m = path[0]!;
  const rest = path.length - 1;
  const tail = rest ? ` the solver finds a win ${rest} ${rest === 1 ? "move" : "moves"} after that.` : " that wins.";
  const src = s.piles[m.from]!.c;
  const what = m.from === STOCK ? "deal a row" : describeMove(p, s, m);
  return {
    message: `${what}: ${reason(p, s, path)}.${tail}`,
    nudge: m.from === STOCK ? "look at the stock" : `look at ${pileName(m.from)}`,
    focus: (m.from === STOCK ? { piles: [STOCK] } : { cards: src.slice(src.length - m.n), to: m.to }) satisfies CardFocus,
    nudgeFocus: { piles: [m.from] } satisfies CardFocus,
    actions: [actionOf(m)],
  };
}

/** Runs ahead of technique hints: a position no line of play can win any more is pointed out first. */
export const checkWinnable: Plugin<SpiderPuzzle, SpiderState, SpiderAction, SpiderInteraction> = {
  id: "spider.check-winnable",
  name: "hints check the game can still be won",
  description: "asking for a hint first says so if no sequence of moves can win from here any more",
  category: "assists",
  appliesTo: [spider],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => {
      if (session.finished) return undefined;
      return plan(puzzle, state).impossible ? { message: "no sequence of moves wins from here any more. undo to get back to a winnable position." } : undefined;
    }, { owner, priority: 90 });
  },
};

export function fallbackHint(p: SpiderPuzzle, s: SpiderState): Hint<SpiderAction> | null {
  const r = plan(p, s);
  if (r.path?.length) return hintFrom(null, stepFor(p, s, r.path), 1) as Hint<SpiderAction>;
  if (r.path || r.impossible) return null;
  return { message: "the search for a win ran out of time from here, so there's no suggestion. undoing a move or two may help." };
}

/** The actions of a winning line from `s`, or null if none is known. */
export function solveFrom(p: SpiderPuzzle, s: SpiderState): { moves: SpiderAction[] } | null {
  const path = plan(p, s).path;
  return path ? { moves: path.map((m) => actionOf(m)) } : null;
}
