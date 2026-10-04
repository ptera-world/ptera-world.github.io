import { bindCommands, type BindingSchema } from "../../core/commands";
import { s, style } from "../../core/dom";
import { defineSchema } from "../../core/schema";
import type { View } from "../../core/types";
import type { SixteenAction, SixteenFocus, SixteenInteraction, SixteenPuzzle, SixteenState } from "./logic";

const SIZE = 10;
/** Space for the arrow strip on each side. */
const EDGE = 6;
const DRAG_PX = 8;
let mounts = 0;

const CSS = `
.sixteen-board { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; }
.sixteen-board .slot { fill: var(--surface-2); }
.sixteen-board .tile { cursor: grab; transition: transform 100ms ease-out; }
.sixteen-board .tile.jump { transition: none; }
.sixteen-board .tile rect { fill: var(--cell); stroke: var(--border); stroke-width: 0.25; }
.sixteen-board .tile.home rect { fill: color-mix(in srgb, var(--accent) 16%, var(--cell)); }
.sixteen-board .tile text { fill: var(--text); font: 600 4.4px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.sixteen-board .arrow { fill: var(--text-dim); cursor: pointer; }
.sixteen-board .arrow:hover { fill: var(--accent); }
.sixteen-board .arrow-hit { fill: transparent; cursor: pointer; }
.sixteen-board .mark { fill: none; stroke: var(--hint); pointer-events: none; }
.sixteen-board .mark.moving { stroke-width: 0.5; stroke-opacity: 0.8; }
.sixteen-board .mark.home { stroke-width: 0.7; stroke-dasharray: 1.2 0.8; }
.sixteen-board .mark.tile { stroke-width: 1; }
.sixteen-board .ghost { pointer-events: none; opacity: 0.7; }
.sixteen-board .ghost rect { fill: color-mix(in srgb, var(--cell) 70%, transparent); stroke: var(--text-dim); stroke-width: 0.35; stroke-dasharray: 1 0.7; }
.sixteen-board .ghost text { fill: var(--text-dim); font: 600 4.4px var(--font); text-anchor: middle; dominant-baseline: central; }
.sixteen-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
[data-input="pointer"] .sixteen-board .cursor { display: none; }
@media (prefers-reduced-motion: reduce) { .sixteen-board .tile { transition: none; } }
`;

const settings = defineSchema({
  tintHome: { type: "bool", label: "tint numbers that are in their final spot", default: true },
});

const BINDINGS: BindingSchema = {
  "sixteen.left": { label: "cursor left", category: "sixteen", keys: ["ArrowLeft", "a"] },
  "sixteen.right": { label: "cursor right", category: "sixteen", keys: ["ArrowRight", "d"] },
  "sixteen.up": { label: "cursor up", category: "sixteen", keys: ["ArrowUp", "w"] },
  "sixteen.down": { label: "cursor down", category: "sixteen", keys: ["ArrowDown", "s"] },
  "sixteen.row-left": { label: "slide row left", category: "sixteen", keys: ["shift+ArrowLeft", "shift+a"], description: "slide the selected tile's row one place left" },
  "sixteen.row-right": { label: "slide row right", category: "sixteen", keys: ["shift+ArrowRight", "shift+d"], description: "slide the selected tile's row one place right" },
  "sixteen.col-up": { label: "slide column up", category: "sixteen", keys: ["shift+ArrowUp", "shift+w"], description: "slide the selected tile's column one place up" },
  "sixteen.col-down": { label: "slide column down", category: "sixteen", keys: ["shift+ArrowDown", "shift+s"], description: "slide the selected tile's column one place down" },
};

const swatch = (body: string, vb = "-0.5 -0.5 11 11") => `<svg viewBox="${vb}">${body}</svg>`;
const tileSample = (fill: string) =>
  `<rect x="0.2" y="0.2" width="9.6" height="9.6" rx="1" fill="${fill}" stroke="var(--border)" stroke-width="0.25"/><text x="5" y="5.3" fill="var(--text)" font-size="4.4" font-weight="600" font-family="var(--font)" text-anchor="middle" dominant-baseline="central">7</text>`;
