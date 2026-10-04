import { bindCommands, type BindingSchema } from "../../core/commands";
import { s, style } from "../../core/dom";
import { defineSchema } from "../../core/schema";
import type { View } from "../../core/types";
import { gapOf, lineToGap, solvedTile, type FifteenAction, type FifteenFocus, type FifteenPuzzle, type FifteenState } from "./logic";

const SIZE = 10;
const GAP = 0.4;

const CSS = `
.fifteen-board { display: block; width: 100%; height: 100%; touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.fifteen-board .slot { fill: var(--surface-2); }
.fifteen-board .tile { cursor: pointer; transition: transform 90ms ease-out; }
.fifteen-board .tile rect { fill: var(--cell); stroke: var(--border); stroke-width: 0.25; }
.fifteen-board .tile.home rect { fill: color-mix(in srgb, var(--accent) 16%, var(--cell)); }
.fifteen-board .tile text { fill: var(--text); font: 600 4.6px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.fifteen-board .mark { fill: none; stroke: var(--hint); pointer-events: none; }
.fifteen-board .mark.press { stroke-width: 1; }
.fifteen-board .mark.home { stroke-width: 0.6; stroke-dasharray: 1.2 0.8; }
.fifteen-board .mark.tile { stroke-width: 0.4; stroke-opacity: 0.7; }
@media (prefers-reduced-motion: reduce) { .fifteen-board .tile { transition: none; } }
`;

const settings = defineSchema({
  tintHome: { type: "bool", label: "tint tiles that are in their final spot", default: true },
});

const BINDINGS: BindingSchema = {
  "fifteen.left": { label: "slide left", category: "fifteen", keys: ["ArrowLeft", "a"], description: "slide the tile right of the gap into it" },
  "fifteen.right": { label: "slide right", category: "fifteen", keys: ["ArrowRight", "d"], description: "slide the tile left of the gap into it" },
  "fifteen.up": { label: "slide up", category: "fifteen", keys: ["ArrowUp", "w"], description: "slide the tile below the gap into it" },
  "fifteen.down": { label: "slide down", category: "fifteen", keys: ["ArrowDown", "s"], description: "slide the tile above the gap into it" },
};

const swatch = (body: string) => `<svg viewBox="-0.5 -0.5 11 11">${body}</svg>`;
const tileSample = (fill: string, label = "7") =>
  `<rect x="0.2" y="0.2" width="9.6" height="9.6" rx="1" fill="${fill}" stroke="var(--border)" stroke-width="0.4"/><text x="5" y="5.3" fill="var(--text)" font-size="4.6" font-weight="600" font-family="var(--font)" text-anchor="middle" dominant-baseline="central">${label}</text>`;
const box = (extra: string) => `<rect x="0.5" y="0.5" width="9" height="9" rx="1" fill="none" stroke="var(--hint)" ${extra}/>`;

