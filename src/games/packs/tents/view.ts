import { bindCommands, type BindingSchema } from "../../core/commands";
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
  GRASS, NONE, TENT, TREE, geometry, lineTarget,
  type Mark, type TentsAction, type TentsConflicts, type TentsInteraction, type TentsPuzzle, type TentsState,
} from "./logic";

/** Derived: TentsConflicts to flag on the board. */
export const CONFLICTS_KEY = "tents.conflicts";

const CSS = `
.tents-board .canopy { fill: var(--accent); }
.tents-board .trunk { fill: var(--text-dim); }
.tents-board .canopy.bad { fill: var(--danger); }
.tents-board .tent { fill: var(--text); }
.tents-board .tent.bad { fill: var(--danger); }
.tents-board .grass { fill: var(--accent-soft); }
.tents-board .clue { fill: var(--text); font: 600 5px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.tents-board .clue.done { opacity: var(--done-opacity); }
.tents-board .clue.bad { fill: var(--danger); }
`;

const settings = defineSchema({
  longPressMs: { type: "int", label: "touch hold for grass (ms)", default: 400, min: 150, max: 1500, step: 50 },
});

const BINDINGS: BindingSchema = {
  "tents.tent": { label: "tent on / off", category: "tents", keys: ["space", "t"], description: "put a tent on the selected cell, or take it away" },
  "tents.grass": { label: "grass on / off", category: "tents", keys: ["Enter", "g"], description: "mark the selected cell as grass: your note that it has no tent. press again to remove it" },
  "tents.clear": { label: "clear cell", category: "tents", keys: ["Backspace", "Delete"], description: "remove the tent or grass from the selected cell" },
  ...cursorBindings("tents", "tents"),
};

const treeSvg = (x: number, y: number, bad = false) =>
  `<rect x="${x + 4.3}" y="${y + 5.5}" width="1.4" height="3.2" fill="var(--text-dim)"/><circle cx="${x + 5}" cy="${y + 4.3}" r="3" fill="${bad ? "var(--danger)" : "var(--accent)"}"/>`;
const tentSvg = (x: number, y: number, fill = "var(--text)") => `<path d="M${x + 5} ${y + 1.8} L${x + 8.6} ${y + 8.2} L${x + 1.4} ${y + 8.2} Z" fill="${fill}"/>`;

function legend(): { sample: string; meaning: string }[] {
  return [
    { sample: sample(sampleCell() + treeSvg(0, 0)), meaning: "a tree" },
    { sample: sample(sampleCell() + tentSvg(0, 0)), meaning: "a tent" },
    { sample: sample(sampleCell() + `<rect width="10" height="10" fill="var(--accent-soft)"/>`), meaning: "grass: your note that a cell has no tent" },
    { sample: sample(sampleCell() + tentSvg(0, 0, "var(--danger)")), meaning: "a tent touching another, or with no tree beside it" },
    { sample: sample(sampleCell() + treeSvg(0, 0, true)), meaning: "a tree with no spot left for its tent" },
    { sample: sample(`<text x="5" y="5.2" fill="var(--text)" font-size="5" font-weight="600" text-anchor="middle" dominant-baseline="central" font-family="var(--font)">2</text>`), meaning: "tents in that row or column (faded when met, red when it can't be)" },
    ...focusLegend("the cells it changes", "the tree or tent it comes from", "the line or spots it's about"),
  ];
}

