import type { Rng } from "../../core/rng";
import { defineSchema, type Values } from "../../core/schema";
import type { Format, GenerateContext, PuzzleDef, Rating } from "../../core/types";
import { cardCode, cardName, msDeal, parseCard, shuffledDeck, suitOf, SUIT_GLYPHS } from "../../lib/cards/deck";
import type { Pile } from "../../lib/cards/piles";
import type { CardCursor } from "../../lib/cards/table";
import { applyMove, BUDGET, isLegal, isWon, moves, runLength, solve, type Move, type Pos } from "./solver";

export const params = defineSchema({
  cells: { type: "int", label: "free cells", default: 4, min: 1, max: 4, description: "fewer free cells make it much harder" },
  deal: { type: "int", label: "deal number (0 = random)", default: 0, min: 0, max: 2147483647, description: "the numbered deals of Microsoft FreeCell, so a number gives the same cards as there; the same number always deals the same game" },
  winnable: { type: "bool", label: "always winnable", default: true, description: "deal again until the solver finds a win; a numbered deal is dealt as it is" },
});

export interface FreecellPuzzle {
  /** Columns bottom first. */
  cols: number[][];
  /** Free cells, -1 when empty. */
  cells: number[];
  /** Top rank on each suit's foundation (clubs, diamonds, hearts, spades), 0 when empty. */
  found: number[];
  /** Microsoft deal number, when the deal is one. */
  deal?: number;
  /** A win from the start, found when the deal was made. */
  solution?: Move[];
}

/** Piles: the free cells, then the foundations (one per suit, clubs diamonds hearts spades), then the columns. */
export interface FreecellState {
  piles: Pile[];
  moves: number;
}

export type FreecellAction = { type: "move"; from: number; to: number; n: number };

export interface FreecellInteraction {
  cursor: CardCursor;
}

const COLS = 8;

export function toPos(s: FreecellState, cellCount: number): Pos {
  const C = cellCount;
  return {
    cells: s.piles.slice(0, C).map((pl) => pl.c[0] ?? -1),
    found: s.piles.slice(C, C + 4).map((pl) => pl.c.length),
    cols: s.piles.slice(C + 4).map((pl) => pl.c.slice()),
  };
}

export function fromPos(p: Pos): Pile[] {
  return [
    ...p.cells.map((c) => ({ c: c >= 0 ? [c] : [], d: 0 })),
    ...p.found.map((r, s) => ({ c: Array.from({ length: r }, (_, i) => s * 13 + i), d: 0 })),
    ...p.cols.map((c) => ({ c: c.slice(), d: 0 })),
  ];
}

export const startPos = (p: FreecellPuzzle): Pos => ({ cols: p.cols.map((c) => c.slice()), cells: p.cells.slice(), found: p.found.slice() });

/** "column 3", "free cell 2", "the ♥ foundation". */
export function pileName(p: { cells: readonly number[] }, pile: number): string {
  const C = p.cells.length;
  if (pile < C) return `free cell ${pile + 1}`;
  if (pile < C + 4) return `the ${SUIT_GLYPHS[pile - C]} foundation`;
  return `column ${pile - C - 3}`;
}

function dealCols(deck: readonly number[], cols = COLS): number[][] {
  const out: number[][] = Array.from({ length: cols }, () => []);
  deck.forEach((c, i) => out[i % cols]!.push(c));
  return out;
}

async function generate(v: Values<typeof params>, rng: Rng, ctx: GenerateContext): Promise<FreecellPuzzle> {
  if (v.deal > 0) {
    const puzzle: FreecellPuzzle = { cols: dealCols(msDeal(v.deal)), cells: Array(v.cells).fill(-1), found: [0, 0, 0, 0], deal: v.deal };
    const r = v.winnable ? solve(startPos(puzzle)) : null;
    return r?.path ? { ...puzzle, solution: r.path } : puzzle;
  }
  let last: FreecellPuzzle | null = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const cols = dealCols(shuffledDeck(rng));
    const puzzle: FreecellPuzzle = { cols, cells: Array(v.cells).fill(-1), found: [0, 0, 0, 0] };
    if (!v.winnable) return puzzle;
    const r = solve(startPos(puzzle));
    if (r.path) return { ...puzzle, solution: r.path };
    last = puzzle;
    await ctx.yield();
  }
  return last!;
}

// --- formats ---

