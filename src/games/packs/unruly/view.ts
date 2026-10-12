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
  unruly, DARK, LIGHT, NONE, ONE, colours,
  type Mark, type UnrulyAction, type UnrulyConflicts, type UnrulyInteraction, type UnrulyPuzzle, type UnrulyState,
} from "./logic";

/** Derived: UnrulyConflicts to flag on the board. */
export const CONFLICTS_KEY = "unruly.conflicts";

const CSS = `
.unruly-board .cell.given { fill: var(--surface-2); }
.unruly-board .dark { fill: var(--text); }
.unruly-board .light { fill: var(--cell); stroke: var(--text); stroke-width: 1.1; }
.unruly-board .dark.bad { fill: var(--danger); }
.unruly-board .light.bad { stroke: var(--danger); }
.unruly-board .warn { fill: var(--danger-soft); }
`;

const settings = defineSchema({
  longPressMs: { type: "int", label: "touch hold for a light piece (ms)", default: 400, min: 150, max: 1500, step: 50 },
});

const BINDINGS = {
  "unruly.cycle": { label: "cycle dark / light / empty", category: "unruly", keys: ["space"], description: "the selected cell goes empty → dark → light → empty" },
  "unruly.cycle-back": { label: "cycle light / dark / empty", category: "unruly", keys: ["Enter"], description: "the selected cell goes empty → light → dark → empty" },
  "unruly.dark": { label: "dark piece", category: "unruly", keys: ["1"], description: "put a dark piece on the selected cell" },
  "unruly.light": { label: "light piece", category: "unruly", keys: ["0", "2"], description: "put a light piece on the selected cell" },
  "unruly.clear": { label: "clear cell", category: "unruly", keys: ["Backspace", "Delete"], description: "empty the selected cell" },
  ...cursorBindings("unruly", "unruly"),
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

const R = 3.4;

function legend(): { sample: string; meaning: string }[] {
  const dark = (fill = "var(--text)") => `<circle cx="5" cy="5" r="${R}" fill="${fill}"/>`;
  const light = (stroke = "var(--text)") => `<circle cx="5" cy="5" r="${R}" fill="var(--cell)" stroke="${stroke}" stroke-width="1.1"/>`;
  const given = `<rect width="10" height="10" fill="var(--surface-2)" stroke="var(--border)" stroke-width="0.25"/>`;
  return [
    { sample: sample(sampleCell()), meaning: "an empty cell" },
    { sample: sample(sampleCell() + dark()), meaning: "a dark piece" },
    { sample: sample(sampleCell() + light()), meaning: "a light piece" },
    { sample: sample(given + dark()), meaning: "a piece that came with the puzzle (shaded cell): it can't be changed" },
    { sample: sample(sampleCell() + dark("var(--danger)")), meaning: "part of three of a color in a row" },
    { sample: sample(sampleCell() + `<rect width="10" height="10" fill="var(--danger-soft)"/>` + light()), meaning: "a line with too many of one color, or two lines that are the same" },
    ...focusLegend("the cell it fills", "the pieces it comes from", "the line it's about"),
  ];
}

export function unrulyView(board: BoardPrefs): View<UnrulyPuzzle, UnrulyState, UnrulyAction, UnrulyInteraction, typeof settings> {
  return {
    id: "unruly.svg",
    name: "grid",
    puzzle: unruly,
    settings,
    controls: [
      { how: "click or tap an empty cell", what: "dark piece; again for light, again to empty it. drag to do the same to several" },
      { how: "right-click, or hold on a touch screen", what: "light piece first instead. keep holding and drag to do several" },
    ],
    legend: legend(),
    mount(root, { session, settings }) {
      style("kit", KIT_CSS);
      style("unruly", CSS);
      const p = session.puzzle;
      const n = p.w * p.h;
      const f = frame(root, p, "unruly-board", "unruly", board);
      const fade = fades(f);
      const warn: SVGRectElement[] = [];
      const holders: SVGGElement[] = [];
      for (let c = 0; c < n; c++) {
        const cell = s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: p.cells[c]! >= 0 ? "cell given" : "cell" });
        f.base.append(cell);
        f.anchor(c, cell);
        f.base.append(warn[c] = s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: "warn", visibility: "hidden" }));
        f.marks.append(holders[c] = s("g"));
      }
      const placeCursor = cursorRect(f);
      let preview: UnrulyState | null = null;

      const piece = (g: Element, c: number, colour: number, bad: boolean) => {
        g.append(s("circle", { cx: f.cx(c) + SIZE / 2, cy: f.cy(c) + SIZE / 2, r: R, class: `${colour === ONE ? "dark" : "light"}${bad ? " bad" : ""}` }));
      };

      const cycle = (m: number, kind: "primary" | "secondary"): Mark => {
        const order: Mark[] = kind === "primary" ? [NONE, DARK, LIGHT] : [NONE, LIGHT, DARK];
        return order[(order.indexOf(m as Mark) + 1) % 3]!;
      };

      const strokes = new Strokes(f, session, {
        editable: (c) => p.cells[c] === -1,
        mark: (c) => session.state.marks[c]!,
        next: (c, kind) => cycle(session.state.marks[c]!, kind),
        commit: (cells, value) => void session.dispatch({ type: "set", cells, value: value as Mark }),
        redraw: () => render(),
        holdMs: () => settings.longPressMs,
      });

      const render = () => {
        const shown = strokes.shown(session.state.marks);
        const col = colours(p, shown);
        const bad = session.derived()[CONFLICTS_KEY] as UnrulyConflicts | undefined;
        const runs = new Set(bad?.runs), lines = new Set([...(bad?.counts ?? []), ...(bad?.repeats ?? [])]);
        for (let c = 0; c < n; c++) {
          const g = holders[c]!;
          while (g.firstChild) g.firstChild.remove();
          if (col[c]! >= 0) piece(g, c, col[c]!, runs.has(c));
          warn[c]!.setAttribute("visibility", lines.has(c) ? "visible" : "hidden");
        }
        while (f.ghost.firstChild) f.ghost.firstChild.remove();
        fade.clear();
        if (preview) {
          const pc = colours(p, preview.marks);
          for (let c = 0; c < n; c++) {
            if (pc[c] === col[c]) continue;
            if (col[c]! >= 0) fade.cell(c);
            if (pc[c]! >= 0) piece(f.ghost, c, pc[c]!, false);
          }
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

      const set = (value: (m: number) => Mark) => () => {
        const c = session.interaction.cursor;
        if (p.cells[c] === -1) session.dispatch({ type: "set", cells: [c], value: value(session.state.marks[c]!) });
      };
      const commands = bindCommands(BINDINGS, {
        "unruly.cycle": set((m) => cycle(m, "primary")),
        "unruly.cycle-back": set((m) => cycle(m, "secondary")),
        "unruly.dark": set(() => DARK),
        "unruly.light": set(() => LIGHT),
        "unruly.clear": set(() => NONE),
        ...cursorHandlers("unruly", p, session),
      }, {
        "unruly.cycle": { menu: "board" },
        "unruly.cycle-back": { menu: "board" },
        "unruly.dark": { menu: "board" },
        "unruly.light": { menu: "board" },
        "unruly.clear": { menu: "board" },
      });
      return {
        gestures: { secondaryClick: true, hold: true, labels: ["cycle", "cycle back"] },
        aspect: f.aspect,
        cells: { cols: p.w, rows: p.h },
        commands,
        target: () => strokes.target(),
        preview: (st) => {
          preview = st as UnrulyState | null;
          render();
        },
        locate: (focus) => f.rects(focusCells(focus)),
        locateChange: (a, b) => {
          const x = (a as UnrulyState).marks, y = (b as UnrulyState).marks;
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
