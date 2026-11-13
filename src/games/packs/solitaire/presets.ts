import type { Preset } from "../../core/types";
import type { params } from "./params";

type P = Preset<typeof params>["params"];

/** Every setting a preset depends on, so changing a default never changes a published game. */
const base: P = {
  decks: 1, suits: "4", layout: "triangle", columns: 7, cells: 0, cellsDealt: 0, down: "all",
  stockTo: "waste", draw: 1, passes: 0, fillFirst: true,
  build: "alternate", updown: false, runs: "built", empty: "kings", home: "cards", takeBack: true,
  scoring: "standard", timed: false, deal: 0,
};

const klondike = (o: P = {}): P => ({ ...base, stock: 24, ...o });
const yukon = (o: P = {}): P => ({ ...base, stock: 0, runs: "any", takeBack: false, scoring: "none", ...o });
const spider = (o: P = {}): P => ({
  ...base, decks: 2, layout: "rows", columns: 10, stock: 50, stockTo: "row", build: "any", runs: "suit", empty: "any", home: "runs", scoring: "spider", ...o,
});
const scorpion = (o: P = {}): P => spider({
  decks: 1, columns: 7, stock: 3, down: "some", downCount: 3, downColumns: 4, fillFirst: false, build: "suit", runs: "any", empty: "kings", scoring: "none", ...o,
});
const freecell = (o: P = {}): P => ({ ...base, layout: "rows", columns: 8, cells: 4, stock: 0, down: "none", runs: "space", empty: "any", takeBack: false, scoring: "none", ...o });
const bakers = (o: P = {}): P => freecell({ build: "suit", ...o });

/**
 * Published games, named as their publishers name them (PySolFC, Microsoft Solitaire and
 * Solitaire Collection). A name with a description after a comma is a published game with
 * settings of its own that keep a setup the earlier separate games offered.
 */
