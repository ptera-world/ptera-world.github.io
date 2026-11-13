import { defineSchema } from "../../core/schema";

const isCustom = (v: Record<string, unknown>) => v.layout === "custom";
const hasStock = (v: Record<string, unknown>) => isCustom(v) || Number(v.stock) > 0;

/** Cards a triangle of `columns` holds: 1, 2, … per column. */
export const triangle = (columns: number): number => (columns * (columns + 1)) / 2;

export const params = defineSchema({
  decks: { type: "int", label: "decks", default: 1, min: 1, max: 4, description: "52 cards each" },
  suits: {
    type: "enum", label: "suits", default: "4",
    options: [
      { value: "4", label: "four suits" },
      { value: "2", label: "two suits", description: "spades and hearts only, as many of each" },
      { value: "1", label: "one suit", description: "spades only" },
    ],
  },
  layout: {
    type: "enum", label: "deal", default: "triangle",
    options: [
      { value: "triangle", label: "triangle", description: "one card in the first column, two in the second, and so on (Klondike); cards past the triangle go face up on every column but the first (Yukon)" },
      { value: "rows", label: "rows", description: "row after row across every column (Spider, FreeCell)" },
      { value: "stairs", label: "stairs", description: "row after row, each one column shorter on the right (Simple Simon)" },
      { value: "custom", label: "cards per column", description: "the face-down and face-up cards of each column, typed out" },
    ],
  },
  columns: { type: "int", label: "columns", default: 7, min: 1, max: 16, when: (v) => !isCustom(v) },
  custom: {
    type: "string", label: "cards per column", default: "1 2 3 4 5 6 7", placeholder: "0+1 1+5 2+5",
    description: "one entry per column: face-up cards, or face-down + face-up (2+5); cards left over go to the stock",
    when: isCustom,
    check: (value) => {
      try {
        const cols = parseCustom(value);
        return `${cols.length} columns, ${cols.reduce((n, c) => n + c.down + c.up, 0)} cards`;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
  },
  cells: { type: "int", label: "free cells", default: 0, min: 0, max: 10, description: "each holds one card" },
  cellsDealt: { type: "int", label: "cards dealt to the free cells", default: 0, min: 0, max: 10, when: (v) => Number(v.cells) > 0 },
  stock: {
    type: "int", label: "cards left in the stock", min: 0, max: 208, when: (v) => !isCustom(v),
    default: (v) => (v.layout === "triangle" ? Math.max(0, Number(v.decks) * 52 - Number(v.cellsDealt) - triangle(Number(v.columns))) : 0),
  },
  down: {
    type: "enum", label: "face down", default: "all", when: (v) => !isCustom(v),
    options: [
      { value: "all", label: "all but the top card", description: "of each column (of the triangle, with a triangle deal)" },
      { value: "none", label: "none" },
      { value: "some", label: "some, in the first columns" },
    ],
  },
  downCount: { type: "int", label: "face-down cards per column", default: 3, min: 1, max: 12, when: (v) => !isCustom(v) && v.down === "some" },
  downColumns: { type: "int", label: "columns with face-down cards", default: 4, min: 1, max: 16, when: (v) => !isCustom(v) && v.down === "some" },
  stockTo: {
    type: "enum", label: "the stock", default: "waste", when: hasStock,
    options: [
      { value: "waste", label: "turns onto a waste pile", description: "the top card of the waste plays" },
      { value: "row", label: "deals a card onto every column" },
    ],
  },
  draw: { type: "int", label: "cards turned at a time", default: 1, min: 1, max: 5, when: (v) => hasStock(v) && v.stockTo === "waste" },
  passes: { type: "int", label: "passes through the stock (0 = no limit)", default: 0, min: 0, max: 10, when: (v) => hasStock(v) && v.stockTo === "waste" },
  fillFirst: { type: "bool", label: "no deal while a column is empty", default: true, when: (v) => hasStock(v) && v.stockTo === "row" },
  build: {
    type: "enum", label: "build columns down", default: "alternate",
    options: [
      { value: "alternate", label: "in alternate colors", description: "red on black, black on red" },
      { value: "suit", label: "in suit" },
      { value: "any", label: "regardless of suit" },
      { value: "color", label: "in the same color" },
      { value: "other", label: "in any other suit" },
    ],
  },
  updown: { type: "bool", label: "build up as well as down", default: false },
  runs: {
    type: "enum", label: "cards that move together", default: "built",
    options: [
      { value: "built", label: "any built run" },
      { value: "suit", label: "runs in one suit" },
      { value: "any", label: "any face-up cards", description: "built on or not" },
      { value: "space", label: "runs as free space allows", description: "as many as could move one at a time through the empty free cells and columns" },
      { value: "one", label: "one card at a time" },
    ],
  },
  empty: {
    type: "enum", label: "an empty column takes", default: "kings",
    options: [
      { value: "kings", label: "a king" },
      { value: "any", label: "any card" },
      { value: "none", label: "nothing" },
    ],
  },
  home: {
    type: "enum", label: "foundations", default: "cards",
    options: [
      { value: "cards", label: "built up by suit, card by card" },
      { value: "runs", label: "take whole king-to-ace runs in one suit", description: "a finished run leaves the columns by itself (Spider)" },
    ],
  },
  takeBack: { type: "bool", label: "cards come back down from the foundations", default: true, when: (v) => v.home === "cards" },
  scoring: {
    type: "enum", label: "scoring",
    default: (v) => (v.home === "runs" ? "spider" : "standard"),
    options: (v) => (v.home === "runs"
      ? [
        { value: "spider", label: "spider", description: "500 to start, a point off per move, 100 per finished run" },
        { value: "none", label: "none" },
      ]
      : [
        { value: "standard", label: "standard", description: "points for what you play; passes through the stock can cost" },
        { value: "vegas", label: "vegas", description: "$52 a deck to deal, $5 back for each card home" },
        { value: "vegas-keep", label: "vegas, running total", description: "vegas, with winnings carried from deal to deal in this browser" },
        { value: "none", label: "none" },
      ]),
  },
  timed: { type: "bool", label: "timed", default: false, description: "standard scoring only: points go off as time passes, and a quick win earns a bonus", when: (v) => v.scoring === "standard" },
  winnable: { type: "bool", label: "always winnable", default: true, description: "deal again until the solver finds a win; where it rarely can (many suits, many decks), the deal says it isn't known winnable" },
  deal: {
    type: "int", label: "deal number (0 = random)", default: 0, min: 0, max: 2147483647,
    description: "the numbered deals of Microsoft FreeCell: a number gives the same cards as there",
    when: (v) => Number(v.decks) === 1 && v.suits === "4" && v.layout === "rows" && Number(v.columns) === 8 && Number(v.stock) === 0 && (Number(v.cells) === 0 || Number(v.cellsDealt) === 0),
  },
});

export interface CustomColumn { down: number; up: number }

/** "0+1 1+5 8": face-down + face-up cards per column, or face-up cards alone. */
export function parseCustom(text: string): CustomColumn[] {
  const items = text.trim().split(/[\s,]+/).filter(Boolean);
  if (!items.length) throw new Error("give at least one column");
  if (items.length > 16) throw new Error("at most 16 columns");
  return items.map((it) => {
    const m = /^(?:(\d+)\+)?(\d+)$/.exec(it);
    if (!m) throw new Error(`"${it}" is not a column (like 5, or 2+5 for two face down and five face up)`);
    const down = Number(m[1] ?? 0), up = Number(m[2]);
    if (down && !up) throw new Error(`"${it}": a column with face-down cards needs a face-up one on top`);
    return { down, up };
  });
}
