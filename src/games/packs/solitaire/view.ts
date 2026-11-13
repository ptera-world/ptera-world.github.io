import type { View } from "../../core/types";
import { CARD_H, CARD_W, cardSample } from "../../lib/cards/draw";
import { SUIT_GLYPHS } from "../../lib/cards/deck";
import { mountTable, tableLegend, tableSettings, type Slot } from "../../lib/cards/table";
import { ctxOf, type SolitaireAction, type SolitairePuzzle, type SolitaireState } from "./deal";
import { canLift, moveAction, pileName, solitaire, tapAction, type SolitaireInteraction } from "./logic";

const GAP = 1.5;
const TOP = 1.5;
const ROW = TOP + CARD_H + 3;
const x = (i: number) => GAP + i * (CARD_W + GAP);

/**
 * The stock, waste and free cells from the left of the top row, the foundations ending at its
 * right (drawn closer together when they don't fit), the columns below, centred when the top
 * row is wider.
 */
function geometry(p: SolitairePuzzle) {
  const c = ctxOf(p), I = c.idx;
  const left = (I.stock >= 0 ? 1 : 0) + (I.waste >= 0 ? 1 : 0) + p.cells.length;
  const nFound = p.found.length, nCols = p.cols.length;
  // the top row gets room for every foundation, or for four after a gap when there are more
  const n = Math.max(nCols, Math.min(left + nFound, left + 4 + (left ? 1 : 0)), 4);
  const w = n * CARD_W + (n + 1) * GAP;
  const fanRoom = p.faces.length > 52 ? 60 : 52;
  const h = ROW + fanRoom + CARD_H + TOP;
  const slots: Slot[] = [];
  let k = 0;
  if (I.stock >= 0) slots.push(p.rules.stock === "row" ? { x: x(k++), y: TOP, fan: "deals", count: nCols, name: pileName(p, I.stock) } : { x: x(k++), y: TOP, fan: "none", mark: "↻", name: pileName(p, I.stock) });
  if (I.waste >= 0) slots.push({ x: x(k++), y: TOP, fan: "waste", count: p.rules.draw, name: pileName(p, I.waste) });
  for (let i = 0; i < p.cells.length; i++) slots.push({ x: x(k++), y: TOP, fan: "none", name: pileName(p, I.cells + i) });
  const first = Math.max(k + (k && k + nFound < n ? 1 : 0), n - nFound);
  const room = x(n - 1) - x(first);
  const step = nFound > 1 ? Math.min(CARD_W + GAP, room / (nFound - 1)) : 0;
  for (let f = 0; f < nFound; f++) {
    const mark = p.rules.home === "cards" ? SUIT_GLYPHS[c.fsuit[f]!] : undefined;
    slots.push({ x: x(first) + f * step, y: TOP, fan: "none", ...(mark ? { mark } : {}), name: pileName(p, I.found + f) });
  }
  const off = (n - nCols) / 2;
  const mark = p.rules.empty === "kings" ? "K" : undefined;
  for (let j = 0; j < nCols; j++) slots.push({ x: x(off + j), y: ROW, fan: "down", bottom: ROW + fanRoom, ...(mark ? { mark } : {}), name: pileName(p, I.cols + j) });
  return { w, h, slots };
}

const BUILD_LEGEND: Record<SolitairePuzzle["rules"]["build"], string> = {
  alternate: "red on black, black on red, one rank lower",
  suit: "on the same suit, one rank lower",
  any: "on any card one rank higher",
  color: "on the same color, one rank lower",
  other: "on any other suit, one rank lower",
};

export const solitaireView: View<SolitairePuzzle, SolitaireState, SolitaireAction, SolitaireInteraction, typeof tableSettings> = {
  id: "solitaire.table",
  name: "table",
  puzzle: solitaire,
  settings: tableSettings,
  controls: (p) => [
    ...(ctxOf(p).idx.stock < 0 ? [] : [p.rules.stock === "row"
      ? { how: "click or tap the stock", what: "deal one card onto every column" }
      : { how: "click or tap the stock", what: "turn over the next cards, or turn the waste back over when the stock is empty" }]),
    { how: "drag a card, or the cards on it that move together, onto another pile", what: "move them there if the rules allow" },
    { how: "click or tap a card", what: `send it home if it can go, else onto a column (its own suit first), else into an empty column${p.cells.length ? ", else into a free cell" : ""}` },
  ],
  legend: (p) => [
    { sample: cardSample(26 + 6), meaning: `a card (7♥): goes ${BUILD_LEGEND[p.rules.build]}${p.rules.updown ? ", or one rank higher" : ""}` },
    ...(p.down.some(Boolean) || ctxOf(p).idx.stock >= 0 ? tableLegend() : tableLegend().slice(1)),
  ],
  mount(root, ctx) {
    const p = ctx.session.puzzle;
    const g = geometry(p);
    const I = ctxOf(p).idx;
    return mountTable(root, ctx, {
      size: () => ({ w: g.w, h: g.h }),
      slots: () => g.slots,
      piles: (s) => s.piles,
      face: (_p, id) => p.faces[id]!,
      canLift,
      drop: moveAction,
      tap: tapAction,
      ...(I.stock >= 0 ? { stock: I.stock, drawLabel: p.rules.stock === "row" ? "deal a row" : "draw from the stock" } : {}),
    });
  },
};
