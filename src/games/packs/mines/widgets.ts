import type { WidgetDef } from "../../core/types";
import { h, style } from "../../ui/dom";
import { mineCount, type MinesAction, type MinesInteraction, type MinesPuzzle, type MinesState } from "./logic";

type MinesWidget = WidgetDef<MinesPuzzle, MinesState, MinesAction, MinesInteraction>;

const CSS = `
.mines-counter { font-family: var(--mono); color: var(--text-dim); min-height: 1.4em; }
.mines-mode { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.mines-mode button { border: none; border-radius: 0; padding: 6px 14px; }
.mines-mode button[aria-pressed="true"] { background: var(--accent-soft); color: var(--text); }
.mines-mode button.flag[aria-pressed="true"] { background: var(--danger-soft); }
.w-results.mines-lost { border-color: var(--danger); }
.w-results.mines-lost .big { color: var(--danger); }
`;

const coarse = (): boolean => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

export const counter: MinesWidget = {
  id: "mines.counter",
  name: "mines left",
  description: "total mines minus flags placed",
  puzzles: ["mines"],
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
};

/** Visible by default only on touch screens, where there is no right click. */
export const flagMode: MinesWidget = {
  id: "mines.mode",
  name: "open / flag switch",
  description: "choose whether tapping a cell opens it or flags it",
  puzzles: ["mines"],
  defaultSlot: coarse() ? "bottom" : "off",
  order: 15,
  mount(el, { session, owner, run }) {
    style("mines-widgets", CSS);
    const openBtn = h("button", { type: "button", onclick: () => { if (session.interaction.flagMode) run("mines.mode"); } }, "open");
    const flagBtn = h("button", { type: "button", class: "flag", onclick: () => { if (!session.interaction.flagMode) run("mines.mode"); } }, "flag");
    el.append(h("div", { class: "mines-mode", role: "group", "aria-label": "what a tap does" }, openBtn, flagBtn));
    const render = () => {
      openBtn.setAttribute("aria-pressed", String(!session.interaction.flagMode));
      flagBtn.setAttribute("aria-pressed", String(session.interaction.flagMode));
    };
    session.hooks.interaction.tap(render, { owner });
    render();
  },
};

/** The losing counterpart of the shell's results card. */
export const lost: MinesWidget = {
  id: "mines.lost",
  name: "mine hit",
  description: "what to do after opening a mine",
  puzzles: ["mines"],
  defaultSlot: "overlay",
  order: 0,
  mount(el, { session, owner, run }) {
    style("mines-widgets", CSS);
    let dismissed = false;
    const render = () => {
      el.replaceChildren();
      if (session.state.dead < 0) {
        dismissed = false;
        return;
      }
      if (dismissed) return;
      const safeLeft = session.puzzle.mines.reduce((a, m, c) => a + (!m && !session.state.open[c] ? 1 : 0), 0);
      el.append(h("div", { class: "w-results mines-lost", role: "alert" },
        h("strong", { class: "big" }, "you hit a mine"),
        h("div", { class: "w-dim" }, `${safeLeft} safe ${safeLeft === 1 ? "cell" : "cells"} were left`),
        h("div", { class: "w-inline" },
          h("button", { class: "primary", onclick: () => run("shell.undo") }, "undo"),
          h("button", { onclick: () => run("shell.new") }, "new game"),
          h("button", { onclick: () => { dismissed = true; render(); } }, "look at the board"))));
    };
    session.hooks.change.tap(render, { owner });
    render();
  },
};

export const minesWidgets = [counter, flagMode, lost];
