import { s } from "../../core/dom";
import { rankLabel, rankOf, SUIT_GLYPHS, suitOf, type Face } from "./deck";

/** Card size in board units. Every card game lays its table out in these. */
export const CARD_W = 10;
export const CARD_H = 14;
export const CARD_R = 0.8;

/**
 * Card colours are theme tokens with defaults: --card-face, --card-edge, --card-ink (black suits),
 * --card-red, --card-back, and for the four-colour deck --card-clubs and --card-diamonds.
 */
export const CARD_CSS = `
.cards-table .card-face rect.body { fill: var(--card-face, #fbfaf6); stroke: var(--card-edge, rgb(0 0 0 / 0.35)); stroke-width: 0.15; }
.cards-table .card-back rect.body { fill: var(--card-back, var(--accent)); stroke: var(--card-edge, rgb(0 0 0 / 0.35)); stroke-width: 0.15; }
.cards-table .card-back rect.inner { fill: none; stroke: rgb(255 255 255 / 0.55); stroke-width: 0.3; }
.cards-table .card-back path { fill: none; stroke: rgb(255 255 255 / 0.35); stroke-width: 0.25; }
.cards-table .card text { font-family: var(--font); font-weight: 700; pointer-events: none; }
.cards-table .card .s0, .cards-table .card .s3 { fill: var(--card-ink, #1d1d1f); }
.cards-table .card .s1, .cards-table .card .s2 { fill: var(--card-red, #c62828); }
.cards-table.four-color .card .s0 { fill: var(--card-clubs, #1b7a36); }
.cards-table.four-color .card .s1 { fill: var(--card-diamonds, #1e5bbf); }
`;

function faceGroup(f: Face): SVGGElement {
  const suit = suitOf(f), rank = rankOf(f);
  const glyph = SUIT_GLYPHS[suit]!;
  const label = rankLabel(rank);
  const cls = `s${suit}`;
  const g = s("g", { class: "card-face" },
    s("rect", { class: "body", x: 0, y: 0, width: CARD_W, height: CARD_H, rx: CARD_R }),
    s("text", { class: cls, x: 0.6, y: 2.75, "font-size": 2.9, "letter-spacing": "-0.15" }, `${label}${glyph}`));
  if (rank > 10) {
    g.append(s("text", { class: cls, x: CARD_W / 2, y: CARD_H / 2 + 0.6, "font-size": 5.6, "text-anchor": "middle", "dominant-baseline": "central" }, label),
      s("text", { class: cls, x: CARD_W / 2, y: CARD_H / 2 + 4.4, "font-size": 3.2, "text-anchor": "middle", "dominant-baseline": "central" }, glyph));
  } else {
    g.append(s("text", { class: cls, x: CARD_W / 2, y: CARD_H / 2 + 0.9, "font-size": rank === 1 ? 7.5 : 6, "text-anchor": "middle", "dominant-baseline": "central" }, glyph));
  }
  return g;
}

function backGroup(): SVGGElement {
  return s("g", { class: "card-back" },
    s("rect", { class: "body", x: 0, y: 0, width: CARD_W, height: CARD_H, rx: CARD_R }),
    s("rect", { class: "inner", x: 0.9, y: 0.9, width: CARD_W - 1.8, height: CARD_H - 1.8, rx: 0.5 }),
    s("path", { d: `M${CARD_W / 2} 2.2L${CARD_W - 2} ${CARD_H / 2}L${CARD_W / 2} ${CARD_H - 2.2}L2 ${CARD_H / 2}Z` }));
}

/** A card with both sides drawn; setUp picks the one shown. */
export function cardElement(f: Face, id: number): SVGGElement {
  const g = s("g", { class: "card", "data-card": id });
  g.append(faceGroup(f), backGroup());
  return g;
}

export function setUp(el: SVGGElement, up: boolean): void {
  (el.firstChild as SVGGElement).style.display = up ? "" : "none";
  (el.lastChild as SVGGElement).style.display = up ? "none" : "";
}

/** Inline SVG markup of one card (face up, or its back), for legends. */
export function cardSample(f: Face | null): string {
  const el = f === null ? backGroup() : faceGroup(f);
  return `<svg viewBox="-0.3 -0.3 ${CARD_W + 0.6} ${CARD_H + 0.6}" class="cards-table" style="height: 2.2em">${el.outerHTML}</svg>`;
}
