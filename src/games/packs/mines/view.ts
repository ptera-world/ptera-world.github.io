import { defineSchema } from "../../core/schema";
import type { CommandDef, View } from "../../core/types";
import { bindCommands, type BindingSchema } from "../../core/commands";
import { s, style } from "../../core/dom";
import { colName, rowName, type Side } from "../../core/names";
import {
  chordCells, numbers, type MinesAction, type MinesFocus, type MinesInteraction, type MinesPuzzle, type MinesState,
} from "./logic";

/** Derived: { safe: number[]; mines: number[] } cells provable from what's open. */
export const DEDUCED_KEY = "mines.deduced";

/** Themed graphics this view draws, drawn in a 10×10 cell box. */
export const ASSETS = {
  flag: `<svg viewBox="0 0 10 10"><line x1="3.6" y1="2.2" x2="3.6" y2="8" stroke="var(--text)" stroke-width="0.7"/><path d="M3.6 2.2 L7.6 3.8 L3.6 5.4 Z" fill="var(--danger)"/></svg>`,
  mine: `<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="2.4" fill="var(--text)"/><path d="M5 1.6V8.4M1.6 5H8.4M2.6 2.6L7.4 7.4M7.4 2.6L2.6 7.4" stroke="var(--text)" stroke-width="0.6"/></svg>`,
  wrong: `<svg viewBox="0 0 10 10"><path d="M2 2 L8 8 M8 2 L2 8" stroke="var(--warn)" stroke-width="1"/></svg>`,
} as const;

export type Look = { asset(id: string, fallback: string): string };

const CSS = `
.mines-board { width: 100%; height: 100%; touch-action: manipulation; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.mines-board .c { stroke: var(--bg); stroke-width: 0.6; }
.mines-board .closed { fill: color-mix(in srgb, var(--text) 16%, var(--surface)); cursor: pointer; }
.mines-board .closed:hover { fill: color-mix(in srgb, var(--text) 22%, var(--surface)); }
.mines-board .closed.pressed { fill: var(--surface); }
.mines-board .open { fill: var(--surface); }
.mines-board .boom { fill: var(--danger); }
.mines-board .open.chordable { cursor: pointer; }
.mines-board .open.chordable:hover { fill: color-mix(in srgb, var(--accent) 14%, var(--surface)); }
.mines-board .closed.around { fill: color-mix(in srgb, var(--accent) 22%, var(--surface)); }
.mines-board .pv { opacity: 0.6; pointer-events: none; }
.mines-board .pv-open { fill: var(--surface); }
.mines-board .pv-closed { fill: color-mix(in srgb, var(--text) 16%, var(--surface)); }
.mines-board .closed.safe-hint { fill: color-mix(in srgb, var(--accent) 40%, var(--surface)); }
.mines-board .closed.mine-hint { fill: color-mix(in srgb, var(--danger) 40%, var(--surface)); }
.mines-board text { font-family: var(--mono); font-weight: 700; font-size: 6.4px; text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.mines-board .n1 { fill: #7ab0ff; } .mines-board .n2 { fill: #7fcf8a; } .mines-board .n3 { fill: #ff7b7b; }
.mines-board .n4 { fill: #c8a2ff; } .mines-board .n5 { fill: #e8a25a; } .mines-board .n6 { fill: #5fd3d3; }
.mines-board .n7 { fill: var(--text); } .mines-board .n8 { fill: var(--text-dim); }
.mines-board .done text { opacity: var(--done-opacity); }
.mines-board .deco { pointer-events: none; }
.mines-board .hint { fill: none; stroke: var(--hint); stroke-width: 1.2; pointer-events: none; }
.mines-board .source { fill: none; stroke: var(--hint); stroke-width: 0.6; stroke-dasharray: 1.2 0.8; pointer-events: none; }
.mines-board .edge { fill: var(--text-dim); font-size: 4.2px; font-weight: 400; }
.mines-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.8; pointer-events: none; }
[data-input="pointer"] .mines-board .cursor { display: none; }
`;

const settings = defineSchema({
  longPressMs: { type: "int", label: "touch long-press for flag (ms)", default: 380, min: 150, max: 1500 },
  chordOnClick: { type: "bool", label: "click a number that has all its flags to open its other neighbors (chording)", default: true },
  chordOnRightClick: { type: "bool", label: "right-click a number that has all its flags to open its other neighbors (chording)", default: true },
  dimDone: { type: "bool", label: "fade numbers whose neighbors are all decided", default: true },
});

