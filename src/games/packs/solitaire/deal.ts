import { effective, type Values } from "../../core/schema";
import { face as faceOf, suitOf } from "../../lib/cards/deck";
import type { Pile } from "../../lib/cards/piles";
import { makeCtx, type Ctx, type Idx, type Move, type Pos, type Rules } from "./engine";
import { params, parseCustom, type CustomColumn } from "./params";
import type { Scoring } from "./score";

export interface SolitairePuzzle {
  rules: Rules;
  /** Face of each card id. */
  faces: number[];
  /** The starting table, card ids bottom first. */
  cols: number[][];
  /** Face-down cards at the bottom of each starting column. */
  down: number[];
  /** Free cells, -1 when empty. */
  cells: number[];
  /** One per 13 cards of a suit (see foundationSuits); usually empty at the start. */
  found: number[][];
  /** Bottom first: the last card is drawn or dealt first. */
  stock: number[];
  scoring: Scoring;
  timed: boolean;
  /** Microsoft FreeCell deal number, when the deal is one. */
  deal?: number;
  /** A win from the start, found when the deal was made. */
  solution?: Move[];
}

/** Piles in Idx order: stock, waste, free cells, foundations, columns. */
export interface SolitaireState {
  piles: Pile[];
  recycles: number;
  moves: number;
  score: number;
}

export type SolitaireAction = { type: "draw" } | { type: "move"; from: number; to: number; n: number };

export function idxOf(p: Pick<SolitairePuzzle, "rules" | "stock" | "cells" | "found" | "cols">): Idx {
  let k = 0;
  const stock = p.stock.length ? k++ : -1;
  const waste = stock >= 0 && p.rules.stock === "waste" ? k++ : -1;
  const cells = k;
  const found = cells + p.cells.length;
  const cols = found + p.found.length;
  return { stock, waste, cells, found, cols, total: cols + p.cols.length };
}

const ctxMemo = new WeakMap<SolitairePuzzle, Ctx>();
export function ctxOf(p: SolitairePuzzle): Ctx {
  let c = ctxMemo.get(p);
  if (!c) {
    c = makeCtx(p.rules, p.faces, idxOf(p));
    ctxMemo.set(p, c);
  }
  return c;
}

export const startPos = (p: SolitairePuzzle): Pos => ({
  stock: p.stock.slice(), waste: [], cells: p.cells.slice(), found: p.found.map((f) => f.slice()),
  cols: p.cols.map((c) => c.slice()), down: p.down.slice(), recycles: 0,
});

export function toPos(c: Ctx, s: SolitaireState): Pos {
  const I = c.idx;
  const nCells = I.found - I.cells, nFound = I.cols - I.found;
  return {
    stock: I.stock >= 0 ? s.piles[I.stock]!.c.slice() : [],
    waste: I.waste >= 0 ? s.piles[I.waste]!.c.slice() : [],
    cells: s.piles.slice(I.cells, I.cells + nCells).map((pl) => pl.c[0] ?? -1),
    found: s.piles.slice(I.found, I.found + nFound).map((pl) => pl.c.slice()),
    cols: s.piles.slice(I.cols).map((pl) => pl.c.slice()),
    down: s.piles.slice(I.cols).map((pl) => pl.d),
    recycles: s.recycles,
  };
}

export function fromPos(c: Ctx, p: Pos, moves: number, score: number): SolitaireState {
  const piles: Pile[] = [];
  if (c.idx.stock >= 0) piles.push({ c: p.stock.slice(), d: p.stock.length });
  if (c.idx.waste >= 0) piles.push({ c: p.waste.slice(), d: 0 });
  for (const x of p.cells) piles.push({ c: x >= 0 ? [x] : [], d: 0 });
  for (const f of p.found) piles.push({ c: f.slice(), d: 0 });
  p.cols.forEach((col, j) => piles.push({ c: col.slice(), d: p.down[j]! }));
  return { piles, recycles: p.recycles, moves, score };
}

/** Suits a restricted deck uses, in the order they fill it. */
const SUITS: Record<string, number[]> = { "4": [0, 1, 2, 3], "2": [3, 2], "1": [3] };

/** Faces of the cards of `decks` decks in `suits` suits, by id: one deck of four suits is ids = faces. */
export function deckFaces(decks: number, suits: string): number[] {
  const used = SUITS[suits] ?? SUITS["4"]!;
  return Array.from({ length: 52 * decks }, (_, i) => faceOf(used[Math.floor(i / 13) % used.length]!, (i % 13) + 1));
}

/** Where the cards go: per column face-down and face-up counts, cards to the free cells, cards left for the stock. */
export interface Shape {
  cols: CustomColumn[];
  cellsDealt: number;
  stock: number;
}