export const presets: readonly Preset<typeof params>[] = [
  { label: "Klondike", params: klondike() },
  { label: "Klondike (draw 3)", params: klondike({ draw: 3 }) },
  { label: "Klondike (draw 3), three passes", params: klondike({ draw: 3, passes: 3 }) },
  { label: "Klondike, timed", params: klondike({ timed: true }) },
  { label: "Vegas Klondike", params: klondike({ passes: 1, scoring: "vegas" }) },
  { label: "Vegas Klondike (draw 3)", params: klondike({ draw: 3, passes: 3, scoring: "vegas" }) },
  { label: "Vegas Klondike (draw 3), cumulative", params: klondike({ draw: 3, passes: 3, scoring: "vegas-keep" }) },
  { label: "Casino Klondike", params: klondike({ passes: 3, scoring: "vegas" }) },
  { label: "Saratoga (Thoughtful)", params: klondike({ down: "none", draw: 3 }) },
  { label: "Whitehead", params: klondike({ down: "none", passes: 1, build: "color", runs: "suit", empty: "any" }) },
  { label: "Thumb and Pouch", params: klondike({ passes: 1, build: "other", empty: "any" }) },
  { label: "Double Klondike", params: klondike({ decks: 2, columns: 9, stock: 59 }) },
  { label: "Gargantua", params: klondike({ decks: 2, columns: 9, stock: 59, passes: 2 }) },
  { label: "Eastcliff", params: klondike({ layout: "rows", stock: 31, passes: 1, empty: "any" }) },
  { label: "Westcliff", params: klondike({ layout: "rows", columns: 10, stock: 22, passes: 1, empty: "any", takeBack: false }) },
  { label: "Easthaven", params: klondike({ layout: "rows", stock: 31, stockTo: "row", fillFirst: false, empty: "any" }) },

  { label: "Yukon", params: yukon() },
  { label: "Russian Solitaire", params: yukon({ build: "suit" }) },
  { label: "Alaska", params: yukon({ build: "suit", updown: true }) },
  { label: "Double Yukon", params: yukon({ decks: 2, layout: "custom", custom: "0+6 1+6 2+6 3+6 4+6 5+6 6+6 7+6 8+6 8+6" }) },
  { label: "Double Russian Solitaire", params: yukon({ decks: 2, layout: "custom", custom: "0+6 1+6 2+6 3+6 4+6 5+6 6+6 7+6 8+6 8+6", build: "suit" }) },
  { label: "Triple Yukon", params: yukon({ decks: 3, layout: "custom", custom: Array.from({ length: 13 }, (_, j) => `${j}+6`).join(" ") }) },
  { label: "Quadruple Yukon", params: yukon({ decks: 4, layout: "custom", custom: Array.from({ length: 16 }, (_, j) => (j === 0 ? "1" : `${j}+${j <= 12 ? 6 : 5}`)).join(" ") }) },

  { label: "Spider", params: spider() },
  { label: "Spider (2 suits)", params: spider({ suits: "2" }) },
  { label: "Spider (1 suit)", params: spider({ suits: "1" }) },
  { label: "Relaxed Spider", params: spider({ fillFirst: false }) },
  { label: "Open Spider", params: spider({ down: "none" }) },
  { label: "Black Widow", params: spider({ runs: "built" }) },
  { label: "Mrs. Mop", params: spider({ columns: 13, stock: 0, down: "none" }) },
  { label: "Spiderette", params: spider({ decks: 1, layout: "triangle", columns: 7, stock: 24 }) },
  { label: "Will o' the Wisp", params: spider({ decks: 1, columns: 7, stock: 31 }) },
  { label: "Simple Simon", params: spider({ decks: 1, layout: "stairs", stock: 0, down: "none", scoring: "none" }) },
  { label: "Big Spider", params: spider({ decks: 3, columns: 13, stock: 78 }) },
  { label: "Big Spider (2 suits)", params: spider({ decks: 3, columns: 13, stock: 78, suits: "2" }) },
  { label: "Big Spider (1 suit)", params: spider({ decks: 3, columns: 13, stock: 78, suits: "1" }) },
  { label: "Spider (4 decks)", params: spider({ decks: 4, columns: 13, stock: 130 }) },
  { label: "Spider, one deck", params: spider({ decks: 1, columns: 7, stock: 28 }) },
  { label: "Spider, one deck, two suits", params: spider({ decks: 1, columns: 7, stock: 28, suits: "2" }) },
  { label: "Spider, one deck, one suit", params: spider({ decks: 1, columns: 7, stock: 28, suits: "1" }) },
  { label: "Spider, four decks, two suits", params: spider({ decks: 4, columns: 16, stock: 112, suits: "2" }) },
  { label: "Scorpion", params: scorpion() },
  { label: "Scorpion II", params: scorpion({ downColumns: 3 }) },
  { label: "Wasp", params: scorpion({ empty: "any" }) },
  { label: "Double Scorpion", params: scorpion({ decks: 2, columns: 10, stock: 0, downCount: 4, downColumns: 5 }) },
  { label: "Triple Scorpion", params: scorpion({ decks: 3, columns: 13, stock: 0, downCount: 5, downColumns: 5 }) },

  { label: "FreeCell", params: freecell() },
  { label: "FreeCell, three free cells", params: freecell({ cells: 3 }) },
  { label: "FreeCell (2 Reserves)", params: freecell({ cells: 2 }) },
  { label: "FreeCell (No Reserve)", params: freecell({ cells: 0 }) },
  { label: "Relaxed FreeCell", params: freecell({ runs: "built" }) },
  { label: "ForeCell", params: freecell({ cellsDealt: 4, empty: "kings" }) },
  { label: "Seven by Four", params: freecell({ columns: 7 }) },
  { label: "Seven by Five", params: freecell({ columns: 7, cells: 5 }) },
  { label: "Bath", params: freecell({ layout: "custom", custom: "1 2 3 4 5 6 7 8 8 8", cells: 2, empty: "kings" }) },
  { label: "Double FreeCell (Traditional)", params: freecell({ decks: 2, columns: 10, cells: 8 }) },
  { label: "Triple FreeCell", params: freecell({ decks: 3, columns: 13, cells: 10 }) },
  { label: "Baker's Game", params: bakers() },
  { label: "King Only Baker's Game", params: bakers({ empty: "kings" }) },
  { label: "Eight Off", params: bakers({ cells: 8, cellsDealt: 4, empty: "kings" }) },
  { label: "Seahaven Towers", params: bakers({ columns: 10, cellsDealt: 2, empty: "kings" }) },
  { label: "Relaxed Seahaven Towers", params: bakers({ columns: 10, cellsDealt: 2, empty: "kings", runs: "built" }) },

  { label: "Forty Thieves", params: { ...base, decks: 2, layout: "rows", columns: 10, stock: 64, down: "none", passes: 1, build: "suit", runs: "one", empty: "any", scoring: "none" } },
];
