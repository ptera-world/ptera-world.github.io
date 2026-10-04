import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { s, style } from "../../core/dom";
import { defineSchema } from "../../core/schema";
import type { View } from "../../core/types";
import type { Focus } from "../../lib/grid-kit/names";
import {
  KIT_CSS, SIZE, Strokes, cursorBindings, cursorHandlers, cursorRect, drawFocus, focusCells, focusLegend, frame, sample, sampleCell,
  type BoardPrefs,
} from "../../lib/grid-kit/view";
import { fades } from "../../lib/grid-kit/fade";
import {
  range, BLACK, DOT, NONE,
  type Mark, type RangeAction, type RangeConflicts, type RangeInteraction, type RangePuzzle, type RangeState,
} from "./logic";

/** Derived: RangeConflicts to flag on the board. */
export const CONFLICTS_KEY = "range.conflicts";

const CSS = `
.range-board .num { fill: var(--text); font: 600 5.6px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.range-board .num.bad { fill: var(--danger); }
.range-board .shade { fill: var(--text); }
.range-board .shade.bad { fill: var(--danger); }
.range-board .dot { fill: var(--text-dim); }
.range-board .cut { fill: var(--danger-soft); }
`;

const settings = defineSchema({
  longPressMs: { type: "int", label: "touch hold for a dot (ms)", default: 400, min: 150, max: 1500, step: 50 },
});

