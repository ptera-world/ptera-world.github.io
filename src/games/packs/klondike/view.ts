import type { View } from "../../core/types";
import { CARD_H, CARD_W, cardSample } from "../../lib/cards/draw";
import { SUIT_GLYPHS } from "../../lib/cards/deck";
import { mountTable, tableLegend, tableSettings, type Slot } from "../../lib/cards/table";
import { canLift, moveAction, pileName, tapAction, type KlondikeAction, type KlondikeInteraction, type KlondikePuzzle, type KlondikeState } from "./logic";
import { STOCK } from "./solver";

const GAP = 1.5;
const TOP = 1.5;
const ROW = TOP + CARD_H + 3;
const FAN_ROOM = 50;
const W = 7 * CARD_W + 8 * GAP;
const H = ROW + FAN_ROOM + CARD_H + TOP;
const x = (i: number) => GAP + i * (CARD_W + GAP);

function slots(p: KlondikePuzzle): Slot[] {
  return [
    { x: x(0), y: TOP, fan: "none", mark: "↻", name: pileName(0) },
    { x: x(1), y: TOP, fan: "waste", count: p.draw, name: pileName(1) },
    ...[0, 1, 2, 3].map((s): Slot => ({ x: x(3 + s), y: TOP, fan: "none", mark: SUIT_GLYPHS[s], name: pileName(2 + s) })),
    ...Array.from({ length: 7 }, (_, j): Slot => ({ x: x(j), y: ROW, fan: "down", bottom: ROW + FAN_ROOM, mark: "K", name: pileName(6 + j) })),
  ];
}

export const klondikeView: View<KlondikePuzzle, KlondikeState, KlondikeAction, KlondikeInteraction> = {
  id: "klondike.table",
  name: "table",
  puzzle: "klondike",
  settings: tableSettings,
  controls: [
    { how: "click or tap the stock", what: "turn over the next cards, or turn the waste back over when the stock is empty" },
    { how: "drag a card, or a face-up run, onto another pile", what: "move it there if the rules allow" },
    { how: "click or tap a card", what: "send it home if it can go, else onto a column, else a king into an empty column" },
  ],
  legend: () => [
    { sample: cardSample(26 + 6), meaning: "a card (7♥): red on black, black on red, one rank lower" },
    ...tableLegend(),
  ],
  mount(root, ctx) {
    const p = ctx.session.puzzle;
    const sl = slots(p);
    return mountTable(root, ctx, {
      size: () => ({ w: W, h: H }),
      slots: () => sl,
      piles: (s) => s.piles,
      face: (_p, id) => id,
      canLift,
      drop: moveAction,
      tap: tapAction,
      stock: STOCK,
      drawLabel: "draw from the stock",
    });
  },
};
