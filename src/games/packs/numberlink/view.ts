import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { s, style } from "../../core/dom";
import { buttonsSwapped, secondary } from "../../core/gestures";
import { defineSchema } from "../../core/schema";
import type { CommandDef, View } from "../../core/types";
import { DOWN, LEFT, RIGHT, UP, edgeAt, edgeGrid, otherEnd, pieces, step } from "../../lib/edges";
import type { Focus } from "../../lib/grid-kit/names";
import { KIT_CSS, SIZE, cursorBindings, cursorHandlers, cursorRect, drawFocus, focusCells, focusLegend, frame, sample, sampleCell, type BoardPrefs } from "../../lib/grid-kit/view";
import { numberlink, CROSS, LINE, NONE, lineColors, pairColor, type NumberlinkAction, type NumberlinkFocus, type NumberlinkInteraction, type NumberlinkPuzzle, type NumberlinkState } from "./logic";
import { CONFLICTS_KEY } from "./plugins";
import type { NumberlinkTarget } from "./techniques";

const CSS = `
.numberlink-board .tint { opacity: 0.22; pointer-events: none; }
.numberlink-board .bad { fill: var(--danger-soft); pointer-events: none; }
.numberlink-board .pipe { stroke-width: 3.2; stroke-linecap: round; fill: none; pointer-events: none; }
.numberlink-board .pipe.loose { stroke: var(--text-dim); }
.numberlink-board .pipe.mixed { stroke: var(--danger); }
.numberlink-board .dot { stroke: color-mix(in srgb, currentColor 40%, var(--text)); stroke-width: 0.4; pointer-events: none; }
.numberlink-board .num { font: 700 3.6px var(--font); text-anchor: middle; dominant-baseline: central; fill: rgb(0 0 0 / 0.7); pointer-events: none; }
.numberlink-board .faded { opacity: 0.2; }
.numberlink-board .cross { stroke: var(--text-dim); stroke-width: 0.5; stroke-linecap: round; pointer-events: none; }
.numberlink-board .focus-edge { stroke: var(--hint); stroke-width: 4.4; stroke-linecap: round; opacity: 0.45; pointer-events: none; }
`;

const settings = defineSchema({
  longPressMs: { type: "int", label: "touch hold for a cross (ms)", default: 400, min: 150, max: 1500, step: 50 },
});

