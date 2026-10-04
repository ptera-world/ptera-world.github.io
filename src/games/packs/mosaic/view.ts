import { bindCommands, type BindingSchema } from "../../core/commands";
import { s, style } from "../../core/dom";
import { defineSchema } from "../../core/schema";
import type { View } from "../../core/types";
import type { Focus } from "./kit/names";
import {
  KIT_CSS, SIZE, Strokes, cursorBindings, cursorHandlers, cursorRect, drawFocus, focusCells, focusLegend, frame, sample, sampleCell,
  type BoardPrefs,
} from "./kit/view";
import {
  BLACK, DOT, NONE, finishedClues,
  type Mark, type MosaicAction, type MosaicConflicts, type MosaicInteraction, type MosaicPuzzle, type MosaicState,
} from "./logic";

/** Derived: MosaicConflicts to flag on the board. */
export const CONFLICTS_KEY = "mosaic.conflicts";

const CSS = `
.mosaic-board .num { fill: var(--text); font: 600 5.6px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.mosaic-board .num.on-black { fill: var(--bg); }
.mosaic-board .num.done { opacity: var(--done-opacity); }
.mosaic-board .num.bad { fill: var(--danger); opacity: 1; }
.mosaic-board .shade { fill: var(--text); }
.mosaic-board .dot { fill: var(--text-dim); }
`;

const settings = defineSchema({
  longPressMs: { type: "int", label: "touch hold for a dot (ms)", default: 400, min: 150, max: 1500, step: 50 },
  dimDone: { type: "bool", label: "fade numbers whose block is finished", default: true },
});

const BINDINGS: BindingSchema = {
  "mosaic.black": { label: "black on / off", category: "mosaic", keys: ["space", "b"], description: "black out the selected cell, or bring it back" },
  "mosaic.dot": { label: "dot on / off", category: "mosaic", keys: ["Enter", "period"], description: "put a dot on the selected cell: your note that it stays white. press again to remove it" },
  "mosaic.clear": { label: "clear cell", category: "mosaic", keys: ["Backspace", "Delete"], description: "remove the black or dot from the selected cell" },
  ...cursorBindings("mosaic", "mosaic"),
};

function legend(): { sample: string; meaning: string }[] {
  const num = (fill: string, extra = "") => `<text x="5" y="5.3" fill="${fill}" font-size="5.6" font-weight="600" font-family="var(--font)" text-anchor="middle" dominant-baseline="central" ${extra}>4</text>`;
  return [
    { sample: sample(sampleCell()), meaning: "a cell not decided yet" },
    { sample: sample(sampleCell() + num("var(--text)")), meaning: "a number: how many blacks are in the 3×3 block around it, itself included" },
    { sample: sample(`<rect width="10" height="10" fill="var(--text)"/>`), meaning: "a black cell" },
    { sample: sample(`<rect width="10" height="10" fill="var(--text)"/>` + num("var(--bg)")), meaning: "a black cell with a number (numbers count their own cell too)" },
    { sample: sample(sampleCell() + `<circle cx="5" cy="5" r="1" fill="var(--text-dim)"/>`), meaning: "a dot: your note that this cell stays white" },
    { sample: sample(sampleCell() + num("var(--text)", `opacity="var(--done-opacity)"`)), meaning: "a faded number: its whole block is decided and right" },
    { sample: sample(sampleCell() + num("var(--danger)")), meaning: "a number with too many blacks around it, or too few cells left" },
    ...focusLegend("the cells it changes", "the number it comes from", "the shared cells it counts"),
  ];
}

