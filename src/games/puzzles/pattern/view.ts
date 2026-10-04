import { defineSchema } from "../../core/schema";
import type { View } from "../../core/types";
import { h, s, style } from "../../ui/dom";
import type { PatternAction, PatternFocus, PatternInteraction, PatternPuzzle, PatternState } from "./logic";
import { EMPTY, FILLED, UNKNOWN, type Cell } from "./solver";

/** Derived key: per-line flags for clue numbers already satisfied. */
export const CLUE_DONE_KEY = "pattern.clueDone";
/** Derived key: line indices (rows 0..h-1, columns h..h+w-1) whose marks can't fit their clue. */
export const LINE_ERRORS_KEY = "pattern.lineErrors";
/** Derived key: cells whose mark disagrees with the solution. */
export const MISTAKES_KEY = "pattern.mistakes";

export interface ClueDone {
  rows: boolean[][];
  cols: boolean[][];
}

const CSS = `
.pattern-wrap { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; height: 100%; min-height: 0; }
.pattern-board { flex: 1; width: 100%; min-height: 0; touch-action: none; user-select: none; -webkit-user-select: none; }
.pattern-board .bg { fill: var(--cell); }
.pattern-board .cell { fill: transparent; }
.pattern-board .cell.filled { fill: var(--text); }
.pattern-board .cell.mistake { fill: var(--danger-soft); stroke: var(--danger); stroke-width: 0.8; }
.pattern-board .cell.filled.mistake { fill: var(--danger); }
.pattern-board .cell.pv-fill { fill: var(--accent); }
.pattern-board .cell.pv-clear { fill: var(--surface-2); }
.pattern-board .cell.hint { stroke: var(--hint); stroke-width: 1.2; }
.pattern-board .mark { stroke: var(--text-dim); stroke-width: 0.9; stroke-linecap: round; fill: none; pointer-events: none; display: none; }
.pattern-board .mark.dot { fill: var(--text-dim); stroke: none; }
.pattern-board .mark.on { display: inline; }
.pattern-board .mark.pv { stroke: var(--accent); fill: none; display: inline; }
.pattern-board .mark.dot.pv { fill: var(--accent); }
.pattern-board .gl { stroke: var(--border); stroke-width: 0.35; pointer-events: none; }
.pattern-board .gl.major { stroke: var(--text-dim); stroke-width: 0.6; }
.pattern-board .frame { fill: none; stroke: var(--text-dim); stroke-width: 0.8; pointer-events: none; }
.pattern-board .band { fill: var(--accent-soft); pointer-events: none; }
.pattern-board .band.hint { fill: var(--hint-soft); }
.pattern-board .clue { fill: var(--text); font-family: var(--font); font-size: 5.6px; dominant-baseline: central; }
.pattern-board .clue.done { opacity: 0.3; }
.pattern-board .clue.error { fill: var(--danger); opacity: 1; font-weight: 600; }
.pattern-board .clue.hint { fill: var(--hint); font-weight: 600; }
.pattern-board .count { fill: var(--accent); font-family: var(--mono); font-size: 7px; text-anchor: middle; dominant-baseline: central; }
.pattern-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.9; pointer-events: none; }
.pattern-tools button[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); }
`;

const settings = defineSchema({
  marks: {
    type: "enum", label: "empty cell mark", default: "cross",
    options: [{ value: "cross", label: "cross" }, { value: "dot", label: "dot" }],
  },
  guides: { type: "int", label: "thick line every (0 = off)", default: 5, min: 0, max: 10 },
  band: { type: "bool", label: "highlight the row and column under the pointer", default: true },
  modeButton: {
    type: "enum", label: "cross-mode button", default: "auto",
    options: [
      { value: "auto", label: "on touch screens" },
      { value: "always", label: "always" },
      { value: "never", label: "never" },
    ],
  },
  longPressMs: { type: "int", label: "long-press to cross (ms, 0 = off)", default: 400, min: 0, max: 2000 },
});

