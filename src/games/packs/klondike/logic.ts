import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, PuzzleDef, Rating } from "../../core/types";
import { buildsDownAlternating, cardCode, cardName, parseCards, rankOf, shuffledDeck, suitOf, SUIT_GLYPHS } from "../../lib/cards/deck";
import type { Pile } from "../../lib/cards/piles";
import type { CardCursor } from "../../lib/cards/table";
import { applyMove, click, COLS, FOUND, isWon, moves, solve, STOCK, WASTE, type Move, type Pos, type Rules } from "./solver";

export const params = defineSchema({
  draw: {
    type: "enum", label: "draw", default: "1",
    options: [{ value: "1", label: "one card at a time" }, { value: "3", label: "three cards at a time" }],
  },
  passes: {
    type: "enum", label: "passes through the stock", default: "0",
    options: [{ value: "0", label: "no limit" }, { value: "3", label: "three" }, { value: "1", label: "one" }],
  },
  winnable: { type: "bool", label: "always winnable", default: true, description: "deal again until the solver finds a win" },
});

export interface KlondikePuzzle {
  /** All 52 cards in dealing order: the first 28 go to the columns row by row, the rest form the stock, first card drawn first. */
  deck: number[];
  draw: number;
  /** Passes through the stock allowed; 0 for no limit. */
  passes: number;
  /** A win from the start, found when the deal was made. */
  solution?: Move[];
}

/** Piles: 0 stock, 1 waste, 2–5 foundations (clubs, diamonds, hearts, spades), 6–12 columns. */
export interface KlondikeState {
  piles: Pile[];
  /** Times the waste has gone back into the stock. */
  recycles: number;
  moves: number;
}

export type KlondikeAction = { type: "draw" } | { type: "move"; from: number; to: number; n: number };

export interface KlondikeInteraction {
  cursor: CardCursor;
}

export const rulesOf = (p: KlondikePuzzle): Rules => ({ draw: p.draw, passes: p.passes });

export function toPos(s: KlondikeState): Pos {
  return {
    stock: s.piles[STOCK]!.c.slice(),
    waste: s.piles[WASTE]!.c.slice(),
    found: s.piles.slice(FOUND, FOUND + 4).map((pl) => pl.c.length),
    cols: s.piles.slice(COLS).map((pl) => pl.c.slice()),
    down: s.piles.slice(COLS).map((pl) => pl.d),
    recycles: s.recycles,
  };
}

export function fromPos(p: Pos, moveCount: number): KlondikeState {
  return {
    piles: [
      { c: p.stock.slice(), d: p.stock.length },
      { c: p.waste.slice(), d: 0 },
      ...p.found.map((r, s) => ({ c: Array.from({ length: r }, (_, i) => s * 13 + i), d: 0 })),
      ...p.cols.map((c, j) => ({ c: c.slice(), d: p.down[j]! })),
    ],
    recycles: p.recycles,
    moves: moveCount,
  };
}

export function dealPos(deck: readonly number[]): Pos {
  const cols: number[][] = Array.from({ length: 7 }, () => []);
  let k = 0;
  for (let row = 0; row < 7; row++) for (let c = row; c < 7; c++) cols[c]!.push(deck[k++]!);
  return { stock: deck.slice(28).reverse(), waste: [], found: [0, 0, 0, 0], cols, down: [0, 1, 2, 3, 4, 5, 6], recycles: 0 };
}

export function pileName(pile: number): string {
  if (pile === STOCK) return "the stock";
  if (pile === WASTE) return "the waste";
  if (pile < COLS) return `the ${SUIT_GLYPHS[pile - FOUND]} foundation`;
  return `column ${pile - COLS + 1}`;
}

/** Plan steps as game actions: the stock clicks, then the move. */
export const actionsOf = (m: Move): KlondikeAction[] => [
  ...Array.from({ length: m.draws }, () => ({ type: "draw" as const })),
  ...(m.n ? [{ type: "move" as const, from: m.from, to: m.to, n: m.n }] : []),
];

