import { h, style } from "../../core/dom";
import { defineWidgets } from "../../core/define";
import { DIGITS } from "../../lib/digits";
import { kakuro, type KakuroAction, type KakuroInteraction, type KakuroPuzzle, type KakuroState } from "./logic";
import { digitCommand } from "./view";

const widget = defineWidgets<KakuroPuzzle, KakuroState, KakuroAction, KakuroInteraction>();

const CSS = `
.kak-pad { display: flex; flex-direction: column; gap: 6px; width: 100%; max-width: 480px; }
.kak-digits { display: grid; gap: 4px; grid-template-columns: repeat(9, 1fr); }
.kak-digits button { height: 44px; font-size: 20px; padding: 0; }
.kak-row { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.kak-row button[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); }
`;

const coarse = (): boolean => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
const keep = (e: PointerEvent) => e.preventDefault();

/** Visible by default only on touch screens, where there's no keyboard to type digits with. */
export const pad = widget({
  id: "kakuro.pad",
  name: "number pad",
  description: "digits, notes and erase for the selected cells, for touch screens",
  puzzles: [kakuro],
  defaultSlot: coarse() ? "bottom" : "off",
  order: 10,
  mount(el, { session, run, owner }) {
    style("kakuro-widgets", CSS);
    const digits = DIGITS.map((d) =>
      h("button", { type: "button", "data-command": digitCommand(d), "aria-label": String(d), onpointerdown: keep, onclick: () => run(digitCommand(d)) }, String(d)));
    const notes = h("button", { type: "button", "data-command": "kakuro.notes", onpointerdown: keep, onclick: () => run("kakuro.notes"), title: "while on, digits go in as small notes" }, "notes");
    el.append(h("div", { class: "kak-pad" },
      h("div", { class: "kak-digits" }, digits),
      h("div", { class: "kak-row" }, notes, h("button", { type: "button", "data-command": "kakuro.clear", onpointerdown: keep, onclick: () => run("kakuro.clear") }, "erase"))));
    const render = () => notes.setAttribute("aria-pressed", String(session.interaction.candidates));
    session.hooks.interaction.tap(render, { owner });
    render();
  },
});

export const kakuroWidgets = [pad];