function checkCards(p: FreecellPuzzle): FreecellPuzzle {
  const seen = new Set<number>();
  const add = (c: number) => {
    if (seen.has(c)) throw new Error(`${cardName(c)} appears twice`);
    seen.add(c);
  };
  p.cols.flat().forEach(add);
  p.cells.filter((c) => c >= 0).forEach(add);
  p.found.forEach((r, s) => { for (let i = 1; i <= r; i++) add(s * 13 + i - 1); });
  if (seen.size !== 52) {
    const missing = Array.from({ length: 52 }, (_, i) => i).filter((c) => !seen.has(c)).map(cardName);
    throw new Error(`missing ${missing.slice(0, 6).join(" ")}${missing.length > 6 ? ` and ${missing.length - 6} more` : ""}`);
  }
  if (p.cols.length < 1 || p.cols.length > 12) throw new Error("expected 1 to 12 columns");
  if (p.cells.length < 1 || p.cells.length > 8) throw new Error("expected 1 to 8 free cells");
  return p;
}

/** Microsoft FreeCell deal numbers: "#617", "617". */
export const msFormat: Format<FreecellPuzzle> = {
  id: "ms",
  label: "deal number (Microsoft FreeCell, 1 to 2147483647)",
  detect: (t) => /^\s*(?:#|game\s*|deal\s*)?\d+\s*$/i.test(t),
  parse(text) {
    const n = Number(/\d+/.exec(text)?.[0]);
    if (!Number.isInteger(n) || n < 1 || n > 2147483647) throw new Error("deal numbers run from 1 to 2147483647");
    return { cols: dealCols(msDeal(n)), cells: [-1, -1, -1, -1], found: [0, 0, 0, 0], deal: n };
  },
};

const FC_RE = /^\s*(?:fc|freecells)\s*:/i;
const FOUND_RE = /^\s*(?:founds|foundations)\s*:/i;
const SUIT_INDEX: Record<string, number> = { C: 0, D: 1, H: 2, S: 3 };
const RANK_INDEX = "0A23456789TJQK";

/**
 * Freecell Solver's board text: one line per column, cards from the bottom of the column (the one
 * on the table) to the top, e.g. "4C 2C 9C 8C QS 4S 2H"; an optional "Freecells: 8H - -" line
 * and "Foundations: H-5 C-A S-0 D-K" line. A column line may start with ":".
 */
export const fcSolveFormat: Format<FreecellPuzzle> = {
  id: "fcs",
  label: "board (Freecell Solver layout: a line of cards per column)",
  detect: (t) => t.trim().split(/\r?\n/).filter((l) => l.trim()).length >= 4 && /^[\s:]*(?:10|[A2-9TJQK])[CDHS]\b/i.test(t.trim().split(/\r?\n/).find((l) => !FC_RE.test(l) && !FOUND_RE.test(l)) ?? ""),
  parse(text) {
    const cols: number[][] = [];
    let cells: number[] = [-1, -1, -1, -1];
    const found = [0, 0, 0, 0];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, "").trim();
      if (!line) continue;
      if (FC_RE.test(line)) {
        const items = line.replace(FC_RE, "").trim().split(/\s+/).filter(Boolean);
        cells = items.map((x) => (x === "-" ? -1 : parseCard(x)));
        continue;
      }
      if (FOUND_RE.test(line)) {
        for (const item of line.replace(FOUND_RE, "").trim().split(/\s+/).filter(Boolean)) {
          const m = /^([CDHS])-(0|10|[A2-9TJQK])$/i.exec(item);
          if (!m) throw new Error(`"${item}" is not a foundation (expected like H-5 or S-0)`);
          found[SUIT_INDEX[m[1]!.toUpperCase()]!] = m[2] === "10" ? 10 : RANK_INDEX.indexOf(m[2]!.toUpperCase());
        }
        continue;
      }
      cols.push(line.replace(/^:/, "").trim().split(/\s+/).filter(Boolean).map(parseCard));
    }
    return checkCards({ cols, cells, found });
  },
  serialize(p) {
    const lines = p.cols.map((c) => `: ${c.map(cardCode).join(" ")}`.trimEnd());
    const head: string[] = [];
    if (p.found.some(Boolean)) head.push(`Foundations: ${p.found.map((r, s) => `${"CDHS"[s]}-${r ? RANK_INDEX[r] : "0"}`).join(" ")}`);
    head.push(`Freecells: ${p.cells.map((c) => (c < 0 ? "-" : cardCode(c))).join(" ")}`);
    return [...head, ...lines].join("\n");
  },
};

// --- rules ---

export function canLift(p: FreecellPuzzle, s: FreecellState, pile: number, index: number): boolean {
  const C = p.cells.length;
  const pl = s.piles[pile];
  if (!pl || index < 0 || index >= pl.c.length) return false;
  if (pile < C) return true;
  if (pile < C + 4) return false;
  return pl.c.length - index <= runLength(pl.c);
}

