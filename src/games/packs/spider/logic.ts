import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, PuzzleDef, Rating } from "../../core/types";
import { cardCode, cardName, face, parseCards, suitOf, SUIT_NAMES } from "../../lib/cards/deck";
import type { Pile } from "../../lib/cards/piles";
import type { CardCursor } from "../../lib/cards/table";
import { applyMove, colBase, DONE, isLegal, isWon, moves, runLength, solve, STOCK, type Move, type Pos } from "./solver";

export const params = defineSchema({
  decks: { type: "int", label: "decks", default: 2, min: 1, max: 4, description: "52 cards each; every deck adds four runs to finish" },
  suits: {
    type: "enum", label: "suits", default: "1",
    options: [{ value: "1", label: "one suit" }, { value: "2", label: "two suits" }, { value: "4", label: "four suits" }],
  },
  columns: { type: "int", label: "columns", default: 10, min: 4, max: 16 },
  deals: { type: "int", label: "stock deals", default: 5, min: 1, max: 10, description: "rows dealt from the stock, one card per column; fewer when the columns would start empty" },
  winnable: { type: "bool", label: "winnable when the solver can tell", default: true, description: "deal again (a few times) until the solver finds a win; with more suits it often can't, and the deal says so" },
});

export interface SpiderPuzzle {
  /** The card faces (52 per deck) in dealing order; a card's id is its place here. All but the stock go round the columns, then the stock, first deal first. */
  deck: number[];
  suits: number;
  /** Absent in games saved before these were options: 10. */
  columns?: number;
  /** Absent in games saved before these were options: 5. */
  deals?: number;
  /** A win from the start, found when the deal was made. */
  solution?: Move[];
}

/** Piles: 0 stock, then one per run to complete (4 per deck), then the columns. */
export interface SpiderState {
  piles: Pile[];
  moves: number;
}

export type SpiderAction = { type: "deal" } | { type: "move"; from: number; to: number; n: number };

export interface SpiderInteraction {
  cursor: CardCursor;
}

const SUIT_ORDER = [3, 2, 0, 1];

export const columnsOf = (p: SpiderPuzzle): number => p.columns ?? 10;
export const dealsOf = (p: SpiderPuzzle): number => p.deals ?? 5;
/** Runs to finish. */
export const setsOf = (p: SpiderPuzzle): number => p.deck.length / 13;
/** Pile number of the first column. */
export const baseOf = (p: SpiderPuzzle): number => colBase({ sets: setsOf(p) });
export const stockSize = (p: SpiderPuzzle): number => dealsOf(p) * columnsOf(p);

/** Most stock deals a deck can pay for while every column still starts with a card. */
export const maxDeals = (cards: number, columns: number): number => Math.max(0, Math.floor(cards / columns) - 1);

export function toPos(p: SpiderPuzzle, s: SpiderState): Pos {
  const base = baseOf(p);
  return {
    stock: s.piles[STOCK]!.c.slice(),
    done: s.piles.slice(DONE, base).filter((pl) => pl.c.length).map((pl) => pl.c.slice()),
    cols: s.piles.slice(base).map((pl) => pl.c.slice()),
    down: s.piles.slice(base).map((pl) => pl.d),
    sets: setsOf(p),
  };
}

export function fromPos(p: Pos, moveCount: number): SpiderState {
  return {
    piles: [
      { c: p.stock.slice(), d: p.stock.length },
      ...Array.from({ length: p.sets }, (_, i) => ({ c: p.done[i]?.slice() ?? [], d: 0 })),
      ...p.cols.map((c, j) => ({ c: c.slice(), d: p.down[j]! })),
    ],
    moves: moveCount,
  };
}

export function dealPos(p: SpiderPuzzle): Pos {
  const ids = p.deck.map((_, i) => i);
  const dealt = p.deck.length - stockSize(p);
  const cols: number[][] = Array.from({ length: columnsOf(p) }, () => []);
  for (let i = 0; i < dealt; i++) cols[i % cols.length]!.push(ids[i]!);
  return { stock: ids.slice(dealt).reverse(), cols, down: cols.map((c) => c.length - 1), done: [], sets: setsOf(p) };
}

export function pileName(p: SpiderPuzzle, pile: number): string {
  if (pile === STOCK) return "the stock";
  const base = baseOf(p);
  if (pile < base) return "the finished runs";
  return `column ${pile - base + 1}`;
}

/** 500 to start, a point off per move, a hundred per finished run. */
export const scoreOf = (s: SpiderState, sets: number): number =>
  Math.max(0, 500 - s.moves + 100 * s.piles.slice(DONE, DONE + sets).filter((pl) => pl.c.length).length);

export const actionOf = (m: Move): SpiderAction => (m.from === STOCK ? { type: "deal" } : { type: "move", from: m.from, to: m.to, n: m.n });

const GEN_BUDGET = 40_000;

