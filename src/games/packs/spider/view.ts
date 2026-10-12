import type { View } from "../../core/types";
import { CARD_H, CARD_W, cardSample } from "../../lib/cards/draw";
import { mountTable, tableLegend, tableSettings, type Slot } from "../../lib/cards/table";
import { baseOf, columnsOf, setsOf, spider, canLift, moveAction, pileName, tapAction, type SpiderAction, type SpiderInteraction, type SpiderPuzzle, type SpiderState } from "./logic";
import { STOCK } from "./solver";

const GAP = 1.5;
const TOP = 1.5;
const ROW = TOP + CARD_H + 3;
const FAN_ROOM = 60;
const x = (i: number) => GAP + i * (CARD_W + GAP);
const width = (p: SpiderPuzzle) => columnsOf(p) * CARD_W + (columnsOf(p) + 1) * GAP;
const height = ROW + FAN_ROOM + CARD_H + TOP;

/** Finished runs sit in a row to the right of the stock, drawn closer together when there are more than fit. */
function slotsOf(p: SpiderPuzzle): Slot[] {
  const sets = setsOf(p), base = baseOf(p);
  const step = sets > 1 ? Math.min(CARD_W + GAP, (width(p) - GAP - x(2) - CARD_W) / (sets - 1)) : 0;
  return [
    { x: x(0), y: TOP, fan: "deals", count: columnsOf(p), name: pileName(p, 0) },
    ...Array.from({ length: sets }, (_, i): Slot => ({ x: x(2) + i * step, y: TOP, fan: "none", name: pileName(p, 1 + i) })),
    ...Array.from({ length: columnsOf(p) }, (_, j): Slot => ({ x: x(j), y: ROW, fan: "down", bottom: ROW + FAN_ROOM, name: pileName(p, base + j) })),
  ];
}

export const spiderView: View<SpiderPuzzle, SpiderState, SpiderAction, SpiderInteraction, typeof tableSettings> = {
  id: "spider.table",
  name: "table",
  puzzle: spider,
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
    const sl = slotsOf(p);
    return mountTable(root, ctx, {
      size: () => ({ w: width(p), h: height }),
      slots: () => sl,
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
