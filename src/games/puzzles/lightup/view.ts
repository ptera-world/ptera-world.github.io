import { defineSchema } from "../../core/schema";
import type { View } from "../../core/types";
import { h, s, style } from "../../ui/dom";
import { EMPTY, geometry, litCounts } from "./grid";
import {
  BULB, DOT, NONE, type Mark,
  type LightupAction, type LightupFocus, type LightupInteraction, type LightupPuzzle, type LightupState,
} from "./logic";

/** Derived: { lights, clues, dark } cell lists to flag as errors. */
export const CONFLICTS_KEY = "lightup.conflicts";
/** Derived: clue cells whose count is met exactly. */
export const SATISFIED_KEY = "lightup.satisfied";

export interface Conflicts {
  lights: number[];
  clues: number[];
  dark: number[];
}

const CSS = `
.lightup { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; height: 100%; justify-content: center; }
.lightup svg { width: min(100%, 80vh); height: auto; max-height: calc(100% - 44px); touch-action: none; user-select: none; -webkit-user-select: none; }
.lightup .cell { fill: var(--cell); stroke: var(--border); stroke-width: 0.25; }
.lightup .glow { fill: var(--cell-lit); opacity: 0; pointer-events: none; transition: opacity 120ms; }
.lightup .glow.lit { opacity: 0.26; }
.lightup .glow.beam { opacity: 0.12; }
.lightup .glow.dead { fill: var(--danger); opacity: 0.22; }
.lightup .wall { fill: var(--text); }
.lightup .num { fill: var(--bg); font: 600 6.4px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.lightup .num.done { opacity: 0.35; }
.lightup .num.bad { fill: var(--danger); }
.lightup .wall.bad { fill: var(--danger-soft); stroke: var(--danger); stroke-width: 0.5; }
.lightup .bulb { fill: var(--cell-lit); stroke: var(--bg); stroke-width: 0.4; pointer-events: none; }
.lightup .bulb.bad { fill: var(--danger); }
.lightup .dot { fill: var(--text-dim); pointer-events: none; }
.lightup .focus { fill: none; stroke: var(--hint); stroke-width: 0.9; pointer-events: none; }
.lightup .focus.why { stroke-dasharray: 1.2 0.8; stroke-width: 0.6; }
.lightup .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
.lightup .mode[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); }
`;

const settings = defineSchema({
  beam: { type: "bool", label: "show where a light would shine on hover", default: true },
  modeButton: {
    type: "enum", label: "mark-mode button", default: "auto",
    options: [
      { value: "auto", label: "touch screens only" },
      { value: "always", label: "always" },
      { value: "never", label: "never" },
    ],
  },
  longPressMs: { type: "int", label: "long press (ms)", default: 400, min: 150, max: 1500, step: 50 },
});

const SIZE = 10;

type Session = Parameters<View<LightupPuzzle, LightupState, LightupAction, LightupInteraction>["mount"]>[1]["session"];

