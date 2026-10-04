import { h, style } from "../../core/dom";
import type { WidgetDef } from "../../core/types";
import { netslide, type NetslideAction, type NetslideInteraction, type NetslidePuzzle, type NetslideState } from "./logic";

export const movesWidget: WidgetDef<NetslidePuzzle, NetslideState, NetslideAction, NetslideInteraction> = {
  id: "netslide.moves",
  name: "moves",
  description: "how many moves so far",
  puzzles: [netslide],
  defaultSlot: "top",
  order: 10,
  mount(el, { session, owner }) {
    style("netslide-widgets", ".netslide-moves { font-family: var(--mono); color: var(--text-dim); min-height: 1.4em; }");
    const box = h("div", { class: "netslide-moves", "aria-live": "polite" });
    el.append(box);
    const render = () => { box.textContent = `${session.state.moves} slides`; };
    session.hooks.change.tap(render, { owner });
    render();
  },
};