/** The deal the settings describe, for `total` cards. */
export function shapeOf(v: Values<typeof params>, total: number): Shape {
  const cellsDealt = Math.min(v.cellsDealt, v.cells, total);
  if (v.layout === "custom") {
    let left = total - cellsDealt;
    const cols = parseCustom(v.custom).map((c) => {
      const down = Math.min(c.down, left);
      left -= down;
      const up = Math.min(c.up, left);
      left -= up;
      return { down: up ? down : Math.max(0, down - 1), up: up || (down ? 1 : 0) };
    });
    return { cols, cellsDealt, stock: left };
  }
  const n = v.columns;
  const stock = Math.min(v.stock, total - cellsDealt);
  let left = total - cellsDealt - stock;
  const count = Array<number>(n).fill(0);
  const tri = Array<number>(n).fill(0);
  if (v.layout === "triangle") {
    for (let row = 0; row < n && left > 0; row++) for (let j = row; j < n && left > 0; j++) { count[j]!++; tri[j]!++; left--; }
    const extra = n > 1 ? Array.from({ length: n - 1 }, (_, j) => j + 1) : [0];
    for (let k = 0; left > 0; k++, left--) count[extra[k % extra.length]!]!++;
  } else if (v.layout === "stairs") {
    for (let row = 0; left > 0; row++) for (let j = 0; j < Math.max(1, n - (row % n)) && left > 0; j++) { count[j]!++; left--; }
  } else {
    for (let k = 0; left > 0; k++, left--) count[k % n]!++;
  }
  const cols = count.map((c, j): CustomColumn => {
    if (!c) return { down: 0, up: 0 };
    let down = 0;
    if (v.down === "all") down = v.layout === "triangle" ? tri[j]! - 1 : c - 1;
    else if (v.down === "some" && j < v.downColumns) down = Math.min(v.downCount, c - 1);
    return { down, up: c - down };
  });
  return { cols, cellsDealt, stock };
}

/**
 * The table for cards in dealing order: row after row across the columns that still take a card
 * (each column's face-down cards first), then the free cells, then the stock, first card dealt first.
 */
export function dealTable(order: readonly number[], shape: Shape, cellCount: number): Pick<SolitairePuzzle, "cols" | "down" | "cells" | "stock"> {
  const cols: number[][] = shape.cols.map(() => []);
  let k = 0;
  const longest = Math.max(0, ...shape.cols.map((c) => c.down + c.up));
  for (let row = 0; row < longest; row++) shape.cols.forEach((c, j) => { if (row < c.down + c.up) cols[j]!.push(order[k++]!); });
  const cells = Array<number>(cellCount).fill(-1);
  for (let i = 0; i < shape.cellsDealt; i++) cells[i] = order[k++]!;
  return { cols, down: shape.cols.map((c) => c.down), cells, stock: order.slice(k).reverse() };
}

/** Cards in dealing order: the inverse of dealTable. */
export function dealOrder(p: Pick<SolitairePuzzle, "cols" | "cells" | "stock">): number[] {
  const out: number[] = [];
  const longest = Math.max(0, ...p.cols.map((c) => c.length));
  for (let row = 0; row < longest; row++) for (const col of p.cols) if (row < col.length) out.push(col[row]!);
  for (const x of p.cells) if (x >= 0) out.push(x);
  out.push(...p.stock.slice().reverse());
  return out;
}

export function rulesOf(v: Values<typeof params>, hasStock: boolean): Rules {
  return {
    build: v.build as Rules["build"],
    updown: v.updown,
    runs: v.runs as Rules["runs"],
    empty: v.empty as Rules["empty"],
    home: v.home as Rules["home"],
    takeBack: v.home === "cards" && v.takeBack,
    stock: hasStock ? (v.stockTo as Rules["stock"]) : "waste",
    draw: v.draw,
    passes: v.passes,
    fillFirst: v.fillFirst,
  };
}

/** A puzzle for settings and card ids in dealing order (no solution yet); `faces` defaults to the deck the settings name. */
export function makePuzzle(given: Values<typeof params>, order: readonly number[], deal?: number, faces: number[] = deckFaces(given.decks, given.suits)): SolitairePuzzle {
  const v = effective(params, given);
  const shape = shapeOf(v, faces.length);
  const table = dealTable(order, shape, v.cells);
  const scoring = v.scoring as Scoring;
  return {
    rules: rulesOf(v, table.stock.length > 0),
    faces,
    ...table,
    found: foundationSlots(faces),
    scoring,
    timed: v.timed && scoring === "standard",
    ...(deal ? { deal } : {}),
  };
}

export const foundationSlots = (faces: readonly number[]): number[][] => Array.from({ length: faces.length / 13 }, () => []);

/** Every suit used has every rank equally often, a whole number of times: what foundations need. */
export function checkFaces(faces: readonly number[]): void {
  const used = [...new Set(faces.map(suitOf))];
  const per = faces.length / 13 / used.length;
  if (!Number.isInteger(per) || per < 1) throw new Error(`expected whole suits of 13 cards, got ${faces.length} cards`);
  const count = new Map<number, number>();
  for (const f of faces) count.set(f, (count.get(f) ?? 0) + 1);
  for (const s of used) for (let r = 1; r <= 13; r++) {
    const n = count.get(faceOf(s, r)) ?? 0;
    if (n !== per) throw new Error(`expected each card of a suit used ${per} ${per === 1 ? "time" : "times"}, got ${n} of one`);
  }
}