const BINDINGS = {
  "numberlink.line-up": { label: "line up", category: "numberlink", keys: ["shift+ArrowUp", "shift+w"], description: "draw (or erase) the line from the selected cell upwards, and move there" },
  "numberlink.line-right": { label: "line right", category: "numberlink", keys: ["shift+ArrowRight", "shift+d"], description: "draw (or erase) the line to the right, and move there" },
  "numberlink.line-down": { label: "line down", category: "numberlink", keys: ["shift+ArrowDown", "shift+s"], description: "draw (or erase) the line downwards, and move there" },
  "numberlink.line-left": { label: "line left", category: "numberlink", keys: ["shift+ArrowLeft", "shift+a"], description: "draw (or erase) the line to the left, and move there" },
  "numberlink.cross-up": { label: "cross up", category: "numberlink", keys: ["alt+ArrowUp"], description: "cross off the edge above the selected cell (no line there), or remove the cross" },
  "numberlink.cross-right": { label: "cross right", category: "numberlink", keys: ["alt+ArrowRight"], description: "cross off the edge to the right, or remove the cross" },
  "numberlink.cross-down": { label: "cross down", category: "numberlink", keys: ["alt+ArrowDown"], description: "cross off the edge below, or remove the cross" },
  "numberlink.cross-left": { label: "cross left", category: "numberlink", keys: ["alt+ArrowLeft"], description: "cross off the edge to the left, or remove the cross" },
  "numberlink.clear-cell": { label: "clear cell", category: "numberlink", keys: ["Backspace", "Delete"], description: "erase every line and cross around the selected cell" },
  ...cursorBindings("numberlink", "numberlink"),
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

function legend(): { sample: string; meaning: string }[] {
  const dot = `<circle cx="5" cy="5" r="3.4" fill="${pairColor(1)}" stroke="var(--text)" stroke-width="0.4"/><text x="5" y="5.2" font-size="3.6" font-weight="700" font-family="var(--font)" text-anchor="middle" dominant-baseline="central" fill="rgb(0 0 0 / 0.7)">1</text>`;
  return [
    { sample: sample(sampleCell() + dot), meaning: "a dot: join it to the other dot with the same color and number" },
    { sample: sample(sampleCell(0) + sampleCell(10) + `<path d="M5 5H15" stroke="${pairColor(2)}" stroke-width="3.2" stroke-linecap="round"/>`, 2), meaning: "a line, in the color of the dot it reaches (gray while it reaches none)" },
    { sample: sample(sampleCell(0) + sampleCell(10) + `<path d="M9 4l2 2M11 4l-2 2" stroke="var(--text-dim)" stroke-width="0.5" stroke-linecap="round"/>`, 2), meaning: "a cross: your note that no line crosses this edge" },
    { sample: sample(`<rect width="10" height="10" fill="var(--danger-soft)" stroke="var(--border)" stroke-width="0.25"/>`), meaning: "a cell whose line can't be right" },
    { sample: sample(sampleCell(0) + sampleCell(10) + `<path d="M5 5H15" stroke="var(--danger)" stroke-width="3.2" stroke-linecap="round"/>`, 2), meaning: "a line joining two different colors" },
    { sample: sample(sampleCell(0) + sampleCell(10) + `<path d="M5 5H15" stroke="var(--hint)" stroke-width="4.4" stroke-linecap="round" opacity="0.45"/>`, 2), meaning: "hint: the edges it changes" },
    ...focusLegend("a cell it marks", "the reason"),
  ];
}

const DIRS = [UP, RIGHT, DOWN, LEFT];

export function numberlinkView(board: BoardPrefs): View<NumberlinkPuzzle, NumberlinkState, NumberlinkAction, NumberlinkInteraction, typeof settings> {
  return {
    id: "numberlink.svg",
    name: "grid",
    puzzle: numberlink,
    settings,
    controls: [
      { how: "drag from a dot", what: "draw its line (starting again from a dot redraws its line; drawing over another line cuts it)" },
      { how: "drag from the loose end of a line", what: "carry on drawing it; drag back over it to take it back" },
      { how: "click or tap near the side of a cell", what: "draw or erase the line across that side" },
      { how: "right-click near the side of a cell, or hold it on a touch screen", what: "put a cross there (no line), or take it away" },
    ],
    legend: legend(),
    mount(root, { session, settings }) {
      style("kit", KIT_CSS);
      style("numberlink", CSS);
      const p = session.puzzle;
      const g = edgeGrid(p.w, p.h);
      const f = frame(root, p, "numberlink-board", "numberlink", board);
      const mid = (c: number) => [f.cx(c) + SIZE / 2, f.cy(c) + SIZE / 2] as const;
      const tints: SVGRectElement[] = [], bads: SVGRectElement[] = [];
      for (let c = 0; c < g.n; c++) {
        const cell = s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: "cell" });
        f.base.append(cell);
        f.anchor(c, cell);
        f.base.append(tints[c] = s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: "tint", visibility: "hidden" }));
        f.base.append(bads[c] = s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: "bad", visibility: "hidden" }));
      }
      const pipes = s("g"), dots = s("g");
      f.marks.append(pipes, dots);
      p.dots.forEach((d, c) => {
        if (!d) return;
        const [x, y] = mid(c);
        dots.append(s("circle", { cx: x, cy: y, r: 3.4, class: "dot", fill: pairColor(d), style: `color: ${pairColor(d)}` }));
        dots.append(s("text", { x, y: y + 0.2, class: "num" }, String(d)));
      });
      const placeCursor = cursorRect(f);
      let preview: NumberlinkState | null = null;
      let hover = -1;

      const drawEdges = (layer: SVGGElement, edges: readonly number[], only?: (e: number) => boolean) => {
        const col = lineColors(p, edges);
        for (let e = 0; e < g.ne; e++) {
          if (only && !only(e)) continue;
          const a = g.ea[e]!, b = g.eb[e]!;
          const [x1, y1] = mid(a), [x2, y2] = mid(b);
          if (edges[e] === LINE) {
            const v = col[a]!;
            layer.append(s("line", { x1, y1, x2, y2, class: `pipe${v === 0 ? " loose" : v < 0 ? " mixed" : ""}`, stroke: v > 0 ? pairColor(v) : null }));
          } else if (edges[e] === CROSS) {
            const x = (x1 + x2) / 2, y = (y1 + y2) / 2;
            layer.append(s("path", { d: `M${x - 1} ${y - 1}l2 2M${x + 1} ${y - 1}l-2 2`, class: "cross" }));
          }
        }
      };

      const render = () => {
        const st = session.state;
        const col = lineColors(p, st.edges);
        const bad = session.derived()[CONFLICTS_KEY] as Record<string, number[]> | undefined;
        const flagged = new Set([...(bad?.cells ?? []), ...(bad?.loop ?? [])]);
        for (let c = 0; c < g.n; c++) {
          const v = col[c]!;
          tints[c]!.setAttribute("visibility", v > 0 ? "visible" : "hidden");
          if (v > 0) tints[c]!.setAttribute("fill", pairColor(v));
          bads[c]!.setAttribute("visibility", flagged.has(c) ? "visible" : "hidden");
        }
        pipes.replaceChildren();
        drawEdges(pipes, st.edges);
        f.ghost.replaceChildren();
        pipes.classList.toggle("faded", !!preview);
        if (preview) drawEdges(f.ghost, preview.edges);
        f.over.replaceChildren();
        const focus = session.activeHint?.focus as NumberlinkFocus | undefined;
        drawFocus(f.over, f, focus as Focus | undefined);
        for (const e of focus?.edges ?? []) {
          const [x1, y1] = mid(g.ea[e]!), [x2, y2] = mid(g.eb[e]!);
          f.over.append(s("line", { x1, y1, x2, y2, class: "focus-edge" }));
        }
        placeCursor(session.interaction.cursor);
      };

      // --- input ---

      const linesAt = (c: number) => DIRS.map((d) => edgeAt(g, c, d)).filter((e) => e >= 0 && session.state.edges[e] === LINE);
      const set = (edges: number[], value: number) => (edges.length ? session.dispatch({ type: "edge", edges, value }) : false);
      /** Edges of the piece of line through c. */
      const pieceEdges = (c: number): number[] => {
        const pc = pieces(g, session.state.edges);
        const id = pc.id[c]!;
        if (id < 0) return [];
        const cells = new Set(pc.cells[id]);
        const out: number[] = [];
        for (let e = 0; e < g.ne; e++) if (session.state.edges[e] === LINE && cells.has(g.ea[e]!)) out.push(e);
        return out;
      };
      /** Follow the line from c away from `from`: the edges passed and the cell where it ends. */
      const walk = (c: number, from: number): { edges: number[]; end: number } => {
        const edges: number[] = [];
        let prev = from, cur = c;
        for (;;) {
          const next = linesAt(cur).find((e) => otherEnd(g, e, cur) !== prev);
          if (next === undefined) return { edges, end: cur };
          edges.push(next);
          prev = cur;
          cur = otherEnd(g, next, cur);
          if (cur === c) return { edges, end: cur };
        }
      };

      type Pen = { pointerId: number; head: number; pair: number; fresh: boolean; moved: boolean; done: boolean; at: Point; sec: boolean; touch: boolean };
      type Point = { cell: number; edge: number };
      let pen: Pen | null = null;
      let pressTimer = 0;
      const cancelPress = () => { clearTimeout(pressTimer); pressTimer = 0; };

      const pointAt = (e: PointerEvent): Point => {
        const pt = f.point(e);
        if (!pt) return { cell: -1, edge: -1 };
        const x = Math.floor(pt.x / SIZE), y = Math.floor(pt.y / SIZE);
        if (x < 0 || y < 0 || x >= p.w || y >= p.h) return { cell: -1, edge: -1 };
        const cell = y * p.w + x;
        const dx = pt.x - (x * SIZE + SIZE / 2), dy = pt.y - (y * SIZE + SIZE / 2);
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SIZE * 0.22) return { cell, edge: -1 };
        const d = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? LEFT : RIGHT) : (dy < 0 ? UP : DOWN);
        return { cell, edge: edgeAt(g, cell, d) };
      };

      /** Start a pen on c: a dot (its line is redrawn once the pen moves), a loose end, an empty cell, or a line with one dot (cut back to c). */
      const startPen = (c: number): { pair: number; fresh: boolean } | null => {
        const lines = linesAt(c);
        if (p.dots[c]) return { pair: p.dots[c]!, fresh: true };
        if (lines.length <= 1) return { pair: lineColors(p, session.state.edges)[c]!, fresh: false };
        const sidesOf = lines.map((e) => {
          const w = walk(otherEnd(g, e, c), c);
          return { edges: [e, ...w.edges], dot: p.dots[w.end]! };
        });
        const dotted = sidesOf.filter((x) => x.dot);
        if (dotted.length !== 1) return null;
        set(sidesOf.find((x) => !x.dot)!.edges, NONE);
        return { pair: dotted[0]!.dot, fresh: false };
      };

      /** Move the pen from its head into the neighbouring cell n. */
      const penTo = (pn: Pen, n: number) => {
        const head = pn.head;
        const e = DIRS.map((d) => edgeAt(g, head, d)).find((x) => x >= 0 && otherEnd(g, x, head) === n);
        if (e === undefined) return;
        if (pn.fresh) {
          set(pieceEdges(head), NONE);
          pn.fresh = false;
        }
        if (session.state.edges[e] === LINE) {
          set([e], NONE);
          pn.head = n;
          return;
        }
        if (p.dots[n] && p.dots[n] !== pn.pair && pn.pair > 0) return;
        if (linesAt(head).length >= (p.dots[head] ? 1 : 2)) return;
        set(linesAt(n), NONE);
        set([e], LINE);
        pn.head = n;
        if (pn.pair === 0) pn.pair = Math.max(0, lineColors(p, session.state.edges)[n]!);
        if (p.dots[n]) pn.done = true;
      };

      const toggleEdge = (e: number, v: number) => session.dispatch({ type: "edge", edges: [e], value: session.state.edges[e] === v ? NONE : v });

      const onDown = (e: PointerEvent) => {
        const at = pointAt(e);
        if (at.cell < 0 || pen) return;
        e.preventDefault();
        session.setInteraction((i) => (i.cursor === at.cell ? i : { ...i, cursor: at.cell }));
        if (session.locked) return;
        if (e.pointerType !== "touch" && e.button !== 0 && e.button !== 2) return;
        f.svg.setPointerCapture?.(e.pointerId);
        pen = { pointerId: e.pointerId, head: at.cell, pair: 0, fresh: false, moved: false, done: false, at, sec: secondary(e, session.def.id), touch: e.pointerType === "touch" };
        if (pen.touch && at.edge >= 0) {
          pressTimer = window.setTimeout(() => {
            pressTimer = 0;
            if (!pen || pen.moved) return;
            navigator.vibrate?.(15);
            toggleEdge(pen.at.edge, buttonsSwapped(session.def.id) ? LINE : CROSS);
            pen = null;
          }, settings.longPressMs);
        }
      };
      const onMove = (e: PointerEvent) => {
        if (!pen || e.pointerId !== pen.pointerId) {
          if (e.pointerType !== "touch") hover = f.cellAt(e);
          return;
        }
        const c = f.cellAt(e);
        if (c < 0 || c === pen.head || (pen.sec && !pen.touch) || pen.done) return;
        if (!pen.moved) {
          const start = startPen(pen.head);
          if (!start) { pen.done = true; return; }
          cancelPress();
          pen.moved = true;
          pen.pair = start.pair;
          pen.fresh = start.fresh;
          session.beginBatch();
        }
        // a fast drag can skip cells: walk there one orthogonal step at a time
        for (let guard = 0; guard < 64 && pen.head !== c && !pen.done; guard++) {
          const hx = pen.head % p.w, hy = Math.floor(pen.head / p.w), tx = c % p.w, ty = Math.floor(c / p.w);
          const next = hx !== tx ? step(g, pen.head, tx > hx ? RIGHT : LEFT) : step(g, pen.head, ty > hy ? DOWN : UP);
          const before = pen.head;
          penTo(pen, next);
          if (pen.head === before) break;
        }
        session.setInteraction((i) => (i.cursor === pen!.head ? i : { ...i, cursor: pen!.head }));
      };
      const finish = (e: PointerEvent, commit: boolean) => {
        if (!pen || e.pointerId !== pen.pointerId) return;
        const pn = pen;
        pen = null;
        const pending = pressTimer !== 0;
        cancelPress();
        if (pn.moved) {
          session.endBatch();
          return;
        }
        if (!commit || (pn.touch && !pending) || pn.at.edge < 0) return;
        toggleEdge(pn.at.edge, pn.sec ? CROSS : LINE);
      };
      const svg = f.svg;
      const onContext = (e: Event) => e.preventDefault();
      const onUp = (e: PointerEvent) => finish(e, true);
      const onCancel = (e: PointerEvent) => finish(e, false);
      const onLeave = () => { hover = -1; };
      svg.addEventListener("contextmenu", onContext);
      svg.addEventListener("pointerdown", onDown);
      svg.addEventListener("pointermove", onMove);
      svg.addEventListener("pointerup", onUp);
      svg.addEventListener("pointercancel", onCancel);
      svg.addEventListener("pointerleave", onLeave);

      const lineTo = (d: number) => () => {
        const c = session.interaction.cursor;
        const e = edgeAt(g, c, d);
        if (e < 0) return;
        toggleEdge(e, LINE);
        session.setInteraction((i) => ({ ...i, cursor: step(g, c, d) }));
      };
      const crossAt = (d: number) => () => {
        const e = edgeAt(g, session.interaction.cursor, d);
        if (e >= 0) toggleEdge(e, CROSS);
      };

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(() => {
          if (session.locked && pen) {
            if (pen.moved) session.endBatch();
            pen = null;
            cancelPress();
          }
          render();
        }, { owner: "view" }),
      ];
      render();

      const commands: CommandDef[] = bindCommands(BINDINGS, {
        "numberlink.line-up": lineTo(UP),
        "numberlink.line-right": lineTo(RIGHT),
        "numberlink.line-down": lineTo(DOWN),
        "numberlink.line-left": lineTo(LEFT),
        "numberlink.cross-up": crossAt(UP),
        "numberlink.cross-right": crossAt(RIGHT),
        "numberlink.cross-down": crossAt(DOWN),
        "numberlink.cross-left": crossAt(LEFT),
        "numberlink.clear-cell": () => {
          const c = session.interaction.cursor;
          set(DIRS.map((d) => edgeAt(g, c, d)).filter((e) => e >= 0 && session.state.edges[e] !== NONE), NONE);
        },
        ...cursorHandlers("numberlink", p, session),
      }, { "numberlink.clear-cell": { menu: "board" } });

      return {
        gestures: { secondaryClick: true, hold: true },
        aspect: f.aspect,
        cells: { cols: p.w, rows: p.h },
        commands,
        target: (): NumberlinkTarget => ({ cell: hover >= 0 ? hover : session.interaction.cursor }),
        preview: (st) => {
          preview = st as NumberlinkState | null;
          render();
        },
        locate: (focus) => {
          const fc = focus as NumberlinkFocus | undefined;
          return f.rects([...focusCells(focus), ...(fc?.edges ?? []).flatMap((e) => [g.ea[e]!, g.eb[e]!])]);
        },
        locateChange: (a, b) => {
          const x = (a as NumberlinkState).edges, y = (b as NumberlinkState).edges;
          return f.rects(x.flatMap((v, e) => (v !== y[e] ? [g.ea[e]!, g.eb[e]!] : [])));
        },
        destroy() {
          cancelPress();
          if (pen?.moved) session.endBatch();
          offs.forEach((o) => o());
          svg.removeEventListener("contextmenu", onContext);
          f.destroy();
        },
      };
    },
  };
}
