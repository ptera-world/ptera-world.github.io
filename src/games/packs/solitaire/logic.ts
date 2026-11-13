import type { Ids } from "../../core/commands";
import { featureTests } from "../../core/define";
import type { Rng } from "../../core/rng";
import { effective, resolve, type Values } from "../../core/schema";
import type { GenerateContext, PuzzleDef, Rating } from "../../core/types";
import { cardName, msDeal, suitOf, SUIT_GLYPHS, SUIT_NAMES } from "../../lib/cards/deck";
import type { CardCursor } from "../../lib/cards/table";
import { applyMove, budgets, click, isLegal, isWon, movable, moves, solve, type Ctx, type Move, type Rules } from "./engine";
import { ctxOf, dealOrder, deckFaces, fromPos, idxOf, makePuzzle, startPos, toPos, type SolitaireAction, type SolitairePuzzle, type SolitaireState } from "./deal";
import { formats } from "./formats";
import { params } from "./params";
import { presets } from "./presets";
import { bankTotal, dealKey, gain, isVegas, money, settle, spiderScore, startScore, timeAdjust, VEGAS_STAKE } from "./score";

export interface SolitaireInteraction {
  cursor: CardCursor;
}

/** Plan steps as game actions: the stock clicks, then the move. */
export const actionsOf = (m: Move): SolitaireAction[] => [
  ...Array.from({ length: m.draws }, () => ({ type: "draw" as const })),
  ...(m.n ? [{ type: "move" as const, from: m.from, to: m.to, n: m.n }] : []),
];

const decksOf = (p: SolitairePuzzle) => p.faces.length / 52;
const runsHome = (s: SolitaireState, c: Ctx) => s.piles.slice(c.idx.found, c.idx.cols).filter((pl) => pl.c.length === 13).length;

export function pileName(p: SolitairePuzzle, pile: number): string {
  const c = ctxOf(p), I = c.idx;
  if (pile === I.stock) return "the stock";
  if (pile === I.waste) return "the waste";
  if (pile < I.found) return `free cell ${pile - I.cells + 1}`;
  if (pile < I.cols) {
    if (p.rules.home === "runs") return "the finished runs";
    const f = pile - I.found, suit = c.fsuit[f]!;
    const same = c.fsuit.filter((s) => s === suit).length;
    const nth = c.fsuit.slice(0, f).filter((s) => s === suit).length + 1;
    return `the ${SUIT_GLYPHS[suit]} foundation${same > 1 ? ` ${nth}` : ""}`;
  }
  return `column ${pile - I.cols + 1}`;
}

// --- dealing ---

const SUIT_ORDER_LABEL: Record<string, string> = { "4": "", "2": "spades and hearts", "1": "spades" };

function tries(v: Values<typeof params>): number {
  if (v.home === "runs") return v.decks > 2 ? 2 : v.suits === "1" ? 12 : v.suits === "2" ? 6 : 3;
  return v.decks > 1 ? 2 : 40;
}

