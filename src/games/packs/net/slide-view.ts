import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { s, style, inputIs } from "../../core/dom";
import type { View } from "../../core/types";
import { D, L, R, U, centre, connectedFrom, degree, neighbour, type NetPuzzle } from "./grid";
import { net, type NetAction, type NetInteraction, type NetState } from "./logic";
import { movable, type ShiftAction, type SlideFocus } from "./slide";

const SIZE = 10;
const EDGE = 6;
const DRAG_PX = 8;
let mounts = 0;

const CSS = `
.net-slide-board { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; }
.net-slide-board .slot { fill: var(--surface-2); }
.net-slide-board .tile { cursor: grab; transition: transform 100ms ease-out; }
.net-slide-board .tile.jump { transition: none; }
.net-slide-board .tile.fixed { cursor: default; }
.net-slide-board .tile rect { fill: var(--cell); stroke: var(--border); stroke-width: 0.2; }
.net-slide-board .pipe { stroke: var(--text-dim); stroke-width: 2; stroke-linecap: butt; fill: none; }
.net-slide-board .cap { fill: var(--cell); stroke: var(--text-dim); stroke-width: 0.9; }
.net-slide-board .tile.on .pipe { stroke: var(--accent); }
.net-slide-board .tile.on .cap { stroke: var(--accent); }
.net-slide-board .hub { fill: var(--accent); }
.net-slide-board .barrier { stroke: var(--text); stroke-width: 1.2; stroke-linecap: round; pointer-events: none; }
.net-slide-board .arrow { fill: var(--text-dim); cursor: pointer; }
.net-slide-board .arrow:hover { fill: var(--accent); }
.net-slide-board .arrow-hit { fill: transparent; cursor: pointer; }
.net-slide-board .mark { fill: none; stroke: var(--hint); pointer-events: none; }
.net-slide-board .ghost { pointer-events: none; opacity: 0.55; }
.net-slide-board .ghost rect { fill: color-mix(in srgb, var(--cell) 60%, transparent); stroke: var(--text-dim); stroke-width: 0.35; stroke-dasharray: 1 0.7; }
.net-slide-board .mark.moving { stroke-width: 0.5; stroke-opacity: 0.8; }
.net-slide-board .mark.home { stroke-width: 0.7; stroke-dasharray: 1.2 0.8; }
.net-slide-board .mark.tile { stroke-width: 1; }
.net-slide-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
${inputIs("pointer")} .net-slide-board .cursor { display: none; }
@media (prefers-reduced-motion: reduce) { .net-slide-board .tile { transition: none; } }
`;