const SIZE = 10;
/** Width of an edge-label strip, in cell units of SIZE. */
const EDGE = 6;
const SVG_NS = "http://www.w3.org/2000/svg";

/** An asset (SVG markup or image URL) as an element filling one cell box. */
export function assetNode(markup: string): () => Element {
  const t = markup.trim();
  if (!t.startsWith("<")) return () => s("image", { href: t, width: SIZE, height: SIZE });
  const holder = document.createElementNS(SVG_NS, "g");
  holder.innerHTML = t;
  const el = holder.firstElementChild;
  if (el?.tagName.toLowerCase() === "svg") {
    el.setAttribute("width", String(SIZE));
    el.setAttribute("height", String(SIZE));
  }
  return () => (el ? el.cloneNode(true) as Element : s("g"));
}

const CLOSED = "color-mix(in srgb, var(--text) 16%, var(--surface))";
const NUM = `font-family="var(--mono)" font-weight="700" font-size="6.4" text-anchor="middle" dominant-baseline="central" `;
/** A one-cell legend swatch: background fill plus optional inner markup (nested svg allowed). */
function sample(fill: string, inner = ""): string {
  return `<svg viewBox="0 0 10 10" width="22" height="22"><rect width="10" height="10" rx="1.2" fill="${fill}"/>${inner}</svg>`;
}

const BINDINGS: BindingSchema = {
  "mines.left": { label: "cursor left", category: "minesweeper", keys: ["ArrowLeft", "a"] },
  "mines.right": { label: "cursor right", category: "minesweeper", keys: ["ArrowRight", "d"] },
  "mines.up": { label: "cursor up", category: "minesweeper", keys: ["ArrowUp", "w"] },
  "mines.down": { label: "cursor down", category: "minesweeper", keys: ["ArrowDown", "s"] },
  "mines.open": { label: "open cell", category: "minesweeper", keys: ["space"], description: "open the cell under the keyboard cursor. on an open number, opens its neighbors instead (like clicking it)" },
  "mines.flag": { label: "flag / unflag cell", category: "minesweeper", keys: ["f", "x"], description: "put a flag on the cell under the keyboard cursor (or take it off). flags mark mines and can't be opened by accident" },
  "mines.chord": { label: "open around number", category: "minesweeper", keys: ["Enter", "c"], description: "on an open number that already has that many flags around it, open all its other neighbors at once" },
  "mines.mode": { label: "flag mode", category: "minesweeper", keys: ["m"], description: "while on, clicking or tapping a hidden cell flags it instead of opening it. for touch screens, where there is no right click" },
  "mines.flag-at": { label: "flag / unflag (pointer)", category: "minesweeper", mouse: ["rightclick"], description: "flag the cell under the pointer, or take its flag off. on an open number, opens its other neighbors instead when its flags are all there (if right-click chording is on)" },
};

/** Flag-or-unflag as an explicit action, so unflagging is recognizably a retraction. */
export const toggleFlag = (st: MinesState, cell: number): MinesAction => ({ type: "flag", cells: [cell], on: !st.flags[cell] });

