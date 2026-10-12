import type { Plugin, Technique } from "../../core/types";
import { cardName, safeHomeReason } from "../../lib/cards/deck";
import { planner } from "../../lib/plan";
import type { CardFocus } from "../../lib/cards/table";
import { actionsOf, dealPos, fromPos, klondike, pileName, rulesOf, toPos, whereTo, type KlondikeAction, type KlondikeInteraction, type KlondikePuzzle, type KlondikeState } from "./logic";
import { applyMove, clonePos, COLS, eachSafeHomeMove, isSafeHome, solve, WASTE, type Move, type Pos } from "./solver";

type KlondikeTechnique = Technique<KlondikePuzzle, KlondikeState, KlondikeAction>;

const HINT_BUDGET = 30_000;

const stateKey = (s: KlondikeState) => `${s.recycles}|${s.piles.map((pl) => `${pl.d}:${pl.c.join(".")}`).join("|")}`;

export const plan = planner<KlondikePuzzle, KlondikeState, Move>({
  key: stateKey,
  init: (p) => fromPos(dealPos(p.deck), 0),
  step: (p, s, m) => {
    const pos = toPos(s);
    applyMove(pos, m, rulesOf(p));
    return fromPos(pos, s.moves + 1);
  },
  search: (p, s) => solve(toPos(s), rulesOf(p), HINT_BUDGET),
  known: (p) => p.solution,
});

/** The position after the plan step's stock clicks, where its move is made. */
function drawn(p: KlondikePuzzle, s: KlondikeState, m: Move): Pos {
  const pos = toPos(s);
  applyMove(pos, { ...m, n: 0 }, rulesOf(p));
  return pos;
}

const leadOf = (s: KlondikeState, m: { from: number; n: number }) => s.piles[m.from]!.c[s.piles[m.from]!.c.length - m.n]!;

/** Why the plan's first step helps, judged from what it uncovers and the next few steps. Never names a face-down card. */
function reason(p: KlondikePuzzle, s: KlondikeState, path: readonly Move[]): string {
  const m = path[0]!;
  const r = rulesOf(p);
  const before = drawn(p, s, m);
  const st = fromPos(before, 0);
  const card = leadOf(st, m);
  if (m.to < COLS) {
    return isSafeHome(before.found, card)
      ? safeHomeReason(card)
      : "the winning line sends it home now";
  }
  const src = st.piles[m.from]!;
  if (m.from >= COLS && src.d > 0 && m.n === src.c.length - src.d) return `this turns over the face-down card in ${pileName(m.from)}`;
  const exposed = m.from >= COLS && src.c.length > m.n ? src.c[src.c.length - m.n - 1]! : -1;
  const movedTop = src.c[src.c.length - 1];
  const after = clonePos(before);
  applyMove(after, { ...m, draws: 0 }, r);
  for (const next of path.slice(1, 6)) {
    const at = fromPos(drawn(p, fromPos(after, 0), next), 0);
    if (next.n && leadOf(at, next) === exposed) return `this frees ${cardName(exposed)} under it, which then goes ${whereTo(at, next.to)}`;
    const dst = at.piles[next.to]?.c;
    if (next.n && next.to >= COLS && dst?.[dst.length - 1] === movedTop) return `so that ${cardName(leadOf(at, next))} can go on it next`;
    applyMove(after, next, r);
  }
  if (m.from >= COLS && src.c.length === m.n) return `this empties ${pileName(m.from)}, room for a king`;
  if (m.from === WASTE) return "it gets the waste card into play";
  return "it keeps the winning line going";
}


export const safeHome: KlondikeTechnique = {
  id: "klondike.safe-home",
  name: "safe home",
  puzzles: [klondike],
  level: 1,
  color: "#3fa34d",
  description: "a card can go home for good once nothing could ever need to sit on it: aces and twos always, and any other card once both foundations of the other color have reached one rank below it.",
  instances(p, s, visit) {
    eachSafeHomeMove(toPos(s), (m) => {
      const card = leadOf(s, m);
      return visit({
        message: `${cardName(card)} home: ${reason(p, s, [m])}.`,
        nudge: `a card in ${pileName(m.from)} can go home`,
        focus: { cards: [card], to: m.to } satisfies CardFocus,
        nudgeFocus: { piles: [m.from] } satisfies CardFocus,
        actions: actionsOf(m),
      });
    });
  },
};

export const klondikeTechniques: KlondikeTechnique[] = [safeHome];

/** Runs ahead of technique hints: a position no line of play can win any more is pointed out first. */
export const checkWinnable: Plugin<KlondikePuzzle, KlondikeState, KlondikeAction, KlondikeInteraction> = {
  id: "klondike.check-winnable",
  name: "hints check the game can still be won",
  description: "asking for a hint first says so if no sequence of moves can win from here any more",
  category: "assists",
  appliesTo: [klondike],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => {
      if (session.finished) return undefined;
      return plan(puzzle, state).impossible ? { message: "no sequence of moves wins from here any more. undo to get back to a winnable position." } : undefined;
    }, { owner, priority: 90 });
  },
};

/** The actions of a winning line from `s`, or null if none is known. */
export function solveFrom(p: KlondikePuzzle, s: KlondikeState): { moves: KlondikeAction[] } | null {
  const path = plan(p, s).path;
  return path ? { moves: path.flatMap((m) => actionsOf(m)) } : null;
}
