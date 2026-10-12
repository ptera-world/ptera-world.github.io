import { defineWidgets } from "../../core/define";
import { h, style } from "../../core/dom";
import { buttonsSwapped } from "../../core/gestures";
import { mines, mineCount, type MinesAction, type MinesInteraction, type MinesPuzzle, type MinesState } from "./logic";

const widget = defineWidgets<MinesPuzzle, MinesState, MinesAction, MinesInteraction>();

const CSS = `
.mines-counter { font-family: var(--mono); color: var(--text-dim); min-height: 1.4em; }
.mines-mode { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.mines-mode button { border: none; border-radius: 0; padding: 6px 14px; }
.mines-mode button[aria-pressed="true"] { background: var(--accent-soft); color: var(--text); }
.mines-mode button.flag[aria-pressed="true"] { background: var(--danger-soft); }
`;

const coarse = (): boolean => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

export const counter = widget({
  id: "mines.counter",
  name: "mines left",
  description: "total mines minus flags placed",
  puzzles: [mines],
  defaultSlot: "top",
  order: 10,
  mount(el, { session, owner }) {
    style("mines-widgets", CSS);
    const total = mineCount(session.puzzle);
    const box = h("div", { class: "mines-counter", "aria-live": "polite" });
    el.append(box);
    const render = () => {
      const left = total - session.state.flags.reduce((a, b) => a + b, 0);
      box.textContent = `${left} ${left === 1 || left === -1 ? "mine" : "mines"} left`;
    };
    session.hooks.change.tap(render, { owner });
    render();
  },
});

/** Visible by default only on touch screens, where there is no right click. */
export const flagMode = widget({
  id: "mines.mode",
  name: "open / flag switch",
  description: "choose whether tapping a cell opens it or flags it",
  puzzles: [mines],
  defaultSlot: coarse() ? "bottom" : "off",
  order: 15,
  mount(el, { session, owner, run }) {
    style("mines-widgets", CSS);
    const openBtn = h("button", { type: "button", "data-command": "shell.swap-buttons", title: "taps open cells", onclick: () => { if (buttonsSwapped(session.def.id)) run("shell.swap-buttons"); } }, "open");
    const flagBtn = h("button", { type: "button", class: "flag", "data-command": "shell.swap-buttons", title: "taps put flags on cells instead of opening them", onclick: () => { if (!buttonsSwapped(session.def.id)) run("shell.swap-buttons"); } }, "flag");
    el.append(h("div", { class: "mines-mode", role: "group", "aria-label": "what a tap does" }, openBtn, flagBtn));
    const render = () => {
      openBtn.setAttribute("aria-pressed", String(!buttonsSwapped(session.def.id)));
      flagBtn.setAttribute("aria-pressed", String(buttonsSwapped(session.def.id)));
    };
    session.hooks.refresh.tap(render, { owner });
    render();
  },
});

export const minesWidgets = [counter, flagMode];