async function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<SpiderPuzzle> {
  const suits = Number(v.suits), decks = v.decks;
  const faces = Array.from({ length: 52 * decks }, (_, i) => face(SUIT_ORDER[Math.floor(i / 13) % suits]!, (i % 13) + 1));
  const columns = v.columns, deals = Math.min(v.deals, maxDeals(faces.length, columns));
  let first: SpiderPuzzle | null = null;
  const tries = decks > 2 ? 2 : suits === 1 ? 12 : suits === 2 ? 6 : 3;
  for (let attempt = 0; attempt < tries; attempt++) {
    const puzzle: SpiderPuzzle = { deck: rng.shuffle(faces.slice()), suits, columns, deals };
    if (!v.winnable) return puzzle;
    first ??= puzzle;
    const r = solve(puzzle.deck, dealPos(puzzle), GEN_BUDGET);
    if (r.path) return { ...puzzle, solution: r.path };
    await ctx.yield();
  }
  return first!;
}

// --- formats ---

const HEAD_RE = /^\s*(?:(?:suits?|columns?|deals?)\s*\d+\s*[,;]?\s*)+$/gim;
const headNumber = (head: string, key: string): number | undefined => {
  const m = new RegExp(`${key}s?\\s*(\\d+)`, "i").exec(head);
  return m ? Number(m[1]) : undefined;
};

/** Whole decks (up to four) restricted to 1, 2 or 4 suits: every card of the suits used appears equally often. */
function checkDeck(deck: number[]): number {
  if (deck.length % 52 || deck.length < 52 || deck.length > 208) throw new Error(`expected 52, 104, 156 or 208 cards, got ${deck.length}`);
  const used = [...new Set(deck.map(suitOf))];
  if (![1, 2, 4].includes(used.length)) throw new Error("use 1, 2 or 4 suits");
  const each = deck.length / 13 / used.length;
  for (const s of used) for (let r = 1; r <= 13; r++) {
    const n = deck.filter((c) => c === face(s, r)).length;
    if (n !== each) throw new Error(`expected ${cardName(face(s, r))} ${each} times, got ${n}`);
  }
  return used.length;
}

/**
 * Plain deal: optional "suits 2, columns 10, deals 5" lines, then the cards as codes (like TH) in
 * dealing order: all but the stock round the columns, then the stock, first deal first.
 */
export const dealFormat: Format<SpiderPuzzle> = {
  id: "deal",
  label: "deal (cards in dealing order)",
  detect: (t) => {
    const n = (t.replace(HEAD_RE, "").match(/(?:10|[A2-9TJQK])[CDHS]/gi) ?? []).length;
    return n % 52 === 0 && n >= 52 && n <= 208 && (n > 52 || new RegExp(HEAD_RE.source, "im").test(t));
  },
  parse(text) {
    const head = (text.match(HEAD_RE) ?? []).join(" ");
    const deck = parseCards(text.replace(HEAD_RE, ""));
    const suits = checkDeck(deck);
    const columns = headNumber(head, "column") ?? 10;
    if (columns < 2 || columns > 20) throw new Error("columns run from 2 to 20");
    const deals = headNumber(head, "deal") ?? Math.min(5, maxDeals(deck.length, columns));
    if (deals < 1 || deals > maxDeals(deck.length, columns)) throw new Error(`with ${columns} columns this deck pays for 1 to ${maxDeals(deck.length, columns)} stock deals`);
    return { deck, suits, columns, deals };
  },
  serialize(p) {
    const c = columnsOf(p);
    return `suits ${p.suits}, columns ${c}, deals ${dealsOf(p)}\n${Array.from({ length: Math.ceil(p.deck.length / c) }, (_, r) => p.deck.slice(r * c, r * c + c).map(cardCode).join(" ")).join("\n")}`;
  },
};

// --- rules for the table ---

export function canLift(p: SpiderPuzzle, s: SpiderState, pile: number, index: number): boolean {
  if (pile < baseOf(p)) return false;
  const pl = s.piles[pile];
  if (!pl || index < pl.d || index >= pl.c.length) return false;
  return pl.c.length - index <= runLength(p.deck, pl.c, pl.d);
}

export function moveAction(p: SpiderPuzzle, s: SpiderState, from: number, index: number, to: number): SpiderAction | null {
  const a = { type: "move" as const, from, to, n: (s.piles[from]?.c.length ?? 0) - index };
  return isLegal(p.deck, toPos(p, s), a) ? a : null;
}

