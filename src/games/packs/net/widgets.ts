import type { WidgetDef } from "../../core/types";
import { h } from "../../core/dom";
import type { NetInteraction } from "./logic";

const button = (id: string, label: string, run: (id: string) => boolean) =>
  h("button", { "data-command": id, onclick: () => run(id) }, label);

/** What a tap or plain click on a tile does; the only way to turn counterclockwise or lock on a touch screen without the menu. */
export const tapModes: WidgetDef = {
  id: "net.tap",
  name: "tap does",
  description: "choose what tapping or clicking a tile does: turn it clockwise, counterclockwise, or lock it",
  puzzles: ["net"],
  defaultSlot: "bottom",
  order: 25,
  mount(el, ctx) {
    const modes = [["cw", "↻ turn"], ["ccw", "↺ turn"], ["lock", "lock"]] as const;
    const buttons = modes.map(([mode, label]) => [mode, button(`net.tap-${mode}`, label, ctx.run)] as const);
    const render = () => {
      const cur = (ctx.session.interaction as NetInteraction).tap ?? "cw";
      for (const [mode, b] of buttons) b.setAttribute("aria-pressed", String(mode === cur));
    };
    el.append(h("div", { class: "w-inline", style: "justify-content: center", role: "group", "aria-label": "tap does" },
      h("span", { class: "w-dim" }, "tap:"), buttons.map(([, b]) => b)));
    ctx.session.hooks.interaction.tap(render, { owner: ctx.owner });
    render();
  },
};

/** Scrolling a wrapped board without a keyboard. */
export const scrollPad: WidgetDef = {
  id: "net.scroll",
  name: "scroll",
  description: "slide a wrapping board around, so the part you're working on isn't split across an edge",
  puzzles: ["net"],
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
