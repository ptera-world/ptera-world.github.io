import { defineSchema } from "../../core/schema";
import type { View } from "../../core/types";
import { h, s, style } from "../../ui/dom";
import {
  numbers, type MinesAction, type MinesFocus, type MinesInteraction, type MinesPuzzle, type MinesState,
} from "./logic";

/** Derived: number = mines minus flags (from the remaining-count plugin). */
export const REMAINING_KEY = "mines.remaining";
/** Derived: { safe: number[]; mines: number[] } cells provable from what's open. */
export const DEDUCED_KEY = "mines.deduced";

const CSS = `
.mines { display: flex; flex-direction: column; align-items: center; gap: 8px; max-width: 100%; max-height: 100%; }
.mines-top { display: flex; gap: 12px; align-items: center; font-family: var(--mono); color: var(--text-dim); min-height: 1.4em; }
.mines-board { height: auto; max-width: 100%; touch-action: manipulation; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.mines-board .c { stroke: var(--bg); stroke-width: 0.6; }
.mines-board .closed { fill: color-mix(in srgb, var(--text) 16%, var(--surface)); cursor: pointer; }
.mines-board .closed:hover { fill: color-mix(in srgb, var(--text) 22%, var(--surface)); }
.mines-board .closed.pressed { fill: var(--surface); }
.mines-board .open { fill: var(--surface); }
.mines-board .boom { fill: var(--danger); }
.mines-board .closed.safe-hint { fill: color-mix(in srgb, var(--accent) 40%, var(--surface)); }
.mines-board .closed.mine-hint { fill: color-mix(in srgb, var(--danger) 40%, var(--surface)); }
.mines-board text { font-family: var(--mono); font-weight: 700; font-size: 6.4px; text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.mines-board .n1 { fill: #7ab0ff; } .mines-board .n2 { fill: #7fcf8a; } .mines-board .n3 { fill: #ff7b7b; }
.mines-board .n4 { fill: #c8a2ff; } .mines-board .n5 { fill: #e8a25a; } .mines-board .n6 { fill: #5fd3d3; }
.mines-board .n7 { fill: var(--text); } .mines-board .n8 { fill: var(--text-dim); }
.mines-board .flag { fill: var(--danger); pointer-events: none; }
.mines-board .pole { stroke: var(--text); stroke-width: 0.7; pointer-events: none; }
.mines-board .mine { fill: var(--text); pointer-events: none; }
.mines-board .wrong { stroke: var(--warn); stroke-width: 1; pointer-events: none; }
.mines-board .hint { fill: none; stroke: var(--hint); stroke-width: 1.2; pointer-events: none; }
.mines-board .source { fill: none; stroke: var(--hint); stroke-width: 0.6; stroke-dasharray: 1.2 0.8; pointer-events: none; }
.mines-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.8; pointer-events: none; }
.mines-mode { display: none; }
@media (pointer: coarse) { .mines-mode { display: inline-block; } }
.mines-mode[aria-pressed="true"] { background: var(--danger-soft); border-color: var(--danger); }
`;

const settings = defineSchema({
  longPressMs: { type: "int", label: "touch long-press for flag (ms)", default: 380, min: 150, max: 1500 },
  chordOnClick: { type: "bool", label: "click a satisfied number to open its neighbours", default: true },
});

const SIZE = 10;