const SIZE = 10;
const CLUE_H = 6.5;

interface Drag {
  pointerId: number;
  start: number;
  cur: number;
  /** Value of the start cell when the drag began; only cells with this value get painted. */
  from: number;
  target: Cell;
  secondary: boolean;
  prior: readonly number[];
  timer: number;
}

function targetFor(from: number, secondary: boolean): Cell {
  if (secondary) return from === EMPTY ? UNKNOWN : EMPTY;
  return from === FILLED ? UNKNOWN : FILLED;
}

export const patternView: View<PatternPuzzle, PatternState, PatternAction, PatternInteraction> = {
  id: "pattern.svg",
  name: "grid",
  puzzle: "pattern",
  settings,
  bindings: {
    "pattern.left": { label: "Cursor left", category: "Pattern", keys: ["ArrowLeft", "a"] },
    "pattern.right": { label: "Cursor right", category: "Pattern", keys: ["ArrowRight", "d"] },
    "pattern.up": { label: "Cursor up", category: "Pattern", keys: ["ArrowUp", "w"] },
    "pattern.down": { label: "Cursor down", category: "Pattern", keys: ["ArrowDown", "s"] },
    "pattern.paint-left": { label: "Paint left", category: "Pattern", description: "move and repeat the last mark", keys: ["shift+ArrowLeft", "shift+a"] },
    "pattern.paint-right": { label: "Paint right", category: "Pattern", description: "move and repeat the last mark", keys: ["shift+ArrowRight", "shift+d"] },
    "pattern.paint-up": { label: "Paint up", category: "Pattern", description: "move and repeat the last mark", keys: ["shift+ArrowUp", "shift+w"] },
    "pattern.paint-down": { label: "Paint down", category: "Pattern", description: "move and repeat the last mark", keys: ["shift+ArrowDown", "shift+s"] },
    "pattern.fill": { label: "Fill / unfill", category: "Pattern", keys: ["space", "Enter"] },
    "pattern.cross": { label: "Cross / uncross", category: "Pattern", keys: ["x", "period"] },
    "pattern.clear": { label: "Clear cell", category: "Pattern", keys: ["Backspace", "Delete"] },
    "pattern.mode": { label: "Toggle cross mode", category: "Pattern", keys: ["m"] },
  },
  mount(root, { session, settings }) {
    style("pattern", CSS);
    const p = session.puzzle;
    const n = p.w * p.h;
    const numW = (num: number) => String(num).length * 3.3 + 2.4;
    const rowW = (clue: readonly number[]) => (clue.length ? clue : [0]).reduce((a, num) => a + numW(num), 0);
    const colLen = Math.max(1, ...p.cols.map((c) => c.length));
    const gx = Math.max(...p.rows.map(rowW), 6) + 3;
    const gy = colLen * CLUE_H + 3;
    const W = gx + p.w * SIZE + 1;
    const H = gy + p.h * SIZE + 1;
    const svg = s("svg", {
      viewBox: `0 0 ${W} ${H}`, class: "pattern-board", role: "grid",
      "aria-label": `${p.w} by ${p.h} nonogram`,
    });
    const cx = (c: number) => gx + (c % p.w) * SIZE;
    const cy = (c: number) => gy + Math.floor(c / p.w) * SIZE;

    svg.append(s("rect", { x: gx, y: gy, width: p.w * SIZE, height: p.h * SIZE, class: "bg" }));
    const bandRow = s("rect", { x: 0, height: SIZE, width: W, class: "band", visibility: "hidden" });
    const bandCol = s("rect", { y: 0, width: SIZE, height: H, class: "band", visibility: "hidden" });
    const hintBands = s("g");
    svg.append(bandRow, bandCol, hintBands);

    const cells = Array.from({ length: n }, (_, i) => {
      const r = s("rect", { x: cx(i) + 0.6, y: cy(i) + 0.6, width: SIZE - 1.2, height: SIZE - 1.2, rx: 0.6, class: "cell" });
      svg.append(r);
      return r;
    });
    const marks = Array.from({ length: n }, (_, i) => {
      const x = cx(i), y = cy(i);
      const m = settings.marks === "dot"
        ? s("circle", { cx: x + SIZE / 2, cy: y + SIZE / 2, r: 1.1, class: "mark dot" })
        : s("path", { d: `M${x + 3} ${y + 3}L${x + 7} ${y + 7}M${x + 7} ${y + 3}L${x + 3} ${y + 7}`, class: "mark" });
      svg.append(m);
      return m;
    });
    const guide = settings.guides as number;
    for (let x = 0; x <= p.w; x++) {
      const major = guide > 0 && x % guide === 0;
      svg.append(s("line", { x1: gx + x * SIZE, x2: gx + x * SIZE, y1: gy, y2: gy + p.h * SIZE, class: major ? "gl major" : "gl" }));
    }
    for (let y = 0; y <= p.h; y++) {
      const major = guide > 0 && y % guide === 0;
      svg.append(s("line", { y1: gy + y * SIZE, y2: gy + y * SIZE, x1: gx, x2: gx + p.w * SIZE, class: major ? "gl major" : "gl" }));
    }
    svg.append(s("rect", { x: gx, y: gy, width: p.w * SIZE, height: p.h * SIZE, class: "frame" }));

    const rowClues = p.rows.map((clue, y) => {
      const nums = clue.length ? clue : [0];
      let right = gx - 2;
      const texts: SVGTextElement[] = [];
      for (let k = nums.length - 1; k >= 0; k--) {
        const num = nums[k]!;
        const t = s("text", { x: right, y: gy + y * SIZE + SIZE / 2, "text-anchor": "end", class: "clue" }, String(num));
        right -= numW(num);
        svg.append(t);
        texts[k] = t;
      }
      return texts;
    });
    const colClues = p.cols.map((clue, x) => {
      const nums = clue.length ? clue : [0];
      return nums.map((num, k) => {
        const t = s("text", {
          x: gx + x * SIZE + SIZE / 2, y: gy - 2 - (nums.length - 1 - k) * CLUE_H - CLUE_H / 2 + 1,
          "text-anchor": "middle", class: "clue",
        }, String(num));
        svg.append(t);
        return t;
      });
    });
    const count = s("text", { x: gx / 2, y: gy / 2, class: "count" });
    const cursor = s("rect", { width: SIZE, height: SIZE, rx: 1, class: "cursor", visibility: "hidden" });
    svg.append(count, cursor);

    const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    const showMode = settings.modeButton === "always" || (settings.modeButton === "auto" && coarse);
    const modeBtn = h("button", {
      type: "button", "aria-pressed": "false",
      onclick: () => session.setInteraction((i) => ({ ...i, crossMode: !i.crossMode })),
    }, "cross mode");
    const tools = h("div", { class: "pattern-tools" }, modeBtn);
    tools.hidden = !showMode;
    const wrap = h("div", { class: "pattern-wrap" }, svg, tools);
    root.append(wrap);

    let drag: Drag | null = null;
    let hover = -1;
    let keyboard = false;
    let lastKeyValue: Cell = FILLED;

    const dragCells = (d: Drag): number[] => {
      const sx = d.start % p.w, sy = Math.floor(d.start / p.w);
      const ex = d.cur % p.w, ey = Math.floor(d.cur / p.w);
      const out: number[] = [];
      if (Math.abs(ex - sx) >= Math.abs(ey - sy)) {
        const step = ex >= sx ? 1 : -1;
        for (let x = sx; ; x += step) { out.push(sy * p.w + x); if (x === ex) break; }
      } else {
        const step = ey >= sy ? 1 : -1;
        for (let y = sy; ; y += step) { out.push(y * p.w + sx); if (y === ey) break; }
      }
      return out.filter((c) => d.prior[c] === d.from);
    };

    const render = () => {
      const st = session.state;
      const d = session.derived();
      const done = d[CLUE_DONE_KEY] as ClueDone | undefined;
      const errors = new Set((d[LINE_ERRORS_KEY] as number[] | undefined) ?? []);
      const wrong = new Set((d[MISTAKES_KEY] as number[] | undefined) ?? []);
      const focus = (session.activeHint?.focus as PatternFocus | undefined) ?? {};
      const hintCells = new Set(focus.cells ?? []);
      const hintLines = new Set(focus.lines ?? []);
      const preview = drag ? new Set(dragCells(drag)) : null;
      for (let i = 0; i < n; i++) {
        let v = st.cells[i]!;
        const pv = preview?.has(i) ?? false;
        if (pv) v = drag!.target;
        const c = cells[i]!;
        c.classList.toggle("filled", v === FILLED && !pv);
        c.classList.toggle("pv-fill", pv && v === FILLED);
        c.classList.toggle("pv-clear", pv && v === UNKNOWN);
        c.classList.toggle("mistake", !pv && wrong.has(i));
        c.classList.toggle("hint", hintCells.has(i));
        const m = marks[i]!;
        m.classList.toggle("on", v === EMPTY);
        m.classList.toggle("pv", pv && v === EMPTY);
      }
      const paint = (texts: SVGTextElement[], line: number, flags: boolean[] | undefined) => {
        texts.forEach((t, k) => {
          t.classList.toggle("done", flags?.[k] ?? false);
          t.classList.toggle("error", errors.has(line));
          t.classList.toggle("hint", hintLines.has(line));
        });
      };
      rowClues.forEach((t, y) => paint(t, y, done?.rows[y]));
      colClues.forEach((t, x) => paint(t, p.h + x, done?.cols[x]));

      while (hintBands.firstChild) hintBands.firstChild.remove();
      for (const l of hintLines) {
        hintBands.append(l < p.h
          ? s("rect", { x: 0, y: gy + l * SIZE, width: W, height: SIZE, class: "band hint" })
          : s("rect", { x: gx + (l - p.h) * SIZE, y: 0, width: SIZE, height: H, class: "band hint" }));
      }

      const focusCell = drag ? drag.cur : keyboard ? session.interaction.cursor : hover;
      const band = settings.band && focusCell >= 0;
      bandRow.setAttribute("visibility", band ? "visible" : "hidden");
      bandCol.setAttribute("visibility", band ? "visible" : "hidden");
      if (band) {
        bandRow.setAttribute("y", String(cy(focusCell)));
        bandCol.setAttribute("x", String(cx(focusCell)));
      }
      count.textContent = preview && preview.size > 1 ? String(preview.size) : "";
      const c = session.interaction.cursor;
      cursor.setAttribute("visibility", keyboard ? "visible" : "hidden");
      cursor.setAttribute("x", String(cx(c)));
      cursor.setAttribute("y", String(cy(c)));
      modeBtn.setAttribute("aria-pressed", String(session.interaction.crossMode));
    };

    const pointToCell = (e: PointerEvent, clamp: boolean): number => {
      const m = svg.getScreenCTM();
      if (!m) return -1;
      const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      let x = Math.floor((pt.x - gx) / SIZE), y = Math.floor((pt.y - gy) / SIZE);
      if (clamp) {
        x = Math.max(0, Math.min(p.w - 1, x));
        y = Math.max(0, Math.min(p.h - 1, y));
      } else if (x < 0 || y < 0 || x >= p.w || y >= p.h) return -1;
      return y * p.w + x;
    };

    const endDrag = (commit: boolean) => {
      const d = drag;
      if (!d) return;
      clearTimeout(d.timer);
      drag = null;
      if (commit) {
        const list = dragCells(d);
        session.batch(() => { session.dispatch({ type: "set", cells: list, value: d.target }); });
      }
      render();
    };

    svg.addEventListener("pointerdown", (e) => {
      if (drag || e.button > 2) return;
      const cell = pointToCell(e, false);
      if (cell < 0) return;
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      keyboard = false;
      const swap = session.interaction.crossMode && e.button === 0;
      const secondary = (e.button === 2) !== swap;
      const from = session.state.cells[cell]!;
      const target: Cell = e.button === 1 ? UNKNOWN : targetFor(from, secondary);
      drag = {
        pointerId: e.pointerId, start: cell, cur: cell, from, target, secondary,
        prior: session.state.cells, timer: 0,
      };
      const lp = settings.longPressMs as number;
      if (e.pointerType !== "mouse" && lp > 0 && e.button === 0) {
        drag.timer = window.setTimeout(() => {
          if (!drag || drag.cur !== drag.start) return;
          drag.secondary = !drag.secondary;
          drag.target = targetFor(drag.from, drag.secondary);
          navigator.vibrate?.(10);
          render();
        }, lp);
      }
      session.setInteraction((i) => ({ ...i, cursor: cell }));
      render();
    });
    svg.addEventListener("pointermove", (e) => {
      if (drag && e.pointerId === drag.pointerId) {
        const cell = pointToCell(e, true);
        if (cell !== drag.cur) {
          drag.cur = cell;
          clearTimeout(drag.timer);
          render();
        }
        return;
      }
      if (e.pointerType === "mouse") {
        const cell = pointToCell(e, false);
        if (cell !== hover) { hover = cell; render(); }
      }
    });
    svg.addEventListener("pointerup", (e) => { if (drag && e.pointerId === drag.pointerId) endDrag(true); });
    svg.addEventListener("pointercancel", () => endDrag(false));
    svg.addEventListener("pointerleave", () => { if (hover >= 0) { hover = -1; render(); } });
    svg.addEventListener("contextmenu", (e) => e.preventDefault());

    const move = (dx: number, dy: number, paint: boolean) => () => {
      keyboard = true;
      session.setInteraction((i) => {
        const x = Math.min(p.w - 1, Math.max(0, (i.cursor % p.w) + dx));
        const y = Math.min(p.h - 1, Math.max(0, Math.floor(i.cursor / p.w) + dy));
        return { ...i, cursor: y * p.w + x };
      });
      if (paint) session.dispatch({ type: "set", cells: [session.interaction.cursor], value: lastKeyValue });
      render();
    };
    const mark = (kind: "fill" | "cross" | "clear") => () => {
      keyboard = true;
      const c = session.interaction.cursor;
      const from = session.state.cells[c]!;
      const value: Cell = kind === "clear" ? UNKNOWN : targetFor(from, kind === "cross");
      lastKeyValue = value;
      session.dispatch({ type: "set", cells: [c], value });
      render();
    };

    const offs = [
      session.hooks.change.tap(render, { owner: "view" }),
      session.hooks.interaction.tap(render, { owner: "view" }),
      session.hooks.refresh.tap(render, { owner: "view" }),
    ];
    render();
    return {
      destroy() {
        if (drag) clearTimeout(drag.timer);
        offs.forEach((f) => f());
        wrap.remove();
      },
      handlers: {
        "pattern.left": move(-1, 0, false),
        "pattern.right": move(1, 0, false),
        "pattern.up": move(0, -1, false),
        "pattern.down": move(0, 1, false),
        "pattern.paint-left": move(-1, 0, true),
        "pattern.paint-right": move(1, 0, true),
        "pattern.paint-up": move(0, -1, true),
        "pattern.paint-down": move(0, 1, true),
        "pattern.fill": mark("fill"),
        "pattern.cross": mark("cross"),
        "pattern.clear": mark("clear"),
        "pattern.mode": () => session.setInteraction((i) => ({ ...i, crossMode: !i.crossMode })),
      },
    };
  },
};
