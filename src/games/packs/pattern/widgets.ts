import { defineWidgets } from "../../core/define";
import { buttonsSwapped } from "../../core/gestures";
import { h, style } from "../../core/dom";
import { pattern, type PatternAction, type PatternInteraction, type PatternPuzzle, type PatternState } from "./logic";

const widget = defineWidgets<PatternPuzzle, PatternState, PatternAction, PatternInteraction>();

const CSS = `
.pattern-mode { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.pattern-mode button { border: none; border-radius: 0; padding: 6px 14px; }
.pattern-mode button[aria-pressed="true"] { background: var(--accent-soft); color: var(--text); }
`;

const coarse = (): boolean => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/** Visible by default only on touch screens, where there is no right click. */
export const crossMode = widget({
  id: "pattern.mode",
  name: "fill / cross switch",
  description: "choose whether tapping a cell fills it or crosses it out",
  puzzles: [pattern],
  defaultSlot: coarse() ? "bottom" : "off",
  order: 15,
  mount(el, { session, owner, run }) {
    style("pattern-widgets", CSS);
    const id = session.def.id;
    const fillBtn = h("button", { type: "button", onclick: () => { if (buttonsSwapped(id)) { run("shell.swap-buttons"); render(); } } }, "fill");
    const crossBtn = h("button", { type: "button", onclick: () => { if (!buttonsSwapped(id)) { run("shell.swap-buttons"); render(); } } }, "cross");
    el.append(h("div", { class: "pattern-mode", role: "group", "aria-label": "what a tap does" }, fillBtn, crossBtn));
    const render = () => {
      fillBtn.setAttribute("aria-pressed", String(!buttonsSwapped(id)));
      crossBtn.setAttribute("aria-pressed", String(buttonsSwapped(id)));
    };
    session.hooks.refresh.tap(render, { owner });
    render();
  },
});

export const patternWidgets = [crossMode];