export const fifteenView: View<FifteenPuzzle, FifteenState, FifteenAction, null> = {
  id: "fifteen.svg",
  name: "tiles",
  puzzle: "fifteen",
  settings,
  controls: [
    { how: "click or tap a tile in the gap's row or column", what: "slide it (and any tiles between) towards the gap" },
  ],
  legend: [
    { sample: swatch(tileSample("var(--cell)")), meaning: "a tile" },
    { sample: swatch(tileSample("color-mix(in srgb, var(--accent) 16%, var(--cell))")), meaning: "a tile in its final spot (with the tint setting on)" },
    { sample: swatch(`<rect width="10" height="10" fill="var(--surface-2)"/>`), meaning: "the gap" },
    { sample: swatch(tileSample("var(--cell)") + box(`stroke-width="1"`)), meaning: "hint: the tile to slide" },
    { sample: swatch(`<rect width="10" height="10" fill="var(--surface-2)"/>` + box(`stroke-width="0.6" stroke-dasharray="1.2 0.8"`)), meaning: "hint: where the tiles being worked on belong" },
  ],
  mount(root, { session, settings }) {
    style("fifteen", CSS);
    const p = session.puzzle;
    const n = p.w * p.h;
    const pad = GAP / 2;
    const svg = s("svg", {
      viewBox: `${-pad} ${-pad} ${p.w * SIZE + GAP} ${p.h * SIZE + GAP}`,
      class: "fifteen-board", role: "grid", "aria-label": `${p.w} by ${p.h} sliding puzzle`,
    });
    const slots = Array.from({ length: n }, (_, c) => s("rect", {
      x: (c % p.w) * SIZE + pad, y: Math.floor(c / p.w) * SIZE + pad, width: SIZE - GAP, height: SIZE - GAP, rx: 1, class: "slot",
    }));
    svg.append(...slots);
    const tiles: SVGGElement[] = [];
    for (let t = 1; t < n; t++) {
      const g = s("g", { class: "tile", "data-tile": t },
        s("rect", { x: pad, y: pad, width: SIZE - GAP, height: SIZE - GAP, rx: 1 }),
        s("text", { x: SIZE / 2, y: SIZE / 2 + 0.3 }, String(t)));
      tiles[t] = g;
      svg.append(g);
    }
    const overlay = s("g");
    svg.append(overlay);
    root.append(svg);

    const at = (c: number) => `translate(${(c % p.w) * SIZE}px, ${Math.floor(c / p.w) * SIZE}px)`;
    const render = () => {
      const st = session.state;
      st.tiles.forEach((t, c) => {
        if (!t) return;
        const g = tiles[t]!;
        g.style.transform = at(c);
        g.setAttribute("data-cell", String(c));
        g.classList.toggle("home", !!settings.tintHome && t === solvedTile(n, c));
      });
      overlay.replaceChildren();
      const f = session.activeHint?.focus as FifteenFocus | undefined;
      const mark = (c: number, cls: string) => overlay.append(s("rect", {
        x: (c % p.w) * SIZE + pad + 0.3, y: Math.floor(c / p.w) * SIZE + pad + 0.3, width: SIZE - GAP - 0.6, height: SIZE - GAP - 0.6, rx: 1, class: `mark ${cls}`,
      }));
      for (const c of f?.tiles ?? []) mark(c, "tile");
      for (const c of f?.homes ?? []) mark(c, "home");
      for (const c of f?.press ?? []) mark(c, "press");
    };

    const press = (cell: number) => {
      if (lineToGap(p.w, session.state.tiles, cell).length) session.dispatch({ type: "move", cell });
    };
    const onDown = (e: PointerEvent) => {
      const el = (e.target as Element).closest("[data-cell]");
      if (!el || e.button !== 0) return;
      e.preventDefault();
      press(Number(el.getAttribute("data-cell")));
    };
    svg.addEventListener("pointerdown", onDown);

    const slide = (dx: number, dy: number) => () => {
      const g = gapOf(session.state.tiles);
      const x = (g % p.w) + dx, y = Math.floor(g / p.w) + dy;
      if (x >= 0 && y >= 0 && x < p.w && y < p.h) press(y * p.w + x);
    };

    const offs = [
      session.hooks.change.tap(render, { owner: "view" }),
      session.hooks.refresh.tap(render, { owner: "view" }),
    ];
    render();
    const rects = (cells: Iterable<number>) => [...new Set(cells)].map((c) => slots[c]!.getBoundingClientRect());
    return {
      aspect: p.w / p.h,
      cells: { cols: p.w, rows: p.h },
      commands: bindCommands(BINDINGS, {
        "fifteen.left": slide(1, 0),
        "fifteen.right": slide(-1, 0),
        "fifteen.up": slide(0, 1),
        "fifteen.down": slide(0, -1),
      }),
      locate: (focus) => {
        const f = focus as FifteenFocus | undefined;
        return f ? rects([...(f.press ?? []), ...(f.homes ?? []), ...(f.tiles ?? [])]) : [];
      },
      locateChange: (a, b) => {
        const x = (a as FifteenState).tiles, y = (b as FifteenState).tiles;
        return rects(x.flatMap((t, c) => (t !== y[c] ? [c] : [])));
      },
      destroy() {
        offs.forEach((f) => f());
        svg.removeEventListener("pointerdown", onDown);
        svg.remove();
      },
    };
  },
};
