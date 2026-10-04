import { bindCommands, type BindingSchema } from "../../core/commands";
import { s, style } from "../../core/dom";
import { defineSchema } from "../../core/schema";
import type { View } from "../../core/types";
import type { Focus } from "../grid-kit/names";
import {
  KIT_CSS, SIZE, Strokes, cursorBindings, cursorHandlers, cursorRect, drawFocus, focusCells, frame,
  type BoardPrefs,
} from "../grid-kit/view";
import { BLACK, DOT, NONE, type Mark, type ShadeAction, type ShadeInteraction, type ShadeState } from "./state";

/** How a BLACK mark is drawn: a filled cell, or a symbol on the cell. */
export type Glyph = "fill" | "star" | "crown";

/** What a view flags, already split by how it is drawn. */
export interface Flags {
  /** BLACK marks drawn in the danger colour. */
  marks: Set<number>;
  /** Cell texts drawn in the danger colour. */
  texts: Set<number>;
  /** Cells tinted with the soft danger colour. */
  cells: Set<number>;
}

export const NO_FLAGS: Flags = { marks: new Set(), texts: new Set(), cells: new Set() };

export interface ShadeViewSpec<Pz extends { w: number; h: number }> {
  /** Puzzle id; also the command and CSS class prefix. */
  puzzle: string;
  /** Text naming a BLACK mark in commands and controls ("shade", "star", "queen"). */
  shadeWord: string;
  glyph: Glyph;
  /** Cells that never take marks (e.g. numbered cells). */
  fixed(p: Pz, c: number): boolean;
  /** Region per cell; thick borders are drawn between different regions. */
  regions?(p: Pz): readonly number[];
  /** Background colour per region (a CSS colour), or null for plain cells. */
  tint?(p: Pz, region: number): string | null;
  /** Text drawn in a cell, centred or in its top-left corner. */
  text?(p: Pz, c: number): { text: string; corner: boolean } | null;
  /** Derived key under which a plugin stores conflicts, and how to read them. */
  flags?: { key: string; read(conflicts: unknown): Flags };
  legend: View["legend"];
}

const CSS = `
.shade-board .txt { fill: var(--text); font: 600 5.6px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.shade-board .txt.corner { font-size: 3.4px; text-anchor: start; dominant-baseline: hanging; }
.shade-board .txt.bad { fill: var(--danger); }
.shade-board .shade { fill: var(--text); }
.shade-board .shade.bad { fill: var(--danger); }
.shade-board .sym { fill: var(--text); }
.shade-board .sym.bad { fill: var(--danger); }
.shade-board .dot { fill: var(--text-dim); }
.shade-board .soft { fill: var(--danger-soft); }
.shade-board .wall { stroke: var(--text); stroke-width: 0.9; stroke-linecap: round; }
.shade-board .rim { fill: none; stroke: var(--text); stroke-width: 0.9; }
`;

