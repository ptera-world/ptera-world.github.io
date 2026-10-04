import { bindCommands, type BindingSchema } from "../../core/commands";
import { s, style } from "../../core/dom";
import { defineSchema } from "../../core/schema";
import type { View } from "../../core/types";
import { goalTile, type TwiddleAction, type TwiddleFocus, type TwiddleInteraction, type TwiddlePuzzle, type TwiddleState } from "./logic";

const SIZE = 10;

const CSS = `
.twiddle-board { display: block; width: 100%; height: 100%; touch-action: manipulation; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.twiddle-board .tile { transition: transform 120ms ease-out; cursor: pointer; }
.twiddle-board .tile rect { fill: var(--cell); stroke: var(--border); stroke-width: 0.25; }
.twiddle-board .tile.home rect { fill: color-mix(in srgb, var(--accent) 16%, var(--cell)); }
.twiddle-board .tile .face { transition: transform 120ms ease-out; }
.twiddle-board .tile text { fill: var(--text); font: 600 4.4px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.twiddle-board .tile .up { stroke: var(--text-dim); stroke-width: 0.5; stroke-linecap: round; pointer-events: none; }
.twiddle-board .block { fill: none; stroke: var(--accent); stroke-width: 0.6; pointer-events: none; }
.twiddle-board .mark { fill: none; stroke: var(--hint); pointer-events: none; }
.twiddle-board .ghost { pointer-events: none; opacity: 0.7; }
.twiddle-board .ghost rect { fill: color-mix(in srgb, var(--cell) 70%, transparent); stroke: var(--text-dim); stroke-width: 0.35; stroke-dasharray: 1 0.7; }
.twiddle-board .ghost text { fill: var(--text-dim); font: 600 4.4px var(--font); text-anchor: middle; dominant-baseline: central; }
.twiddle-board .mark.moving { stroke-width: 0.5; stroke-opacity: 0.8; }
.twiddle-board .mark.home { stroke-width: 0.7; stroke-dasharray: 1.2 0.8; }
.twiddle-board .mark.tile { stroke-width: 1; }
.twiddle-board .mark.block { stroke-width: 0.8; stroke-dasharray: 2 1; }
.twiddle-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
[data-input="pointer"] .twiddle-board .cursor { display: none; }
@media (prefers-reduced-motion: reduce) { .twiddle-board .tile, .twiddle-board .tile .face { transition: none; } }
`;

const settings = defineSchema({
  tintHome: { type: "bool", label: "tint tiles that are in their final spot (and upright)", default: true },
  showBlock: { type: "bool", label: "outline the block a click would turn", default: true },
});

const BINDINGS: BindingSchema = {
  "twiddle.left": { label: "select block left", category: "twiddle", keys: ["ArrowLeft", "a"] },
  "twiddle.right": { label: "select block right", category: "twiddle", keys: ["ArrowRight", "d"] },
  "twiddle.up": { label: "select block up", category: "twiddle", keys: ["ArrowUp", "w"] },
  "twiddle.down": { label: "select block down", category: "twiddle", keys: ["ArrowDown", "s"] },
  "twiddle.ccw": { label: "turn counterclockwise", category: "twiddle", keys: ["space", "Enter"], description: "turn the selected block a quarter turn counterclockwise" },
  "twiddle.cw": { label: "turn clockwise", category: "twiddle", keys: ["shift+space", "shift+Enter", "x"], description: "turn the selected block a quarter turn clockwise" },
  "twiddle.cw-at": { label: "turn clockwise (pointer)", category: "twiddle", mouse: ["rightclick"], description: "turn the block under the pointer clockwise" },
};

const swatch = (body: string) => `<svg viewBox="-0.5 -0.5 11 11">${body}</svg>`;
const tileSample = (fill: string, extra = "") =>
  `<rect x="0.2" y="0.2" width="9.6" height="9.6" rx="1" fill="${fill}" stroke="var(--border)" stroke-width="0.25"/><text x="5" y="5" fill="var(--text)" font-size="4.4" font-weight="600" font-family="var(--font)" text-anchor="middle" dominant-baseline="central">7</text>${extra}`;
