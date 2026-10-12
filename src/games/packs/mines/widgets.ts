import { defineWidgets } from "../../core/define";
import { h, style } from "../../core/dom";
import { mines, mineCount, type MinesAction, type MinesInteraction, type MinesPuzzle, type MinesState } from "./logic";

const widget = defineWidgets<MinesPuzzle, MinesState, MinesAction, MinesInteraction>();

const CSS = `
.mines-counter { font-family: var(--mono); color: var(--text-dim); min-height: 1.4em; }
`;

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

export const minesWidgets = [counter];