const box = (extra: string) => `<rect x="0.5" y="0.5" width="9" height="9" rx="1" fill="none" stroke="var(--hint)" ${extra}/>`;

/** Arrow triangle pointing `dir` (0 right, 1 down, 2 left, 3 up) centerd on (cx, cy). */
function tri(cx: number, cy: number, dir: number): string {
  const pts = [[1.6, 0], [-1.2, -1.8], [-1.2, 1.8]].map(([x, y]) => {
    const a = (dir * Math.PI) / 2;
    return `${(cx + x! * Math.cos(a) - y! * Math.sin(a)).toFixed(2)},${(cy + x! * Math.sin(a) + y! * Math.cos(a)).toFixed(2)}`;
  });
  return pts.join(" ");
}

export const sixteenView: View<SixteenPuzzle, SixteenState, SixteenAction, SixteenInteraction> = {
  id: "sixteen.svg",
  name: "tiles",
  puzzle: "sixteen",
  settings,
  controls: [
    { how: "click or tap an arrow at the end of a row or column", what: "slide that line one place the way the arrow points" },
    { how: "drag a tile sideways or up and down", what: "slide its row or column by as many places as you drag" },
  ],
  legend: [
    { sample: swatch(tileSample("var(--cell)")), meaning: "a number" },
    { sample: swatch(tileSample("color-mix(in srgb, var(--accent) 16%, var(--cell))")), meaning: "a number in its final spot (with the tint setting on)" },
    { sample: swatch(`<polygon points="${tri(5, 5, 0)}" fill="var(--text-dim)"/>`, "2 2 6 6"), meaning: "slides its row or column this way" },
    { sample: swatch(tileSample("var(--cell)") + box(`stroke-width="1"`)), meaning: "hint: the number being brought home" },
    { sample: swatch(`<rect width="10" height="10" fill="var(--surface-2)"/>` + box(`stroke-width="0.7" stroke-dasharray="1.2 0.8"`)), meaning: "hint: where it goes" },
    { sample: swatch(tileSample("var(--cell)") + box(`stroke-width="0.5" stroke-opacity="0.8"`)), meaning: "hint: the tiles the suggested slides move" },
  ],
  mount(root, { session, settings }) {
    style("sixteen", CSS);
    const p = session.puzzle;
    const n = p.w * p.h;
    const W = p.w * SIZE, H = p.h * SIZE;
    const svg = s("svg", {
      viewBox: `${-EDGE} ${-EDGE} ${W + 2 * EDGE} ${H + 2 * EDGE}`,
      class: "sixteen-board", role: "grid", "aria-label": `${p.w} by ${p.h} sixteen`,
    });
    const clipId = `sixteen-clip-${++mounts}`;
    const clip = s("clipPath", { id: clipId }, s("rect", { x: 0, y: 0, width: W, height: H }));
    const slots = Array.from({ length: n }, (_, c) => s("rect", {
      x: (c % p.w) * SIZE + 0.2, y: Math.floor(c / p.w) * SIZE + 0.2, width: SIZE - 0.4, height: SIZE - 0.4, rx: 1, class: "slot",
    }));
    const tileLayer = s("g", { "clip-path": `url(#${clipId})` });
    const tiles: SVGGElement[] = [];
    for (let t = 1; t <= n; t++) {
      const g = s("g", { class: "tile" },
        s("rect", { x: 0.2, y: 0.2, width: SIZE - 0.4, height: SIZE - 0.4, rx: 1 }),
        s("text", { x: SIZE / 2, y: SIZE / 2 + 0.3 }, String(t)));
      tiles[t] = g;
      tileLayer.append(g);
    }
    const arrows = s("g");
    const arrow = (cx: number, cy: number, dir: number, a: SixteenAction) => {
      const hit = s("rect", { x: cx - EDGE / 2, y: cy - EDGE / 2, width: EDGE, height: EDGE, class: "arrow-hit" });
      const poly = s("polygon", { points: tri(cx, cy, dir), class: "arrow" });
      const g = s("g", {}, hit, poly);
      g.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); session.dispatch(a); });
      arrows.append(g);
    };
    for (let y = 0; y < p.h; y++) {
      const cy = y * SIZE + SIZE / 2;
      arrow(-EDGE / 2, cy, 2, { type: "shift", line: "row", index: y, by: -1 });
      arrow(W + EDGE / 2, cy, 0, { type: "shift", line: "row", index: y, by: 1 });
    }
    for (let x = 0; x < p.w; x++) {
      const cx = x * SIZE + SIZE / 2;
      arrow(cx, -EDGE / 2, 3, { type: "shift", line: "col", index: x, by: -1 });
      arrow(cx, H + EDGE / 2, 1, { type: "shift", line: "col", index: x, by: 1 });
    }
    const ghost = s("g", { class: "ghost" });
    const overlay = s("g");
    const cursor = s("rect", { width: SIZE, height: SIZE, rx: 1.2, class: "cursor" });
    svg.append(s("defs", {}, clip), ...slots, tileLayer, ghost, arrows, overlay, cursor);
    let previewing: SixteenState | null = null;
    root.append(svg);

    const where: number[] = [];
    let drag: { id: number; cell: number; x: number; y: number; axis: "row" | "col" | null; px: number } | null = null;

    const render = () => {
      const st = session.state;
      st.tiles.forEach((t, c) => {
        const g = tiles[t]!;
        const x = c % p.w, y = Math.floor(c / p.w);
        const old = where[t];
        const jump = old !== undefined && (Math.abs((old % p.w) - x) > 1 || Math.abs(Math.floor(old / p.w) - y) > 1);
        g.classList.toggle("jump", jump);
        g.style.transform = `translate(${x * SIZE}px, ${y * SIZE}px)`;
        g.setAttribute("data-cell", String(c));
        g.classList.toggle("home", !!settings.tintHome && t === c + 1);
        where[t] = c;
      });
      ghost.replaceChildren();
      previewing?.tiles.forEach((t, c) => {
        if (t === st.tiles[c]) return;
        ghost.append(s("g", { transform: `translate(${(c % p.w) * SIZE} ${Math.floor(c / p.w) * SIZE})` },
          s("rect", { x: 0.2, y: 0.2, width: SIZE - 0.4, height: SIZE - 0.4, rx: 1 }),
          s("text", { x: SIZE / 2, y: SIZE / 2 + 0.3 }, String(t))));
      });
      overlay.replaceChildren();
      const f = session.activeHint?.focus as SixteenFocus | undefined;
      const mark = (c: number, cls: string, inset: number) => overlay.append(s("rect", {
        x: (c % p.w) * SIZE + inset, y: Math.floor(c / p.w) * SIZE + inset, width: SIZE - 2 * inset, height: SIZE - 2 * inset, rx: 1, class: `mark ${cls}`,
      }));
      for (const c of f?.moving ?? []) mark(c, "moving", 0.6);
      if (f?.home !== undefined) mark(f.home, "home", 0.9);
      if (f?.tile !== undefined) mark(f.tile, "tile", 0.5);
      const cur = session.interaction.cursor;
      cursor.setAttribute("x", String((cur % p.w) * SIZE));
      cursor.setAttribute("y", String(Math.floor(cur / p.w) * SIZE));
    };

    const pxPerUnit = () => svg.getBoundingClientRect().width / (W + 2 * EDGE);
    const lineCells = (axis: "row" | "col", cell: number) => axis === "row"
      ? Array.from({ length: p.w }, (_, x) => Math.floor(cell / p.w) * p.w + x)
      : Array.from({ length: p.h }, (_, y) => y * p.w + (cell % p.w));
    const preview = (dx: number) => {
      if (!drag?.axis) return;
      for (const c of lineCells(drag.axis, drag.cell)) {
        const g = tiles[session.state.tiles[c]!]!;
        const x = (c % p.w) * SIZE + (drag.axis === "row" ? dx : 0), y = Math.floor(c / p.w) * SIZE + (drag.axis === "col" ? dx : 0);
        g.classList.add("jump");
        g.style.transform = `translate(${x}px, ${y}px)`;
      }
    };
    const onDown = (e: PointerEvent) => {
      const el = (e.target as Element).closest(".tile");
      if (!el || e.button !== 0 || session.locked) return;
      e.preventDefault();
      const cell = Number(el.getAttribute("data-cell"));
      session.setInteraction((i) => ({ ...i, cursor: cell }));
      drag = { id: e.pointerId, cell, x: e.clientX, y: e.clientY, axis: null, px: pxPerUnit() };
      svg.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.axis && Math.hypot(dx, dy) > DRAG_PX) drag.axis = Math.abs(dx) > Math.abs(dy) ? "row" : "col";
      if (drag.axis) preview((drag.axis === "row" ? dx : dy) / drag.px);
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      const delta = d.axis ? ((d.axis === "row" ? e.clientX - d.x : e.clientY - d.y) / d.px) / SIZE : 0;
      const by = Math.round(delta);
      if (d.axis && by && e.type === "pointerup") {
        const index = d.axis === "row" ? Math.floor(d.cell / p.w) : d.cell % p.w;
        if (!session.dispatch({ type: "shift", line: d.axis, index, by })) render();
      } else render();
    };
    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onUp);

    const moveCursor = (dx: number, dy: number) => () => session.setInteraction((i) => {
      const x = Math.min(p.w - 1, Math.max(0, (i.cursor % p.w) + dx));
      const y = Math.min(p.h - 1, Math.max(0, Math.floor(i.cursor / p.w) + dy));
      return { ...i, cursor: y * p.w + x };
    });
    const slide = (line: "row" | "col", by: number) => () => {
      const c = session.interaction.cursor;
      const x = c % p.w, y = Math.floor(c / p.w);
      if (!session.dispatch({ type: "shift", line, index: line === "row" ? y : x, by })) return;
      const nx = line === "row" ? (x + by + p.w) % p.w : x, ny = line === "col" ? (y + by + p.h) % p.h : y;
      session.setInteraction((i) => ({ ...i, cursor: ny * p.w + nx }));
    };

    const offs = [
      session.hooks.change.tap(render, { owner: "view" }),
      session.hooks.interaction.tap(render, { owner: "view" }),
      session.hooks.refresh.tap(render, { owner: "view" }),
    ];
    render();
    const rects = (cells: Iterable<number>) => [...new Set(cells)].map((c) => slots[c]!.getBoundingClientRect());
    return {
      aspect: (W + 2 * EDGE) / (H + 2 * EDGE),
      cells: { cols: p.w + 1, rows: p.h + 1 },
      commands: bindCommands(BINDINGS, {
        "sixteen.left": moveCursor(-1, 0),
        "sixteen.right": moveCursor(1, 0),
        "sixteen.up": moveCursor(0, -1),
        "sixteen.down": moveCursor(0, 1),
        "sixteen.row-left": slide("row", -1),
        "sixteen.row-right": slide("row", 1),
        "sixteen.col-up": slide("col", -1),
        "sixteen.col-down": slide("col", 1),
      }),
      preview: (state) => {
        previewing = state as SixteenState | null;
        render();
      },
      locate: (focus) => {
        const f = focus as SixteenFocus | undefined;
        if (!f) return [];
        return rects([...(f.moving ?? []), ...(f.home !== undefined ? [f.home] : []), ...(f.tile !== undefined ? [f.tile] : [])]);
      },
      locateChange: (a, b) => {
        const x = (a as SixteenState).tiles, y = (b as SixteenState).tiles;
        return rects(x.flatMap((t, c) => (t !== y[c] ? [c] : [])));
      },
      destroy() {
        offs.forEach((f) => f());
        svg.remove();
      },
    };
  },
};