export function isLegal(p: Pos, m: { from: number; to: number; n: number }): boolean {
  if (m.from === m.to || m.n < 1 || m.to < FOUND || m.to >= COLS + 7 || m.from < WASTE || m.from >= COLS + 7) return false;
  let lead: number | undefined;
  if (m.from === WASTE) {
    if (m.n !== 1) return false;
    lead = p.waste[p.waste.length - 1];
  } else if (m.from < COLS) {
    if (m.n !== 1 || m.to < COLS) return false;
    const r = p.found[m.from - FOUND]!;
    lead = r ? (m.from - FOUND) * 13 + r - 1 : undefined;
  } else {
    const j = m.from - COLS;
    const col = p.cols[j]!;
    if (m.n > col.length - p.down[j]!) return false;
    lead = col[col.length - m.n];
  }
  if (lead === undefined) return false;
  if (m.to < COLS) return m.n === 1 && suitOf(lead) === m.to - FOUND && p.found[m.to - FOUND] === rankOf(lead) - 1;
  const dst = p.cols[m.to - COLS]!;
  return dst.length ? buildsDownAlternating(lead, dst[dst.length - 1]!) : rankOf(lead) === 13;
}

const GEN_BUDGET = 30_000;

async function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<KlondikePuzzle> {
  const draw = Number(v.draw), passes = Number(v.passes);
  let last: KlondikePuzzle | null = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const puzzle: KlondikePuzzle = { deck: shuffledDeck(rng), draw, passes };
    if (!v.winnable) return puzzle;
    const r = solve(dealPos(puzzle.deck), rulesOf(puzzle), GEN_BUDGET);
    if (r.path) return { ...puzzle, solution: r.path };
    last = puzzle;
    await ctx.yield();
  }
  return last!;
}

// --- formats ---

const HEAD_RE = /^\s*draw\s*([13])(?:\s*[,;]?\s*passes\s*(\d+))?\s*$/im;

/**
 * Plain deal: an optional "draw 3, passes 1" line, then the 52 cards as codes (like TH or 5c) in
 * dealing order: 28 to the columns, row by row (row 1 across all seven columns, row 2 across
 * columns 2–7, …, each column's last card face up), then the stock, first card drawn first.
 */
export const dealFormat: Format<KlondikePuzzle> = {
  id: "deal",
  label: "deal (draw line, then 52 cards in dealing order)",
  detect: (t) => /^(?:\s*draw\s*[13].*\n)?(?:\s*(?:10|[A2-9TJQK])[CDHS♣♦♥♠]\s*,?){52}\s*$/i.test(t),
  parse(text) {
    const head = HEAD_RE.exec(text);
    const deck = parseCards(text.replace(HEAD_RE, ""));
    if (deck.length !== 52) throw new Error(`expected 52 cards, got ${deck.length}`);
    const seen = new Set(deck);
    if (seen.size !== 52) throw new Error(`${cardName(deck.find((c, i) => deck.indexOf(c) !== i)!)} appears twice`);
    const passes = Number(head?.[2] ?? 0);
    if (passes < 0 || passes > 99) throw new Error("passes run from 0 (no limit) to 99");
    return { deck, draw: Number(head?.[1] ?? 1), passes };
  },
  serialize: (p) => `draw ${p.draw}, passes ${p.passes}\n${p.deck.slice(0, 28).map(cardCode).join(" ")}\n${p.deck.slice(28).map(cardCode).join(" ")}`,
};

// --- rules for the table ---

export function canLift(_p: KlondikePuzzle, s: KlondikeState, pile: number, index: number): boolean {
  const pl = s.piles[pile];
  if (!pl || index < 0 || index >= pl.c.length || pile === STOCK) return false;
  if (pile < COLS) return index === pl.c.length - 1;
  return index >= pl.d;
}

export function moveAction(_p: KlondikePuzzle, s: KlondikeState, from: number, index: number, to: number): KlondikeAction | null {
  const a = { type: "move" as const, from, to, n: (s.piles[from]?.c.length ?? 0) - index };
  return isLegal(toPos(s), a) ? a : null;
}

/** Clicking: the stock draws; a card goes home if it can, else onto a column, else a king into an empty column. */
export function tapAction(p: KlondikePuzzle, s: KlondikeState, pile: number, index: number): KlondikeAction[] | null {
  if (pile === STOCK) return click(toPos(s), rulesOf(p)) ? [{ type: "draw" }] : null;
  if (!canLift(p, s, pile, index)) return null;
  const card = s.piles[pile]!.c[index]!;
  const cols = Array.from({ length: 7 }, (_, j) => COLS + j);
  const order = [FOUND + suitOf(card), ...cols.filter((j) => s.piles[j]!.c.length), ...cols.filter((j) => !s.piles[j]!.c.length)];
  for (const to of order) {
    if (to === pile) continue;
    const a = moveAction(p, s, pile, index, to);
    if (a) return [a];
  }
  return null;
}