export const minesView: View<MinesPuzzle, MinesState, MinesAction, MinesInteraction> = {
  id: "mines.svg",
  name: "grid",
  puzzle: "mines",
  settings,
  bindings: {
    "mines.left": { label: "Cursor left", category: "Mines", keys: ["ArrowLeft", "a"] },
    "mines.right": { label: "Cursor right", category: "Mines", keys: ["ArrowRight", "d"] },
    "mines.up": { label: "Cursor up", category: "Mines", keys: ["ArrowUp", "w"] },
    "mines.down": { label: "Cursor down", category: "Mines", keys: ["ArrowDown", "s"] },
    "mines.open": { label: "Open cell", category: "Mines", keys: ["space"] },
    "mines.flag": { label: "Flag cell", category: "Mines", keys: ["f", "x"] },
    "mines.chord": { label: "Open around number", category: "Mines", keys: ["Enter", "c"] },
    "mines.mode": { label: "Toggle flag mode", category: "Mines", keys: ["m"] },
  },
  mount(root, { session, settings }) {
    style("mines", CSS);
    const p = session.puzzle;
    const n = p.w * p.h;
    const nums = numbers(p);
    const svg = s("svg", {
      viewBox: `0 0 ${p.w * SIZE} ${p.h * SIZE}`, class: "mines-board", role: "grid",
      "aria-label": `${p.w} by ${p.h} minefield`,
      style: `width: min(100%, calc((100vh - 220px) * ${p.w / p.h})); min-width: ${Math.min(p.w * 22, 2000)}px`,
    });
    const counter = h("span", { "aria-label": "mines left" });
    const modeBtn = h("button", { class: "mines-mode", type: "button", "aria-pressed": "false" }, "flag mode");
    const wrap = h("div", { class: "mines" }, h("div", { class: "mines-top" }, counter, modeBtn), svg);
    root.append(wrap);

    const cells: SVGRectElement[] = [];
    const deco: SVGGElement[] = [];
    for (let c = 0; c < n; c++) {
      const x = (c % p.w) * SIZE, y = Math.floor(c / p.w) * SIZE;
      const r = s("rect", { x, y, width: SIZE, height: SIZE, rx: 1.2, class: "c closed", "data-cell": c });
      const g = s("g", { transform: `translate(${x} ${y})` });
      svg.append(r, g);
      cells.push(r);
      deco.push(g);
    }
    const overlay = s("g");
    const cursor = s("rect", { width: SIZE, height: SIZE, rx: 1.5, class: "cursor" });
    svg.append(overlay, cursor);

    let keyboardUsed = false;
    let pressed: number[] = [];
    const drawn: string[] = Array.from({ length: n }, () => "");

    const flagShape = () => [
      s("line", { x1: 3.6, y1: 2.2, x2: 3.6, y2: 8, class: "pole" }),
      s("path", { d: "M3.6 2.2 L7.6 3.8 L3.6 5.4 Z", class: "flag" }),
    ];
    const mineShape = () => [s("circle", { cx: 5, cy: 5, r: 2.4, class: "mine" })];

    const render = () => {
      const st = session.state;
      const d = session.derived();
      const dead = st.dead >= 0;
      const solved = session.solved;
      const ded = d[DEDUCED_KEY] as { safe: number[]; mines: number[] } | undefined;
      const safeHint = new Set(ded?.safe ?? []);
      const mineHint = new Set(ded?.mines ?? []);
      const press = new Set(pressed);
      for (let c = 0; c < n; c++) {
        const open = st.open[c] === 1;
        const isMine = p.mines[c] === 1;
        const flagged = st.flags[c] === 1;
        let cls = "c ";
        if (c === st.dead) cls += "boom";
        else if (open) cls += "open";
        else {
          cls += "closed";
          if (press.has(c)) cls += " pressed";
          else if (safeHint.has(c)) cls += " safe-hint";
          else if (mineHint.has(c) && !flagged) cls += " mine-hint";
        }
        cells[c]!.setAttribute("class", cls);
        let key = "";
        if (open) key = isMine ? "mine" : nums[c] ? `n${nums[c]}` : "";
        else if (flagged) key = dead && !isMine ? "wrong" : "flag";
        else if (isMine && solved) key = "flag";
        else if (isMine && dead) key = "mine";
        if (drawn[c] === key) continue;
        drawn[c] = key;
        const g = deco[c]!;
        while (g.firstChild) g.firstChild.remove();
        if (key.startsWith("n")) g.append(s("text", { x: 5, y: 5.4, class: key }, String(nums[c])));
        else if (key === "mine") g.append(...mineShape());
        else if (key === "flag") g.append(...flagShape());
        else if (key === "wrong") {
          g.append(...flagShape(), s("path", { d: "M2 2 L8 8 M8 2 L2 8", class: "wrong" }));
        }
      }
      while (overlay.firstChild) overlay.firstChild.remove();
      const focus = session.activeHint?.focus as MinesFocus | undefined;
      const box = (c: number, cls: string) => s("rect", {
        x: (c % p.w) * SIZE + 0.6, y: Math.floor(c / p.w) * SIZE + 0.6, width: SIZE - 1.2, height: SIZE - 1.2, rx: 1.2, class: cls,
      });
      for (const c of focus?.sources ?? []) overlay.append(box(c, "source"));
      for (const c of focus?.cells ?? []) overlay.append(box(c, "hint"));
      const cur = session.interaction.cursor;
      cursor.style.display = keyboardUsed ? "" : "none";
      cursor.setAttribute("x", String((cur % p.w) * SIZE));
      cursor.setAttribute("y", String(Math.floor(cur / p.w) * SIZE));
      const remaining = d[REMAINING_KEY];
      counter.textContent = typeof remaining === "number" ? `${remaining} left` : "";
      modeBtn.setAttribute("aria-pressed", String(session.interaction.flagMode));
    };

    const primary = (cell: number) => {
      const st = session.state;
      if (st.open[cell]) {
        if (settings.chordOnClick) session.dispatch({ type: "chord", cell });
      } else if (session.interaction.flagMode) session.dispatch({ type: "flag", cells: [cell] });
      else session.dispatch({ type: "open", cells: [cell] });
    };
    const setCursor = (cell: number) => session.setInteraction((i) => (i.cursor === cell ? i : { ...i, cursor: cell }));
    const cellAt = (e: PointerEvent): number => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const v = el?.getAttribute("data-cell");
      return v === null || v === undefined ? -1 : Number(v);
    };

    let down: { cell: number; button: number; id: number; x: number; y: number; timer: number; consumed: boolean } | null = null;
    const clearDown = () => {
      if (down) clearTimeout(down.timer);
      down = null;
      if (pressed.length) { pressed = []; render(); }
    };
    const showPressed = (cell: number, button: number) => {
      const st = session.state;
      if (st.dead >= 0) pressed = [];
      else if (st.open[cell] || button === 1) pressed = neighboursClosed(cell);
      else pressed = st.flags[cell] || session.interaction.flagMode ? [] : [cell];
      render();
    };
    const neighboursClosed = (cell: number) => {
      const st = session.state;
      const out: number[] = [];
      const x = cell % p.w, y = Math.floor(cell / p.w);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= p.w || ny >= p.h) continue;
        const d = ny * p.w + nx;
        if (!st.open[d] && !st.flags[d]) out.push(d);
      }
      return out;
    };

    svg.addEventListener("contextmenu", (e) => e.preventDefault());
    svg.addEventListener("pointerdown", (e) => {
      const cell = cellAt(e);
      if (cell < 0) return;
      keyboardUsed = false;
      setCursor(cell);
      clearDown();
      if (e.pointerType === "mouse" && e.button === 2) {
        session.dispatch({ type: "flag", cells: [cell] });
        return;
      }
      if (e.button !== 0 && e.button !== 1) return;
      e.preventDefault();
      const timer = e.pointerType === "mouse" ? 0 : window.setTimeout(() => {
        if (!down) return;
        down.consumed = true;
        pressed = [];
        if (!session.state.open[down.cell]) {
          session.dispatch({ type: "flag", cells: [down.cell] });
          navigator.vibrate?.(15);
        }
        render();
      }, settings.longPressMs as number);
      down = { cell, button: e.button, id: e.pointerId, x: e.clientX, y: e.clientY, timer, consumed: false };
      showPressed(cell, e.button);
    });
    svg.addEventListener("pointermove", (e) => {
      if (!down || e.pointerId !== down.id) return;
      if (e.pointerType !== "mouse") {
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) clearDown();
        return;
      }
      const cell = cellAt(e);
      if (cell !== down.cell && cell >= 0) {
        down.cell = cell;
        setCursor(cell);
        showPressed(cell, down.button);
      }
    });
    const up = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.id) return;
      const d = down;
      clearDown();
      if (d.consumed || e.type === "pointercancel") return;
      if (cellAt(e) !== d.cell) return;
      if (d.button === 1) session.dispatch({ type: "chord", cell: d.cell });
      else primary(d.cell);
    };
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);
    svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") clearDown(); });
    modeBtn.addEventListener("click", () => session.setInteraction((i) => ({ ...i, flagMode: !i.flagMode })));

    const move = (dx: number, dy: number) => () => {
      keyboardUsed = true;
      session.setInteraction((i) => {
        const x = Math.min(p.w - 1, Math.max(0, (i.cursor % p.w) + dx));
        const y = Math.min(p.h - 1, Math.max(0, Math.floor(i.cursor / p.w) + dy));
        return { ...i, cursor: y * p.w + x };
      });
      render();
    };
    const atCursor = (f: (c: number) => void) => () => {
      keyboardUsed = true;
      f(session.interaction.cursor);
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
        clearDown();
        offs.forEach((f) => f());
        wrap.remove();
      },
      handlers: {
        "mines.left": move(-1, 0),
        "mines.right": move(1, 0),
        "mines.up": move(0, -1),
        "mines.down": move(0, 1),
        "mines.open": atCursor((c) => (session.state.open[c] ? session.dispatch({ type: "chord", cell: c }) : session.dispatch({ type: "open", cells: [c] }))),
        "mines.flag": atCursor((c) => session.dispatch({ type: "flag", cells: [c] })),
        "mines.chord": atCursor((c) => session.dispatch({ type: "chord", cell: c })),
        "mines.mode": () => session.setInteraction((i) => ({ ...i, flagMode: !i.flagMode })),
      },
    };
  },
};