/** Clicking: the stock deals; a run goes onto the same suit if it can, else any card one higher, else an empty column. */
export function tapAction(p: SpiderPuzzle, s: SpiderState, pile: number, index: number): SpiderAction[] | null {
  if (pile === STOCK) return isLegal(p.deck, toPos(p, s), { from: STOCK, to: STOCK, n: 0 }) ? [{ type: "deal" }] : null;
  if (!canLift(p, s, pile, index)) return null;
  const lead = p.deck[s.piles[pile]!.c[index]!]!;
  const cols = Array.from({ length: columnsOf(p) }, (_, j) => baseOf(p) + j).filter((j) => j !== pile);
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
  return dst.length ? `onto ${cardName(p.deck[dst[dst.length - 1]!]!)}` : `into empty ${pileName(p, to)}`;
}

export function describeMove(p: SpiderPuzzle, s: SpiderState, a: { from: number; to: number; n: number }): string {
  const src = s.piles[a.from]!.c;
  const lead = p.deck[src[src.length - a.n]!]!;
  const what = a.n === 1 ? cardName(lead) : `${cardName(lead)} and the ${a.n - 1} ${a.n === 2 ? "card" : "cards"} on it`;
  return `${what} ${whereTo(p, s, a.to)}`;
}

function describeAction(p: SpiderPuzzle, a: SpiderAction, before: SpiderState, after: SpiderState): string {
  const finishedIn = (st: SpiderState) => st.piles.slice(DONE, baseOf(p)).filter((pl) => pl.c.length).length;
  const done = finishedIn(after) - finishedIn(before);
  const finished = done > 0 ? `, finishing ${done === 1 ? "a run" : `${done} runs`}` : "";
  if (a.type === "deal") return `deal a row${finished}`;
  return `${describeMove(p, before, a)}${finished}`;
}

function rate(p: SpiderPuzzle): Rating | null {
  if (!p.solution) return null;
  const n = p.solution.length;
  const per = n * 8 / setsOf(p);
  return { label: per < 140 ? "easy" : per < 200 ? "medium" : "hard", score: p.suits * 1000 + n };
}

export const spider: PuzzleDef<SpiderPuzzle, SpiderState, SpiderAction, SpiderInteraction, typeof params> = {
  id: "spider",
  name: "Spider",
  aliases: ["spider solitaire", "patience"],
  tags: ["cards", "solitaire", "moves"],
  description: "build runs from king down to ace in one suit, and each finished run leaves the table. win by finishing every run of every deck. one to four decks, any number of columns and stock deals.",
  generatorVersion: 2,
  params,
  presets: [
    { label: "one suit", params: { decks: 2, suits: "1", columns: 10, deals: 5 } },
    { label: "two suits", params: { decks: 2, suits: "2", columns: 10, deals: 5 } },
    { label: "four suits", params: { decks: 2, suits: "4", columns: 10, deals: 5 } },
    { label: "one deck, one suit", params: { decks: 1, suits: "1", columns: 7, deals: 4 } },
    { label: "one deck, two suits", params: { decks: 1, suits: "2", columns: 7, deals: 4 } },
    { label: "one deck, four suits", params: { decks: 1, suits: "4", columns: 7, deals: 4 } },
    { label: "three decks, two suits", params: { decks: 3, suits: "2", columns: 13, deals: 6 } },
    { label: "four decks, two suits", params: { decks: 4, suits: "2", columns: 16, deals: 7 } },
  ],
  generate,
  formats: [dealFormat],
  init: (p) => fromPos(dealPos(p), 0),
  initInteraction: (p) => ({ cursor: { pile: baseOf(p), index: 5, held: null } }),
  reduce(p, s, a) {
    const pos = toPos(p, s);
    const m: Move = a.type === "deal" ? { from: STOCK, to: STOCK, n: 0 } : a.type === "move" ? a : { from: -1, to: -1, n: 0 };
    if (!isLegal(p.deck, pos, m)) return s;
    applyMove(p.deck, pos, m);
    return fromPos(pos, s.moves + 1);
  },
  isSolved: (p, s) => isWon(toPos(p, s)),
  isLost: (p, s) => {
    const pos = toPos(p, s);
    return !isWon(pos) && moves(p.deck, pos).length === 0;
  },
  rate,
  rules: (p) => [
    "in the columns, a card goes on any card one rank higher, whatever its suit. any card or run can go into an empty column.",
    "a run of cards going down in one suit moves together; a mixed-suit run doesn't.",
    `a run from king down to ace in one suit leaves the table by itself. finish all ${setsOf(p)} to win.`,
    `click the stock to deal one more card onto every column; not while a column is empty. there are ${dealsOf(p)} deals.`,
    p.suits === 1 ? "this deal uses spades only." : `this deal uses ${p.suits} suits: ${SUIT_ORDER.slice(0, p.suits).map((s) => SUIT_NAMES[s]).join(", ")}.`,
  ],
  describe: (p) => `${setsOf(p) / 4 === 2 ? "" : `${setsOf(p) / 4} ${setsOf(p) === 4 ? "deck" : "decks"}, `}${p.suits === 1 ? "one suit" : `${p.suits} suits`}${p.solution ? "" : ", not known winnable"}`,
  describeAction,
};
