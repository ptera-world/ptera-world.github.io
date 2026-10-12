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
  singles, BLACK, CIRCLE, NONE,
  type SinglesAction, type SinglesConflicts, type SinglesInteraction, type SinglesPuzzle, type SinglesState,
} from "./logic";

/** Derived: SinglesConflicts to flag on the board. */
export const CONFLICTS_KEY = "singles.conflicts";

const CSS = `
.singles-board .num { fill: var(--text); font: 600 5.6px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.singles-board .shade { fill: var(--text); }
.singles-board .shade.bad { fill: var(--danger); }
.singles-board .num.on-black { fill: var(--bg); opacity: 0.55; }
.singles-board .ring { fill: none; stroke: var(--text-dim); stroke-width: 0.6; }
.singles-board .ring.bad { stroke: var(--danger); stroke-width: 0.9; }
.singles-board .num.bad { fill: var(--danger); }
.singles-board .cut { fill: var(--danger-soft); pointer-events: none; }
`;

const settings = defineSchema({
  longPressMs: { type: "int", label: "touch hold for a circle (ms)", default: 400, min: 150, max: 1500, step: 50 },
});

const BINDINGS = {
  "singles.black": { label: "black on / off", category: "singles", keys: ["space", "b"], description: "black out the selected cell, or bring it back" },
  "singles.circle": { label: "circle on / off", category: "singles", keys: ["Enter", "c", "o"], description: "circle the selected cell: your note that it stays white. press again to remove it" },
  "singles.clear": { label: "clear cell", category: "singles", keys: ["Backspace", "Delete"], description: "remove the black or circle from the selected cell" },
  ...cursorBindings("singles", "singles"),
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

function legend(): { sample: string; meaning: string }[] {
  const num = (fill: string, extra = "") => `<text x="5" y="5.3" fill="${fill}" font-size="5.6" font-weight="600" font-family="var(--font)" text-anchor="middle" dominant-baseline="central" ${extra}>3</text>`;
  const black = (fill: string) => `<rect width="10" height="10" fill="${fill}"/>`;
  const ring = (stroke: string, w: number) => `<circle cx="5" cy="5" r="3.8" fill="none" stroke="${stroke}" stroke-width="${w}"/>`;
  return [
    { sample: sample(sampleCell() + num("var(--text)")), meaning: "a cell not decided yet" },
    { sample: sample(black("var(--text)") + num("var(--bg)", `opacity="0.55"`)), meaning: "a black cell (its number no longer counts)" },
    { sample: sample(sampleCell() + ring("var(--text-dim)", 0.6) + num("var(--text)")), meaning: "a circle: your note that this cell stays white" },
    { sample: sample(black("var(--danger)") + num("var(--bg)", `opacity="0.55"`)), meaning: "a black touching another black" },
    { sample: sample(sampleCell() + ring("var(--danger)", 0.9) + num("var(--danger)")), meaning: "a circled number repeated in its row or column" },
    { sample: sample(sampleCell() + `<rect width="10" height="10" fill="var(--danger-soft)"/>` + num("var(--text)")), meaning: "cells cut off from the other white cells" },
    ...focusLegend("the cell it changes", "the reason (the numbers or black it comes from)"),
  ];
}

export function singlesView(board: BoardPrefs): View<SinglesPuzzle, SinglesState, SinglesAction, SinglesInteraction, typeof settings> {
  return {
    id: "singles.svg",
    name: "grid",
    puzzle: singles,
    settings,
    controls: [
      { how: "click or tap a cell", what: "black it out, or bring it back. drag to do several" },
      { how: "right-click, or hold on a touch screen", what: "circle it (your note that it stays white), or remove the circle. keep holding and drag to do several" },
    ],
    legend: legend(),
    mount(root, { session, settings }) {
      style("kit", KIT_CSS);
      style("singles", CSS);
      const p = session.puzzle;
      const n = p.w * p.h;
      const f = frame(root, p, "singles-board", "singles", board);
      const fade = fades(f);
      const nums: SVGTextElement[] = [];
      const cells: SVGRectElement[] = [];
      for (let c = 0; c < n; c++) {
        f.base.append(cells[c] = s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: "cell" }));
        f.anchor(c, cells[c]!);
      }
      const marks: SVGGElement[] = [];
      for (let c = 0; c < n; c++) f.marks.append(marks[c] = s("g"));
      const numLayer = s("g");
      f.over.before(numLayer);
      for (let c = 0; c < n; c++) numLayer.append(nums[c] = s("text", { x: f.cx(c) + SIZE / 2, y: f.cy(c) + SIZE / 2 + 0.3, class: "num" }, String(p.nums[c])));
      const placeCursor = cursorRect(f);
      let preview: SinglesState | null = null;

      const drawMark = (g: SVGGElement, c: number, mark: number, bad: SinglesConflicts | null) => {
        if (mark === BLACK) g.append(s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: `shade${bad?.touching.includes(c) ? " bad" : ""}` }));
        else if (mark === CIRCLE) g.append(s("circle", { cx: f.cx(c) + SIZE / 2, cy: f.cy(c) + SIZE / 2, r: 3.8, class: `ring${bad?.repeats.includes(c) ? " bad" : ""}` }));
      };

      const strokes = new Strokes(f, session, {
        editable: () => true,
        mark: (c) => session.state.marks[c]!,
        next: (c, kind) => {
          const m = session.state.marks[c]!;
          const want = kind === "primary" ? BLACK : CIRCLE;
          return m === want ? NONE : want;
        },
        commit: (cells, value) => void session.dispatch({ type: "set", cells, value: value as SinglesAction["value"] }),
        redraw: () => render(),
        holdMs: () => settings.longPressMs,
      });

      const render = () => {
        const shown = strokes.shown(session.state.marks);
        const bad = (session.derived()[CONFLICTS_KEY] as SinglesConflicts | undefined) ?? null;
        for (let c = 0; c < n; c++) {
          const g = marks[c]!;
          while (g.firstChild) g.firstChild.remove();
          drawMark(g, c, shown[c]!, bad);
          if (bad?.cut.includes(c) && shown[c] !== BLACK) g.append(s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: "cut" }));
          nums[c]!.classList.toggle("on-black", shown[c] === BLACK);
          nums[c]!.classList.toggle("bad", shown[c] === CIRCLE && !!bad?.repeats.includes(c));
        }
        while (f.ghost.firstChild) f.ghost.firstChild.remove();
        fade.clear();
        if (preview) {
          for (let c = 0; c < n; c++) if (preview.marks[c] !== shown[c]) { if (shown[c]) fade.cell(c); drawMark(f.ghost, c, preview.marks[c]!, null); }
        }
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

      const atCursor = (fn: (c: number) => void) => () => fn(session.interaction.cursor);
      const toggle = (value: typeof BLACK | typeof CIRCLE) => atCursor((c) => session.dispatch({ type: "set", cells: [c], value: session.state.marks[c] === value ? NONE : value }));
      const commands = bindCommands(BINDINGS, {
        "singles.black": toggle(BLACK),
        "singles.circle": toggle(CIRCLE),
        "singles.clear": atCursor((c) => session.dispatch({ type: "set", cells: [c], value: NONE })),
        ...cursorHandlers("singles", p, session),
      }, {
        "singles.black": { menu: "board" },
        "singles.circle": { menu: "board" },
        "singles.clear": { menu: "board" },
      });
      return {
        gestures: { secondaryClick: true, hold: true, labels: ["black", "circle"] },
        aspect: f.aspect,
        cells: { cols: p.w, rows: p.h },
        commands,
        target: () => strokes.target(),
        preview: (st) => {
          preview = st as SinglesState | null;
          render();
        },
        locate: (focus) => f.rects(focusCells(focus)),
        locateChange: (a, b) => {
          const x = (a as SinglesState).marks, y = (b as SinglesState).marks;
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
