import type { View } from "../../core/types";
import { CARD_H, CARD_W, cardSample } from "../../lib/cards/draw";
import { scoreWidget } from "../../lib/cards/score";
import { mountTable, tableLegend, tableSettings, type Slot } from "../../lib/cards/table";
import { canLift, dropAction, pileName, tapAction, tripeaks, STOCK, type TriPeaksAction, type TriPeaksInteraction, type TriPeaksPuzzle, type TriPeaksState } from "./logic";
import { colOf, rowOf, SPOTS } from "./solver";

const GAP = 1.5;
const TOP = 1.5;
const STEP = CARD_W + 1.5;
const ROW_STEP = 7;
const W = 9 * STEP + CARD_W + 2 * GAP;
const BASE = TOP + 3 * ROW_STEP + CARD_H + 3;
const H = BASE + CARD_H + TOP;

/** Horizontal centre of a spot in card steps: the bottom row sits on whole steps, each row up between its two covers. */
function centre(spot: number): number {
  const r = rowOf(spot), c = colOf(spot);
  if (r === 3) return c;
  if (r === 2) return c + 0.5;
  if (r === 1) return c + (c >> 1) + 1;
  return 3 * c + 1.5;
}

const SLOTS: Slot[] = [
  { x: W / 2 - CARD_W - GAP, y: BASE, fan: "none", mark: "↻", name: pileName(0) },
  { x: W / 2 + GAP, y: BASE, fan: "none", name: pileName(1) },
  ...Array.from({ length: SPOTS }, (_, i): Slot => ({ x: GAP + centre(i) * STEP, y: TOP + rowOf(i) * ROW_STEP, fan: "none", bare: true, name: pileName(2 + i) })),
];

export const tripeaksView: View<TriPeaksPuzzle, TriPeaksState, TriPeaksAction, TriPeaksInteraction, typeof tableSettings> = {
  id: "tripeaks.table",
  name: "table",
  puzzle: tripeaks,
  settings: tableSettings,
  controls: [
    { how: "click or tap the stock", what: "turn the next card onto the waste, or turn the waste back over when the stock is empty" },
    { how: "click or tap a free face-up card", what: "play it onto the waste if it is one rank above or below the waste card" },
    { how: "drag a free card onto the waste", what: "play it there if it fits" },
  ],
  legend: () => [
    { sample: cardSample(26 + 6), meaning: "a free card (7♥): plays on a 6 or an 8 of any suit" },
    ...tableLegend(),
  ],
  mount(root, ctx) {
    return mountTable(root, ctx, {
      size: () => ({ w: W, h: H }),
      slots: () => SLOTS,
      piles: (s) => s.piles,
      face: (_p, id) => id,
      canLift,
      drop: dropAction,
      tap: tapAction,
      stock: STOCK,
      drawLabel: "draw from the stock",
    });
  },
};

export const tripeaksScore = scoreWidget<TriPeaksPuzzle, TriPeaksState>({
  id: "tripeaks.score",
  name: "score",
  description: "score, the run you're on and the peaks cleared",
  puzzles: [tripeaks],
  read: (_p, s) => `score ${s.score} · run ${s.streak} · peaks ${s.peaks}/3`,
});