async function generate(given: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<SolitairePuzzle> {
  const v = effective(params, given);
  const ids = deckFaces(v.decks, v.suits).map((_, i) => i);
  const withWin = (p: SolitairePuzzle): SolitairePuzzle | null => {
    const r = solve(ctxOf(p), startPos(p), budgets(p.rules).deal);
    return r.path ? { ...p, solution: r.path } : null;
  };
  if (v.deal > 0) {
    const p = makePuzzle(v, msDeal(v.deal), v.deal);
    return (v.winnable && withWin(p)) || p;
  }
  let first: SolitairePuzzle | null = null;
  for (let attempt = 0; attempt < tries(v); attempt++) {
    const p = makePuzzle(v, rng.shuffle(ids.slice()));
    if (!v.winnable) return p;
    first ??= p;
    const won = withWin(p);
    if (won) return won;
    await ctx.yield();
  }
  return first!;
}

// --- presets by setup ---

/** What makes two deals the same game: rules, scoring and where the cards start. */
function setupKey(p: Pick<SolitairePuzzle, "rules" | "faces" | "cols" | "down" | "cells" | "stock" | "scoring" | "timed" | "found">): string {
  const suits = [...new Set(p.faces.map(suitOf))].sort().join("");
  const rules: Rules = { ...p.rules, ...(p.stock.length ? {} : { stock: "waste", draw: 1, passes: 0, fillFirst: true }) };
  if (rules.stock === "row") Object.assign(rules, { draw: 1, passes: 0 });
  else rules.fillFirst = true;
  return JSON.stringify([rules, p.faces.length, suits, p.cols.map((c, j) => `${p.down[j]}+${c.length - p.down[j]!}`), p.cells.map((x) => x >= 0), p.stock.length, p.found.map((f) => f.length), p.scoring, p.timed]);
}

const presetKeys = new Map<string, string>();
for (const pr of presets) {
  const v = effective(params, resolve(params, pr.params));
  const n = deckFaces(v.decks, v.suits).length;
  const key = setupKey(makePuzzle(v, Array.from({ length: n }, (_, i) => i)));
  if (!presetKeys.has(key)) presetKeys.set(key, pr.label);
}

/** The published game this deal is, if it is one of the presets. */
export const variantOf = (p: SolitairePuzzle): string | null => presetKeys.get(setupKey(p)) ?? null;

// --- rules for the table ---

export function canLift(p: SolitairePuzzle, s: SolitaireState, pile: number, index: number): boolean {
  const c = ctxOf(p), I = c.idx;
  const pl = s.piles[pile];
  if (!pl || pile === I.stock || index < 0 || index >= pl.c.length) return false;
  if (pile < I.found) return true;
  if (pile < I.cols) return index === pl.c.length - 1 && p.rules.home === "cards" && p.rules.takeBack;
  if (pile === I.waste) return index === pl.c.length - 1;
  return index >= pl.d && pl.c.length - index <= movable(c, pl.c, pl.d);
}

export function moveAction(p: SolitairePuzzle, s: SolitaireState, from: number, index: number, to: number): SolitaireAction | null {
  const a = { type: "move" as const, from, to, n: (s.piles[from]?.c.length ?? 0) - index };
  return isLegal(ctxOf(p), toPos(ctxOf(p), s), a) ? a : null;
}

/** Clicking: the stock turns or deals; a card goes home if it can, else onto a column (its own suit first), else into an empty column, else a free cell. */
export function tapAction(p: SolitairePuzzle, s: SolitaireState, pile: number, index: number): SolitaireAction[] | null {
  const c = ctxOf(p), I = c.idx;
  if (pile === I.stock) return click(c, toPos(c, s)) ? [{ type: "draw" }] : null;
  if (!canLift(p, s, pile, index)) return null;
  const card = s.piles[pile]!.c[index]!;
  const cols = Array.from({ length: I.total - I.cols }, (_, j) => I.cols + j);
  const topSuit = (j: number) => suitOf(p.faces[s.piles[j]!.c[s.piles[j]!.c.length - 1]!]!);
  const filled = cols.filter((j) => s.piles[j]!.c.length);
  const order = [
    ...Array.from({ length: I.cols - I.found }, (_, f) => I.found + f),
    ...filled.filter((j) => topSuit(j) === suitOf(p.faces[card]!)), ...filled,
    ...cols.filter((j) => !s.piles[j]!.c.length),
    ...(pile >= I.cols || pile === I.waste ? Array.from({ length: I.found - I.cells }, (_, i) => I.cells + i) : []),
  ];
  for (const to of order) {
    if (to === pile) continue;
    const a = moveAction(p, s, pile, index, to);
    if (a) return [a];
  }
  return null;
}

/** "home", "to a free cell", "onto 8♠", "into empty column 3". */
export function whereTo(p: SolitairePuzzle, s: SolitaireState, to: number): string {
  const I = ctxOf(p).idx;
  if (to >= I.found && to < I.cols) return "home";
  if (to < I.found) return "to a free cell";
  const dst = s.piles[to]!.c;
  return dst.length ? `onto ${cardName(p.faces[dst[dst.length - 1]!]!)}` : `into empty ${pileName(p, to)}`;
}

export function describeMove(p: SolitairePuzzle, s: SolitaireState, a: { from: number; to: number; n: number }): string {
  const I = ctxOf(p).idx;
  const src = s.piles[a.from]!.c;
  const lead = cardName(p.faces[src[src.length - a.n]!]!);
  const what = a.n === 1 ? lead : `${lead} and the ${a.n - 1} ${a.n === 2 ? "card" : "cards"} on it`;
  return `${what} ${a.from >= I.found && a.from < I.cols ? "back down " : ""}${whereTo(p, s, a.to)}`;
}

function describeAction(p: SolitairePuzzle, a: SolitaireAction, before: SolitaireState, after: SolitaireState): string {
  const c = ctxOf(p), I = c.idx;
  const done = p.rules.home === "runs" ? runsHome(after, c) - runsHome(before, c) : 0;
  const finished = done > 0 ? `, finishing ${done === 1 ? "a run" : `${done} runs`}` : "";
  if (a.type === "draw") {
    if (p.rules.stock === "row") return `deal a row${finished}`;
    if (!before.piles[I.stock]!.c.length) return "turn the waste over";
    const w = after.piles[I.waste]!.c;
    const top = w[w.length - 1];
    if (top === undefined) return "draw";
    return p.rules.draw === 1 ? `draw ${cardName(p.faces[top]!)}` : `draw ${p.rules.draw}, ${cardName(p.faces[top]!)} on top`;
  }
  const text = describeMove(p, before, a);
  const from = after.piles[a.from]!;
  const turned = a.from >= I.cols && before.piles[a.from]!.d > from.d ? from.c[from.c.length - 1] : undefined;
  return `${text}${turned === undefined ? "" : `, turning over ${cardName(p.faces[turned]!)}`}${finished}`;
}

function rate(p: SolitairePuzzle): Rating | null {
  if (p.rules.home === "runs") {
    if (!p.solution) return null;
    const n = p.solution.length;
    const per = (n * 104) / p.faces.length;
    return { label: per < 140 ? "easy" : per < 200 ? "medium" : "hard", score: new Set(p.faces.map(suitOf)).size * 1000 + n };
  }
  if (p.rules.runs === "space" || p.rules.runs === "one") {
    const r = solve(ctxOf(p), startPos(p));
    if (!r.path) return null;
    return { label: r.nodes < 400 ? "easy" : r.nodes < 4000 ? "medium" : "hard", score: r.nodes };
  }
  if (!p.solution) return null;
  const score = ((p.solution.length + p.solution.reduce((n, m) => n + m.draws, 0)) * 52) / p.faces.length;
  return { label: score < 110 ? "easy" : score < 160 ? "medium" : "hard", score };
}

// --- rules in words ---

const BUILD_WORDS: Record<Rules["build"], string> = {
  alternate: "of the other color (red on black, black on red)",
  suit: "of the same suit",
  any: "of any suit",
  color: "of the same color",
  other: "of any other suit",
};

function rulesText(p: SolitairePuzzle): string[] {
  const r = p.rules, c = ctxOf(p);
  const out: string[] = [];
  const sets = p.faces.length / 13;
  out.push(r.home === "cards"
    ? `build ${sets === 4 ? "four foundations, one per suit" : `${sets} foundations, one per suit and deck`}, from ace up to king.`
    : `a run from king down to ace in one suit leaves the table by itself. finish all ${sets} to win.`);
  out.push(`in the columns, a card goes on one a rank ${r.updown ? "higher or lower" : "higher"} ${BUILD_WORDS[r.build]}. ${r.empty === "any" ? "any card or run can go into an empty column." : r.empty === "kings" ? "only a king, or a run starting with one, goes into an empty column." : "nothing goes into an empty column."}`);
  out.push({
    built: "any built run in a column moves together.",
    suit: "a run going down in one suit moves together; a mixed run doesn't.",
    any: "any face-up card moves together with all the cards on it, whether they are built in order or not.",
    space: "a built run moves together if there are enough free cells and empty columns to move it one card at a time: (free cells + 1), doubled for every empty column not being moved into" + (r.empty === "any" ? "." : " (only when empty columns take any card)."),
    one: "cards move one at a time.",
  }[r.runs]);
  if (p.down.some(Boolean)) out.push("when a face-down card is left on top of a column it turns over.");
  if (p.cells.length) out.push(`each free cell holds one card. there ${p.cells.length === 1 ? "is 1 free cell" : `are ${p.cells.length} free cells`}.`);
  if (c.idx.stock >= 0) {
    out.push(r.stock === "row"
      ? `click the stock to deal one more card onto every column${r.fillFirst ? "; not while a column is empty" : ""}.`
      : `click the stock to turn over ${r.draw === 1 ? "one card" : `${r.draw} cards`}; only the top card of the waste plays. when the stock runs out, click it to turn the waste back over${r.passes ? ` (${r.passes === 1 ? "no second pass" : `${r.passes} passes in all`})` : ""}.`);
  }
  if (r.home === "cards") out.push(r.takeBack ? "cards can come back down from a foundation onto a column." : "cards on a foundation stay there.");
  const suits = [...new Set(p.faces.map(suitOf))];
  if (suits.length < 4) out.push(suits.length === 1 ? `this deal uses ${SUIT_NAMES[suits[0]!]} only.` : `this deal uses ${suits.length} suits: ${suits.map((s) => SUIT_NAMES[s]).join(", ")}.`);
  out.push(...scoreRules(p));
  return out;
}

function scoreRules(p: SolitairePuzzle): string[] {
  const mode = p.scoring;
  if (mode === "none") return [];
  if (mode === "spider") return ["spider scoring: 500 to start, a point off per move, a hundred per finished run."];
  if (mode === "standard") {
    return [
      `standard scoring: 10 for a card home, 5 for a waste card onto a column, 5 for turning a card over, -15 for taking a card back from home${ctxOf(p).idx.waste >= 0 ? `, ${p.rules.draw === 1 ? "-100 for each further pass through the stock" : "-20 for each pass through the stock after the third"}` : ""}. it never drops below zero.`,
      ...(p.timed ? ["timed: 2 points off for every ten seconds, and a win after more than 30 seconds adds 700000 divided by the seconds taken."] : []),
    ];
  }
  return [
    `vegas scoring: you start $${VEGAS_STAKE * decksOf(p)} down, win $5 for each card home and give $5 back for each taken off a foundation.`,
    ...(mode === "vegas-keep" ? ["the running total adds up every deal played in this browser."] : []),
  ];
}

function describe(p: SolitairePuzzle): string {
  if (p.deal) return `${variantOf(p) ?? "FreeCell"}, deal #${p.deal}`;
  const name = variantOf(p);
  const known = p.solution || p.rules.home === "cards" ? "" : ", not known winnable";
  if (name) return `${name}${known}`;
  const suits = new Set(p.faces.map(suitOf)).size;
  return `${p.cols.length} columns, ${decksOf(p) === 1 ? "one deck" : `${decksOf(p)} decks`}${suits < 4 ? `, ${SUIT_ORDER_LABEL[String(suits)]} only` : ""}${p.cells.length ? `, ${p.cells.length} free ${p.cells.length === 1 ? "cell" : "cells"}` : ""}${known}`;
}

const FEATURES = {
  /** Cards go home one at a time, so a card can be sent home. */
  "cards-home": (p: SolitairePuzzle) => p.rules.home === "cards",
};

declare module "../../core/types" {
  interface FeatureNames extends Ids<typeof FEATURES> {}
}

export const solitaire: PuzzleDef<SolitairePuzzle, SolitaireState, SolitaireAction, SolitaireInteraction, typeof params> = {
  id: "solitaire",
  name: "Solitaire",
  aliases: ["klondike", "klondike solitaire", "patience", "spider", "spider solitaire", "spiderette", "freecell", "free cell", "freecell solitaire", "baker's game", "eight off", "seahaven towers", "yukon", "russian solitaire", "scorpion", "forty thieves", "vegas", "thoughtful", "simple simon"],
  tags: ["cards", "solitaire", "moves", "variants"],
  description: "the tableau solitaires: Klondike, Spider, FreeCell and their relatives. build the cards home on the foundations, digging through the columns, the stock and the free cells. every rule is a setting, and the published games are presets.",
  generatorVersion: 1,
  params,
  presets,
  generate,
  formats,
  init: (p) => {
    const c = ctxOf(p);
    return fromPos(c, startPos(p), 0, startScore(p.scoring, decksOf(p)));
  },
  initInteraction: (p) => ({ cursor: { pile: idxOf(p).cols, index: Math.max(0, (p.cols[0]?.length ?? 0) - 1), held: null } }),
  reduce(p, s, a) {
    const c = ctxOf(p);
    const pos = toPos(c, s);
    const before = toPos(c, s);
    const mode = p.scoring;
    let m: { from: number; to: number; n: number } | null = null;
    if (a.type === "draw") {
      if (!click(c, pos)) return s;
    } else if (a.type === "move" && isLegal(c, pos, a)) {
      applyMove(c, pos, { draws: 0, from: a.from, to: a.to, n: a.n });
      m = a;
    } else return s;
    const next = fromPos(c, pos, s.moves + 1, 0);
    next.score = mode === "spider" ? spiderScore(next.moves, runsHome(next, c)) : settle(mode, s.score + gain(c, mode, before, pos, m));
    return next;
  },
  isSolved: (p, s) => isWon(ctxOf(p), toPos(ctxOf(p), s)),
  isLost: (p, s) => {
    const c = ctxOf(p), pos = toPos(c, s);
    return !isWon(c, pos) && moves(c, pos).length === 0;
  },
  rate,
  features: featureTests(FEATURES),
  rules: rulesText,
  describe,
  describeAction,
};

/** The line above the board: score (or money) and moves, with the running vegas total when it is kept. */
export function scoreLine(p: SolitairePuzzle, s: SolitaireState, elapsedMs: number): string {
  const mode = p.scoring;
  const moveText = `${s.moves} ${s.moves === 1 ? "move" : "moves"}`;
  if (mode === "none") return moveText;
  if (isVegas(mode)) {
    const here = money(s.score);
    return mode === "vegas-keep" ? `this deal ${here} · total ${money(bankTotal(bankKey(p), s.score))} · ${moveText}` : `${here} · ${moveText}`;
  }
  const won = solitaire.isSolved(p, s);
  const shown = p.timed ? Math.max(0, s.score + timeAdjust(elapsedMs, won)) : s.score;
  return `score ${shown} · ${moveText}`;
}

export const bankKey = (p: SolitairePuzzle): string => dealKey(dealOrder(p).map((id) => p.faces[id]!), p.rules.draw);
