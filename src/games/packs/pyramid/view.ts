import type { View } from "../../core/types";
import { CARD_H, CARD_W, cardSample } from "../../lib/cards/draw";
import { mountTable, tableLegend, tableSettings, type Slot } from "../../lib/cards/table";
import { canLift, moveAction, pileName, pyramid, tapAction, type PyramidAction, type PyramidInteraction, type PyramidPuzzle, type PyramidState } from "./logic";
import { PYR, ROW, ROWS, SPOTS, STOCK } from "./solver";

const GAP = 1.5;
const TOP = 1.5;
const STEP_X = CARD_W + GAP;
const STEP_Y = 6.5;
const BASE = TOP + (ROWS - 1) * STEP_Y + CARD_H + 3;
const W = ROWS * STEP_X + GAP;
const H = BASE + CARD_H + TOP;

/** Later piles draw over earlier ones, so each row sits over the row above it, as the cards overlap. */
const SLOTS: Slot[] = [
  { x: GAP, y: BASE, fan: "none", mark: "↻", name: pileName(STOCK) },
  { x: GAP + STEP_X, y: BASE, fan: "none", name: pileName(1) },
  ...Array.from({ length: SPOTS }, (_, i): Slot => {
    const r = ROW[i]!, c = i - (r * (r + 1)) / 2;
    return { x: GAP + (c + (ROWS - 1 - r) / 2) * STEP_X, y: TOP + r * STEP_Y, fan: "none", bare: true, name: pileName(PYR + i) };
  }),
];

export const pyramidView: View<PyramidPuzzle, PyramidState, PyramidAction, PyramidInteraction, typeof tableSettings> = {
  id: "pyramid.table",
  name: "table",
  puzzle: pyramid,
  settings: tableSettings,
  controls: [
    { how: "click or tap the stock", what: "turn over the next card, or turn the waste back over when the stock is empty" },
    { how: "click or tap a free card", what: "a king goes at once; any other card is picked, and the next card you tap goes with it if they add up to 13" },
    { how: "drag a free card onto its partner", what: "remove both if they add up to 13" },
  ],
  legend: () => [
    { sample: cardSample(26 + 5), meaning: "a free card (6♥): pairs with a 7, and a king goes alone" },
    { sample: cardSample(null), meaning: "the stock: one card per click goes to the waste" },
    ...tableLegend().slice(1),
  ],
  mount(root, ctx) {
    return mountTable(root, ctx, {
      size: () => ({ w: W, h: H }),
      slots: () => SLOTS,
      piles: (s) => s.piles,
      face: (_p, id) => id,
      canLift,
      drop: moveAction,
      tap: tapAction,
      marked: (s) => (s.pick >= 0 ? [s.pick] : []),
      stock: STOCK,
      drawLabel: "draw from the stock",
    });
  },
};