export function moveAction(p: FreecellPuzzle, s: FreecellState, from: number, index: number, to: number): FreecellAction | null {
  const n = (s.piles[from]?.c.length ?? 0) - index;
  const a: FreecellAction = { type: "move", from, to, n };
  return isLegal(toPos(s, p.cells.length), a) ? a : null;
}

/** Clicking a card: home if it can go, else onto a column, else an empty column, else a free cell. */
export function tapAction(p: FreecellPuzzle, s: FreecellState, pile: number, index: number): FreecellAction[] | null {
  if (!canLift(p, s, pile, index)) return null;
  const C = p.cells.length;
  const card = s.piles[pile]!.c[index]!;
  const order = [C + suitOf(card)];
  const cols = Array.from({ length: p.cols.length }, (_, j) => C + 4 + j);
  order.push(...cols.filter((j) => s.piles[j]!.c.length), ...cols.filter((j) => !s.piles[j]!.c.length));
  if (pile >= C) for (let i = 0; i < C; i++) order.push(i);
  for (const to of order) {
    if (to === pile) continue;
    const a = moveAction(p, s, pile, index, to);
    if (a) return [a];
  }
  return null;
}

export function describeMove(p: { cells: readonly number[] }, s: FreecellState, a: { from: number; to: number; n: number }): string {
  const src = s.piles[a.from]!.c;
  const lead = src[src.length - a.n]!;
  const what = a.n === 1 ? cardName(lead) : `${cardName(lead)} and the ${a.n - 1} ${a.n === 2 ? "card" : "cards"} on it`;
  return `${what} ${whereTo(p, s, a)}`;
}

/** "home", "to a free cell", "onto 8♠", "into empty column 3". */
export function whereTo(p: { cells: readonly number[] }, s: FreecellState, a: { to: number }): string {
  const C = p.cells.length;
  if (a.to >= C && a.to < C + 4) return "home";
  if (a.to < C) return "to a free cell";
  const dst = s.piles[a.to]!.c;
  return dst.length ? `onto ${cardName(dst[dst.length - 1]!)}` : `into empty ${pileName(p, a.to)}`;
}

function rate(p: FreecellPuzzle): Rating | null {
  const r = solve(startPos(p), BUDGET);
  if (!r.path) return null;
  const label = r.nodes < 400 ? "easy" : r.nodes < 4000 ? "medium" : "hard";
  return { label, score: r.nodes };
}

export const freecell: PuzzleDef<FreecellPuzzle, FreecellState, FreecellAction, FreecellInteraction, typeof params> = {
  id: "freecell",
  name: "FreeCell",
  aliases: ["free cell", "freecell solitaire", "patience"],
  tags: ["cards", "solitaire", "moves"],
  description: "move every card to its foundation, ace to king by suit. every card is face up; use the free cells and empty columns to dig out what you need.",
  generatorVersion: 1,
  params,
  presets: [
    { label: "4 free cells", params: { cells: 4 } },
    { label: "3 free cells", params: { cells: 3 } },
    { label: "2 free cells", params: { cells: 2 } },
  ],
  generate,
  formats: [fcSolveFormat, msFormat],
  init: (p) => ({ piles: fromPos(startPos(p)), moves: 0 }),
  initInteraction: (p) => ({ cursor: { pile: p.cells.length + 4, index: (p.cols[0]?.length ?? 0) - 1, held: null } }),
  reduce(p, s, a) {
    if (a.type !== "move") return s;
    const pos = toPos(s, p.cells.length);
    if (!isLegal(pos, a)) return s;
    applyMove(pos, a);
    return { piles: fromPos(pos), moves: s.moves + 1 };
  },
  isSolved: (p, s) => isWon(toPos(s, p.cells.length)),
  isLost: (p, s) => {
    const pos = toPos(s, p.cells.length);
    return !isWon(pos) && moves(pos).length === 0;
  },
  rate,
  rules: (p) => [
    "build four foundations, one per suit, from ace up to king.",
    "in the columns, a card goes on one a rank higher of the other color (red on black, black on red). any card can go into an empty column.",
    `each free cell holds one card. there ${p.cells.length === 1 ? "is 1 free cell" : `are ${p.cells.length} free cells`}.`,
    "a run of ordered cards moves together if there are enough free cells and empty columns to move it one card at a time: (free cells + 1), doubled for every empty column not being moved into.",
    "cards on a foundation stay there.",
  ],
  describe: (p) => (p.deal ? `deal #${p.deal}` : `${p.cells.length} free ${p.cells.length === 1 ? "cell" : "cells"}`),
  describeAction: (p, a, before) => describeMove(p, before, a),
};