export function mosaicView(board: BoardPrefs): View<MosaicPuzzle, MosaicState, MosaicAction, MosaicInteraction> {
  return {
    id: "mosaic.svg",
    name: "grid",
    puzzle: "mosaic",
    settings,
    controls: [
      { how: "click or tap a cell", what: "black it out, or bring it back. drag to do several" },
      { how: "right-click, or hold on a touch screen", what: "put a dot there (stays white), or take it away. keep holding and drag to do several" },
    ],
    legend: legend(),
    mount(root, { session, settings }) {
      style("kit", KIT_CSS);
      style("mosaic", CSS);
      const p = session.puzzle;
      const n = p.w * p.h;
      const f = frame(root, p, "mosaic-board", "mosaic", board);
      const holders: SVGGElement[] = [];
      const nums: (SVGTextElement | undefined)[] = [];
      const numLayer = s("g");
      f.over.before(numLayer);
      for (let c = 0; c < n; c++) {
        const cell = s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: "cell" });
        f.base.append(cell);
        f.anchor(c, cell);
        f.marks.append(holders[c] = s("g"));
        if (p.clues[c]! >= 0) numLayer.append(nums[c] = s("text", { x: f.cx(c) + SIZE / 2, y: f.cy(c) + SIZE / 2 + 0.3, class: "num" }, String(p.clues[c])));
      }
      const placeCursor = cursorRect(f);
      let preview: MosaicState | null = null;

      const drawMark = (el: Element, c: number, mark: number) => {
        if (mark === BLACK) el.append(s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: "shade" }));
        else if (mark === DOT) {
          const corner = p.clues[c]! >= 0;
          el.append(s("circle", { cx: f.cx(c) + (corner ? 8.4 : SIZE / 2), cy: f.cy(c) + (corner ? 8.4 : SIZE / 2), r: corner ? 0.7 : 1, class: "dot" }));
        }
      };

      const strokes = new Strokes(f, session, {
        editable: () => true,
        mark: (c) => session.state.marks[c]!,
        next: (c, kind) => {
          const want = kind === "primary" ? BLACK : DOT;
          return session.state.marks[c] === want ? NONE : want;
        },
        commit: (cells, value) => void session.dispatch({ type: "set", cells, value: value as Mark }),
        redraw: () => render(),
        holdMs: () => settings.longPressMs as number,
      });

      const render = () => {
        const shown = strokes.shown(session.state.marks);
        const bad = new Set((session.derived()[CONFLICTS_KEY] as MosaicConflicts | undefined)?.clues);
        const done = new Set(settings.dimDone ? finishedClues(p, shown) : []);
        for (let c = 0; c < n; c++) {
          const h = holders[c]!;
          while (h.firstChild) h.firstChild.remove();
          drawMark(h, c, shown[c]!);
          const el = nums[c];
          if (!el) continue;
          el.classList.toggle("on-black", shown[c] === BLACK);
          el.classList.toggle("bad", bad.has(c));
          el.classList.toggle("done", done.has(c));
        }
        while (f.ghost.firstChild) f.ghost.firstChild.remove();
        if (preview) for (let c = 0; c < n; c++) if (preview.marks[c] !== shown[c]) drawMark(f.ghost, c, preview.marks[c]!);
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
        session.dispatch({ type: "set", cells: [c], value: value(session.state.marks[c]!) });
      };
      const commands = bindCommands(BINDINGS, {
        "mosaic.black": atCursor((m) => (m === BLACK ? NONE : BLACK)),
        "mosaic.dot": atCursor((m) => (m === DOT ? NONE : DOT)),
        "mosaic.clear": atCursor(() => NONE),
        ...cursorHandlers("mosaic", p, session),
      }, {
        "mosaic.black": { menu: "board" },
        "mosaic.dot": { menu: "board" },
        "mosaic.clear": { menu: "board" },
      });
      return {
        gestures: { secondaryClick: true, hold: true },
        aspect: f.aspect,
        cells: { cols: p.w, rows: p.h },
        commands,
        target: () => strokes.target(),
        preview: (st) => {
          preview = st as MosaicState | null;
          render();
        },
        locate: (focus) => f.rects(focusCells(focus)),
        locateChange: (a, b) => {
          const x = (a as MosaicState).marks, y = (b as MosaicState).marks;
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
