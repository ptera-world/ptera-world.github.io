import { bindCommands, type BindingSchema } from "../../core/commands";
import { s, style } from "../../core/dom";
import type { View } from "../../core/types";
import {
  KIT_CSS, SIZE, cursorRect, drawFocus, focusCells, focusLegend, frame, sample, sampleCell,
  type BoardPrefs,
} from "../../lib/grid-kit/view";
import { fades } from "../../lib/grid-kit/fade";
import {
  boxEdges, edgeBetween, geometry, pieceRight, pieces,
  type RectAction, type RectConflicts, type RectInteraction, type RectPuzzle, type RectState,
} from "./logic";
import type { RectFocus } from "./techniques";

/** Derived: RectConflicts to flag on the board. */
export const CONFLICTS_KEY = "rect.conflicts";

const CSS = `
.rect-board .num { fill: var(--text); font: 600 5.6px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.rect-board .rim { fill: none; stroke: var(--text); stroke-width: 1; }
.rect-board .wall { stroke: var(--text); stroke-width: 1; stroke-linecap: round; }
.rect-board .right { fill: var(--accent-soft); }
.rect-board .wrong { fill: var(--danger-soft); }
.rect-board .drag { fill: var(--hint-soft, var(--accent-soft)); stroke: var(--focus); stroke-width: 0.6; stroke-dasharray: 1.2 0.8; pointer-events: none; }
.rect-board .drag.erase { stroke: var(--danger); }
.rect-board .edge-focus { stroke: var(--hint); stroke-width: 1.4; stroke-linecap: round; opacity: 0.8; }
`;

const BINDINGS: BindingSchema = {
  "rect.corner": { label: "rectangle corner", category: "rectangles", keys: ["space", "Enter"], description: "press once to mark the selected cell as one corner; move, then press again to draw the rectangle between the two" },
  "rect.wall-up": { label: "wall above on / off", category: "rectangles", keys: ["shift+ArrowUp"], description: "draw or rub out the wall on the top side of the selected cell" },
  "rect.wall-left": { label: "wall left on / off", category: "rectangles", keys: ["shift+ArrowLeft"], description: "draw or rub out the wall on the left side of the selected cell" },
  "rect.wall-right": { label: "wall right on / off", category: "rectangles", keys: ["shift+ArrowRight"], description: "draw or rub out the wall on the right side of the selected cell" },
  "rect.wall-down": { label: "wall below on / off", category: "rectangles", keys: ["shift+ArrowDown"], description: "draw or rub out the wall on the bottom side of the selected cell" },
  "rect.left": { label: "cursor left", category: "rectangles", keys: ["ArrowLeft", "a"], description: "move the keyboard selection one cell left" },
  "rect.right": { label: "cursor right", category: "rectangles", keys: ["ArrowRight", "d"], description: "move the keyboard selection one cell right" },
  "rect.up": { label: "cursor up", category: "rectangles", keys: ["ArrowUp", "w"], description: "move the keyboard selection one cell up" },
  "rect.down": { label: "cursor down", category: "rectangles", keys: ["ArrowDown", "s"], description: "move the keyboard selection one cell down" },
};

function legend(): { sample: string; meaning: string }[] {
  const num = `<text x="5" y="5.3" fill="var(--text)" font-size="5.6" font-weight="600" font-family="var(--font)" text-anchor="middle" dominant-baseline="central">4</text>`;
  return [
    { sample: sample(sampleCell() + num), meaning: "a number: the area of the rectangle holding it" },
    { sample: sample(sampleCell() + sampleCell(10) + `<line x1="10" y1="0" x2="10" y2="10" stroke="var(--text)" stroke-width="1"/>`, 2), meaning: "a wall between two rectangles" },
    { sample: sample(`<rect width="10" height="10" fill="var(--accent-soft)" stroke="var(--border)" stroke-width="0.25"/>` + num), meaning: "a finished rectangle: walled in, with one number equal to its area" },
    { sample: sample(`<rect width="10" height="10" fill="var(--danger-soft)" stroke="var(--border)" stroke-width="0.25"/>`), meaning: "a walled-in rectangle with no number, two numbers, or the wrong area" },
    { sample: sample(sampleCell() + sampleCell(10) + `<line x1="10" y1="0.6" x2="10" y2="9.4" stroke="var(--hint)" stroke-width="1.4" opacity="0.8"/>`, 2), meaning: "hint: a wall it draws" },
    ...focusLegend("the cells beside the walls", "the number it comes from", "the cells it reasons about"),
  ];
}

