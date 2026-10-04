import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, PuzzleDef, Rating } from "../../core/types";
import { cardCode, cardName, face, parseCards, suitOf, SUIT_NAMES } from "../../lib/cards/deck";
import type { Pile } from "../../lib/cards/piles";
import type { CardCursor } from "../../lib/cards/table";
import { applyMove, COLS, DONE, isLegal, isWon, moves, runLength, solve, STOCK, type Move, type Pos } from "./solver";

export const params = defineSchema({
  suits: {
    type: "enum", label: "suits", default: "1",
    options: [{ value: "1", label: "one suit" }, { value: "2", label: "two suits" }, { value: "4", label: "four suits" }],
  },
  winnable: { type: "bool", label: "winnable when the solver can tell", default: true, description: "deal again (a few times) until the solver finds a win; with more suits it often can't, and the deal says so" },
});

export interface SpiderPuzzle {
  /** The 104 card faces in dealing order; a card's id is its place here. 54 go round the ten columns, then the stock, first deal first. */
  deck: number[];
  suits: number;
  /** A win from the start, found when the deal was made. */
  solution?: Move[];
}

/** Piles: 0 stock, 1–8 completed suits, 9–18 columns. */
export interface SpiderState {
  piles: Pile[];
  moves: number;
}

export type SpiderAction = { type: "deal" } | { type: "move"; from: number; to: number; n: number };

export interface SpiderInteraction {
  cursor: CardCursor;
}

const SUIT_ORDER = [3, 2, 0, 1];

export function toPos(s: SpiderState): Pos {
  return {
    stock: s.piles[STOCK]!.c.slice(),
    done: s.piles.slice(DONE, COLS).filter((pl) => pl.c.length).map((pl) => pl.c.slice()),
    cols: s.piles.slice(COLS).map((pl) => pl.c.slice()),
    down: s.piles.slice(COLS).map((pl) => pl.d),
  };
}

export function fromPos(p: Pos, moveCount: number): SpiderState {
  return {
    piles: [
      { c: p.stock.slice(), d: p.stock.length },
      ...Array.from({ length: 8 }, (_, i) => ({ c: p.done[i]?.slice() ?? [], d: 0 })),
      ...p.cols.map((c, j) => ({ c: c.slice(), d: p.down[j]! })),
    ],
    moves: moveCount,
  };
}

export function dealPos(p: SpiderPuzzle): Pos {
  const ids = p.deck.map((_, i) => i);
  const cols: number[][] = Array.from({ length: 10 }, () => []);
  for (let i = 0; i < 54; i++) cols[i % 10]!.push(ids[i]!);
  return { stock: ids.slice(54).reverse(), cols, down: cols.map((c) => c.length - 1), done: [] };
}

export function pileName(pile: number): string {
  if (pile === STOCK) return "the stock";
  if (pile < COLS) return "the finished suits";
  return `column ${pile - COLS + 1}`;
}

export const actionOf = (m: Move): SpiderAction => (m.from === STOCK ? { type: "deal" } : { type: "move", from: m.from, to: m.to, n: m.n });

const GEN_BUDGET = 40_000;

async function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<SpiderPuzzle> {
  const suits = Number(v.suits);
  const faces = Array.from({ length: 104 }, (_, i) => face(SUIT_ORDER[Math.floor(i / 13) % suits]!, (i % 13) + 1));
  let first: SpiderPuzzle | null = null;
  const tries = suits === 1 ? 12 : suits === 2 ? 6 : 3;
  for (let attempt = 0; attempt < tries; attempt++) {
    const puzzle: SpiderPuzzle = { deck: rng.shuffle(faces.slice()), suits };
    if (!v.winnable) return puzzle;
    first ??= puzzle;
    const r = solve(puzzle.deck, dealPos(puzzle), GEN_BUDGET);
    if (r.path) return { ...puzzle, solution: r.path };
    await ctx.yield();
  }
  return first!;
}

// --- formats ---

const HEAD_RE = /^\s*suits?\s*([124])\s*$/im;

/** Two decks restricted to 1, 2 or 4 suits: every card of the suits used appears equally often. */
function checkDeck(deck: number[]): number {
  if (deck.length !== 104) throw new Error(`expected 104 cards, got ${deck.length}`);
  const used = [...new Set(deck.map(suitOf))];
  if (![1, 2, 4].includes(used.length)) throw new Error("use 1, 2 or 4 suits");
  const each = 8 / used.length;
  for (const s of used) for (let r = 1; r <= 13; r++) {
    const n = deck.filter((c) => c === face(s, r)).length;
    if (n !== each) throw new Error(`expected ${cardName(face(s, r))} ${each} times, got ${n}`);
  }
  return used.length;
}

/** Plain deal: an optional "suits 2" line, then the 104 cards as codes (like TH) in dealing order: 54 round the ten columns, then the stock, first deal first. */
export const dealFormat: Format<SpiderPuzzle> = {
  id: "deal",
  label: "deal (104 cards in dealing order)",
  detect: (t) => (t.replace(HEAD_RE, "").match(/(?:10|[A2-9TJQK])[CDHS]/gi) ?? []).length === 104,
  parse(text) {
    const deck = parseCards(text.replace(HEAD_RE, ""));
    const suits = checkDeck(deck);
    return { deck, suits };
  },
  serialize: (p) => `suits ${p.suits}\n${Array.from({ length: 11 }, (_, r) => p.deck.slice(r * 10, r * 10 + 10).map(cardCode).join(" ")).join("\n")}`,
};