export const lightupView: View<LightupPuzzle, LightupState, LightupAction, LightupInteraction> = {
  id: "lightup.svg",
  name: "grid",
  puzzle: "lightup",
  settings,
  bindings: {
    "lightup.left": { label: "Cursor left", category: "Light Up", keys: ["ArrowLeft", "a"] },
    "lightup.right": { label: "Cursor right", category: "Light Up", keys: ["ArrowRight", "d"] },
    "lightup.up": { label: "Cursor up", category: "Light Up", keys: ["ArrowUp", "w"] },
    "lightup.down": { label: "Cursor down", category: "Light Up", keys: ["ArrowDown", "s"] },
    "lightup.light": { label: "Toggle light", category: "Light Up", keys: ["space", "Enter"] },
    "lightup.mark": { label: "Toggle no-light mark", category: "Light Up", keys: ["x", "."] },
    "lightup.clear": { label: "Clear cell", category: "Light Up", keys: ["Backspace", "Delete"] },
    "lightup.mode": { label: "Toggle mark mode", category: "Light Up", keys: ["m"] },
  },
  mount(root, { session, settings }) {
    style("lightup", CSS);
    const p = session.puzzle;
    const g = geometry(p);
    const svg = s("svg", {
      viewBox: `-0.5 -0.5 ${p.w * SIZE + 1} ${p.h * SIZE + 1}`,
      role: "grid", "aria-label": `light up, ${p.w} by ${p.h}`,
    });
    const layer = () => s("g");
    const base = layer(), glowL = layer(), marksL = layer(), over = layer();
    svg.append(base, glowL, marksL, over);

    const glow: SVGRectElement[] = [];
    const bulbs: SVGCircleElement[] = [];
    const dots: SVGCircleElement[] = [];
    const walls: SVGRectElement[] = [];
    const nums: SVGTextElement[] = [];
    const focusRects: SVGRectElement[] = [];
    const cx = (i: number) => (i % p.w) * SIZE;
    const cy = (i: number) => Math.floor(i / p.w) * SIZE;
    for (let i = 0; i < p.w * p.h; i++) {
      const v = p.cells[i]!;
      if (v === EMPTY) {
        base.append(s("rect", { x: cx(i), y: cy(i), width: SIZE, height: SIZE, class: "cell" }));
        glowL.append(glow[i] = s("rect", { x: cx(i) + 0.15, y: cy(i) + 0.15, width: SIZE - 0.3, height: SIZE - 0.3, class: "glow" }));
        marksL.append(
          bulbs[i] = s("circle", { cx: cx(i) + SIZE / 2, cy: cy(i) + SIZE / 2, r: 3, class: "bulb", visibility: "hidden" }),
          dots[i] = s("circle", { cx: cx(i) + SIZE / 2, cy: cy(i) + SIZE / 2, r: 0.9, class: "dot", visibility: "hidden" }),
        );
      } else {
        base.append(walls[i] = s("rect", { x: cx(i), y: cy(i), width: SIZE, height: SIZE, class: "wall" }));
        if (v >= 0) base.append(nums[i] = s("text", { x: cx(i) + SIZE / 2, y: cy(i) + SIZE / 2 + 0.3, class: "num" }, String(v)));
      }
    }
    const cursor = s("rect", { width: SIZE - 0.6, height: SIZE - 0.6, rx: 1, class: "cursor" });
    over.append(cursor);

    const touchUi = settings.modeButton === "always" ||
      (settings.modeButton === "auto" && typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
    const modeBtn = h("button", {
      class: "mode", type: "button", "aria-pressed": "false",
      onclick: () => session.setInteraction((i) => ({ ...i, markMode: !i.markMode })),
    }, "mark mode");
    const wrap = h("div", { class: "lightup" }, svg, touchUi ? modeBtn : null);
    root.append(wrap);

    let hover = -1;
    let paint: { from: number; value: Mark; cells: number[] } | null = null;

    const render = () => {
      const marks = paint ? previewMarks(session, paint) : session.state.marks;
      const lit = litCounts(g, marks);
      const d = session.derived();
      const conf = d[CONFLICTS_KEY] as Conflicts | undefined;
      const badLights = new Set(conf?.lights), badClues = new Set(conf?.clues), dead = new Set(conf?.dark);
      const done = new Set(d[SATISFIED_KEY] as number[] | undefined);
      const beam = settings.beam && hover >= 0 && p.cells[hover] === EMPTY && marks[hover] === NONE && !lit[hover]
        ? new Set([hover, ...g.sees[hover]!]) : null;
      for (const c of g.empties) {
        const m = marks[c];
        glow[c]!.classList.toggle("lit", lit[c]! > 0);
        glow[c]!.classList.toggle("beam", !lit[c] && !!beam?.has(c));
        glow[c]!.classList.toggle("dead", dead.has(c));
        bulbs[c]!.setAttribute("visibility", m === BULB ? "visible" : "hidden");
        bulbs[c]!.classList.toggle("bad", badLights.has(c));
        dots[c]!.setAttribute("visibility", m === DOT ? "visible" : "hidden");
      }
      for (const q of g.clues) {
        nums[q]!.classList.toggle("done", done.has(q) && !badClues.has(q));
        nums[q]!.classList.toggle("bad", badClues.has(q));
        walls[q]!.classList.toggle("bad", badClues.has(q));
      }
      for (const r of focusRects) r.remove();
      focusRects.length = 0;
      const focus = session.activeHint?.focus as LightupFocus | undefined;
      if (focus) {
        for (const [list, cls] of [[focus.cells, "focus"], [focus.because, "focus why"]] as const) {
          for (const c of list) {
            const r = s("rect", { x: cx(c) + 0.5, y: cy(c) + 0.5, width: SIZE - 1, height: SIZE - 1, rx: 1, class: cls });
            over.append(r);
            focusRects.push(r);
          }
        }
      }
      const cur = session.interaction.cursor;
      cursor.setAttribute("x", String(cx(cur) + 0.3));
      cursor.setAttribute("y", String(cy(cur) + 0.3));
      modeBtn.setAttribute("aria-pressed", String(session.interaction.markMode));
    };

    const cellAt = (e: PointerEvent): number => {
      const m = svg.getScreenCTM();
      if (!m) return -1;
      const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      const x = Math.floor(pt.x / SIZE), y = Math.floor(pt.y / SIZE);
      return x < 0 || y < 0 || x >= p.w || y >= p.h ? -1 : y * p.w + x;
    };
    const setCursor = (c: number) => session.setInteraction((i) => (i.cursor === c ? i : { ...i, cursor: c }));
    const toggleLight = (c: number) => {
      if (p.cells[c] === EMPTY) session.dispatch({ type: "toggle", cell: c, value: BULB });
    };
    const startPaint = (c: number) => {
      if (p.cells[c] !== EMPTY) return;
      const from = session.state.marks[c]!;
      paint = { from, value: from === DOT ? NONE : DOT, cells: [c] };
      render();
    };
    const finishPaint = () => {
      if (!paint) return;
      const { cells, value } = paint;
      paint = null;
      if (!session.dispatch({ type: "set", cells, value })) render();
    };

    let pressTimer = 0;
    let pressCell = -1;
    let pointerId = -1;
    const cancelPress = () => {
      clearTimeout(pressTimer);
      pressTimer = 0;
    };

    svg.addEventListener("contextmenu", (e) => e.preventDefault());
    svg.addEventListener("pointerdown", (e) => {
      const c = cellAt(e);
      if (c < 0 || pointerId !== -1) return;
      e.preventDefault();
      pointerId = e.pointerId;
      svg.setPointerCapture(e.pointerId);
      setCursor(c);
      const mark = session.interaction.markMode;
      if (e.pointerType === "touch") {
        if (mark) startPaint(c);
        else {
          pressCell = c;
          pressTimer = window.setTimeout(() => {
            pressTimer = 0;
            pressCell = -1;
            navigator.vibrate?.(15);
            startPaint(c);
          }, settings.longPressMs as number);
        }
      } else if (e.button === 2 || (e.button === 0 && mark)) startPaint(c);
      else if (e.button === 0) toggleLight(c);
    });
    svg.addEventListener("pointermove", (e) => {
      const c = cellAt(e);
      if (e.pointerId !== pointerId) {
        if (e.pointerType !== "touch" && c !== hover) {
          hover = c;
          render();
        }
        return;
      }
      if (pressTimer && c !== pressCell) {
        cancelPress();
        pressCell = -1;
      }
      if (paint && c >= 0 && p.cells[c] === EMPTY && session.state.marks[c] === paint.from && !paint.cells.includes(c)) {
        paint.cells.push(c);
        render();
      }
    });
    const end = (e: PointerEvent, commit: boolean) => {
      if (e.pointerId !== pointerId) return;
      pointerId = -1;
      if (pressTimer) {
        cancelPress();
        if (commit && pressCell >= 0) toggleLight(pressCell);
        pressCell = -1;
      }
      if (commit) finishPaint();
      else {
        paint = null;
        render();
      }
    };
    svg.addEventListener("pointerup", (e) => end(e, true));
    svg.addEventListener("pointercancel", (e) => end(e, false));
    svg.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "touch" && hover !== -1) {
        hover = -1;
        render();
      }
    });

    const move = (dx: number, dy: number) => () => {
      session.setInteraction((i) => {
        const x = Math.min(p.w - 1, Math.max(0, (i.cursor % p.w) + dx));
        const y = Math.min(p.h - 1, Math.max(0, Math.floor(i.cursor / p.w) + dy));
        return { ...i, cursor: y * p.w + x };
      });
    };
    const atCursor = (fn: (c: number) => void) => () => {
      const c = session.interaction.cursor;
      if (p.cells[c] === EMPTY) fn(c);
    };

    const offs = [
      session.hooks.change.tap(render, { owner: "view" }),
      session.hooks.interaction.tap(render, { owner: "view" }),
      session.hooks.refresh.tap(render, { owner: "view" }),
    ];
    render();
    return {
      destroy() {
        cancelPress();
        offs.forEach((f) => f());
        wrap.remove();
      },
      handlers: {
        "lightup.left": move(-1, 0),
        "lightup.right": move(1, 0),
        "lightup.up": move(0, -1),
        "lightup.down": move(0, 1),
        "lightup.light": atCursor((c) => session.dispatch({ type: "toggle", cell: c, value: BULB })),
        "lightup.mark": atCursor((c) => session.dispatch({ type: "toggle", cell: c, value: DOT })),
        "lightup.clear": atCursor((c) => session.dispatch({ type: "set", cells: [c], value: NONE })),
        "lightup.mode": () => session.setInteraction((i) => ({ ...i, markMode: !i.markMode })),
      },
    };
  },
};

function previewMarks(session: Session, paint: { value: number; cells: number[] }): number[] {
  const marks = session.state.marks.slice();
  for (const c of paint.cells) marks[c] = paint.value;
  return marks;
}
