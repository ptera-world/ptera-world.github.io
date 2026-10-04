import { bindCommands, type BindingSchema } from "../../core/commands";
import { s, style } from "../../core/dom";
import { defineSchema } from "../../core/schema";
import type { View } from "../../core/types";
import {
  KIT_CSS, SIZE, cursorBindings, cursorHandlers, cursorRect, drawFocus, focusCells, focusLegend, frame, sample, sampleCell,
  type BoardPrefs,
} from "../../lib/grid-kit/view";
import { fades } from "../../lib/grid-kit/fade";
import {
  GAP, LINE, NONE, geometry, regions,
  type Mark, type PalisadeAction, type PalisadeConflicts, type PalisadeInteraction, type PalisadePuzzle, type PalisadeState,
} from "./logic";
import type { PalisadeFocus } from "./techniques";

/** Derived: PalisadeConflicts to flag on the board. */
export const CONFLICTS_KEY = "palisade.conflicts";

const CSS = `
.palisade-board .num { fill: var(--text); font: 600 5.6px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.palisade-board .num.done { opacity: var(--done-opacity); }
.palisade-board .num.bad { fill: var(--danger); opacity: 1; }
.palisade-board .rim { fill: none; stroke: var(--text); stroke-width: 1; }
.palisade-board .wall { stroke: var(--text); stroke-width: 1; stroke-linecap: round; }
.palisade-board .gap { fill: var(--text-dim); }
.palisade-board .bad-region { fill: var(--danger-soft); }
.palisade-board .done-region { fill: var(--accent-soft); }
.palisade-board .edge-focus { stroke: var(--hint); stroke-width: 1.4; stroke-linecap: round; fill: none; opacity: 0.8; }
`;

const settings = defineSchema({
  longPressMs: { type: "int", label: "touch hold for a gap (ms)", default: 400, min: 150, max: 1500, step: 50 },
  shadeDone: { type: "bool", label: "shade regions that are walled off at the right size", default: true },
});

const BINDINGS: BindingSchema = {
  "palisade.wall-up": { label: "wall above on / off", category: "palisade", keys: ["shift+ArrowUp"], description: "draw or rub out the wall on the top side of the selected cell" },
  "palisade.wall-left": { label: "wall left on / off", category: "palisade", keys: ["shift+ArrowLeft"], description: "draw or rub out the wall on the left side of the selected cell" },
  "palisade.wall-right": { label: "wall right on / off", category: "palisade", keys: ["shift+ArrowRight"], description: "draw or rub out the wall on the right side of the selected cell" },
  "palisade.wall-down": { label: "wall below on / off", category: "palisade", keys: ["shift+ArrowDown"], description: "draw or rub out the wall on the bottom side of the selected cell" },
  "palisade.gap-up": { label: "gap above on / off", category: "palisade", keys: ["alt+ArrowUp"], description: "mark the top side of the selected cell as having no wall, or clear it" },
  "palisade.gap-left": { label: "gap left on / off", category: "palisade", keys: ["alt+ArrowLeft"], description: "mark the left side of the selected cell as having no wall, or clear it" },
  "palisade.gap-right": { label: "gap right on / off", category: "palisade", keys: ["alt+ArrowRight"], description: "mark the right side of the selected cell as having no wall, or clear it" },
  "palisade.gap-down": { label: "gap below on / off", category: "palisade", keys: ["alt+ArrowDown"], description: "mark the bottom side of the selected cell as having no wall, or clear it" },
  ...cursorBindings("palisade", "palisade"),
};

