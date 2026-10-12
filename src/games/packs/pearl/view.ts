import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { s, style, inputIs } from "../../core/dom";
import { buttonsSwapped, secondary } from "../../core/gestures";
import { defineSchema } from "../../core/schema";
import type { CommandDef, View } from "../../core/types";
import { DOWN, LEFT, RIGHT, UP, edgeAt, edgeGrid, step } from "../../lib/edges";
import { pearl, CROSS, LINE, NONE, toggle, type Conflicts, type PearlAction, type PearlFocus, type PearlInteraction, type PearlPuzzle, type PearlState } from "./logic";
import { BLACK, WHITE } from "./solver";
import type { PearlTarget } from "./techniques";
import { CAST_BAND, sideAt } from "../../lib/edge-hit";

/** Derived: Conflicts to flag on the board. */
export const CONFLICTS_KEY = "pearl.conflicts";

const CSS = `
.pearl-board { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.pearl-board .cell { fill: var(--cell); stroke: var(--border); stroke-width: 0.25; }
.pearl-board .cell.bad { fill: var(--danger-soft); }
.pearl-board .pearl { stroke: var(--text); stroke-width: 0.6; pointer-events: none; }
.pearl-board .pearl.black { fill: var(--text); }
.pearl-board .pearl.white { fill: var(--cell); }
.pearl-board .pearl.bad { stroke: var(--danger); stroke-width: 1; }
.pearl-board .pearl.black.bad { fill: var(--danger); }
.pearl-board .line { stroke: var(--accent); stroke-width: 1.6; stroke-linecap: round; pointer-events: none; }
.pearl-board .faded { opacity: 0.25; }
.pearl-board .line.loop-bad { stroke: var(--danger); }
.pearl-board .line.preview { stroke: var(--hint); opacity: 0.6; }
.pearl-board .cross { stroke: var(--text-dim); stroke-width: 0.5; stroke-linecap: round; pointer-events: none; }
.pearl-board .cross.preview { stroke: var(--hint); }
.pearl-board .focus { fill: none; stroke: var(--hint); stroke-width: 0.9; pointer-events: none; }
.pearl-board .focus.why { stroke-dasharray: 1.2 0.8; stroke-width: 0.6; }
.pearl-board .focus-edge { stroke: var(--hint); stroke-width: 3; stroke-linecap: round; opacity: 0.45; pointer-events: none; }
.pearl-board .cast-mark { display: none; fill: none; stroke: var(--cast); stroke-width: 0.8; stroke-linecap: round; pointer-events: none; }
[data-casting] .pearl-board .cast-mark { display: inline; }
.pearl-board .labels text { fill: var(--text-dim); font: 500 3.6px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.pearl-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
${inputIs("pointer")} .pearl-board .cursor { display: none; }
`;

const settings = defineSchema({
  longPressMs: { type: "int", label: "touch long-press for a cross (ms)", default: 400, min: 150, max: 1500, step: 50 },
});

const SIZE = 10;
const PAD = 0.25;
const LABEL = 6;