const BINDINGS = {
  "range.black": { label: "black on / off", category: "range", keys: ["space", "b"], description: "black out the selected cell, or bring it back" },
  "range.dot": { label: "dot on / off", category: "range", keys: ["Enter", "period"], description: "put a dot on the selected cell: your note that it stays white. press again to remove it" },
  "range.clear": { label: "clear cell", category: "range", keys: ["Backspace", "Delete"], description: "remove the black or dot from the selected cell" },
  ...cursorBindings("range", "range"),
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

function legend(): { sample: string; meaning: string }[] {
  const num = (fill: string) => `<text x="5" y="5.3" fill="${fill}" font-size="5.6" font-weight="600" font-family="var(--font)" text-anchor="middle" dominant-baseline="central">4</text>`;
  return [
    { sample: sample(sampleCell()), meaning: "a cell not decided yet" },
    { sample: sample(sampleCell() + num("var(--text)")), meaning: "a number: how many white cells it sees in its row and column, itself included" },
    { sample: sample(`<rect width="10" height="10" fill="var(--text)"/>`), meaning: "a black cell" },
    { sample: sample(sampleCell() + `<circle cx="5" cy="5" r="1" fill="var(--text-dim)"/>`), meaning: "a dot: your note that this cell stays white" },
    { sample: sample(`<rect width="10" height="10" fill="var(--danger)"/>`), meaning: "a black touching another black" },
    { sample: sample(sampleCell() + num("var(--danger)")), meaning: "a number that sees too many cells, or can't see enough any more" },
    { sample: sample(sampleCell() + `<rect width="10" height="10" fill="var(--danger-soft)"/>`), meaning: "cells cut off from the other white cells" },
    ...focusLegend("the cells it changes", "the number or black it comes from", "other cells it mentions"),
  ];
}

export function rangeView(board: BoardPrefs): View<RangePuzzle, RangeState, RangeAction, RangeInteraction, typeof settings> {
  return {
    id: "range.svg",
    name: "grid",
    puzzle: range,
    settings,
    controls: [
      { how: "click or tap a cell", what: "black it out, or bring it back. drag to do several" },
      { how: "right-click, or hold on a touch screen", what: "put a dot there (stays white), or take it away. keep holding and drag to do several" },
    ],
    legend: legend(),
    mount(root, { session, settings }) {
      style("kit", KIT_CSS);
      style("range", CSS);
      const p = session.puzzle;
      const n = p.w * p.h;
      const f = frame(root, p, "range-board", "range", board);
      const fade = fades(f);
      const holders: SVGGElement[] = [];
      const nums: (SVGTextElement | undefined)[] = [];
      for (let c = 0; c < n; c++) {
        const cell = s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: "cell" });
        f.base.append(cell);
        f.anchor(c, cell);
        f.marks.append(holders[c] = s("g"));
        if (p.nums[c]! > 0) f.base.append(nums[c] = s("text", { x: f.cx(c) + SIZE / 2, y: f.cy(c) + SIZE / 2 + 0.3, class: "num" }, String(p.nums[c])));
      }
      const placeCursor = cursorRect(f);
      let preview: RangeState | null = null;

      const drawMark = (el: Element, c: number, mark: number, bad: boolean) => {
        if (mark === BLACK) el.append(s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: `shade${bad ? " bad" : ""}` }));
        else if (mark === DOT) el.append(s("circle", { cx: f.cx(c) + SIZE / 2, cy: f.cy(c) + SIZE / 2, r: 1, class: "dot" }));
      };

      const strokes = new Strokes(f, session, {
        editable: (c) => p.nums[c] === 0,
        mark: (c) => session.state.marks[c]!,
        next: (c, kind) => {
          const want = kind === "primary" ? BLACK : DOT;
          return session.state.marks[c] === want ? NONE : want;
        },
        commit: (cells, value) => void session.dispatch({ type: "set", cells, value: value as Mark }),
        redraw: () => render(),
        holdMs: () => settings.longPressMs,
      });

      const render = () => {
        const shown = strokes.shown(session.state.marks);
        const bad = session.derived()[CONFLICTS_KEY] as RangeConflicts | undefined;
        const touching = new Set(bad?.touching), clues = new Set(bad?.clues), cut = new Set(bad?.cut);
        for (let c = 0; c < n; c++) {
          const h = holders[c]!;
          while (h.firstChild) h.firstChild.remove();
          if (cut.has(c) && shown[c] !== BLACK) h.append(s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: "cut" }));
          drawMark(h, c, shown[c]!, touching.has(c));
          nums[c]?.classList.toggle("bad", clues.has(c));
        }
        while (f.ghost.firstChild) f.ghost.firstChild.remove();
        fade.clear();
        if (preview) for (let c = 0; c < n; c++) if (preview.marks[c] !== shown[c]) { if (shown[c]) fade.cell(c); drawMark(f.ghost, c, preview.marks[c]!, false); }
        while (f.over.firstChild) f.over.firstChild.remove();
        drawFocus(f.over, f, session.activeHint?.focus as Focus | undefined);
        placeCursor(session.interaction.cursor);
      };

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(() => {
          if (session.locked) strokes.cancel();
          render();
        }, { owner: "view" }),
      ];
      render();

      const atCursor = (value: (m: number) => Mark) => () => {
        const c = session.interaction.cursor;
        if (p.nums[c] === 0) session.dispatch({ type: "set", cells: [c], value: value(session.state.marks[c]!) });
      };
      const commands = bindCommands(BINDINGS, {
        "range.black": atCursor((m) => (m === BLACK ? NONE : BLACK)),
        "range.dot": atCursor((m) => (m === DOT ? NONE : DOT)),
        "range.clear": atCursor(() => NONE),
        ...cursorHandlers("range", p, session),
      }, {
        "range.black": { menu: "board" },
        "range.dot": { menu: "board" },
        "range.clear": { menu: "board" },
      });
      return {
        gestures: { secondaryClick: true, hold: true },
        aspect: f.aspect,
        cells: { cols: p.w, rows: p.h },
        commands,
        target: () => strokes.target(),
        preview: (st) => {
          preview = st as RangeState | null;
          render();
        },
        locate: (focus) => f.rects(focusCells(focus)),
        locateChange: (a, b) => {
          const x = (a as RangeState).marks, y = (b as RangeState).marks;
          return f.rects(x.flatMap((m, c) => (m !== y[c] ? [c] : [])));
        },
        destroy() {
          strokes.destroy();
          offs.forEach((o) => o());
          f.destroy();
        },
      };
    },
  };
}
