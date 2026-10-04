import { h, style } from "../../core/dom";
import type { WidgetDef } from "../../core/types";
import { fifteen, type FifteenAction, type FifteenPuzzle, type FifteenState } from "./logic";

export const movesWidget: WidgetDef<FifteenPuzzle, FifteenState, FifteenAction, null> = {
  id: "fifteen.moves",
  name: "moves",
  description: "how many moves so far",
  puzzles: [fifteen],
  defaultSlot: "top",
  order: 10,
  mount(el, { session, owner }) {
    style("fifteen-widgets", ".fifteen-moves { font-family: var(--mono); color: var(--text-dim); min-height: 1.4em; }");
    const box = h("div", { class: "fifteen-moves", "aria-live": "polite" });
    el.append(box);
    const render = () => { box.textContent = `${session.state.moves} tile moves`; };
    session.hooks.change.tap(render, { owner });
    render();
  },
};