/** Five-point star centred in a cell box at (x, y). */
export function starPath(x: number, y: number, r = 3.4): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.42 : r;
    pts.push(`${(x + SIZE / 2 + rr * Math.cos(a)).toFixed(2)},${(y + SIZE / 2 + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

/** Crown centred in a cell box at (x, y). */
export function crownPath(x: number, y: number): string {
  const p = (dx: number, dy: number) => `${(x + dx).toFixed(2)},${(y + dy).toFixed(2)}`;
  return `M${p(2, 7.4)}L${p(2.2, 3.2)}L${p(3.8, 5)}L${p(5, 2.4)}L${p(6.2, 5)}L${p(7.8, 3.2)}L${p(8, 7.4)}Z`;
}

const settings = defineSchema({
  longPressMs: { type: "int", label: "touch hold for a dot (ms)", default: 400, min: 150, max: 1500, step: 50 },
});

/** A board of cells that are marked BLACK or DOT, with optional regions, region colours and cell texts. */
export function shadeView<Pz extends { w: number; h: number }>(spec: ShadeViewSpec<Pz>, board: BoardPrefs): View<Pz, ShadeState, ShadeAction, ShadeInteraction> {
  const id = spec.puzzle, word = spec.shadeWord;
  const BINDINGS: BindingSchema = {
    [`${id}.shade`]: { label: `${word} on / off`, category: id, keys: ["space", "b"], description: `${word} the selected cell, or take it away` },
    [`${id}.dot`]: { label: "dot on / off", category: id, keys: ["Enter", "period"], description: `put a dot on the selected cell: your note that it gets no ${word}. press again to remove it` },
    [`${id}.clear`]: { label: "clear cell", category: id, keys: ["Backspace", "Delete"], description: `remove the ${word} or dot from the selected cell` },
    ...cursorBindings(id, id),
  };
  return {
    id: `${id}.svg`,
    name: "grid",
    puzzle: id,
    settings,
    controls: [
      { how: "click or tap a cell", what: `${word} it, or take it away. drag to do several` },
      { how: "right-click, or hold on a touch screen", what: `put a dot there (no ${word}), or take it away. keep holding and drag to do several` },
    ],
    legend: spec.legend,
    mount(root, { session, settings }) {
      style("kit", KIT_CSS);
      style("shade-kit", CSS);
      const p = session.puzzle;
      const n = p.w * p.h;
      const f = frame(root, p, `shade-board ${id}-board`, id, board);
      const regions = spec.regions?.(p);
      const holders: SVGGElement[] = [];
      const texts: (SVGTextElement | undefined)[] = [];
      for (let c = 0; c < n; c++) {
        const tint = regions && spec.tint ? spec.tint(p, regions[c]!) : null;
        const cell = s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: "cell", ...(tint ? { style: `fill: ${tint}` } : {}) });
        f.base.append(cell);
        f.anchor(c, cell);
        f.marks.append(holders[c] = s("g"));
        const t = spec.text?.(p, c);
        if (t) {
          texts[c] = t.corner
            ? s("text", { x: f.cx(c) + 0.8, y: f.cy(c) + 0.7, class: "txt corner" }, t.text)
            : s("text", { x: f.cx(c) + SIZE / 2, y: f.cy(c) + SIZE / 2 + 0.3, class: "txt" }, t.text);
          f.base.append(texts[c]!);
        }
      }
      if (regions) {
        const walls = s("g");
        for (let c = 0; c < n; c++) {
          const x = c % p.w;
          if (x < p.w - 1 && regions[c] !== regions[c + 1]) walls.append(s("line", { x1: f.cx(c + 1), y1: f.cy(c), x2: f.cx(c + 1), y2: f.cy(c) + SIZE, class: "wall" }));
          if (c + p.w < n && regions[c] !== regions[c + p.w]) walls.append(s("line", { x1: f.cx(c), y1: f.cy(c + p.w), x2: f.cx(c) + SIZE, y2: f.cy(c + p.w), class: "wall" }));
        }
        f.marks.before(walls);
        f.over.before(s("rect", { x: 0, y: 0, width: p.w * SIZE, height: p.h * SIZE, class: "rim" }));
      }
      const placeCursor = cursorRect(f);
      let preview: ShadeState | null = null;

      const drawMark = (el: Element, c: number, mark: number, bad: boolean) => {
        const x = f.cx(c), y = f.cy(c), cls = bad ? " bad" : "";
        if (mark === BLACK) {
          if (spec.glyph === "fill") el.append(s("rect", { x, y, width: SIZE, height: SIZE, class: `shade${cls}` }));
          else el.append(s("path", { d: spec.glyph === "star" ? starPath(x, y) : crownPath(x, y), class: `sym${cls}` }));
        } else if (mark === DOT) el.append(s("circle", { cx: x + SIZE / 2, cy: y + SIZE / 2, r: 1, class: "dot" }));
      };

      const strokes = new Strokes(f, session, {
        editable: (c) => !spec.fixed(p, c),
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
        const fl = spec.flags ? spec.flags.read(session.derived()[spec.flags.key]) : NO_FLAGS;
        for (let c = 0; c < n; c++) {
          const h = holders[c]!;
          while (h.firstChild) h.firstChild.remove();
          if (fl.cells.has(c) && !(spec.glyph === "fill" && shown[c] === BLACK)) h.append(s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: "soft" }));
          drawMark(h, c, shown[c]!, fl.marks.has(c));
          texts[c]?.classList.toggle("bad", fl.texts.has(c));
        }
        while (f.ghost.firstChild) f.ghost.firstChild.remove();
        if (preview) for (let c = 0; c < n; c++) if (preview.marks[c] !== shown[c]) drawMark(f.ghost, c, preview.marks[c]!, false);
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
        if (!spec.fixed(p, c)) session.dispatch({ type: "set", cells: [c], value: value(session.state.marks[c]!) });
      };
      const commands = bindCommands(BINDINGS, {
        [`${id}.shade`]: atCursor((m) => (m === BLACK ? NONE : BLACK)),
        [`${id}.dot`]: atCursor((m) => (m === DOT ? NONE : DOT)),
        [`${id}.clear`]: atCursor(() => NONE),
        ...cursorHandlers(id, p, session),
      }, {
        [`${id}.shade`]: { menu: "board" },
        [`${id}.dot`]: { menu: "board" },
        [`${id}.clear`]: { menu: "board" },
      });
      return {
        gestures: { secondaryClick: true, hold: true },
        aspect: f.aspect,
        cells: { cols: p.w, rows: p.h },
        commands,
        target: () => strokes.target(),
        preview: (st) => {
          preview = st as ShadeState | null;
          render();
        },
        locate: (focus) => f.rects(focusCells(focus)),
        locateChange: (a, b) => {
          const x = (a as ShadeState).marks, y = (b as ShadeState).marks;
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