const BINDINGS = {
  "net.slide-left": { label: "cursor left", category: "net", keys: ["ArrowLeft", "a"] },
  "net.slide-right": { label: "cursor right", category: "net", keys: ["ArrowRight", "d"] },
  "net.slide-up": { label: "cursor up", category: "net", keys: ["ArrowUp", "w"] },
  "net.slide-down": { label: "cursor down", category: "net", keys: ["ArrowDown", "s"] },
  "net.row-left": { label: "slide row left", category: "net", keys: ["shift+ArrowLeft", "shift+a"], description: "slide the selected piece's row one place left" },
  "net.row-right": { label: "slide row right", category: "net", keys: ["shift+ArrowRight", "shift+d"], description: "slide the selected piece's row one place right" },
  "net.col-up": { label: "slide column up", category: "net", keys: ["shift+ArrowUp", "shift+w"], description: "slide the selected piece's column one place up" },
  "net.col-down": { label: "slide column down", category: "net", keys: ["shift+ArrowDown", "shift+s"], description: "slide the selected piece's column one place down" },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

/** Arms start a pipe's half-width behind the center, so corners join without a notch. */
const ARM: Record<number, string> = { [R]: "M4 5H10", [U]: "M5 6V0", [L]: "M6 5H0", [D]: "M5 4V10" };

/** Pipe markup for a mask in a 10×10 box. */
function pipes(mask: number): string {
  let out = "";
  for (const d of [R, U, L, D]) if (mask & d) out += `<path d="${ARM[d]}" class="pipe"/>`;
  if (degree(mask) === 1) out += `<rect x="3" y="3" width="4" height="4" rx="0.6" class="cap"/>`;
  return out;
}

function tri(cx: number, cy: number, dir: number): string {
  return [[1.6, 0], [-1.2, -1.8], [-1.2, 1.8]].map(([x, y]) => {
    const a = (dir * Math.PI) / 2;
    return `${(cx + x! * Math.cos(a) - y! * Math.sin(a)).toFixed(2)},${(cy + x! * Math.sin(a) + y! * Math.cos(a)).toFixed(2)}`;
  }).join(" ");
}

const swatch = (body: string, vb = "-0.5 -0.5 11 11") => `<svg viewBox="${vb}">${body}</svg>`;
const sample = (mask: number, colour: string, extra = "") =>
  `<rect x="0.1" y="0.1" width="9.8" height="9.8" fill="var(--cell)" stroke="var(--border)" stroke-width="0.2"/>` +
  [R, U, L, D].filter((d) => mask & d).map((d) => `<path d="${ARM[d]}" stroke="${colour}" stroke-width="2" fill="none"/>`).join("") +
  (degree(mask) === 1 ? `<rect x="3" y="3" width="4" height="4" rx="0.6" fill="var(--cell)" stroke="${colour}" stroke-width="0.9"/>` : "") + extra;
const box = (extra: string) => `<rect x="0.5" y="0.5" width="9" height="9" rx="1" fill="none" stroke="var(--hint)" ${extra}/>`;

export const slideControls = [
  { how: "click or tap an arrow at the end of a row or column", what: "slide that line one place the way the arrow points" },
  { how: "drag a piece sideways or up and down", what: "slide its row or column by as many places as you drag" },
];

export const slideLegend = [
  { sample: swatch(sample(R | L | D, "var(--text-dim)")), meaning: "a pipe piece not yet joined to the center" },
  { sample: swatch(sample(R | L | D, "var(--accent)")), meaning: "a piece joined to the center" },
  { sample: swatch(sample(U, "var(--accent)")), meaning: "a dead end" },
  { sample: swatch(sample(R | D, "var(--accent)", `<circle cx="5" cy="5" r="2" fill="var(--accent)"/>`)), meaning: "the center piece: it never moves" },
  { sample: swatch(`<rect width="10" height="10" fill="var(--cell)"/><line x1="10" y1="0" x2="10" y2="10" stroke="var(--text)" stroke-width="1.2"/>`), meaning: "a wall: no pipe may cross it" },
  { sample: swatch(`<polygon points="${tri(5, 5, 0)}" fill="var(--text-dim)"/>`, "2 2 6 6"), meaning: "slides its row or column this way" },
  { sample: swatch(sample(R | L, "var(--text-dim)") + box(`stroke-width="1"`)), meaning: "hint: the piece being moved into place" },
  { sample: swatch(box(`stroke-width="0.7" stroke-dasharray="1.2 0.8"`)), meaning: "hint: where it goes" },
  { sample: swatch(sample(R | L, "var(--text-dim)") + box(`stroke-width="0.5" stroke-opacity="0.8"`)), meaning: "hint: the pieces the suggested slides move" },
];

/** The board for sliding rows and columns; the net view mounts it for boards that slide. */
export const slideView: View<NetPuzzle, NetState, NetAction, NetInteraction> = {
  id: "net.slide",
  name: "pipes",
  puzzle: net,
  controls: slideControls,
  legend: slideLegend,
  mount(root, { session }) {
    style("net-slide", CSS);
    const p = session.puzzle;
    const n = p.w * p.h;
    const W = p.w * SIZE, H = p.h * SIZE;
    const hub = centre(p);
    const svg = s("svg", { viewBox: `${-EDGE} ${-EDGE} ${W + 2 * EDGE} ${H + 2 * EDGE}`, class: "net-slide-board", role: "grid", "aria-label": `${p.w} by ${p.h} sliding pipes` });
    const clipId = `net-slide-clip-${++mounts}`;
    const slots = Array.from({ length: n }, (_, c) => s("rect", { x: (c % p.w) * SIZE, y: Math.floor(c / p.w) * SIZE, width: SIZE, height: SIZE, class: "slot" }));
    const tileLayer = s("g", { "clip-path": `url(#${clipId})` });
    /** One element per starting cell; ids[c] is the element now at cell c. */
    const tiles = p.tiles.map((mask, i) => {
      const g = s("g", { class: i === hub ? "tile fixed" : "tile" }, s("rect", { x: 0, y: 0, width: SIZE, height: SIZE }));
      const art = s("g");
      art.innerHTML = pipes(mask) + (i === hub ? `<circle cx="5" cy="5" r="2" class="hub"/>` : "");
      g.append(art);
      tileLayer.append(g);
      return g;
    });
    const barriers = s("g");
    for (let c = 0; c < n; c++) {
      const x = (c % p.w) * SIZE, y = Math.floor(c / p.w) * SIZE;
      if (p.barriers[c]! & R && neighbour(p, c, R) >= 0) barriers.append(s("line", { x1: x + SIZE, y1: y, x2: x + SIZE, y2: y + SIZE, class: "barrier" }));
      if (p.barriers[c]! & D && neighbour(p, c, D) >= 0) barriers.append(s("line", { x1: x, y1: y + SIZE, x2: x + SIZE, y2: y + SIZE, class: "barrier" }));
      if (p.wrap && (c % p.w) === 0 && p.barriers[c]! & L) barriers.append(s("line", { x1: x, y1: y, x2: x, y2: y + SIZE, class: "barrier" }));
      if (p.wrap && c < p.w && p.barriers[c]! & U) barriers.append(s("line", { x1: x, y1: y, x2: x + SIZE, y2: y, class: "barrier" }));
    }
    if (!p.wrap) barriers.append(s("rect", { x: 0, y: 0, width: W, height: H, class: "barrier", fill: "none" }));
    const arrows = s("g");
    const arrow = (cx: number, cy: number, dir: number, a: ShiftAction) => {
      if (!movable(p, a)) return;
      const g = s("g", {}, s("rect", { x: cx - EDGE / 2, y: cy - EDGE / 2, width: EDGE, height: EDGE, class: "arrow-hit" }), s("polygon", { points: tri(cx, cy, dir), class: "arrow" }));
      g.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); session.dispatch(a); });
      arrows.append(g);
    };
    for (let y = 0; y < p.h; y++) {
      arrow(-EDGE / 2, y * SIZE + SIZE / 2, 2, { type: "shift", line: "row", index: y, by: -1 });
      arrow(W + EDGE / 2, y * SIZE + SIZE / 2, 0, { type: "shift", line: "row", index: y, by: 1 });
    }
    for (let x = 0; x < p.w; x++) {
      arrow(x * SIZE + SIZE / 2, -EDGE / 2, 3, { type: "shift", line: "col", index: x, by: -1 });
      arrow(x * SIZE + SIZE / 2, H + EDGE / 2, 1, { type: "shift", line: "col", index: x, by: 1 });
    }
    const ghost = s("g", { class: "ghost" });
    const overlay = s("g");
    const cursor = s("rect", { width: SIZE, height: SIZE, rx: 1.2, class: "cursor" });
    svg.append(s("defs", {}, s("clipPath", { id: clipId }, s("rect", { x: 0, y: 0, width: W, height: H }))), ...slots, tileLayer, ghost, barriers, arrows, overlay, cursor);
    let previewing: NetState | null = null;
    root.append(svg);

    let ids = Array.from({ length: n }, (_, c) => c);
    let lastTiles = session.state.tiles;
    /** Follow each element through a change: equal masks are matched nearest-first, so slides animate. */
    const track = () => {
      const st = session.state.tiles;
      if (st === lastTiles) return;
      const used = new Uint8Array(n);
      const next = Array.from({ length: n }, () => -1);
      for (let c = 0; c < n; c++) if (lastTiles[c] === st[c]) { next[c] = ids[c]!; used[c] = 1; }
      for (let c = 0; c < n; c++) {
        if (next[c]! >= 0) continue;
        let best = -1, bestD = Infinity;
        for (let d = 0; d < n; d++) {
          if (used[d] || lastTiles[d] !== st[c]) continue;
          const dx = Math.abs((d % p.w) - (c % p.w)), dy = Math.abs(Math.floor(d / p.w) - Math.floor(c / p.w));
          const dist = Math.min(dx, p.w - dx) + Math.min(dy, p.h - dy);
          if (dist < bestD) { bestD = dist; best = d; }
        }
        if (best < 0) best = used.indexOf(0);
        used[best] = 1;
        next[c] = ids[best]!;
      }
      ids = next;
      lastTiles = st;
    };
    const where: number[] = [];
    let drag: { id: number; cell: number; x: number; y: number; axis: "row" | "col" | null; px: number } | null = null;

    const render = () => {
      track();
      const on = connectedFrom(p, session.state.tiles, hub).cells;
      for (let c = 0; c < n; c++) {
        const id = ids[c]!;
        const g = tiles[id]!;
        const x = c % p.w, y = Math.floor(c / p.w);
        const old = where[id];
        g.classList.toggle("jump", old !== undefined && (Math.abs((old % p.w) - x) > 1 || Math.abs(Math.floor(old / p.w) - y) > 1));
        g.style.transform = `translate(${x * SIZE}px, ${y * SIZE}px)`;
        g.setAttribute("data-cell", String(c));
        g.classList.toggle("on", !!on[c]);
        where[id] = c;
      }
      ghost.replaceChildren();
      previewing?.tiles.forEach((mask, c) => {
        if (mask === session.state.tiles[c]) return;
        const g = s("g", { transform: `translate(${(c % p.w) * SIZE} ${Math.floor(c / p.w) * SIZE})` }, s("rect", { x: 0.3, y: 0.3, width: SIZE - 0.6, height: SIZE - 0.6, rx: 0.8 }));
        const art = s("g");
        art.innerHTML = pipes(mask);
        g.append(art);
        ghost.append(g);
      });
      overlay.replaceChildren();
      const f = session.activeHint?.focus as SlideFocus | undefined;
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

    const lineCells = (axis: "row" | "col", cell: number) => axis === "row"
      ? Array.from({ length: p.w }, (_, x) => Math.floor(cell / p.w) * p.w + x)
      : Array.from({ length: p.h }, (_, y) => y * p.w + (cell % p.w));
    const lineOf = (axis: "row" | "col", cell: number) => ({ line: axis, index: axis === "row" ? Math.floor(cell / p.w) : cell % p.w });
    const onDown = (e: PointerEvent) => {
      const el = (e.target as Element).closest(".tile");
      if (!el || e.button !== 0 || session.locked) return;
      e.preventDefault();
      const cell = Number(el.getAttribute("data-cell"));
      session.setInteraction((i) => ({ ...i, cursor: cell }));
      drag = { id: e.pointerId, cell, x: e.clientX, y: e.clientY, axis: null, px: svg.getBoundingClientRect().width / (W + 2 * EDGE) };
      svg.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.axis && Math.hypot(dx, dy) > DRAG_PX) {
        const axis = Math.abs(dx) > Math.abs(dy) ? "row" : "col";
        if (movable(p, lineOf(axis, drag.cell))) drag.axis = axis;
      }
      if (!drag.axis) return;
      const off = (drag.axis === "row" ? dx : dy) / drag.px;
      for (const c of lineCells(drag.axis, drag.cell)) {
        const g = tiles[ids[c]!]!;
        g.classList.add("jump");
        g.style.transform = `translate(${(c % p.w) * SIZE + (drag.axis === "row" ? off : 0)}px, ${Math.floor(c / p.w) * SIZE + (drag.axis === "col" ? off : 0)}px)`;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      const by = d.axis ? Math.round(((d.axis === "row" ? e.clientX - d.x : e.clientY - d.y) / d.px) / SIZE) : 0;
      if (d.axis && by && e.type === "pointerup" && session.dispatch({ type: "shift", ...lineOf(d.axis, d.cell), by })) return;
      render();
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
        "net.slide-left": moveCursor(-1, 0),
        "net.slide-right": moveCursor(1, 0),
        "net.slide-up": moveCursor(0, -1),
        "net.slide-down": moveCursor(0, 1),
        "net.row-left": slide("row", -1),
        "net.row-right": slide("row", 1),
        "net.col-up": slide("col", -1),
        "net.col-down": slide("col", 1),
      }, {
        "net.row-left": { menu: "board" },
        "net.row-right": { menu: "board" },
        "net.col-up": { menu: "board" },
        "net.col-down": { menu: "board" },
      }),
      preview: (state) => {
        previewing = state as NetState | null;
        render();
      },
      locate: (focus) => {
        const f = focus as SlideFocus | undefined;
        if (!f) return [];
        return rects([...(f.moving ?? []), ...(f.home !== undefined ? [f.home] : []), ...(f.tile !== undefined ? [f.tile] : [])]);
      },
      locateChange: (a, b) => {
        const x = (a as NetState).tiles, y = (b as NetState).tiles;
        return rects(x.flatMap((t, c) => (t !== y[c] ? [c] : [])));
      },
      destroy() {
        offs.forEach((f) => f());
        svg.remove();
      },
    };
  },
};
