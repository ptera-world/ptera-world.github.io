import type { WidgetDef } from "../../core/types";
import { h, style } from "../../core/dom";
import { lightup, type LightupAction, type LightupInteraction, type LightupPuzzle, type LightupState } from "./logic";

type LightupWidget = WidgetDef<LightupPuzzle, LightupState, LightupAction, LightupInteraction>;

const CSS = `
.lightup-switch { display: inline-flex; align-items: center; gap: 8px; }
.lightup-switch-label { color: var(--text-dim); font-size: 13px; }
.lightup-mode { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.lightup-mode button { border: none; border-radius: 0; padding: 6px 14px; }
.lightup-mode button[aria-pressed="true"] { background: var(--accent-soft); color: var(--text); }
`;

const coarse = (): boolean => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/** Visible by default only on touch screens, where there is no right click. */
export const markMode: LightupWidget = {
  id: "lightup.mode",
  name: "light / mark switch",
  description: "choose whether tapping a cell places a light or a no-light mark (a dot noting that a cell can't hold a light)",
  puzzles: [lightup],
  defaultSlot: coarse() ? "bottom" : "off",
  order: 15,
  mount(el, { session, owner, run }) {
    style("lightup-widgets", CSS);
    const lightBtn = h("button", { type: "button", title: "tapping a cell puts a light there (or takes it away)", onclick: () => { if (session.interaction.markMode) run("lightup.mode"); } }, "a light");
    const markBtn = h("button", { type: "button", title: "tapping a cell puts a no-light mark there: a dot noting that it can't hold a light", onclick: () => { if (!session.interaction.markMode) run("lightup.mode"); } }, "a no-light mark");
    el.append(h("div", { class: "lightup-switch" },
      h("span", { class: "lightup-switch-label", id: "lightup-switch-label" }, "a tap places"),
      h("div", { class: "lightup-mode", role: "group", "aria-labelledby": "lightup-switch-label" }, lightBtn, markBtn)));
    const render = () => {
      lightBtn.setAttribute("aria-pressed", String(!session.interaction.markMode));
      markBtn.setAttribute("aria-pressed", String(session.interaction.markMode));
    };
    session.hooks.interaction.tap(render, { owner });
    render();
  },
};

export const lightupWidgets: LightupWidget[] = [markMode];
