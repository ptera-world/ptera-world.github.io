import type { CommandId } from "../../core/commands";
import type { WidgetDef } from "../../core/types";
import { h, style } from "../../core/dom";
import type { NetPuzzle } from "./grid";
import { net, type NetState } from "./logic";

const button = (id: CommandId, label: string, run: (id: CommandId) => boolean) =>
  h("button", { "data-command": id, onclick: () => run(id) }, label);

/** Scrolling a wrapped board without a keyboard. */
export const scrollPad: WidgetDef = {
  id: "net.scroll",
  name: "scroll",
  description: "slide a wrapping board around, so the part you're working on isn't split across an edge",
  puzzles: [net],
  requires: ["wrap", "rotate"],
  defaultSlot: "bottom",
  order: 30,
  mount(el, ctx) {
    el.append(h("div", { class: "w-inline", style: "justify-content: center", role: "group", "aria-label": "scroll the board" },
      h("span", { class: "w-dim" }, "scroll:"),
      button("net.shift-left", "←", ctx.run),
      button("net.shift-up", "↑", ctx.run),
      button("net.shift-down", "↓", ctx.run),
      button("net.shift-right", "→", ctx.run),
      button("net.recentre", "center", ctx.run)));
  },
};

/** Slides made so far, on boards whose rows and columns slide. */
export const slideCount: WidgetDef<NetPuzzle, NetState> = {
  id: "net.moves",
  name: "moves",
  description: "how many slides so far",
  puzzles: [net],
  requires: ["slide"],
  defaultSlot: "top",
  order: 10,
  mount(el, { session, owner }) {
    style("net-widgets", ".net-moves { font-family: var(--mono); color: var(--text-dim); min-height: 1.4em; }");
    const box = h("div", { class: "net-moves", "aria-live": "polite" });
    el.append(box);
    const render = () => { box.textContent = `${session.state.moves ?? 0} slides`; };
    session.hooks.change.tap(render, { owner });
    render();
  },
};
