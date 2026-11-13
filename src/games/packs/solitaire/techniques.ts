import type { Plugin, Technique } from "../../core/types";
import { cardName, isRed, rankOf, rankWord, safeHomeReason } from "../../lib/cards/deck";
import type { CardFocus } from "../../lib/cards/table";
import { planner } from "../../lib/plan";
import { applyMove, budgets, clonePos, eachSafeHomeMove, isSafeHome, solve, type Ctx, type Move, type Pos } from "./engine";
import { ctxOf, fromPos, startPos, toPos, type SolitaireAction, type SolitairePuzzle, type SolitaireState } from "./deal";
import { actionsOf, pileName, solitaire, whereTo, type SolitaireInteraction } from "./logic";

type SolitaireTechnique = Technique<SolitairePuzzle, SolitaireState, SolitaireAction>;

const stateKey = (s: SolitaireState) => `${s.recycles}|${s.piles.map((pl) => `${pl.d}:${pl.c.join(".")}`).join("|")}`;

export const plan = planner<SolitairePuzzle, SolitaireState, Move>({
  key: stateKey,
  init: (p) => fromPos(ctxOf(p), startPos(p), 0, 0),
  step: (p, s, m) => {
    const c = ctxOf(p), pos = toPos(c, s);
    applyMove(c, pos, m);
    return fromPos(c, pos, s.moves + 1, 0);
  },
  search: (p, s) => solve(ctxOf(p), toPos(ctxOf(p), s), budgets(p.rules).hint),
  known: (p) => p.solution,
});

/** The position after the plan step's stock clicks, where its move is made. */
function drawn(c: Ctx, s: SolitaireState, m: Move): Pos {
  const pos = toPos(c, s);
  applyMove(c, pos, { ...m, n: 0 });
  return pos;
}

const leadOf = (s: SolitaireState, m: { from: number; n: number }) => s.piles[m.from]!.c[s.piles[m.from]!.c.length - m.n]!;

/** Why nothing can need to sit on a card any more. */
function safeReason(p: SolitairePuzzle, card: number): string {
  const f = p.faces[card]!;
  if (p.rules.build === "alternate" && p.faces.length === 52) return safeHomeReason(f);
  if (rankOf(f) <= 2) return safeHomeReason(f);
  const which = p.rules.build === "suit" ? `the ${rankWord(rankOf(f) - 1)}s of its suit` : p.rules.build === "color" ? `the ${isRed(f) ? "red" : "black"} ${rankWord(rankOf(f) - 1)}s` : `the ${rankWord(rankOf(f) - 1)}s that could go on it`;
  return `nothing can need to sit on it any more: ${which} are all home`;
}

/** Why the plan's first step helps, judged from what it uncovers and the next few steps. Never names a face-down card. */
function reason(p: SolitairePuzzle, s: SolitaireState, path: readonly Move[]): string {
  const c = ctxOf(p), I = c.idx;
  const m = path[0]!;
  const before = drawn(c, s, m);
  const st = fromPos(c, before, 0, 0);
  const card = leadOf(st, m);
  if (m.to >= I.found && m.to < I.cols) return isSafeHome(c, before, card) ? safeReason(p, card) : "the winning line sends it home now";
  const src = st.piles[m.from]!;
  if (m.from >= I.cols && src.d > 0 && m.n === src.c.length - src.d) return `this turns over the face-down card in ${pileName(p, m.from)}`;
  const exposed = m.from >= I.cols && src.c.length > m.n ? src.c[src.c.length - m.n - 1]! : -1;
  const movedTop = src.c[src.c.length - 1];
  const after = clonePos(before);
  applyMove(c, after, { ...m, draws: 0 });
  for (const next of path.slice(1, 6)) {
    const at = fromPos(c, drawn(c, fromPos(c, after, 0, 0), next), 0, 0);
    if (next.n && leadOf(at, next) === exposed) return `this frees ${cardName(p.faces[exposed]!)} under it, which then goes ${whereTo(p, at, next.to)}`;
    const dst = at.piles[next.to]?.c;
    if (next.n && next.to >= I.cols && dst?.[dst.length - 1] === movedTop) return `so that ${cardName(p.faces[leadOf(at, next)]!)} can go on it next`;
    applyMove(c, after, next);
  }
  if (m.from >= I.cols && src.c.length === m.n) return `this empties ${pileName(p, m.from)}, ${p.rules.empty === "kings" ? "room for a king" : "room to sort out another column"}`;
  if (m.from === I.waste) return "it gets the waste card into play";
  if (m.from < I.found) return "this frees a cell";
  if (exposed >= 0 && src.c.length - m.n - 1 >= src.d) return `this gets at ${cardName(p.faces[exposed]!)} under it`;
  return "it keeps the winning line going";
}

export const safeHome: SolitaireTechnique = {
  id: "solitaire.safe-home",
  name: "safe home",
  puzzles: [solitaire],
  requires: ["cards-home"],
  level: 1,
  color: "#3fa34d",
  description: "a card can go home for good once nothing could ever need to sit on it: aces and twos always, and any other card once every card that could go on it is already home (with red-on-black building: both foundations of the other color reach one rank below it).",
  instances(p, s, visit) {
    const c = ctxOf(p);
    eachSafeHomeMove(c, toPos(c, s), (m) => {
      const card = leadOf(s, m);
      return visit({
        message: `${cardName(p.faces[card]!)} home: ${reason(p, s, [m])}.`,
        nudge: `a card in ${pileName(p, m.from)} can go home`,
        focus: { cards: [card], to: m.to } satisfies CardFocus,
        nudgeFocus: { piles: [m.from] } satisfies CardFocus,
        actions: actionsOf(m),
      });
    });
  },
};

export const techniques: SolitaireTechnique[] = [safeHome];

/** Runs ahead of technique hints: a position no line of play can win any more is pointed out first. */
export const checkWinnable: Plugin<SolitairePuzzle, SolitaireState, SolitaireAction, SolitaireInteraction> = {
  id: "solitaire.check-winnable",
  name: "hints check the game can still be won",
  description: "asking for a hint first says so if no sequence of moves can win from here any more",
  category: "assists",
  appliesTo: [solitaire],
  enabledByDefault: true,
  setup({ session, owner }) {
    session.hooks.hint.tap(({ puzzle, state }) => {
      if (session.finished) return undefined;
      return plan(puzzle, state).impossible ? { message: "no sequence of moves wins from here any more. undo to get back to a winnable position." } : undefined;
    }, { owner, priority: 90 });
  },
};

/** The actions of a winning line from `s`, or null if none is known. */
export function solveFrom(p: SolitairePuzzle, s: SolitaireState): { moves: SolitaireAction[] } | null {
  const path = plan(p, s).path;
  return path ? { moves: path.flatMap((m) => actionsOf(m)) } : null;
}