const upMark = `<line x1="3.6" y1="7.9" x2="6.4" y2="7.9" stroke="var(--text-dim)" stroke-width="0.5" stroke-linecap="round"/>`;
const box = (extra: string) => `<rect x="0.5" y="0.5" width="9" height="9" rx="1" fill="none" stroke="var(--hint)" ${extra}/>`;

function legend(p: TwiddlePuzzle) {
  return [
    { sample: swatch(tileSample("var(--cell)")), meaning: p.rowsOnly ? "a tile: its number is the row it belongs in" : "a tile" },
    { sample: swatch(tileSample("color-mix(in srgb, var(--accent) 16%, var(--cell))")), meaning: "a tile in its final spot (with the tint setting on)" },
    ...(p.orientable ? [{ sample: swatch(tileSample("var(--cell)", upMark)), meaning: "the line under a number marks its bottom: upright when the line is underneath" }] : []),
    { sample: swatch(`<rect x="0.3" y="0.3" width="9.4" height="9.4" rx="1" fill="none" stroke="var(--accent)" stroke-width="0.6"/>`), meaning: "the block a click would turn" },
    { sample: swatch(tileSample("var(--cell)") + box(`stroke-width="1"`)), meaning: "hint: the tile being brought home" },
    { sample: swatch(box(`stroke-width="0.7" stroke-dasharray="1.2 0.8"`)), meaning: "hint: where it goes" },
    { sample: swatch(tileSample("var(--cell)") + box(`stroke-width="0.5" stroke-opacity="0.8"`)), meaning: "hint: the tiles the suggested turns move" },
  ];
}