function legend(): { sample: string; meaning: string }[] {
  const num = (fill: string) => `<text x="5" y="5.3" fill="${fill}" font-size="5.6" font-weight="600" font-family="var(--font)" text-anchor="middle" dominant-baseline="central">2</text>`;
  return [
    { sample: sample(sampleCell() + sampleCell(10), 2), meaning: "two cells with no wall decided between them" },
    { sample: sample(sampleCell() + sampleCell(10) + `<line x1="10" y1="0" x2="10" y2="10" stroke="var(--text)" stroke-width="1"/>`, 2), meaning: "a wall: the cells are in different regions" },
    { sample: sample(sampleCell() + sampleCell(10) + `<circle cx="10" cy="5" r="0.8" fill="var(--text-dim)"/>`, 2), meaning: "a gap: your note that there's no wall here" },
    { sample: sample(sampleCell() + num("var(--text)")), meaning: "a number: how many of the cell's four sides are walls (the grid edge counts)" },
    { sample: sample(`<rect width="10" height="10" fill="var(--accent-soft)" stroke="var(--border)" stroke-width="0.25"/>`), meaning: "a region walled off at the right size" },
    { sample: sample(`<rect width="10" height="10" fill="var(--danger-soft)" stroke="var(--border)" stroke-width="0.25"/>`), meaning: "a region that's walled off too small, or joined by gaps too big" },
    { sample: sample(sampleCell() + num("var(--danger)")), meaning: "a number that's passed or can't be reached any more" },
    { sample: sample(sampleCell() + sampleCell(10) + `<line x1="10" y1="0.6" x2="10" y2="9.4" stroke="var(--hint)" stroke-width="1.4" opacity="0.8"/>`, 2), meaning: "hint: the edge it settles" },
    ...focusLegend("the cells beside it", "the number or cells it comes from", "other cells it mentions"),
  ];
}

/** Within this distance of a cell's side (in SVG units), a press picks that side. */
const PICK = 3.5;

