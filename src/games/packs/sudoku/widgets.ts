import { defineSchema } from "../../core/schema";
import type { WidgetContext, WidgetDef } from "../../core/types";
import { h, style } from "../../core/dom";
import { modelOf } from "./engine/model";
import { constraintTypes } from "./engine/registry";
import { cellName } from "./engine/types";
import { LATIN_IDS } from "./defs";
import { MODES } from "./input";
import { peerCandidates } from "./plugins";
import type { GridAction, GridInteraction, GridState, LatinPuzzle } from "./puzzle";
import { colorVar } from "./view";

type LatinWidget = WidgetDef<LatinPuzzle, GridState, GridAction, GridInteraction>;
type Ctx = WidgetContext<LatinPuzzle, GridState, GridAction, GridInteraction>;

const CSS = `
.sdk-pad { display: flex; flex-direction: column; gap: 6px; width: 100%; max-width: 480px; container-type: inline-size; }
.sdk-modes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.sdk-modes button { padding: 6px 2px; font-size: 13px; }
.sdk-modes button[aria-pressed="true"], .sdk-hl button[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); }
.sdk-digits { display: grid; gap: 6px; grid-template-columns: repeat(var(--cols), 1fr); }
.sdk-digits button { position: relative; aspect-ratio: 1; font-size: 22px; padding: 0; display: flex; align-items: center; justify-content: center; }
.sdk-pad.row .sdk-digits button { aspect-ratio: auto; height: 46px; font-size: 20px; }
@container (min-width: 300px) {
  .sdk-digits { grid-template-columns: repeat(var(--n), 1fr); gap: 4px; }
  .sdk-digits button { aspect-ratio: auto; height: 46px; font-size: 20px; }
}
.sdk-digits button.done.fade > span { opacity: var(--done-opacity, 0.35); }
.sdk-digits button.done.fade { border-style: dashed; }
.sdk-digits button.done.hide { visibility: hidden; }
.sdk-digits button small { position: absolute; right: 5px; bottom: 3px; font-size: 11px; color: var(--text-dim); }
.sdk-digits .swatch { width: 60%; height: 60%; border-radius: 4px; }
.sdk-digits[data-mode="corner"] button > span { font-size: 13px; position: absolute; left: 6px; top: 3px; }
.sdk-digits[data-mode="center"] button > span { font-size: 14px; }
.sdk-pad .erase { width: 100%; }
.sdk-hl { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; justify-content: center; }
.sdk-hl button { min-width: 2.2em; padding: 4px 6px; font-size: 14px; }
.sdk-hl .label { font-size: 12px; color: var(--text-dim); width: 100%; text-align: center; }
.sdk-cell { font: 600 15px var(--mono); color: var(--text); min-height: 1.5em; text-align: center; }
.sdk-combos { font: 13px var(--mono); color: var(--text); height: 6.6em; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; width: 100%; max-width: 480px; }
.sdk-combos .none { color: var(--text-dim); font-family: var(--font); }
`;

const watch = (ctx: Ctx, render: () => void): void => {
  const o = { owner: ctx.owner };
  ctx.session.hooks.change.tap(render, o);
  ctx.session.hooks.interaction.tap(render, o);
  ctx.session.hooks.refresh.tap(render, o);
};

/** Placed count of each digit, indexed by digit. */
function counts(p: LatinPuzzle, s: GridState): number[] {
  const out = Array.from({ length: p.n + 1 }, () => 0);
  for (const v of s.values) if (v) out[v]!++;
  return out;
}

const keep = (e: PointerEvent) => e.preventDefault();

const pad: LatinWidget = {
  id: "sudoku.pad",
  name: "digit pad",
  description: "input modes, digits and erase, for mouse and touch",
  puzzles: LATIN_IDS,
  defaultSlot: "side",
  order: 10,
  settings: defineSchema({
    left: { type: "bool", label: "show how many of each digit are left", default: true },
    finished: {
      type: "enum", label: "finished digits", default: "fade",
      options: [{ value: "fade", label: "fade (theme sets how much)" }, { value: "hide", label: "hide" }, { value: "keep", label: "leave as is" }],
    },
  }),
  mount(el, ctx) {
    style("sudoku-widgets", CSS);
    const { session, run, settings, slot } = ctx;
    const n = session.puzzle.n;
    const wide = slot === "top" || slot === "bottom";
    const modeButtons = MODES.map((m) => h("button", { "aria-pressed": "false", onpointerdown: keep, onclick: () => run(`sudoku.mode-${m.id}`) }, m.label));
    // n buttons in every mode (colour mode offers the first n colours), so switching modes never resizes the pad
    const digitButtons = Array.from({ length: n }, (_, i) =>
      h("button", { "aria-label": String(i + 1), onpointerdown: keep, onclick: () => run(`sudoku.${session.interaction.mode === "color" ? "color-" : "d"}${i + 1}`) }));
    const grid = h("div", { class: "sdk-digits", style: `--cols: ${wide ? n : n <= 4 ? 2 : 3}; --n: ${n}` }, digitButtons);
    el.append(h("div", { class: `sdk-pad${wide ? " row" : ""}` },
      h("div", { class: "sdk-modes", role: "group", "aria-label": "input mode" }, modeButtons),
      grid,
      h("button", { class: "erase", onpointerdown: keep, onclick: () => run("sudoku.clear") }, "erase")));
    const render = () => {
      const it = session.interaction;
      modeButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(MODES[i]!.id === it.mode)));
      grid.dataset.mode = it.mode;
      const placed = counts(session.puzzle, session.state);
      digitButtons.forEach((b, i) => {
        const dg = i + 1;
        const left = n - (placed[dg] ?? 0);
        const k = `${it.mode}|${left}`;
        if (b.dataset.k === k) return;
        b.dataset.k = k;
        b.className = "";
        if (it.mode === "color") {
          b.replaceChildren(h("span", { class: "swatch", style: `background: ${colorVar(dg)}` }));
          return;
        }
        b.replaceChildren(h("span", null, String(dg)), settings.left ? h("small", { style: left > 0 ? "" : "visibility: hidden" }, String(Math.max(0, left))) : "");
        if (left <= 0 && settings.finished !== "keep") b.className = `done ${settings.finished}`;
      });
    };
    watch(ctx, render);
    render();
  },
};

