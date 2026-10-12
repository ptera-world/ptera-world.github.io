import type { CommandId } from "../../core/commands";
import type { WidgetDef } from "../../core/types";
import { h } from "../../core/dom";
import { net } from "./logic";

const button = (id: CommandId, label: string, run: (id: CommandId) => boolean) =>
  h("button", { "data-command": id, onclick: () => run(id) }, label);

/** Scrolling a wrapped board without a keyboard. */
export const scrollPad: WidgetDef = {
  id: "net.scroll",
  name: "scroll",
  description: "slide a wrapping board around, so the part you're working on isn't split across an edge",
  puzzles: [net],
  requires: ["wrap"],
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