export function minesView(look: Look, labelSides: () => ReadonlySet<Side>): View<MinesPuzzle, MinesState, MinesAction, MinesInteraction> {
  return {
    id: "mines.svg",
    name: "grid",
    puzzle: "mines",
    settings,
    legend: [
      { sample: sample(CLOSED), meaning: "hidden cell: could be a mine" },
      { sample: sample("var(--surface)", `<text x="5" y="5.4" ${NUM}fill="#7ab0ff">1</text>`), meaning: "opened cell: the number counts the mines in the eight cells around it (blank means none)" },
      { sample: sample("var(--surface)", `<text x="5" y="5.4" ${NUM}fill="#7ab0ff" opacity="var(--done-opacity)">1</text>`), meaning: "faded number: every cell around it is opened or flagged" },
      { sample: sample(CLOSED, ASSETS.flag), meaning: "flag: your note that a mine is here" },
      { sample: sample("var(--danger)", ASSETS.mine), meaning: "the mine you opened (game over)" },
      { sample: sample(CLOSED, ASSETS.mine), meaning: "after a loss: where the other mines were" },
      { sample: sample(CLOSED, ASSETS.flag + ASSETS.wrong), meaning: "after a loss: a flag that wasn't on a mine" },
      { sample: sample(CLOSED, `<rect x="0.6" y="0.6" width="8.8" height="8.8" rx="1.2" fill="none" stroke="var(--hint)" stroke-width="1.2"/>`), meaning: "hint: the cells it decides" },
      { sample: sample("var(--surface)", `<rect x="0.6" y="0.6" width="8.8" height="8.8" rx="1.2" fill="none" stroke="var(--hint)" stroke-width="0.6" stroke-dasharray="1.2 0.8"/>`), meaning: "hint: the numbers it reasons from" },
      { sample: sample("color-mix(in srgb, var(--accent) 40%, var(--surface))"), meaning: "provably safe (only with \"highlight provable cells\" on)" },
      { sample: sample("color-mix(in srgb, var(--danger) 40%, var(--surface))"), meaning: "provably a mine (only with \"highlight provable cells\" on)" },
      { sample: sample("var(--surface)", `<rect x="0.4" y="0.4" width="9.2" height="9.2" rx="1.5" fill="none" stroke="var(--focus)" stroke-width="0.8"/>`), meaning: "keyboard cursor (shown while using the keyboard)" },
    ],
    controls: [
      { how: "click or tap a hidden cell", what: "open it" },
      { how: "right-click, or long-press on touch", what: "flag it as a mine (again to take the flag off)" },
      { how: "click or right-click an open number that has all its flags", what: "open its other neighbors: pointing at it shows which (middle-click or enter does the same; \"open around finished numbers\" in assists does it by itself)" },
      { how: "press, then drag off the cell before letting go", what: "change your mind: nothing happens" },
    ],
    mount(root, { session, settings }) {
      style("mines", CSS);
      const p = session.puzzle;
      const n = p.w * p.h;
      const nums = numbers(p);
      const flagNode = assetNode(look.asset("mines.flag", ASSETS.flag));
      const mineNode = assetNode(look.asset("mines.mine", ASSETS.mine));
      const wrongNode = assetNode(look.asset("mines.wrong", ASSETS.wrong));
      const sides = labelSides();
      const pad = { top: sides.has("top") ? EDGE : 0, right: sides.has("right") ? EDGE : 0, bottom: sides.has("bottom") ? EDGE : 0, left: sides.has("left") ? EDGE : 0 };
      const vw = p.w * SIZE + pad.left + pad.right, vh = p.h * SIZE + pad.top + pad.bottom;
      const svg = s("svg", {
        viewBox: `${-pad.left} ${-pad.top} ${vw} ${vh}`, class: "mines-board", role: "grid",
        "aria-label": `${p.w} by ${p.h} minefield`,
      });
      root.append(svg);

      const cells: SVGRectElement[] = [];
      const deco: SVGGElement[] = [];
      for (let c = 0; c < n; c++) {
        const x = (c % p.w) * SIZE, y = Math.floor(c / p.w) * SIZE;
        const r = s("rect", { x, y, width: SIZE, height: SIZE, rx: 1.2, class: "c closed", "data-cell": c });
        const g = s("g", { transform: `translate(${x} ${y})`, class: "deco" });
        svg.append(r, g);
        cells.push(r);
        deco.push(g);
      }
      const edge = (x: number, y: number, text: string) => svg.append(s("text", { x, y, class: "edge" }, text));
      for (let x = 0; x < p.w; x++) {
        if (pad.top) edge(x * SIZE + SIZE / 2, -EDGE / 2, colName(x));
        if (pad.bottom) edge(x * SIZE + SIZE / 2, p.h * SIZE + EDGE / 2, colName(x));
      }
      for (let y = 0; y < p.h; y++) {
        if (pad.left) edge(-EDGE / 2, y * SIZE + SIZE / 2, rowName(y));
        if (pad.right) edge(p.w * SIZE + EDGE / 2, y * SIZE + SIZE / 2, rowName(y));
      }
      const overlay = s("g");
      const cursor = s("rect", { width: SIZE, height: SIZE, rx: 1.5, class: "cursor" });
      svg.append(overlay, cursor);

      let pressed: number[] = [];
      /** Cell under the mouse, or -1. */
      let hover = -1;
      /** Last cell pointed at or moved to; what aimed techniques act on. */
      let aim = session.interaction.cursor;
      let ghost: MinesState | null = null;
      const drawn: string[] = Array.from({ length: n }, () => "");
      const neighbours = (cell: number) => {
        const out: number[] = [];
        const x = cell % p.w, y = Math.floor(cell / p.w);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if ((dx || dy) && nx >= 0 && ny >= 0 && nx < p.w && ny < p.h) out.push(ny * p.w + nx);
        }
        return out;
      };
      /** A number whose every neighbor is open or flagged has nothing left to say. */
      const isDone = (st: MinesState, c: number) => neighbours(c).every((d) => st.open[d] || st.flags[d]);

      const render = () => {
        const st = session.state;
        const d = session.derived();
        const dead = st.dead >= 0;
        const solved = session.solved;
        const ded = d[DEDUCED_KEY] as { safe: number[]; mines: number[] } | undefined;
        const safeHint = new Set(ded?.safe ?? []);
        const mineHint = new Set(ded?.mines ?? []);
        const press = new Set(pressed);
        const around = new Set((settings.chordOnClick || settings.chordOnRightClick) && hover >= 0 && !pressed.length ? chordCells(p, st, hover) : []);
        for (let c = 0; c < n; c++) {
          const open = st.open[c] === 1;
          const isMine = p.mines[c] === 1;
          const flagged = st.flags[c] === 1;
          let cls = "c ";
          if (c === st.dead) cls += "boom";
          else if (open) {
            cls += settings.dimDone && nums[c] && isDone(st, c) ? "open done" : "open";
            if ((settings.chordOnClick || settings.chordOnRightClick) && nums[c] && !dead && chordCells(p, st, c).length) cls += " chordable";
          }
          else {
            cls += "closed";
            if (press.has(c)) cls += " pressed";
            else if (around.has(c)) cls += " around";
            else if (safeHint.has(c)) cls += " safe-hint";
            else if (mineHint.has(c) && !flagged) cls += " mine-hint";
          }
          cells[c]!.setAttribute("class", cls);
          deco[c]!.classList.toggle("done", cls.includes("done"));
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
          else if (key === "mine") g.append(mineNode());
          else if (key === "flag") g.append(flagNode());
          else if (key === "wrong") g.append(flagNode(), wrongNode());
        }
        while (overlay.firstChild) overlay.firstChild.remove();
        const focus = session.activeHint?.focus as MinesFocus | undefined;
        const box = (c: number, cls: string) => s("rect", {
          x: (c % p.w) * SIZE + 0.6, y: Math.floor(c / p.w) * SIZE + 0.6, width: SIZE - 1.2, height: SIZE - 1.2, rx: 1.2, class: cls,
        });
        if (ghost) {
          for (let c = 0; c < n; c++) {
            const at = (node: Element) => { const g = s("g", { transform: `translate(${(c % p.w) * SIZE} ${Math.floor(c / p.w) * SIZE})`, class: "pv" }); g.append(node); overlay.append(g); };
            if (ghost.open[c] && !st.open[c]) {
              at(s("rect", { width: SIZE, height: SIZE, rx: 1.2, class: "pv-open" }));
              if (nums[c] && !p.mines[c]) at(s("text", { x: 5, y: 5.4, class: `n${nums[c]}` }, String(nums[c])));
            } else if (ghost.flags[c] && !st.flags[c]) at(flagNode());
            else if ((!ghost.open[c] && st.open[c]) || (!ghost.flags[c] && st.flags[c])) at(s("rect", { width: SIZE, height: SIZE, rx: 1.2, class: "pv-closed" }));
          }
        }
        for (const c of focus?.sources ?? []) overlay.append(box(c, "source"));
        for (const c of focus?.cells ?? []) overlay.append(box(c, "hint"));
        const cur = session.interaction.cursor;
        cursor.setAttribute("x", String((cur % p.w) * SIZE));
        cursor.setAttribute("y", String(Math.floor(cur / p.w) * SIZE));
      };

      const primary = (cell: number) => {
        const st = session.state;
        if (st.open[cell]) {
          if (settings.chordOnClick) session.dispatch({ type: "chord", cell });
        } else if (session.interaction.flagMode) session.dispatch(toggleFlag(st, cell));
        else session.dispatch({ type: "open", cells: [cell] });
      };
      const setCursor = (cell: number) => session.setInteraction((i) => (i.cursor === cell ? i : { ...i, cursor: cell }));
      const cellAt = (e: MouseEvent): number => {
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
        if (session.locked) pressed = [];
        else if (st.open[cell] || button === 1) pressed = neighbours(cell).filter((d) => !st.open[d] && !st.flags[d]);
        else pressed = st.flags[cell] || session.interaction.flagMode ? [] : [cell];
        render();
      };

      const onContext = (e: Event) => e.preventDefault();
      const onDown = (e: PointerEvent) => {
        const cell = cellAt(e);
        if (cell < 0) return;
        setCursor(cell);
        clearDown();
        if (e.button !== 0 && e.button !== 1) return;
        e.preventDefault();
        const timer = e.pointerType === "mouse" ? 0 : window.setTimeout(() => {
          if (!down) return;
          down.consumed = true;
          pressed = [];
          if (!session.state.open[down.cell]) {
            session.dispatch(toggleFlag(session.state, down.cell));
            navigator.vibrate?.(15);
          }
          render();
        }, settings.longPressMs as number);
        down = { cell, button: e.button, id: e.pointerId, x: e.clientX, y: e.clientY, timer, consumed: false };
        showPressed(cell, e.button);
      };
      const onMove = (e: PointerEvent) => {
        if (!down && e.pointerType === "mouse") {
          const cell = cellAt(e);
          if (cell !== hover) {
            hover = cell;
            if (cell >= 0) aim = cell;
            render();
          }
          return;
        }
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
      };
      const up = (e: PointerEvent) => {
        if (!down || e.pointerId !== down.id) return;
        const d = down;
        clearDown();
        if (d.consumed || e.type === "pointercancel") return;
        if (cellAt(e) !== d.cell) return;
        if (d.button === 1) session.dispatch({ type: "chord", cell: d.cell });
        else primary(d.cell);
      };
      const onLeave = (e: PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        hover = -1;
        clearDown();
        render();
      };
      svg.addEventListener("contextmenu", onContext);
      svg.addEventListener("pointerdown", onDown);
      svg.addEventListener("pointermove", onMove);
      svg.addEventListener("pointerup", up);
      svg.addEventListener("pointercancel", up);
      svg.addEventListener("pointerleave", onLeave);

      const move = (dx: number, dy: number) => () => {
        session.setInteraction((i) => {
          const x = Math.min(p.w - 1, Math.max(0, (i.cursor % p.w) + dx));
          const y = Math.min(p.h - 1, Math.max(0, Math.floor(i.cursor / p.w) + dy));
          return { ...i, cursor: y * p.w + x };
        });
      };
      const atCursor = (f: (c: number) => void) => () => f(session.interaction.cursor);

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(({ prev, interaction }) => {
          if (prev.cursor !== interaction.cursor) aim = interaction.cursor;
          render();
        }, { owner: "view" }),
        session.hooks.refresh.tap(render, { owner: "view" }),
      ];
      render();

      const rects = (list: Iterable<number>) => [...new Set(list)].map((c) => cells[c]!.getBoundingClientRect());
      const commands: CommandDef[] = bindCommands(BINDINGS, {
        "mines.left": move(-1, 0),
        "mines.right": move(1, 0),
        "mines.up": move(0, -1),
        "mines.down": move(0, 1),
        "mines.open": atCursor((c) => (session.state.open[c] ? session.dispatch({ type: "chord", cell: c }) : session.dispatch({ type: "open", cells: [c] }))),
        "mines.flag": atCursor((c) => session.dispatch(toggleFlag(session.state, c))),
        "mines.chord": atCursor((c) => session.dispatch({ type: "chord", cell: c })),
        "mines.mode": () => session.setInteraction((i) => ({ ...i, flagMode: !i.flagMode })),
        "mines.flag-at": (_ctx, e) => {
          const cell = e instanceof MouseEvent ? cellAt(e) : -1;
          if (cell < 0) return false;
          setCursor(cell);
          if (session.state.open[cell]) {
            if (settings.chordOnRightClick) session.dispatch({ type: "chord", cell });
            return true;
          }
          session.dispatch(toggleFlag(session.state, cell));
          return true;
        },
      }, {
        "mines.mode": { checked: () => session.interaction.flagMode },
      });
      return {
        aspect: vw / vh,
        cells: { cols: vw / SIZE, rows: vh / SIZE },
        target: () => aim,
        preview: (state) => {
          ghost = state as MinesState | null;
          render();
        },
        gestures: { secondaryClick: true, hold: true },
        commands,
        context: () => ({ minesFlagMode: session.interaction.flagMode, minesLost: session.state.dead >= 0 }),
        locate: (focus) => {
          const f = focus as MinesFocus | undefined;
          return f ? rects([...(f.cells ?? []), ...(f.sources ?? [])]) : [];
        },
        locateChange: (a, b) => {
          const x = a as MinesState, y = b as MinesState;
          const out: number[] = [];
          for (let c = 0; c < n; c++) if (x.open[c] !== y.open[c] || x.flags[c] !== y.flags[c]) out.push(c);
          return rects(out);
        },
        destroy() {
          clearDown();
          offs.forEach((f) => f());
          svg.remove();
        },
      };
    },
  };
}