const highlighter: LatinWidget = {
  id: "sudoku.highlighter",
  name: "digit highlighter",
  description: "pick a digit to light up everywhere; what gets lit is set under the \"highlight a digit\" assist",
  puzzles: LATIN_IDS,
  defaultSlot: "side",
  order: 20,
  mount(el, ctx) {
    style("sudoku-widgets", CSS);
    const { session, run } = ctx;
    const n = session.puzzle.n;
    const follow = h("button", { title: "follow the selected cell", onpointerdown: keep, onclick: () => run("sudoku.highlight-off") }, "auto");
    const buttons = Array.from({ length: n }, (_, i) => h("button", { onpointerdown: keep, onclick: () => run(`sudoku.highlight-${i + 1}`) }, String(i + 1)));
    el.append(h("div", { class: "sdk-hl", role: "group", "aria-label": "highlight digit" }, h("span", { class: "label" }, "highlight"), follow, buttons));
    const render = () => {
      const hl = session.interaction.highlight ?? 0;
      follow.setAttribute("aria-pressed", String(hl === 0));
      buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(hl === i + 1)));
    };
    watch(ctx, render);
    render();
  },
};

const cellLabel: LatinWidget = {
  id: "sudoku.cell-name",
  name: "cell name",
  description: "the selected cell's name as hints use it: column letter, then row number (C5 = column C, row 5). turn on edge labels (l) to see the letters and numbers around the board",
  puzzles: LATIN_IDS,
  defaultSlot: "off",
  order: 30,
  mount(el, ctx) {
    style("sudoku-widgets", CSS);
    const box = h("div", { class: "sdk-cell", "aria-live": "polite" });
    el.append(box);
    const render = () => { box.textContent = cellName(ctx.session.puzzle.n, ctx.session.interaction.cursor); };
    watch(ctx, render);
    render();
  },
};

const combos: LatinWidget = {
  id: "sudoku.combos",
  name: "cage combinations",
  description: "the digit sets still possible for the cage under the cursor",
  puzzles: LATIN_IDS,
  requires: ["combos"],
  defaultSlot: "side",
  order: 40,
  settings: defineSchema({
    max: { type: "int", label: "most combinations to list", default: 8, min: 1, max: 40 },
  }),
  mount(el, ctx) {
    style("sudoku-widgets", CSS);
    const { session, settings } = ctx;
    const max = settings.max as number;
    const box = h("div", { class: "sdk-combos", "aria-live": "polite" });
    el.append(box);
    let last = "";
    const render = () => {
      const p = session.puzzle, st = session.state;
      const m = modelOf(p);
      const masks = peerCandidates(m, st.values, st.struck);
      const lines: string[] = [];
      for (const ri of m.rulesOf[session.interaction.cursor] ?? []) {
        const r = m.rules[ri]!;
        const spec = p.constraints[m.ruleSource[ri]!]!;
        if (!constraintTypes.get(spec.type)?.combos || !r.enumerate) continue;
        const seen = new Set<string>();
        for (const sol of r.enumerate(r.cells.map((c) => masks[c]!), 2000)) seen.add(sol.slice().sort((a, b) => a - b).join(""));
        const list = [...seen].sort();
        lines.push(`${r.label}: ${list.length ? list.slice(0, max).join(" ") + (list.length > max ? ` (+${list.length - max})` : "") : "nothing fits"}`);
      }
      const key = lines.join("\n");
      if (key === last && box.childElementCount) return;
      last = key;
      box.replaceChildren(...(lines.length ? lines.map((l) => h("div", null, l)) : [h("div", { class: "none" }, "select a cell in a cage")]));
    };
    watch(ctx, render);
    render();
  },
};

export const latinWidgets: LatinWidget[] = [pad, highlighter, cellLabel, combos];