export function palisadeView(board: BoardPrefs): View<PalisadePuzzle, PalisadeState, PalisadeAction, PalisadeInteraction> {
  return {
    id: "palisade.svg",
    name: "grid",
    puzzle: "palisade",
    settings,
    controls: [
      { how: "click or tap near a cell's side", what: "draw a wall there, or rub it out. drag along the lines to draw several" },
      { how: "right-click near a side, or hold on a touch screen", what: "mark it as having no wall (a gap), or clear the mark" },
    ],
    legend: legend(),
    mount(root, { session, settings }) {
      style("kit", KIT_CSS);
      style("palisade", CSS);
      const p = session.puzzle;
      const g = geometry(p);
      const f = frame(root, p, "palisade-board", "palisade", board);
      const fade = fades(f);
      const tint: SVGRectElement[] = [];
      const nums: (SVGTextElement | undefined)[] = [];
      for (let c = 0; c < g.n; c++) {
        const cell = s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: "cell" });
        f.base.append(cell);
        f.anchor(c, cell);
        f.base.append(tint[c] = s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, visibility: "hidden" }));
        if (p.clues[c]! >= 0) f.base.append(nums[c] = s("text", { x: f.cx(c) + SIZE / 2, y: f.cy(c) + SIZE / 2 + 0.3, class: "num" }, String(p.clues[c])));
      }
      f.base.append(s("rect", { x: 0, y: 0, width: p.w * SIZE, height: p.h * SIZE, class: "rim" }));
      const placeCursor = cursorRect(f);
      let preview: PalisadeState | null = null;

      /** Endpoints of an inner edge's line. */
      const seg = (e: number) => {
        const [a, b] = g.edges[e]!;
        if (b === a + 1) return [f.cx(b), f.cy(b), f.cx(b), f.cy(b) + SIZE] as const;
        return [f.cx(b), f.cy(b), f.cx(b) + SIZE, f.cy(b)] as const;
      };
      const drawEdge = (el: Element, e: number, mark: number) => {
        const [x1, y1, x2, y2] = seg(e);
        if (mark === LINE) el.append(s("line", { x1, y1, x2, y2, class: "wall" }));
        else if (mark === GAP) el.append(s("circle", { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, r: 0.8, class: "gap" }));
      };

      /** The inner edge nearest the pointer, if it's close enough to a side. */
      const edgeAt = (e: { clientX: number; clientY: number }): number => {
        const pt = f.point(e);
        if (!pt) return -1;
        const x = Math.floor(pt.x / SIZE), y = Math.floor(pt.y / SIZE);
        if (x < 0 || y < 0 || x >= p.w || y >= p.h) return -1;
        const c = y * p.w + x, fx = pt.x - x * SIZE, fy = pt.y - y * SIZE;
        const dists = [[fy, c - p.w, c], [fx, c - 1, c], [SIZE - fx, c, c + 1], [SIZE - fy, c, c + p.w]] as const;
        const [d, a, b] = [...dists].sort((u, v) => u[0] - v[0])[0]!;
        if (d > PICK) return -1;
        return g.sides[c]!.find((side) => [a, b].includes(side.other) && side.other !== c)?.edge ?? -1;
      };

      let stroke: { value: Mark; from: number; edges: number[] } | null = null;
      let pointerId = -1;
      let holdTimer = 0;
      let hoverCell = -1;
      const shownMarks = () => {
        if (!stroke) return session.state.marks;
        const out = session.state.marks.slice();
        for (const e of stroke.edges) out[e] = stroke.value;
        return out;
      };
      const onDown = (ev: PointerEvent) => {
        const c = f.cellAt(ev);
        if (c >= 0) session.setInteraction((i) => (i.cursor === c ? i : { ...i, cursor: c }));
        const e = edgeAt(ev);
        if (e < 0 || session.locked || pointerId !== -1) return;
        ev.preventDefault();
        if (ev.pointerType !== "touch" && ev.button !== 0 && ev.button !== 2) return;
        pointerId = ev.pointerId;
        f.svg.setPointerCapture?.(ev.pointerId);
        const want = ev.button === 2 ? GAP : LINE;
        const from = session.state.marks[e]!;
        stroke = { value: from === want ? NONE : want, from, edges: [e] };
        if (ev.pointerType === "touch") {
          holdTimer = window.setTimeout(() => {
            holdTimer = 0;
            if (stroke?.edges.length !== 1) return;
            navigator.vibrate?.(15);
            stroke = { value: from === GAP ? NONE : GAP, from, edges: [e] };
            render();
          }, settings.longPressMs as number);
        }
        render();
      };
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) {
          const c = f.cellAt(ev);
          if (ev.pointerType !== "touch" && c !== hoverCell) hoverCell = c;
          return;
        }
        const e = edgeAt(ev);
        if (!stroke || e < 0 || stroke.edges.includes(e) || session.state.marks[e] !== stroke.from) return;
        clearTimeout(holdTimer);
        stroke.edges.push(e);
        render();
      };
      const onEnd = (ev: PointerEvent, commit: boolean) => {
        if (ev.pointerId !== pointerId) return;
        pointerId = -1;
        clearTimeout(holdTimer);
        const st = stroke;
        stroke = null;
        if (st && commit) session.dispatch({ type: "set", edges: st.edges, value: st.value });
        render();
      };
      const listeners: [string, EventListener][] = [
        ["contextmenu", (ev) => ev.preventDefault()],
        ["pointerdown", ((ev: PointerEvent) => onDown(ev)) as EventListener],
        ["pointermove", ((ev: PointerEvent) => onMove(ev)) as EventListener],
        ["pointerup", ((ev: PointerEvent) => onEnd(ev, true)) as EventListener],
        ["pointercancel", ((ev: PointerEvent) => onEnd(ev, false)) as EventListener],
        ["pointerleave", ((ev: PointerEvent) => { if (ev.pointerType !== "touch") hoverCell = -1; }) as EventListener],
      ];
      for (const [type, fn] of listeners) f.svg.addEventListener(type, fn);

      const render = () => {
        const marks = shownMarks();
        const bad = session.derived()[CONFLICTS_KEY] as PalisadeConflicts | undefined;
        const badCells = new Set(bad?.regions), badClues = new Set(bad?.clues);
        const walled = regions(g, (e) => marks[e] !== LINE);
        for (let c = 0; c < g.n; c++) {
          const good = !!settings.shadeDone && walled.size[walled.id[c]!] === p.k;
          const cls = badCells.has(c) ? "bad-region" : good ? "done-region" : "";
          tint[c]!.setAttribute("class", cls);
          tint[c]!.setAttribute("visibility", cls ? "visible" : "hidden");
          const el = nums[c];
          if (!el) continue;
          const walls = 4 - g.sides[c]!.length + g.sides[c]!.filter((sd) => marks[sd.edge] === LINE).length;
          el.classList.toggle("bad", badClues.has(c));
          el.classList.toggle("done", !badClues.has(c) && walls === p.clues[c] && g.sides[c]!.every((sd) => marks[sd.edge] !== NONE));
        }
        while (f.marks.firstChild) f.marks.firstChild.remove();
        for (let e = 0; e < g.edges.length; e++) drawEdge(f.marks, e, marks[e]!);
        while (f.ghost.firstChild) f.ghost.firstChild.remove();
        fade.clear();
        if (preview) for (let e = 0; e < g.edges.length; e++) if (preview.marks[e] !== marks[e]) {
          if (marks[e]) { const [x1, y1, x2, y2] = seg(e); fade.line(x1, y1, x2, y2, 1.8); }
          drawEdge(f.ghost, e, preview.marks[e]!);
        }
        while (f.over.firstChild) f.over.firstChild.remove();
        const focus = session.activeHint?.focus as PalisadeFocus | undefined;
        drawFocus(f.over, f, focus);
        for (const e of focus?.edges ?? []) {
          const [x1, y1, x2, y2] = seg(e);
          f.over.append(s("line", { x1, y1, x2, y2, class: "edge-focus" }));
        }
        placeCursor(session.interaction.cursor);
      };

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(() => {
          if (session.locked) {
            stroke = null;
            pointerId = -1;
          }
          render();
        }, { owner: "view" }),
      ];
      render();

      const side = (dx: number, dy: number, want: Mark) => () => {
        const c = session.interaction.cursor;
        const x = (c % p.w) + dx, y = Math.floor(c / p.w) + dy;
        if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
        const e = g.sides[c]!.find((sd) => sd.other === y * p.w + x)?.edge;
        if (e === undefined) return;
        session.dispatch({ type: "set", edges: [e], value: session.state.marks[e] === want ? NONE : want });
      };
      const commands = bindCommands(BINDINGS, {
        "palisade.wall-up": side(0, -1, LINE),
        "palisade.wall-left": side(-1, 0, LINE),
        "palisade.wall-right": side(1, 0, LINE),
        "palisade.wall-down": side(0, 1, LINE),
        "palisade.gap-up": side(0, -1, GAP),
        "palisade.gap-left": side(-1, 0, GAP),
        "palisade.gap-right": side(1, 0, GAP),
        "palisade.gap-down": side(0, 1, GAP),
        ...cursorHandlers("palisade", p, session),
      });
      return {
        gestures: { secondaryClick: true, hold: true },
        aspect: f.aspect,
        cells: { cols: p.w, rows: p.h },
        commands,
        target: () => (hoverCell >= 0 ? hoverCell : session.interaction.cursor),
        preview: (st) => {
          preview = st as PalisadeState | null;
          render();
        },
        locate: (focus) => f.rects(focusCells(focus)),
        locateChange: (a, b) => {
          const x = (a as PalisadeState).marks, y = (b as PalisadeState).marks;
          return f.rects(x.flatMap((m, e) => (m !== y[e] ? g.edges[e]! : [])));
        },
        destroy() {
          clearTimeout(holdTimer);
          for (const [type, fn] of listeners) f.svg.removeEventListener(type, fn);
          offs.forEach((o) => o());
          f.destroy();
        },
      };
    },
  };
}

