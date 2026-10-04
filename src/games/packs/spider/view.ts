import type { View } from "../../core/types";
import { CARD_H, CARD_W, cardSample } from "../../lib/cards/draw";
import { mountTable, tableLegend, tableSettings, type Slot } from "../../lib/cards/table";
import { canLift, moveAction, pileName, tapAction, type SpiderAction, type SpiderInteraction, type SpiderPuzzle, type SpiderState } from "./logic";
import { STOCK } from "./solver";

const GAP = 1.5;
const TOP = 1.5;
const ROW = TOP + CARD_H + 3;
const FAN_ROOM = 60;
const W = 10 * CARD_W + 11 * GAP;
const H = ROW + FAN_ROOM + CARD_H + TOP;
const x = (i: number) => GAP + i * (CARD_W + GAP);

const SLOTS: Slot[] = [
  { x: x(0), y: TOP, fan: "deals", count: 10, name: pileName(STOCK) },
  ...Array.from({ length: 8 }, (_, i): Slot => ({ x: x(2 + i), y: TOP, fan: "none", name: pileName(1 + i) })),
  ...Array.from({ length: 10 }, (_, j): Slot => ({ x: x(j), y: ROW, fan: "down", bottom: ROW + FAN_ROOM, name: pileName(9 + j) })),
];

export const spiderView: View<SpiderPuzzle, SpiderState, SpiderAction, SpiderInteraction> = {
  id: "spider.table",
  name: "table",
  puzzle: "spider",
  settings: tableSettings,
  controls: [
    { how: "click or tap the stock", what: "deal one card onto every column" },
    { how: "drag a card, or a run of one suit, onto another column", what: "move it there if the rules allow" },
    { how: "click or tap a card", what: "move it (and the run on it) onto the same suit if it can, else onto any card one higher, else into an empty column" },
  ],
  legend: () => [
    { sample: cardSample(39 + 6), meaning: "a card (7♠): goes on any 8, but only runs of one suit move together" },
    { sample: cardSample(null), meaning: "a face-down card; the stock shows one per deal left" },
    ...tableLegend().slice(1),
  ],
  mount(root, ctx) {
    const p = ctx.session.puzzle;
    return mountTable(root, ctx, {
      size: () => ({ w: W, h: H }),
      slots: () => SLOTS,
      piles: (s) => s.piles,
      face: (_p, id) => p.deck[id]!,
      canLift,
      drop: moveAction,
      tap: tapAction,
      stock: STOCK,
      drawLabel: "deal a row",
    });
  },
};
