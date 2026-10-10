import type { Plugin, Step, Technique } from "../../core/types";
import { cardName, safeHomeReason } from "../../lib/cards/deck";
import { planner } from "../../lib/plan";
import type { CardFocus } from "../../lib/cards/table";
import { actionsOf, dealPos, describeMove, fromPos, klondike, pileName, rulesOf, toPos, whereTo, type KlondikeAction, type KlondikeInteraction, type KlondikePuzzle, type KlondikeState } from "./logic";
import { applyMove, clonePos, COLS, eachSafeHomeMove, isSafeHome, solve, STOCK, WASTE, type Move, type Pos } from "./solver";

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

type Kind = "home" | "reveal" | "build" | "space" | "stock";

/** The position after the plan step's stock clicks, where its move is made. */
function drawn(p: KlondikePuzzle, s: KlondikeState, m: Move): Pos {
  const pos = toPos(s);
  applyMove(pos, { ...m, n: 0 }, rulesOf(p));
  return pos;
}

function kindOf(s: KlondikeState, m: Move): Kind {
  if (m.draws > 0) return "stock";
  if (m.to < COLS) return "home";
  const src = s.piles[m.from]!;
  if (m.from >= COLS && src.d > 0 && m.n === src.c.length - src.d) return "reveal";
  return s.piles[m.to]!.c.length ? "build" : "space";
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

function stepFor(p: KlondikePuzzle, s: KlondikeState, path: readonly Move[]): Step<KlondikeAction> {
  const m = path[0]!;
  const before = fromPos(drawn(p, s, m), 0);
  const rest = path.length - 1;
  const tail = rest ? ` the solver finds a win ${rest} ${rest === 1 ? "step" : "steps"} after that.` : " that wins.";
  const draw = m.draws ? `click the stock ${m.draws === 1 ? "once" : `${m.draws} times`} to bring up ${cardName(leadOf(before, m))}, then play ` : "";
  const src = s.piles[m.from]!.c;
  return {
    message: `${draw}${describeMove(before, m)}: ${reason(p, s, path)}.${tail}`,
    nudge: m.draws ? "look through the stock" : `look at ${pileName(m.from)}`,
    focus: (m.draws ? { piles: [STOCK], to: m.to } : { cards: src.slice(src.length - m.n), to: m.to }) satisfies CardFocus,
    nudgeFocus: { piles: [m.draws ? STOCK : m.from] } satisfies CardFocus,
    actions: actionsOf(m),
  };
}

function solverTechnique(kind: Kind, t: Omit<KlondikeTechnique, "instances" | "puzzles">): KlondikeTechnique {
  return {
    ...t,
    puzzles: [klondike],
    instances(p, s, visit) {
      const path = plan(p, s).path;
      if (!path?.length || kindOf(s, path[0]!) !== kind) return;
      visit(stepFor(p, s, path));
    },
  };
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

export const klondikeTechniques: KlondikeTechnique[] = [
  safeHome,
  solverTechnique("home", {
    id: "klondike.home", name: "home now", level: 2, color: "#2f9e8f",
    description: "sending a card home early isn't always safe (something might have wanted to sit on it), but a search for a whole winning line says this one can go now.",
  }),
  solverTechnique("reveal", {
    id: "klondike.reveal", name: "turn a card over", level: 3, color: "#3b6fd6",
    description: "move a column's face-up cards off so its face-down card turns over. which column to dig into first is the real choice; the hint picks the one a search for a whole winning line does.",
  }),
  solverTechnique("build", {
    id: "klondike.build", name: "build", level: 4, color: "#d6a13b",
    description: "play a card from the waste, a foundation, or the middle of a column onto a card one rank higher of the other color. the hint says what the move opens up.",
  }),
  solverTechnique("space", {
    id: "klondike.king-to-space", name: "king to an empty column", level: 5, color: "#8b4fc7",
    description: "only a king, or a run starting with one, fills an empty column. when there are several kings to choose from, the hint picks the one a search for a whole winning line does.",
  }),
  solverTechnique("stock", {
    id: "klondike.dig-stock", name: "dig through the stock", level: 6, color: "#e08a2c",
    description: "nothing showing is worth playing yet, so click through the stock to the card that is. the hint says how many clicks it takes.",
  }),
];

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

export function fallbackHint(p: KlondikePuzzle, s: KlondikeState) {
  const r = plan(p, s);
  if (r.path || r.impossible) return null;
  return { message: "the search for a win ran out of time from here, so there's no suggestion. undoing a move or two may help." };
}

/** The actions of a winning line from `s`, or null if none is known. */
export function solveFrom(p: KlondikePuzzle, s: KlondikeState): { moves: KlondikeAction[] } | null {
  const path = plan(p, s).path;
  return path ? { moves: path.flatMap((m) => actionsOf(m)) } : null;
}