/** "home", "onto 8♠", "into empty column 3". */
export function whereTo(s: KlondikeState, to: number): string {
  if (to < COLS) return "home";
  const dst = s.piles[to]!.c;
  return dst.length ? `onto ${cardName(dst[dst.length - 1]!)}` : `into empty ${pileName(to)}`;
}

export function describeMove(s: KlondikeState, a: { from: number; to: number; n: number }): string {
  const src = s.piles[a.from]!.c;
  const lead = src[src.length - a.n]!;
  const what = a.n === 1 ? cardName(lead) : `${cardName(lead)} and the ${a.n - 1} ${a.n === 2 ? "card" : "cards"} on it`;
  return `${what} ${a.from >= FOUND && a.from < COLS ? "back down " : ""}${whereTo(s, a.to)}`;
}

function describeAction(p: KlondikePuzzle, a: KlondikeAction, before: KlondikeState, after: KlondikeState): string {
  if (a.type === "draw") {
    if (!before.piles[STOCK]!.c.length) return "turn the waste over";
    const top = after.piles[WASTE]!.c[after.piles[WASTE]!.c.length - 1];
    return p.draw === 1 || top === undefined ? `draw ${top === undefined ? "" : cardName(top)}`.trim() : `draw 3, ${cardName(top)} on top`;
  }
  const text = describeMove(before, a);
  const from = after.piles[a.from]!;
  const turned = a.from >= COLS && before.piles[a.from]!.d > from.d ? from.c[from.c.length - 1] : undefined;
  return turned === undefined ? text : `${text}, turning over ${cardName(turned)}`;
}

function rate(p: KlondikePuzzle): Rating | null {
  if (!p.solution) return null;
  const draws = p.solution.reduce((n, m) => n + m.draws, 0);
  const score = p.solution.length + draws;
  return { label: score < 110 ? "easy" : score < 160 ? "medium" : "hard", score };
}

export const klondike: PuzzleDef<KlondikePuzzle, KlondikeState, KlondikeAction, KlondikeInteraction, typeof params> = {
  id: "klondike",
  name: "Klondike",
  aliases: ["solitaire", "patience", "klondike solitaire"],
  tags: ["cards", "solitaire", "moves"],
  description: "the classic solitaire: build every suit up from ace to king on the foundations, digging through the seven columns and the stock.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "draw one", params: { draw: "1", passes: "0" } },
    { label: "draw three", params: { draw: "3", passes: "0" } },
    { label: "draw three, three passes", params: { draw: "3", passes: "3" } },
  ],
  generate,
  formats: [dealFormat],
  init: (p) => fromPos(dealPos(p.deck), 0),
  initInteraction: () => ({ cursor: { pile: COLS, index: 0, held: null } }),
  reduce(p, s, a) {
    const pos = toPos(s);
    if (a.type === "draw") {
      if (!click(pos, rulesOf(p))) return s;
      return fromPos(pos, s.moves + 1);
    }
    if (a.type !== "move" || !isLegal(pos, a)) return s;
    applyMove(pos, { draws: 0, ...a }, rulesOf(p));
    return fromPos(pos, s.moves + 1);
  },
  isSolved: (_p, s) => isWon(toPos(s)),
  isLost: (p, s) => {
    const pos = toPos(s);
    return !isWon(pos) && moves(pos, rulesOf(p)).length === 0;
  },
  rate,
  rules: (p) => [
    "build four foundations, one per suit, from ace up to king.",
    "in the columns, a card goes on one a rank higher of the other color (red on black, black on red). only a king, or a run starting with one, goes into an empty column.",
    "any face-up run in a column moves together; when a face-down card is left on top it turns over.",
    `click the stock to turn over ${p.draw === 1 ? "one card" : "three cards"}; only the top card of the waste plays. when the stock runs out, click it to turn the waste back over${p.passes ? ` (${p.passes === 1 ? "no second pass" : `${p.passes} passes in all`})` : ""}.`,
    "cards can come back down from a foundation onto a column.",
  ],
  describe: (p) => `draw ${p.draw === 1 ? "one" : "three"}${p.passes ? `, ${p.passes === 1 ? "one pass" : `${p.passes} passes`}` : ""}`,
  describeAction,
};