export function tentsView(board: BoardPrefs): View<TentsPuzzle, TentsState, TentsAction, TentsInteraction> {
  return {
    id: "tents.svg",
    name: "grid",
    puzzle: "tents",
    settings,
    controls: [
      { how: "click or tap a cell", what: "put a tent there, or take it away. drag to do several" },
      { how: "right-click, or hold on a touch screen", what: "mark it as grass (no tent), or clear it. keep holding and drag to mark several" },
    ],
    legend: legend(),
    mount(root, { session, settings }) {
      style("kit", KIT_CSS);
      style("tents", CSS);
      const p = session.puzzle;
      const g = geometry(p);
      const f = frame(root, p, "tents-board", "tents", board, { top: 0, right: 1, bottom: 1, left: 0 });
      const fade = fades(f);
      const holders: SVGGElement[] = [];
      const trees = new Map<number, SVGCircleElement>();
      for (let c = 0; c < g.n; c++) {
        const cell = s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: "cell" });
        f.base.append(cell);
        f.anchor(c, cell);
        if (p.cells[c] === TREE) {
          f.base.append(s("rect", { x: f.cx(c) + 4.3, y: f.cy(c) + 5.5, width: 1.4, height: 3.2, class: "trunk" }));
          const canopy = s("circle", { cx: f.cx(c) + 5, cy: f.cy(c) + 4.3, r: 3, class: "canopy" });
          f.base.append(canopy);
          trees.set(c, canopy);
        }
        f.marks.append(holders[c] = s("g"));
      }
      const clues = g.lines.map((_, li) => {
        const x = li < p.h ? p.w * SIZE + SIZE / 2 : (li - p.h) * SIZE + SIZE / 2;
        const y = li < p.h ? li * SIZE + SIZE / 2 + 0.2 : p.h * SIZE + SIZE / 2 + 0.2;
        const el = s("text", { x, y, class: "clue" }, String(lineTarget(p, li)));
        f.base.append(el);
        return el;
      });
      const placeCursor = cursorRect(f);
      let preview: TentsState | null = null;

      const drawMark = (el: Element, c: number, mark: number, bad: boolean) => {
        if (mark === TENT) el.append(s("path", { d: `M${f.cx(c) + 5} ${f.cy(c) + 1.8} L${f.cx(c) + 8.6} ${f.cy(c) + 8.2} L${f.cx(c) + 1.4} ${f.cy(c) + 8.2} Z`, class: `tent${bad ? " bad" : ""}` }));
        else if (mark === GRASS) el.append(s("rect", { x: f.cx(c) + 0.15, y: f.cy(c) + 0.15, width: SIZE - 0.3, height: SIZE - 0.3, class: "grass" }));
      };

      const strokes = new Strokes(f, session, {
        editable: (c) => p.cells[c] !== TREE,
        mark: (c) => session.state.marks[c]!,
        next: (c, kind) => {
          const want = kind === "primary" ? TENT : GRASS;
          return session.state.marks[c] === want ? NONE : want;
        },
        commit: (cells, value) => void session.dispatch({ type: "set", cells, value: value as Mark }),
        redraw: () => render(),
        holdMs: () => settings.longPressMs as number,
      });

      const render = () => {
        const shown = strokes.shown(session.state.marks);
        const bad = session.derived()[CONFLICTS_KEY] as TentsConflicts | undefined;
        const badCells = new Set([...(bad?.touching ?? []), ...(bad?.lonely ?? [])]);
        const badLines = new Set(bad?.counts);
        for (let c = 0; c < g.n; c++) {
          const h = holders[c]!;
          while (h.firstChild) h.firstChild.remove();
          if (p.cells[c] !== TREE) drawMark(h, c, shown[c]!, badCells.has(c));
        }
        for (const [t, el] of trees) el.classList.toggle("bad", badCells.has(t));
        g.lines.forEach((line, li) => {
          const have = line.filter((c) => shown[c] === TENT).length;
          clues[li]!.classList.toggle("bad", badLines.has(li));
          clues[li]!.classList.toggle("done", !badLines.has(li) && have === lineTarget(p, li));
        });
        while (f.ghost.firstChild) f.ghost.firstChild.remove();
        fade.clear();
        if (preview) for (let c = 0; c < g.n; c++) if (preview.marks[c] !== shown[c]) { if (shown[c]) fade.cell(c); drawMark(f.ghost, c, preview.marks[c]!, false); }
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
        if (p.cells[c] !== TREE) session.dispatch({ type: "set", cells: [c], value: value(session.state.marks[c]!) });
      };
      const commands = bindCommands(BINDINGS, {
        "tents.tent": atCursor((m) => (m === TENT ? NONE : TENT)),
        "tents.grass": atCursor((m) => (m === GRASS ? NONE : GRASS)),
        "tents.clear": atCursor(() => NONE),
        ...cursorHandlers("tents", p, session),
      }, {
        "tents.tent": { menu: "board" },
        "tents.grass": { menu: "board" },
        "tents.clear": { menu: "board" },
      });
      return {
        gestures: { secondaryClick: true, hold: true },
        aspect: f.aspect,
        cells: { cols: p.w + 1, rows: p.h + 1 },
        commands,
        target: () => strokes.target(),
        preview: (st) => {
          preview = st as TentsState | null;
          render();
        },
        locate: (focus) => f.rects(focusCells(focus)),
        locateChange: (a, b) => {
          const x = (a as TentsState).marks, y = (b as TentsState).marks;
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
