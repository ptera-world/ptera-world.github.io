import { h, style } from "../../core/dom";
import type { WidgetDef } from "../../core/types";
import { twiddle, type TwiddleAction, type TwiddleInteraction, type TwiddlePuzzle, type TwiddleState } from "./logic";

export const movesWidget: WidgetDef<TwiddlePuzzle, TwiddleState, TwiddleAction, TwiddleInteraction> = {
  id: "twiddle.moves",
  name: "moves",
  description: "how many moves so far",
  puzzles: [twiddle],
  defaultSlot: "top",
  order: 10,
  mount(el, { session, owner }) {
    style("twiddle-widgets", ".twiddle-moves { font-family: var(--mono); color: var(--text-dim); min-height: 1.4em; }");
    const box = h("div", { class: "twiddle-moves", "aria-live": "polite" });
    el.append(box);
    const render = () => { box.textContent = `${session.state.moves} turns`; };
    session.hooks.change.tap(render, { owner });
    render();
  },
};