const BINDINGS = {
  "pearl.line-up": { label: "line up", category: "pearl", keys: ["shift+ArrowUp", "shift+w"], description: "draw (or erase) the loop from the selected cell upwards, and move there" },
  "pearl.line-right": { label: "line right", category: "pearl", keys: ["shift+ArrowRight", "shift+d"], description: "draw (or erase) the loop to the right, and move there" },
  "pearl.line-down": { label: "line down", category: "pearl", keys: ["shift+ArrowDown", "shift+s"], description: "draw (or erase) the loop downwards, and move there" },
  "pearl.line-left": { label: "line left", category: "pearl", keys: ["shift+ArrowLeft", "shift+a"], description: "draw (or erase) the loop to the left, and move there" },
  "pearl.cross-up": { label: "cross up", category: "pearl", keys: ["alt+ArrowUp"], description: "mark the edge above the selected cell with a cross (the loop doesn't go there), or remove it" },
  "pearl.cross-right": { label: "cross right", category: "pearl", keys: ["alt+ArrowRight"], description: "cross off the edge to the right, or remove the cross" },
  "pearl.cross-down": { label: "cross down", category: "pearl", keys: ["alt+ArrowDown"], description: "cross off the edge below, or remove the cross" },
  "pearl.cross-left": { label: "cross left", category: "pearl", keys: ["alt+ArrowLeft"], description: "cross off the edge to the left, or remove the cross" },
  "pearl.left": { label: "cursor left", category: "pearl", keys: ["ArrowLeft", "a"] },
  "pearl.right": { label: "cursor right", category: "pearl", keys: ["ArrowRight", "d"] },
  "pearl.up": { label: "cursor up", category: "pearl", keys: ["ArrowUp", "w"] },
  "pearl.down": { label: "cursor down", category: "pearl", keys: ["ArrowDown", "s"] },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

export type Side = "top" | "right" | "bottom" | "left";
export type Board = { labelSides(): Set<Side>; colName(col: number): string; rowName(row: number): string };

function legend(): { sample: string; meaning: string }[] {
  const svg = (body: string, w = 10) => `<svg viewBox="-0.5 -0.5 ${w + 1} 11">${body}</svg>`;
  const cell = (x = 0, fill = "var(--cell)") => `<rect x="${x}" width="10" height="10" fill="${fill}" stroke="var(--border)" stroke-width="0.25"/>`;
  const pearl = (kind: "black" | "white", stroke = "var(--text)", fill?: string) =>
    `<circle cx="5" cy="5" r="3.2" fill="${fill ?? (kind === "black" ? "var(--text)" : "var(--cell)")}" stroke="${stroke}" stroke-width="0.6"/>`;
  const line = (stroke = "var(--accent)") => `<line x1="5" y1="5" x2="15" y2="5" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/>`;
  return [
    { sample: svg(cell() + pearl("black")), meaning: "a black pearl: the loop turns here and goes straight through the next cell each way" },
    { sample: svg(cell() + pearl("white")), meaning: "a white pearl: the loop goes straight through, and turns just before or after" },
    { sample: svg(cell(0) + cell(10) + line(), 20), meaning: "the loop between two cells" },
    { sample: svg(cell(0) + cell(10) + `<path d="M9 4l2 2M11 4l-2 2" stroke="var(--text-dim)" stroke-width="0.5" stroke-linecap="round"/>`, 20), meaning: "a cross: your note that the loop doesn't go this way" },
    { sample: svg(cell() + `<circle cx="5" cy="5" r="3.2" fill="var(--cell)" stroke="var(--danger)" stroke-width="1"/>`), meaning: "a pearl the drawn loop breaks" },
    { sample: svg(cell(0, "var(--danger-soft)")), meaning: "a cell the loop can't pass like that (three lines, or a dead end)" },
    { sample: svg(cell(0) + cell(10) + line("var(--danger)"), 20), meaning: "a closed loop that isn't the whole answer" },
    { sample: svg(cell(0) + cell(10) + `<line x1="5" y1="5" x2="15" y2="5" stroke="var(--hint)" stroke-width="3" stroke-linecap="round" opacity="0.45"/>`, 20), meaning: "hint: the edges it changes" },
    { sample: svg(cell() + `<rect x="0.5" y="0.5" width="9" height="9" rx="1" fill="none" stroke="var(--hint)" stroke-width="0.6" stroke-dasharray="1.2 0.8"/>`), meaning: "hint: the reason" },
    { sample: svg(cell() + `<rect x="0.3" y="0.3" width="9.4" height="9.4" rx="1" fill="none" stroke="var(--focus)" stroke-width="0.6"/>`), meaning: "the keyboard selection (shown while using the keyboard)" },
  ];
}

export function pearlView(board: Board): View<PearlPuzzle, PearlState, PearlAction, PearlInteraction, typeof settings> {
  return {
    id: "pearl.svg",
    name: "grid",
    puzzle: pearl,
    settings,
    controls: [
      { how: "drag from cell to cell", what: "draw the loop (dragging over a line you drew erases it)" },
      { how: "click or tap near the side of a cell", what: "draw or erase the line across that side" },
      { how: "right-click near the side of a cell, or hold on a touch screen", what: "put a cross there (the loop doesn't go this way), or take it away" },
    ],
    legend: legend(),
    mount(root, { session, settings }) {
      style("pearl", CSS);
      const p = session.puzzle;
      const g = edgeGrid(p.w, p.h);
      const sides = board.labelSides();
      const m = (side: Side) => (sides.has(side) ? LABEL : PAD);
      const vbW = p.w * SIZE + m("left") + m("right"), vbH = p.h * SIZE + m("top") + m("bottom");
      const svg = s("svg", { viewBox: `${-m("left")} ${-m("top")} ${vbW} ${vbH}`, class: "pearl-board", role: "grid", "aria-label": `pearl, ${p.w} by ${p.h}` });
      const labels = s("g", { class: "labels" });
      for (let x = 0; x < p.w; x++) {
        if (sides.has("top")) labels.append(s("text", { x: x * SIZE + SIZE / 2, y: -LABEL / 2 }, board.colName(x)));
        if (sides.has("bottom")) labels.append(s("text", { x: x * SIZE + SIZE / 2, y: p.h * SIZE + LABEL / 2 }, board.colName(x)));
      }
      for (let y = 0; y < p.h; y++) {
        if (sides.has("left")) labels.append(s("text", { x: -LABEL / 2, y: y * SIZE + SIZE / 2 }, board.rowName(y)));
        if (sides.has("right")) labels.append(s("text", { x: p.w * SIZE + LABEL / 2, y: y * SIZE + SIZE / 2 }, board.rowName(y)));
      }
      const base = s("g"), linesL = s("g"), pearlsL = s("g"), over = s("g");
      const cursor = s("rect", { width: SIZE - 0.6, height: SIZE - 0.6, rx: 1, class: "cursor" });
      const castMark = s("path", { class: "cast-mark" });
      svg.append(labels, base, linesL, pearlsL, over, cursor, castMark);
      root.append(svg);

      const cx = (c: number) => (c % p.w) * SIZE + SIZE / 2;
      const cy = (c: number) => Math.floor(c / p.w) * SIZE + SIZE / 2;
      const tiles: SVGRectElement[] = [];
      const pearls: (SVGCircleElement | null)[] = [];
      for (let c = 0; c < g.n; c++) {
        base.append(tiles[c] = s("rect", { x: cx(c) - SIZE / 2, y: cy(c) - SIZE / 2, width: SIZE, height: SIZE, class: "cell" }));
        pearls[c] = null;
        if (p.pearls[c] === BLACK || p.pearls[c] === WHITE) {
          pearlsL.append(pearls[c] = s("circle", { cx: cx(c), cy: cy(c), r: 3.2, class: `pearl ${p.pearls[c] === BLACK ? "black" : "white"}` }));
        }
      }
      const mid = (e: number) => [(cx(g.ea[e]!) + cx(g.eb[e]!)) / 2, (cy(g.ea[e]!) + cy(g.eb[e]!)) / 2] as const;

      let preview: PearlState | null = null;
      /** Where the pointer last was over the board (a pointerdown, or a mouse move), or null off it. */
      let last: { clientX: number; clientY: number } | null = null;

      const render = () => {
        const st = session.state;
        const conf = session.derived()[CONFLICTS_KEY] as Conflicts | undefined;
        const badCells = new Set(conf?.cells), badPearls = new Set(conf?.pearls), badLoop = new Set(conf?.loop);
        for (let c = 0; c < g.n; c++) {
          tiles[c]!.classList.toggle("bad", badCells.has(c));
          pearls[c]?.classList.toggle("bad", badPearls.has(c));
        }
        while (linesL.firstChild) linesL.firstChild.remove();
        const drawEdge = (e: number, v: number, extra = "") => {
          if (v === LINE) {
            const bad = badLoop.has(g.ea[e]!) && badLoop.has(g.eb[e]!);
            linesL.append(s("line", { x1: cx(g.ea[e]!), y1: cy(g.ea[e]!), x2: cx(g.eb[e]!), y2: cy(g.eb[e]!), class: `line${bad ? " loop-bad" : ""}${extra}` }));
          } else if (v === CROSS) {
            const [x, y] = mid(e);
            linesL.append(s("path", { d: `M${x - 1} ${y - 1}l2 2M${x + 1} ${y - 1}l-2 2`, class: `cross${extra}` }));
          }
        };
        for (let e = 0; e < g.ne; e++) {
          const changed = !!preview && preview.edges[e] !== st.edges[e];
          drawEdge(e, st.edges[e]!, changed ? " faded" : "");
          if (changed) drawEdge(e, preview!.edges[e]!, " preview");
        }
        while (over.firstChild) over.firstChild.remove();
        const focus = session.activeHint?.focus as PearlFocus | undefined;
        if (focus) {
          for (const c of focus.because ?? []) over.append(s("rect", { x: cx(c) - SIZE / 2 + 0.5, y: cy(c) - SIZE / 2 + 0.5, width: SIZE - 1, height: SIZE - 1, rx: 1, class: "focus why" }));
          for (const e of focus.edges ?? []) over.append(s("line", { x1: cx(g.ea[e]!), y1: cy(g.ea[e]!), x2: cx(g.eb[e]!), y2: cy(g.eb[e]!), class: "focus-edge" }));
        }
        const cur = session.interaction.cursor;
        cursor.setAttribute("x", String(cx(cur) - SIZE / 2 + 0.3));
        cursor.setAttribute("y", String(cy(cur) - SIZE / 2 + 0.3));
        showCast();
      };

      /** The cell under the pointer, the edge of it nearest the pointer, and the pointer's offset in the cell (shares of its size). */
      const pointAt = (e: { clientX: number; clientY: number }): { cell: number; edge: number; fx: number; fy: number } => {
        const mtx = svg.getScreenCTM();
        if (!mtx) return { cell: -1, edge: -1, fx: 0, fy: 0 };
        const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(mtx.inverse());
        const x = Math.floor(pt.x / SIZE), y = Math.floor(pt.y / SIZE);
        if (x < 0 || y < 0 || x >= p.w || y >= p.h) return { cell: -1, edge: -1, fx: 0, fy: 0 };
        const cell = y * p.w + x;
        const dx = pt.x - (x * SIZE + SIZE / 2), dy = pt.y - (y * SIZE + SIZE / 2);
        const d = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? LEFT : RIGHT) : (dy < 0 ? UP : DOWN);
        return { cell, edge: edgeAt(g, cell, d), fx: pt.x / SIZE - x, fy: pt.y / SIZE - y };
      };
      /** What the pointer points at: an edge or a cell, with the casting band while a technique is picked; the cursor cell off the board. */
      const pointed = (): PearlTarget => {
        const at = last && pointAt(last);
        if (!at || at.cell < 0) return { cell: session.interaction.cursor };
        if (svg.closest("[data-casting]")) {
          const d = sideAt(at.fx, at.fy, CAST_BAND, (side) => edgeAt(g, at.cell, side) >= 0);
          return d < 0 ? { cell: at.cell } : { edge: edgeAt(g, at.cell, d) };
        }
        return at.edge >= 0 ? { edge: at.edge } : { cell: at.cell };
      };
      function showCast(): void {
        const t = pointed();
        if ("edge" in t) {
          const a = g.ea[t.edge]!, b = g.eb[t.edge]!;
          castMark.setAttribute("d", `M${cx(a)} ${cy(a)}L${cx(b)} ${cy(b)}`);
        } else {
          const x = cx(t.cell) - SIZE / 2 + 0.6, y = cy(t.cell) - SIZE / 2 + 0.6, w = SIZE - 1.2;
          castMark.setAttribute("d", `M${x} ${y}h${w}v${w}h${-w}z`);
        }
      }

      let drag: { pointerId: number; from: number; mode: number | null; moved: boolean; edge: number; sec: boolean; touch: boolean; drawn: number } | null = null;
      let pressTimer = 0;
      const cancelPress = () => { clearTimeout(pressTimer); pressTimer = 0; };
      const onContext = (e: Event) => e.preventDefault();
      const onDown = (e: PointerEvent) => {
        const at = pointAt(e);
        if (at.cell < 0 || drag) return;
        last = { clientX: e.clientX, clientY: e.clientY };
        showCast();
        e.preventDefault();
        session.setInteraction((i) => ({ ...i, cursor: at.cell }));
        if (session.locked) return;
        svg.setPointerCapture?.(e.pointerId);
        drag = { pointerId: e.pointerId, from: at.cell, mode: null, moved: false, edge: at.edge, sec: secondary(e, session.def.id), touch: e.pointerType === "touch", drawn: 0 };
        if (drag.touch && at.edge >= 0) {
          pressTimer = window.setTimeout(() => {
            pressTimer = 0;
            if (!drag || drag.moved) return;
            navigator.vibrate?.(15);
            session.dispatch(toggle(session.state, drag.edge, buttonsSwapped(session.def.id) ? LINE : CROSS));
            drag = null;
          }, settings.longPressMs as number);
        }
      };
      const onMove = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointerId) {
          if (e.pointerType !== "touch") {
            last = { clientX: e.clientX, clientY: e.clientY };
            showCast();
          }
          return;
        }
        const at = pointAt(e);
        if (at.cell < 0 || at.cell === drag.from || (drag.sec && !drag.touch)) return;
        let edge = -1;
        for (let d = 0; d < 4; d++) if (step(g, drag.from, d) === at.cell) edge = edgeAt(g, drag.from, d);
        if (edge < 0) return;
        cancelPress();
        drag.moved = true;
        if (drag.mode === null) drag.mode = session.state.edges[edge] === LINE ? NONE : LINE;
        if (session.dispatch({ type: "set", edges: [edge], value: drag.mode }, { extend: drag.drawn > 0 })) drag.drawn++;
        drag.from = at.cell;
        session.setInteraction((i) => ({ ...i, cursor: at.cell }));
      };
      const onUp = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const d = drag;
        drag = null;
        const pending = pressTimer !== 0;
        cancelPress();
        if (d.moved || d.edge < 0) return;
        if (d.touch && !pending) return;
        session.dispatch(toggle(session.state, d.edge, d.sec ? CROSS : LINE));
      };
      const onCancel = (e: PointerEvent) => {
        if (drag && e.pointerId === drag.pointerId) drag = null;
        cancelPress();
      };
      svg.addEventListener("contextmenu", onContext);
      svg.addEventListener("pointerdown", onDown);
      svg.addEventListener("pointermove", onMove);
      svg.addEventListener("pointerup", onUp);
      svg.addEventListener("pointercancel", onCancel);
      // a lifted finger leaves the board, but the spot it pressed stays the one a cast aims at
      svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "touch") return; last = null; showCast(); });

      const move = (dx: number, dy: number) => () => session.setInteraction((i) => {
        const x = Math.min(p.w - 1, Math.max(0, (i.cursor % p.w) + dx));
        const y = Math.min(p.h - 1, Math.max(0, Math.floor(i.cursor / p.w) + dy));
        return { ...i, cursor: y * p.w + x };
      });
      const lineTo = (d: number) => () => {
        const c = session.interaction.cursor;
        const e = edgeAt(g, c, d);
        if (e < 0) return;
        session.dispatch(toggle(session.state, e, LINE));
        session.setInteraction((i) => ({ ...i, cursor: step(g, c, d) }));
      };
      const crossAt = (d: number) => () => {
        const e = edgeAt(g, session.interaction.cursor, d);
        if (e >= 0) session.dispatch(toggle(session.state, e, CROSS));
      };

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(() => {
          if (session.locked) { drag = null; cancelPress(); }
          render();
        }, { owner: "view" }),
      ];
      render();

      const rects = (cells: Iterable<number>) => [...new Set(cells)].map((c) => tiles[c]!.getBoundingClientRect());
      const commands: CommandDef[] = bindCommands(BINDINGS, {
        "pearl.line-up": lineTo(UP),
        "pearl.line-right": lineTo(RIGHT),
        "pearl.line-down": lineTo(DOWN),
        "pearl.line-left": lineTo(LEFT),
        "pearl.cross-up": crossAt(UP),
        "pearl.cross-right": crossAt(RIGHT),
        "pearl.cross-down": crossAt(DOWN),
        "pearl.cross-left": crossAt(LEFT),
        "pearl.left": move(-1, 0),
        "pearl.right": move(1, 0),
        "pearl.up": move(0, -1),
        "pearl.down": move(0, 1),
      }, {
        "pearl.line-up": { menu: "board" },
        "pearl.line-right": { menu: "board" },
        "pearl.line-down": { menu: "board" },
        "pearl.line-left": { menu: "board" },
        "pearl.cross-up": { menu: "board" },
        "pearl.cross-right": { menu: "board" },
        "pearl.cross-down": { menu: "board" },
        "pearl.cross-left": { menu: "board" },
      });
      return {
        gestures: { secondaryClick: true, hold: true, labels: ["line", "cross"] },
        aspect: vbW / vbH,
        cells: { cols: p.w, rows: p.h },
        commands,
        target: pointed,
        preview: (st) => {
          preview = st as PearlState | null;
          render();
        },
        locate: (focus) => {
          const f = focus as PearlFocus | undefined;
          return f ? rects([...(f.edges ?? []).flatMap((e) => [g.ea[e]!, g.eb[e]!]), ...(f.because ?? [])]) : [];
        },
        locateChange: (a, b) => {
          const x = (a as PearlState).edges, y = (b as PearlState).edges;
          const cells: number[] = [];
          x.forEach((v, e) => { if (v !== y[e]) cells.push(g.ea[e]!, g.eb[e]!); });
          return rects(cells);
        },
        destroy() {
          cancelPress();
          offs.forEach((f) => f());
          svg.remove();
        },
      };
    },
  };
}
