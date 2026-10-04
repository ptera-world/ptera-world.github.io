import { h, style } from "../../core/dom";
import type { WidgetDef } from "../../core/types";
import { geometry, type FillingAction, type FillingInteraction, type FillingPuzzle, type FillingState } from "./logic";
import { digitCommand } from "./view";

type FillingWidget = WidgetDef<FillingPuzzle, FillingState, FillingAction, FillingInteraction>;

const CSS = `
.fil-pad { display: flex; flex-direction: column; gap: 6px; width: 100%; max-width: 480px; }
.fil-digits { display: grid; gap: 4px; grid-template-columns: repeat(var(--n), 1fr); }
.fil-digits button { height: 44px; font-size: 20px; padding: 0; }
.fil-row { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.fil-row button[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); }
`;

const coarse = (): boolean => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
const keep = (e: PointerEvent) => e.preventDefault();

/** Visible by default only on touch screens, where there's no keyboard to type numbers with. */
export const pad: FillingWidget = {
  id: "filling.pad",
  name: "number pad",
  description: "numbers, notes and erase for the selected cells, for touch screens",
  puzzles: ["filling"],
  defaultSlot: coarse() ? "bottom" : "off",
  order: 10,
  mount(el, { session, run, owner }) {
    style("filling-widgets", CSS);
    const top = geometry(session.puzzle).top;
    const digits = Array.from({ length: top }, (_, i) =>
      h("button", { type: "button", "aria-label": String(i + 1), onpointerdown: keep, onclick: () => run(digitCommand(i + 1)) }, String(i + 1)));
    const notes = h("button", { type: "button", onpointerdown: keep, onclick: () => run("filling.notes"), title: "while on, numbers go in as small notes" }, "notes");
    el.append(h("div", { class: "fil-pad" },
      h("div", { class: "fil-digits", style: `--n: ${top}` }, digits),
      h("div", { class: "fil-row" }, notes, h("button", { type: "button", onpointerdown: keep, onclick: () => run("filling.clear") }, "erase"))));
    const render = () => notes.setAttribute("aria-pressed", String(session.interaction.candidates));
    session.hooks.interaction.tap(render, { owner });
    render();
  },
};

export const fillingWidgets: FillingWidget[] = [pad];