/** Within this distance of a cell's side (in SVG units), a press works on that side's wall. */
const PICK = 2.6;

export function rectView(board: BoardPrefs): View<RectPuzzle, RectState, RectAction, RectInteraction> {
  return {
    id: "rect.svg",
    name: "grid",
    puzzle: "rect",
    controls: [
      { how: "drag from one cell to another", what: "draw the rectangle between them (walls round it, none inside)" },
      { how: "right-drag", what: "rub out every wall in and around the rectangle" },
      { how: "click or tap right next to a grid line", what: "draw or rub out that one wall; drag along lines for several" },
    ],
    legend: legend(),
    mount(root, { session }) {
      style("kit", KIT_CSS);
      style("rect", CSS);
      const p = session.puzzle;
      const g = geometry(p);
      const f = frame(root, p, "rect-board", "rectangles", board);
      const fade = fades(f);
      const tint: SVGRectElement[] = [];
      for (let c = 0; c < g.n; c++) {
        const cell = s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: "cell" });
        f.base.append(cell);
        f.anchor(c, cell);
        f.base.append(tint[c] = s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, visibility: "hidden" }));
        if (p.nums[c]! > 0) f.base.append(s("text", { x: f.cx(c) + SIZE / 2, y: f.cy(c) + SIZE / 2 + 0.3, class: "num" }, String(p.nums[c])));
      }
      f.base.append(s("rect", { x: 0, y: 0, width: p.w * SIZE, height: p.h * SIZE, class: "rim" }));
      const dragEl = s("rect", { class: "drag", visibility: "hidden" });
      f.over.after(dragEl);
      const placeCursor = cursorRect(f);
      let preview: RectState | null = null;

      const seg = (e: number) => {
        const [a, b] = g.edges[e]!;
        if (b === a + 1) return [f.cx(b), f.cy(b), f.cx(b), f.cy(b) + SIZE] as const;
        return [f.cx(b), f.cy(b), f.cx(b) + SIZE, f.cy(b)] as const;
      };
      const drawWall = (el: Element, e: number) => {
        const [x1, y1, x2, y2] = seg(e);
        el.append(s("line", { x1, y1, x2, y2, class: "wall" }));
      };
      const edgeAt = (ev: { clientX: number; clientY: number }): number => {
        const pt = f.point(ev);
        if (!pt) return -1;
        const x = Math.floor(pt.x / SIZE), y = Math.floor(pt.y / SIZE);
        if (x < 0 || y < 0 || x >= p.w || y >= p.h) return -1;
        const c = y * p.w + x, fx = pt.x - x * SIZE, fy = pt.y - y * SIZE;
        const sides = [[fy, c - p.w, y > 0], [fx, c - 1, x > 0], [SIZE - fx, c + 1, x < p.w - 1], [SIZE - fy, c + p.w, y < p.h - 1]] as const;
        const [d, other, ok] = [...sides].sort((u, v) => u[0] - v[0])[0]!;
        return d <= PICK && ok ? edgeBetween(g, c, other) : -1;
      };
      const boxOf = (a: number, b: number) => {
        const x = Math.min(a % p.w, b % p.w), y = Math.min(Math.floor(a / p.w), Math.floor(b / p.w));
        return { x, y, w: Math.abs((a % p.w) - (b % p.w)) + 1, h: Math.abs(Math.floor(a / p.w) - Math.floor(b / p.w)) + 1 };
      };
      const drawAction = (a: number, b: number, erase: boolean): RectAction => {
        const box = boxOf(a, b);
        const { inside, border } = boxEdges(g, box.x, box.y, box.w, box.h);
        return erase ? { type: "edges", on: [], off: [...inside, ...border] } : { type: "edges", on: border, off: inside };
      };

      let drag: { mode: "edge"; value: number; from: number; edges: number[] } | { mode: "box"; start: number; end: number; erase: boolean } | null = null;
      let pointerId = -1;
      let hover = -1;

      const shownWalls = (): readonly number[] => {
        if (!drag || drag.mode !== "edge") return session.state.walls;
        const out = session.state.walls.slice();
        for (const e of drag.edges) out[e] = drag.value;
        return out;
      };

      const render = () => {
        const walls = shownWalls();
        const wrong = new Set((session.derived()[CONFLICTS_KEY] as RectConflicts | undefined)?.wrong);
        const right = new Set(pieces(p, walls).filter((cells) => pieceRight(p, walls, cells)).flat());
        for (let c = 0; c < g.n; c++) {
          const cls = wrong.has(c) ? "wrong" : right.has(c) ? "right" : "";
          tint[c]!.setAttribute("class", cls);
          tint[c]!.setAttribute("visibility", cls ? "visible" : "hidden");
        }
        while (f.marks.firstChild) f.marks.firstChild.remove();
        walls.forEach((v, e) => v && drawWall(f.marks, e));
        while (f.ghost.firstChild) f.ghost.firstChild.remove();
        fade.clear();
        if (preview) preview.walls.forEach((v, e) => {
          if (v && !walls[e]) drawWall(f.ghost, e);
          else if (!v && walls[e]) { const [x1, y1, x2, y2] = seg(e); fade.line(x1, y1, x2, y2, 1.4); }
        });
        if (drag?.mode === "box" && drag.end !== drag.start) {
          const box = boxOf(drag.start, drag.end);
          for (const [k, v] of Object.entries({ x: box.x * SIZE, y: box.y * SIZE, width: box.w * SIZE, height: box.h * SIZE })) dragEl.setAttribute(k, String(v));
          dragEl.setAttribute("class", `drag${drag.erase ? " erase" : ""}`);
          dragEl.setAttribute("visibility", "visible");
        } else dragEl.setAttribute("visibility", "hidden");
        while (f.over.firstChild) f.over.firstChild.remove();
        const focus = session.activeHint?.focus as RectFocus | undefined;
        drawFocus(f.over, f, focus);
        for (const e of focus?.edges ?? []) {
          const [x1, y1, x2, y2] = seg(e);
          f.over.append(s("line", { x1, y1, x2, y2, class: "edge-focus" }));
        }
        placeCursor(session.interaction.cursor);
      };

      const listeners: [string, EventListener][] = [
        ["contextmenu", (ev) => ev.preventDefault()],
        ["pointerdown", ((ev: PointerEvent) => {
          const c = f.cellAt(ev);
          if (c < 0 || pointerId !== -1) return;
          ev.preventDefault();
          session.setInteraction((i) => (i.cursor === c ? i : { ...i, cursor: c }));
          if (session.locked || (ev.pointerType !== "touch" && ev.button !== 0 && ev.button !== 2)) return;
          pointerId = ev.pointerId;
          f.svg.setPointerCapture?.(ev.pointerId);
          const e = ev.button === 2 ? -1 : edgeAt(ev);
          if (e >= 0) {
            const from = session.state.walls[e]!;
            drag = { mode: "edge", value: from ? 0 : 1, from, edges: [e] };
          } else drag = { mode: "box", start: c, end: c, erase: ev.button === 2 };
          render();
        }) as EventListener],
        ["pointermove", ((ev: PointerEvent) => {
          if (ev.pointerId !== pointerId) {
            if (ev.pointerType !== "touch") hover = f.cellAt(ev);
            return;
          }
          if (drag?.mode === "edge") {
            const e = edgeAt(ev);
            if (e < 0 || drag.edges.includes(e) || session.state.walls[e] !== drag.from) return;
            drag.edges.push(e);
            render();
          } else if (drag?.mode === "box") {
            const c = f.cellAt(ev);
            if (c < 0 || c === drag.end) return;
            drag.end = c;
            render();
          }
        }) as EventListener],
        ["pointerup", ((ev: PointerEvent) => {
          if (ev.pointerId !== pointerId) return;
          pointerId = -1;
          const d = drag;
          drag = null;
          if (d?.mode === "edge") session.dispatch(d.value ? { type: "edges", on: d.edges, off: [] } : { type: "edges", on: [], off: d.edges });
          else if (d?.mode === "box" && (d.end !== d.start || d.erase)) session.dispatch(drawAction(d.start, d.end, d.erase));
          render();
        }) as EventListener],
        ["pointercancel", ((ev: PointerEvent) => {
          if (ev.pointerId !== pointerId) return;
          pointerId = -1;
          drag = null;
          render();
        }) as EventListener],
        ["pointerleave", ((ev: PointerEvent) => { if (ev.pointerType !== "touch") hover = -1; }) as EventListener],
      ];
      for (const [type, fn] of listeners) f.svg.addEventListener(type, fn);

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(() => {
          if (session.locked) {
            drag = null;
            pointerId = -1;
          }
          render();
        }, { owner: "view" }),
      ];
      render();

      const side = (dx: number, dy: number) => () => {
        const c = session.interaction.cursor;
        const x = (c % p.w) + dx, y = Math.floor(c / p.w) + dy;
        if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
        const e = edgeBetween(g, c, y * p.w + x);
        session.dispatch(session.state.walls[e] ? { type: "edges", on: [], off: [e] } : { type: "edges", on: [e], off: [] });
      };
      const move = (dx: number, dy: number) => () => session.setInteraction((i) => {
        const x = Math.min(p.w - 1, Math.max(0, (i.cursor % p.w) + dx)), y = Math.min(p.h - 1, Math.max(0, Math.floor(i.cursor / p.w) + dy));
        return { ...i, cursor: y * p.w + x };
      });
      const commands = bindCommands(BINDINGS, {
        "rect.corner": () => {
          const { cursor, anchor } = session.interaction;
          if (anchor < 0) session.setInteraction((i) => ({ ...i, anchor: cursor }));
          else {
            session.setInteraction((i) => ({ ...i, anchor: -1 }));
            if (anchor !== cursor) session.dispatch(drawAction(anchor, cursor, false));
          }
        },
        "rect.wall-up": side(0, -1),
        "rect.wall-left": side(-1, 0),
        "rect.wall-right": side(1, 0),
        "rect.wall-down": side(0, 1),
        "rect.left": move(-1, 0),
        "rect.right": move(1, 0),
        "rect.up": move(0, -1),
        "rect.down": move(0, 1),
      });
      return {
        gestures: { secondaryClick: true },
        aspect: f.aspect,
        cells: { cols: p.w, rows: p.h },
        commands,
        target: () => (hover >= 0 ? hover : session.interaction.cursor),
        preview: (st) => {
          preview = st as RectState | null;
          render();
        },
        locate: (focus) => f.rects(focusCells(focus)),
        locateChange: (a, b) => {
          const x = (a as RectState).walls, y = (b as RectState).walls;
          return f.rects(x.flatMap((v, e) => (v !== y[e] ? g.edges[e]! : [])));
        },
        destroy() {
          for (const [type, fn] of listeners) f.svg.removeEventListener(type, fn);
          offs.forEach((o) => o());
          f.destroy();
        },
      };
    },
  };
}