export const twiddleView: View<TwiddlePuzzle, TwiddleState, TwiddleAction, TwiddleInteraction> = {
  id: "twiddle.svg",
  name: "tiles",
  puzzle: "twiddle",
  settings,
  controls: [
    { how: "click or tap where four tiles meet", what: "turn that 2×2 block counterclockwise" },
    { how: "right-click, or hold on a touch screen", what: "turn it clockwise" },
  ],
  legend,
  mount(root, { session, settings }) {
    style("twiddle", CSS);
    const p = session.puzzle;
    const n = p.w * p.h;
    const W = p.w * SIZE, H = p.h * SIZE;
    const svg = s("svg", { viewBox: `-0.5 -0.5 ${W + 1} ${H + 1}`, class: "twiddle-board", role: "grid", "aria-label": `${p.w} by ${p.h} twiddle` });
    const tileLayer = s("g");
    const tiles: SVGGElement[] = [];
    const faces: SVGGElement[] = [];
    for (let id = 0; id < n; id++) {
      const face = s("g", { class: "face" },
        s("text", { x: SIZE / 2, y: SIZE / 2 }, ""),
        p.orientable ? s("line", { x1: 3.6, y1: 7.9, x2: 6.4, y2: 7.9, class: "up" }) : null);
      face.style.transformOrigin = `${SIZE / 2}px ${SIZE / 2}px`;
      const g = s("g", { class: "tile" }, s("rect", { x: 0.2, y: 0.2, width: SIZE - 0.4, height: SIZE - 0.4, rx: 1 }), face);
      tiles.push(g);
      faces.push(face);
      tileLayer.append(g);
    }
    const hover = s("rect", { width: 2 * SIZE, height: 2 * SIZE, rx: 1.4, class: "block", visibility: "hidden" });
    const ghost = s("g", { class: "ghost" });
    const overlay = s("g");
    const cursor = s("rect", { width: 2 * SIZE, height: 2 * SIZE, rx: 1.4, class: "cursor" });
    svg.append(tileLayer, ghost, hover, overlay, cursor);
    let previewing: TwiddleState | null = null;
    root.append(svg);

    /** ids[c] = element drawn at cell c; matched to the nearest equal tile on every change so turns animate. */
    let ids = Array.from({ length: n }, (_, c) => c);
    let lastTiles = session.state.tiles, lastTurns = session.state.turns;
    let spin = Array.from({ length: n }, (_, c) => session.state.turns[c]!);
    const track = () => {
      const st = session.state;
      if (st.tiles === lastTiles && st.turns === lastTurns) return;
      const prev = { tiles: lastTiles, turns: lastTurns };
      const used = new Uint8Array(n);
      const next = Array.from({ length: n }, () => -1);
      const nextSpin = spin.slice();
      for (let c = 0; c < n; c++) {
        if (prev.tiles[c] === st.tiles[c] && prev.turns[c] === st.turns[c]) { next[c] = ids[c]!; used[c] = 1; }
      }
      for (let c = 0; c < n; c++) {
        if (next[c]! >= 0) continue;
        let best = -1, bestD = Infinity;
        for (let d = 0; d < n; d++) {
          if (used[d] || prev.tiles[d] !== st.tiles[c]) continue;
          const dist = Math.abs((d % p.w) - (c % p.w)) + Math.abs(Math.floor(d / p.w) - Math.floor(c / p.w));
          if (dist < bestD) { bestD = dist; best = d; }
        }
        if (best < 0) best = used.indexOf(0);
        used[best] = 1;
        next[c] = ids[best]!;
        const delta = (((st.turns[c]! - prev.turns[best]!) % 4) + 4) % 4;
        nextSpin[ids[best]!] = spin[ids[best]!]! + (delta === 3 ? -1 : delta);
      }
      ids = next;
      spin = nextSpin;
      lastTiles = st.tiles;
      lastTurns = st.turns;
    };

    const render = () => {
      track();
      const st = session.state;
      for (let c = 0; c < n; c++) {
        const id = ids[c]!;
        const g = tiles[id]!;
        g.style.transform = `translate(${(c % p.w) * SIZE}px, ${Math.floor(c / p.w) * SIZE}px)`;
        g.setAttribute("data-cell", String(c));
        (faces[id]!.firstChild as SVGTextElement).textContent = String(st.tiles[c]);
        faces[id]!.style.transform = p.orientable ? `rotate(${-90 * spin[id]!}deg)` : "";
        g.classList.toggle("home", !!settings.tintHome && st.tiles[c] === goalTile(p, c) && (!p.orientable || st.turns[c] === 0));
      }
      ghost.replaceChildren();
      previewing?.tiles.forEach((t, c) => {
        if (t === st.tiles[c] && (!p.orientable || previewing!.turns[c] === st.turns[c])) return;
        const turn = p.orientable ? ` rotate(${-90 * previewing!.turns[c]!} ${SIZE / 2} ${SIZE / 2})` : "";
        ghost.append(s("g", { transform: `translate(${(c % p.w) * SIZE} ${Math.floor(c / p.w) * SIZE})${turn}` },
          s("rect", { x: 0.2, y: 0.2, width: SIZE - 0.4, height: SIZE - 0.4, rx: 1 }),
          s("text", { x: SIZE / 2, y: SIZE / 2 + 0.3 }, String(t))));
      });
      overlay.replaceChildren();
      const f = session.activeHint?.focus as TwiddleFocus | undefined;
      const mark = (c: number, cls: string, inset: number, span = 1) => overlay.append(s("rect", {
        x: (c % p.w) * SIZE + inset, y: Math.floor(c / p.w) * SIZE + inset, width: span * SIZE - 2 * inset, height: span * SIZE - 2 * inset, rx: 1, class: `mark ${cls}`,
      }));
      for (const c of f?.moving ?? []) mark(c, "moving", 0.6);
      if (f?.home !== undefined) mark(f.home, "home", 0.9);
      if (f?.tile !== undefined) mark(f.tile, "tile", 0.5);
      if (f?.blocks?.length) mark(f.blocks[0]!, "block", 0.2, 2);
      const cur = session.interaction.cursor;
      cursor.setAttribute("x", String((cur % p.w) * SIZE));
      cursor.setAttribute("y", String(Math.floor(cur / p.w) * SIZE));
    };

    /** Top-left cell of the block whose center is nearest the pointer. */
    const blockAt = (e: MouseEvent): number => {
      const r = svg.getBoundingClientRect();
      const ux = ((e.clientX - r.left) / r.width) * (W + 1) - 0.5, uy = ((e.clientY - r.top) / r.height) * (H + 1) - 0.5;
      const x = Math.min(p.w - 2, Math.max(0, Math.round(ux / SIZE) - 1));
      const y = Math.min(p.h - 2, Math.max(0, Math.round(uy / SIZE) - 1));
      return y * p.w + x;
    };
    const turn = (cell: number, clockwise: boolean) => {
      session.setInteraction((i) => ({ ...i, cursor: cell }));
      session.dispatch({ type: "rotate", x: cell % p.w, y: Math.floor(cell / p.w), clockwise });
    };
    const showHover = (cell: number) => {
      if (!settings.showBlock || cell < 0) { hover.setAttribute("visibility", "hidden"); return; }
      hover.setAttribute("x", String((cell % p.w) * SIZE));
      hover.setAttribute("y", String(Math.floor(cell / p.w) * SIZE));
      hover.setAttribute("visibility", "visible");
    };
    let press: { id: number; cell: number; timer: number; held: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const cell = blockAt(e);
      showHover(cell);
      const timer = e.pointerType === "mouse" ? 0 : window.setTimeout(() => {
        if (!press) return;
        press.held = true;
        turn(press.cell, true);
        navigator.vibrate?.(15);
      }, 450);
      press = { id: e.pointerId, cell, timer, held: false };
    };
    const onUp = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.id) return;
      clearTimeout(press.timer);
      const pr = press;
      press = null;
      if (!pr.held && e.type === "pointerup") turn(pr.cell, false);
      if (e.pointerType !== "mouse") showHover(-1);
    };
    const onMove = (e: PointerEvent) => { if (e.pointerType === "mouse") showHover(blockAt(e)); };
    const onLeave = () => showHover(-1);
    const onContext = (e: Event) => e.preventDefault();
    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onUp);
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerleave", onLeave);
    svg.addEventListener("contextmenu", onContext);

    const moveCursor = (dx: number, dy: number) => () => session.setInteraction((i) => {
      const x = Math.min(p.w - 2, Math.max(0, (i.cursor % p.w) + dx));
      const y = Math.min(p.h - 2, Math.max(0, Math.floor(i.cursor / p.w) + dy));
      return { ...i, cursor: y * p.w + x };
    });

    const offs = [
      session.hooks.change.tap(render, { owner: "view" }),
      session.hooks.interaction.tap(render, { owner: "view" }),
      session.hooks.refresh.tap(render, { owner: "view" }),
    ];
    render();
    const cellRect = (c: number) => {
      const r = svg.getBoundingClientRect();
      const k = r.width / (W + 1);
      return new DOMRect(r.left + ((c % p.w) * SIZE + 0.5) * k, r.top + (Math.floor(c / p.w) * SIZE + 0.5) * k, SIZE * k, SIZE * k);
    };
    const rects = (cells: Iterable<number>) => [...new Set(cells)].map(cellRect);
    return {
      aspect: (W + 1) / (H + 1),
      cells: { cols: p.w, rows: p.h },
      gestures: { secondaryClick: true, hold: true },
      commands: bindCommands(BINDINGS, {
        "twiddle.left": moveCursor(-1, 0),
        "twiddle.right": moveCursor(1, 0),
        "twiddle.up": moveCursor(0, -1),
        "twiddle.down": moveCursor(0, 1),
        "twiddle.ccw": () => turn(session.interaction.cursor, false),
        "twiddle.cw": () => turn(session.interaction.cursor, true),
        "twiddle.cw-at": (_ctx, e) => {
          if (!(e instanceof MouseEvent)) return false;
          turn(blockAt(e), true);
          return true;
        },
      }),
      preview: (state) => {
        previewing = state as TwiddleState | null;
        render();
      },
      locate: (focus) => {
        const f = focus as TwiddleFocus | undefined;
        if (!f) return [];
        return rects([...(f.moving ?? []), ...(f.home !== undefined ? [f.home] : []), ...(f.tile !== undefined ? [f.tile] : [])]);
      },
      locateChange: (a, b) => {
        const x = a as TwiddleState, y = b as TwiddleState;
        return rects(x.tiles.flatMap((t, c) => (t !== y.tiles[c] || x.turns[c] !== y.turns[c] ? [c] : [])));
      },
      destroy() {
        offs.forEach((f) => f());
        if (press) clearTimeout(press.timer);
        svg.remove();
      },
    };
  },
};
