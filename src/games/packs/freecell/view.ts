import type { View } from "../../core/types";
import { CARD_H, CARD_W, cardSample } from "../../lib/cards/draw";
import { mountTable, tableLegend, tableSettings, type Slot } from "../../lib/cards/table";
import { SUIT_GLYPHS } from "../../lib/cards/deck";
import { freecell, canLift, moveAction, pileName, tapAction, type FreecellAction, type FreecellInteraction, type FreecellPuzzle, type FreecellState } from "./logic";

const GAP = 1.5;
const TOP = 1.5;
const ROW = TOP + CARD_H + 3;
const FAN_ROOM = 54;

function geometry(p: FreecellPuzzle) {
  const n = Math.max(p.cols.length, p.cells.length + 4);
  const w = n * CARD_W + (n + 1) * GAP;
  const h = ROW + FAN_ROOM + CARD_H + TOP;
  const x = (i: number) => GAP + i * (CARD_W + GAP);
  const slots: Slot[] = [];
  p.cells.forEach((_, i) => slots.push({ x: x(i), y: TOP, fan: "none", name: pileName(p, i) }));
  for (let s = 0; s < 4; s++) slots.push({ x: x(n - 4 + s), y: TOP, fan: "none", mark: SUIT_GLYPHS[s], name: pileName(p, p.cells.length + s) });
  const off = (n - p.cols.length) / 2;
  p.cols.forEach((_, j) => slots.push({ x: x(off + j), y: ROW, fan: "down", bottom: ROW + FAN_ROOM, name: pileName(p, p.cells.length + 4 + j) }));
  return { w, h, slots };
}

export const freecellView: View<FreecellPuzzle, FreecellState, FreecellAction, FreecellInteraction, typeof tableSettings> = {
  id: "freecell.table",
  name: "table",
  puzzle: freecell,
  settings: tableSettings,
  controls: [
    { how: "drag a card, or an ordered run of cards, onto another pile", what: "move it there if the rules allow" },
    { how: "click or tap a card", what: "send it home if it can go, else onto a column, else into an empty column, else into a free cell" },
  ],
  legend: () => [
    { sample: cardSample(26 + 6), meaning: "a card (7♥): red on black, black on red, one rank lower" },
    ...tableLegend().slice(1),
  ],
  mount(root, ctx) {
    const p = ctx.session.puzzle;
    const g = geometry(p);
    return mountTable(root, ctx, {
      size: () => ({ w: g.w, h: g.h }),
      slots: () => g.slots,
      piles: (s) => s.piles,
      face: (_p, id) => id,
      canLift,
      drop: moveAction,
      tap: tapAction,
    });
  },
};
