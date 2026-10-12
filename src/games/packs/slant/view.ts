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
  slant, NONE, SLASH_BACK, SLASH_FWD, geometry, pointCell,
  type Mark, type SlantAction, type SlantConflicts, type SlantInteraction, type SlantPuzzle, type SlantState,
} from "./logic";

/** Derived: SlantConflicts to flag on the board. */
export const CONFLICTS_KEY = "slant.conflicts";

const CSS = `
.slant-board .line { stroke: var(--text); stroke-width: 1; stroke-linecap: round; }
.slant-board .line.bad { stroke: var(--danger); }
.slant-board .clue { fill: var(--cell); stroke: var(--text); stroke-width: 0.45; }
.slant-board .clue.done { opacity: var(--done-opacity); }
.slant-board .clue.bad { stroke: var(--danger); stroke-width: 0.8; }
.slant-board .clue-num { fill: var(--text); font: 600 3.4px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.slant-board .clue-num.bad { fill: var(--danger); }
`;

const settings = defineSchema({
  longPressMs: { type: "int", label: "touch hold to start with / (ms)", default: 400, min: 150, max: 1500, step: 50 },
});

const BINDINGS = {
  "slant.cycle": { label: "cycle \\ / / / empty", category: "slant", keys: ["space"], description: "the selected cell goes empty → \\ → / → empty" },
  "slant.cycle-back": { label: "cycle / / \\ / empty", category: "slant", keys: ["Enter"], description: "the selected cell goes empty → / → \\ → empty" },
  "slant.back": { label: "draw \\", category: "slant", keys: ["backslash"], description: "draw \\ in the selected cell" },
  "slant.fwd": { label: "draw /", category: "slant", keys: ["slash"], description: "draw / in the selected cell" },
  "slant.clear": { label: "clear cell", category: "slant", keys: ["Backspace", "Delete"], description: "rub out the line in the selected cell" },
  ...cursorBindings("slant", "slant"),
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

const INSET = 1.2;

function legend(): { sample: string; meaning: string }[] {
  const line = (back: boolean, stroke = "var(--text)") =>
    `<line x1="${INSET}" y1="${back ? INSET : 10 - INSET}" x2="${10 - INSET}" y2="${back ? 10 - INSET : INSET}" stroke="${stroke}" stroke-width="1" stroke-linecap="round"/>`;
  const clue = (stroke = "var(--text)", w = 0.45) =>
    `<circle cx="5" cy="5" r="2.6" fill="var(--cell)" stroke="${stroke}" stroke-width="${w}"/><text x="5" y="5.2" fill="${stroke}" font-size="3.4" font-weight="600" text-anchor="middle" dominant-baseline="central" font-family="var(--font)">2</text>`;
  return [
    { sample: sample(sampleCell() + line(true)), meaning: "a \\ line" },
    { sample: sample(sampleCell() + line(false)), meaning: "a / line" },
    { sample: sample(clue()), meaning: "a number on a corner point: how many lines touch it" },
    { sample: sample(sampleCell() + line(true, "var(--danger)")), meaning: "a line that's part of a closed loop" },
    { sample: sample(clue("var(--danger)", 0.8)), meaning: "a number that's passed or can't be reached any more" },
    ...focusLegend("the cell it draws in", "the cell whose corner holds the number", "other cells it mentions"),
  ];
}

export function slantView(board: BoardPrefs): View<SlantPuzzle, SlantState, SlantAction, SlantInteraction, typeof settings> {
  return {
    id: "slant.svg",
    name: "grid",
    puzzle: slant,
    settings,
    controls: [
      { how: "click or tap a cell", what: "draw \\, then /, then rub it out. drag to do the same to several" },
      { how: "right-click, or hold on a touch screen", what: "draw /, then \\, then rub it out" },
    ],
    legend: legend(),
    mount(root, { session, settings }) {
      style("kit", KIT_CSS);
      style("slant", CSS);
      const p = session.puzzle;
      const g = geometry(p);
      const f = frame(root, p, "slant-board", "slant", board, { top: 0.4, right: 0.4, bottom: 0.4, left: 0.4 });
      const fade = fades(f);
      const holders: SVGGElement[] = [];
      for (let c = 0; c < g.n; c++) {
        const cell = s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: "cell" });
        f.base.append(cell);
        f.anchor(c, cell);
        f.marks.append(holders[c] = s("g"));
      }
      const clueLayer = s("g");
      f.ghost.after(clueLayer);
      const clueEls = new Map<number, [SVGCircleElement, SVGTextElement]>();
      for (const pt of g.shown) {
        const circle = s("circle", { cx: f.px(pt), cy: f.py(pt), r: 2.6, class: "clue" });
        const text = s("text", { x: f.px(pt), y: f.py(pt) + 0.2, class: "clue-num" }, String(p.clues[pt]));
        clueLayer.append(circle, text);
        clueEls.set(pt, [circle, text]);
      }
      const placeCursor = cursorRect(f);
      let preview: SlantState | null = null;

      const drawLine = (el: Element, c: number, mark: number, bad: boolean) => {
        if (mark === NONE) return;
        const x = f.cx(c), y = f.cy(c), back = mark === SLASH_BACK;
        el.append(s("line", { x1: x + INSET, y1: y + (back ? INSET : SIZE - INSET), x2: x + SIZE - INSET, y2: y + (back ? SIZE - INSET : INSET), class: `line${bad ? " bad" : ""}` }));
      };

      const cycle = (m: number, kind: "primary" | "secondary"): Mark => {
        const order: Mark[] = kind === "primary" ? [NONE, SLASH_BACK, SLASH_FWD] : [NONE, SLASH_FWD, SLASH_BACK];
        return order[(order.indexOf(m as Mark) + 1) % 3]!;
      };

      const strokes = new Strokes(f, session, {
        editable: () => true,
        mark: (c) => session.state.marks[c]!,
        next: (c, kind) => cycle(session.state.marks[c]!, kind),
        commit: (cells, value) => void session.dispatch({ type: "set", cells, value: value as Mark }),
        redraw: () => render(),
        holdMs: () => settings.longPressMs as number,
      });

      const render = () => {
        const shown = strokes.shown(session.state.marks);
        const bad = session.derived()[CONFLICTS_KEY] as SlantConflicts | undefined;
        const loops = new Set(bad?.loops), badClues = new Set(bad?.clues);
        for (let c = 0; c < g.n; c++) {
          const h = holders[c]!;
          while (h.firstChild) h.firstChild.remove();
          drawLine(h, c, shown[c]!, loops.has(c));
        }
        for (const [pt, [circle, text]] of clueEls) {
          const cells = g.around[pt]!;
          const have = cells.filter((a) => shown[a.cell] !== NONE && (shown[a.cell] === SLASH_FWD ? 1 : 0) === a.value).length;
          const full = cells.every((a) => shown[a.cell] !== NONE);
          circle.classList.toggle("bad", badClues.has(pt));
          text.classList.toggle("bad", badClues.has(pt));
          circle.classList.toggle("done", !badClues.has(pt) && full && have === p.clues[pt]);
        }
        while (f.ghost.firstChild) f.ghost.firstChild.remove();
        fade.clear();
        if (preview) for (let c = 0; c < g.n; c++) if (preview.marks[c] !== shown[c]) { if (shown[c]) fade.cell(c); drawLine(f.ghost, c, preview.marks[c]!, false); }
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

      const set = (value: (m: number) => Mark) => () => {
        const c = session.interaction.cursor;
        session.dispatch({ type: "set", cells: [c], value: value(session.state.marks[c]!) });
      };
      const commands = bindCommands(BINDINGS, {
        "slant.cycle": set((m) => cycle(m, "primary")),
        "slant.cycle-back": set((m) => cycle(m, "secondary")),
        "slant.back": set(() => SLASH_BACK),
        "slant.fwd": set(() => SLASH_FWD),
        "slant.clear": set(() => NONE),
        ...cursorHandlers("slant", p, session),
      }, {
        "slant.cycle": { menu: "board" },
        "slant.cycle-back": { menu: "board" },
        "slant.back": { menu: "board" },
        "slant.fwd": { menu: "board" },
        "slant.clear": { menu: "board" },
      });
      return {
        gestures: { secondaryClick: true, hold: true, labels: ["cycle", "cycle back"] },
        aspect: f.aspect,
        cells: { cols: p.w + 1, rows: p.h + 1 },
        commands,
        target: () => strokes.target(),
        preview: (st) => {
          preview = st as SlantState | null;
          render();
        },
        locate: (focus) => f.rects([...focusCells(focus), ...((focus as Focus | undefined)?.points ?? []).map((pt) => pointCell(p, pt))]),
        locateChange: (a, b) => {
          const x = (a as SlantState).marks, y = (b as SlantState).marks;
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