// --- rules for the table ---

export function canLift(p: SpiderPuzzle, s: SpiderState, pile: number, index: number): boolean {
  if (pile < COLS) return false;
  const pl = s.piles[pile];
  if (!pl || index < pl.d || index >= pl.c.length) return false;
  return pl.c.length - index <= runLength(p.deck, pl.c, pl.d);
}

export function moveAction(p: SpiderPuzzle, s: SpiderState, from: number, index: number, to: number): SpiderAction | null {
  const a = { type: "move" as const, from, to, n: (s.piles[from]?.c.length ?? 0) - index };
  return isLegal(p.deck, toPos(s), a) ? a : null;
}

/** Clicking: the stock deals; a run goes onto the same suit if it can, else any card one higher, else an empty column. */
export function tapAction(p: SpiderPuzzle, s: SpiderState, pile: number, index: number): SpiderAction[] | null {
  if (pile === STOCK) return isLegal(p.deck, toPos(s), { from: STOCK, to: STOCK, n: 0 }) ? [{ type: "deal" }] : null;
  if (!canLift(p, s, pile, index)) return null;
  const lead = p.deck[s.piles[pile]!.c[index]!]!;
  const cols = Array.from({ length: 10 }, (_, j) => COLS + j).filter((j) => j !== pile);
  const topFace = (j: number) => p.deck[s.piles[j]!.c[s.piles[j]!.c.length - 1]!]!;
  const filled = cols.filter((j) => s.piles[j]!.c.length);
  const order = [...filled.filter((j) => suitOf(topFace(j)) === suitOf(lead)), ...filled, ...cols.filter((j) => !s.piles[j]!.c.length)];
  for (const to of order) {
    const a = moveAction(p, s, pile, index, to);
    if (a) return [a];
  }
  return null;
}

export function whereTo(p: SpiderPuzzle, s: SpiderState, to: number): string {
  const dst = s.piles[to]!.c;
  return dst.length ? `onto ${cardName(p.deck[dst[dst.length - 1]!]!)}` : `into empty ${pileName(to)}`;
}

export function describeMove(p: SpiderPuzzle, s: SpiderState, a: { from: number; to: number; n: number }): string {
  const src = s.piles[a.from]!.c;
  const lead = p.deck[src[src.length - a.n]!]!;
  const what = a.n === 1 ? cardName(lead) : `${cardName(lead)} and the ${a.n - 1} ${a.n === 2 ? "card" : "cards"} on it`;
  return `${what} ${whereTo(p, s, a.to)}`;
}

function describeAction(p: SpiderPuzzle, a: SpiderAction, before: SpiderState, after: SpiderState): string {
  const done = after.piles.slice(DONE, COLS).filter((pl) => pl.c.length).length - before.piles.slice(DONE, COLS).filter((pl) => pl.c.length).length;
  const finished = done > 0 ? `, finishing ${done === 1 ? "a suit" : `${done} suits`}` : "";
  if (a.type === "deal") return `deal a row${finished}`;
  return `${describeMove(p, before, a)}${finished}`;
}

function rate(p: SpiderPuzzle): Rating | null {
  if (!p.solution) return null;
  const n = p.solution.length;
  return { label: n < 140 ? "easy" : n < 200 ? "medium" : "hard", score: p.suits * 1000 + n };
}

export const spider: PuzzleDef<SpiderPuzzle, SpiderState, SpiderAction, SpiderInteraction, typeof params> = {
  id: "spider",
  name: "Spider",
  aliases: ["spider solitaire", "patience"],
  tags: ["cards", "solitaire", "moves"],
  description: "two decks, ten columns: build runs from king down to ace in one suit, and each finished run leaves the table. win by finishing all eight.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "one suit", params: { suits: "1" } },
    { label: "two suits", params: { suits: "2" } },
    { label: "four suits", params: { suits: "4" } },
  ],
  generate,
  formats: [dealFormat],
  init: (p) => fromPos(dealPos(p), 0),
  initInteraction: () => ({ cursor: { pile: COLS, index: 5, held: null } }),
  reduce(p, s, a) {
    const pos = toPos(s);
    const m: Move = a.type === "deal" ? { from: STOCK, to: STOCK, n: 0 } : a.type === "move" ? a : { from: -1, to: -1, n: 0 };
    if (!isLegal(p.deck, pos, m)) return s;
    applyMove(p.deck, pos, m);
    return fromPos(pos, s.moves + 1);
  },
  isSolved: (_p, s) => isWon(toPos(s)),
  isLost: (p, s) => {
    const pos = toPos(s);
    return !isWon(pos) && moves(p.deck, pos).length === 0;
  },
  rate,
  rules: (p) => [
    "in the columns, a card goes on any card one rank higher, whatever its suit. any card or run can go into an empty column.",
    "a run of cards going down in one suit moves together; a mixed-suit run doesn't.",
    "a run from king down to ace in one suit leaves the table by itself. finish all eight to win.",
    "click the stock to deal one more card onto every column; not while a column is empty.",
    p.suits === 1 ? "this deal uses spades only." : `this deal uses ${p.suits} suits: ${SUIT_ORDER.slice(0, p.suits).map((s) => SUIT_NAMES[s]).join(", ")}.`,
  ],
  describe: (p) => `${p.suits === 1 ? "one suit" : `${p.suits} suits`}${p.solution ? "" : ", not known winnable"}`,
  describeAction,
};
