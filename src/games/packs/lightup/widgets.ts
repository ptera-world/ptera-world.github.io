import type { WidgetDef } from "../../core/types";
import { h, style } from "../../ui/dom";
import type { LightupAction, LightupInteraction, LightupPuzzle, LightupState } from "./logic";

type LightupWidget = WidgetDef<LightupPuzzle, LightupState, LightupAction, LightupInteraction>;

const CSS = `
.lightup-mode { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.lightup-mode button { border: none; border-radius: 0; padding: 6px 14px; }
.lightup-mode button[aria-pressed="true"] { background: var(--accent-soft); color: var(--text); }
`;

const coarse = (): boolean => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/** Visible by default only on touch screens, where there is no right click. */
export const markMode: LightupWidget = {
  id: "lightup.mode",
  name: "light / mark switch",
  description: "choose whether tapping a cell places a light or a no-light mark",
  puzzles: ["lightup"],
  defaultSlot: coarse() ? "bottom" : "off",
  order: 15,
  mount(el, { session, owner, run }) {
    style("lightup-widgets", CSS);
    const lightBtn = h("button", { type: "button", onclick: () => { if (session.interaction.markMode) run("lightup.mode"); } }, "light");
    const markBtn = h("button", { type: "button", onclick: () => { if (!session.interaction.markMode) run("lightup.mode"); } }, "no-light mark");
    el.append(h("div", { class: "lightup-mode", role: "group", "aria-label": "what a tap does" }, lightBtn, markBtn));
    const render = () => {
      lightBtn.setAttribute("aria-pressed", String(!session.interaction.markMode));
      markBtn.setAttribute("aria-pressed", String(session.interaction.markMode));
    };
    session.hooks.interaction.tap(render, { owner });
    render();
  },
};

export const lightupWidgets: LightupWidget[] = [markMode];
