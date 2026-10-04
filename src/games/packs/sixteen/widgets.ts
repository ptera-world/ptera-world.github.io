import { h, style } from "../../core/dom";
import type { WidgetDef } from "../../core/types";
import { type SixteenAction, type SixteenInteraction, type SixteenPuzzle, type SixteenState } from "./logic";

export const movesWidget: WidgetDef<SixteenPuzzle, SixteenState, SixteenAction, SixteenInteraction> = {
  id: "sixteen.moves",
  name: "moves",
  description: "how many moves so far",
  puzzles: ["sixteen"],
  defaultSlot: "top",
  order: 10,
  mount(el, { session, owner }) {
    style("sixteen-widgets", ".sixteen-moves { font-family: var(--mono); color: var(--text-dim); min-height: 1.4em; }");
    const box = h("div", { class: "sixteen-moves", "aria-live": "polite" });
    el.append(box);
    const render = () => { box.textContent = `${session.state.moves} slides`; };
    session.hooks.change.tap(render, { owner });
    render();
  },
};
