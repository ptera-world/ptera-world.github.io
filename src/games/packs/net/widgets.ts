import type { WidgetDef } from "../../core/types";
import { h } from "../../ui/dom";

/** Scrolling a wrapped board without a keyboard. */
export const scrollPad: WidgetDef = {
  id: "net.scroll",
  name: "scroll",
  description: "move a wrapping board around, so the part you're working on isn't split across the edge",
  puzzles: ["net"],
  requires: ["wrap"],
  defaultSlot: "bottom",
  order: 30,
  mount(el, ctx) {
    const btn = (label: string, aria: string, id: string) =>
      h("button", { "aria-label": aria, title: aria, onclick: () => ctx.run(id) }, label);
    el.append(h("div", { class: "w-inline", style: "justify-content: center" },
      btn("←", "scroll left", "net.shift-left"),
      btn("↑", "scroll up", "net.shift-up"),
      btn("↓", "scroll down", "net.shift-down"),
      btn("→", "scroll right", "net.shift-right"),
      btn("centre", "centre the source", "net.recentre")));
  },
};
