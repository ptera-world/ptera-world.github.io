import { bindCommands, type BindingSchema } from "../../core/commands";
import { h, s, style, inputIs } from "../../core/dom";
import { defineSchema } from "../../core/schema";
import type { View, WidgetDef } from "../../core/types";
import { flood, COLOUR_NAMES, MAX_COLOURS, region, type FloodAction, type FloodFocus, type FloodPuzzle, type FloodState } from "./logic";

const SIZE = 10;

/** Cell colors; a theme can override any of them with --flood-0 … --flood-9. */
export const PALETTE = ["#d9443f", "#e8c62c", "#3fa34d", "#3b6fd6", "#ef8a2b", "#8b4fc7", "#8a5a33", "#5fc4e8", "#a6d64a", "#ef7fb6"] as const;
export const colourVar = (c: number) => `var(--flood-${c}, ${PALETTE[c]})`;

const CSS = `
.flood-board { display: block; width: 100%; height: 100%; touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.flood-board .cell { cursor: pointer; transition: fill 160ms ease-out; }
.flood-board .num { font: 600 4px var(--mono); text-anchor: middle; dominant-baseline: central; fill: rgb(0 0 0 / 0.55); pointer-events: none; }
.flood-board .edge { stroke: var(--text); stroke-width: 0.7; stroke-linecap: square; pointer-events: none; }
.flood-board .mark { fill: none; stroke: var(--hint); stroke-width: 0.8; pointer-events: none; }
.flood-board .ghost { pointer-events: none; opacity: 0.75; stroke: var(--bg); stroke-width: 0.5; stroke-dasharray: 1 0.7; }
.flood-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
${inputIs("pointer")} .flood-board .cursor { display: none; }
.flood-moves { font-family: var(--mono); color: var(--text-dim); min-height: 1.4em; }
.flood-moves.over { color: var(--danger); }
@media (prefers-reduced-motion: reduce) { .flood-board .cell { transition: none; } }
`;

const settings = defineSchema({
  outline: { type: "bool", label: "outline the flooded area", default: true },
  numbers: { type: "bool", label: "show a number on each color", default: false, description: "for telling colors apart without relying on hue" },
});

const BINDINGS: BindingSchema = Object.fromEntries(Array.from({ length: MAX_COLOURS }, (_, c) => [
  `flood.colour-${c + 1}`,
  { label: `flood with ${COLOUR_NAMES[c]}`, category: "flood", keys: [String((c + 1) % 10)], description: `fill the flooded area with color ${c + 1} (${COLOUR_NAMES[c]})` },
]));

const swatch = (body: string) => `<svg viewBox="-0.5 -0.5 11 11">${body}</svg>`;

function legend(p: FloodPuzzle) {
  return [
    ...Array.from({ length: p.colours }, (_, c) => ({
      sample: swatch(`<rect width="10" height="10" fill="${colourVar(c)}"/>`),
      meaning: `color ${c + 1}, ${COLOUR_NAMES[c]} (key ${(c + 1) % 10})`,
    })),
    { sample: swatch(`<rect width="10" height="10" fill="${colourVar(0)}"/><path d="M0 10V0H10" fill="none" stroke="var(--text)" stroke-width="0.7"/>`), meaning: "the edge of the flooded area (with the outline setting on)" },
    { sample: swatch(`<rect width="10" height="10" fill="${colourVar(3)}"/><rect x="0.6" y="0.6" width="8.8" height="8.8" fill="none" stroke="var(--hint)" stroke-width="0.8"/>`), meaning: "hint: cells the suggested fill brings in" },
  ];
}

export const floodView: View<FloodPuzzle, FloodState, FloodAction, null, typeof settings> = {
  id: "flood.svg",
  name: "grid",
  puzzle: flood,
  settings,
  controls: [{ how: "click or tap any cell", what: "flood with that cell's color" }],
  legend,
  mount(root, { session, settings }) {
    style("flood", CSS);
    const p = session.puzzle;
    const n = p.w * p.h;
    const svg = s("svg", { viewBox: `-0.5 -0.5 ${p.w * SIZE + 1} ${p.h * SIZE + 1}`, class: "flood-board", role: "grid", "aria-label": `${p.w} by ${p.h} flood` });
    const cells = Array.from({ length: n }, (_, c) => s("rect", { x: (c % p.w) * SIZE, y: Math.floor(c / p.w) * SIZE, width: SIZE + 0.05, height: SIZE + 0.05, class: "cell", "data-cell": c }));
    const nums = settings.numbers ? Array.from({ length: n }, (_, c) => s("text", { x: (c % p.w) * SIZE + SIZE / 2, y: Math.floor(c / p.w) * SIZE + SIZE / 2, class: "num" })) : [];
    const edges = s("g");
    const overlay = s("g");
    const ghost = s("g", { class: "ghost" });
    svg.append(...cells, ...nums, ghost, edges, overlay);
    let previewing: FloodState | null = null;
    root.append(svg);

    const render = () => {
      const g = session.state.grid;
      g.forEach((c, i) => {
        cells[i]!.setAttribute("fill", colourVar(c));
        if (nums[i]) nums[i]!.textContent = String(c + 1);
      });
      ghost.replaceChildren();
      previewing?.grid.forEach((c, i) => {
        if (c !== g[i]) ghost.append(s("rect", { x: (i % p.w) * SIZE + 1.5, y: Math.floor(i / p.w) * SIZE + 1.5, width: SIZE - 3, height: SIZE - 3, rx: 1, fill: colourVar(c) }));
      });
      edges.replaceChildren();
      if (settings.outline) {
        const on = region(p.w, p.h, g);
        let d = "";
        for (let i = 0; i < n; i++) {
          if (!on[i]) continue;
          const x = (i % p.w) * SIZE, y = Math.floor(i / p.w) * SIZE;
          if ((i % p.w) < p.w - 1 && !on[i + 1]) d += `M${x + SIZE} ${y}V${y + SIZE}`;
          if (i + p.w < n && !on[i + p.w]) d += `M${x} ${y + SIZE}H${x + SIZE}`;
          if ((i % p.w) > 0 && !on[i - 1]) d += `M${x} ${y}V${y + SIZE}`;
          if (i >= p.w && !on[i - p.w]) d += `M${x} ${y}H${x + SIZE}`;
        }
        if (d) edges.append(s("path", { d, class: "edge" }));
      }
      overlay.replaceChildren();
      const f = session.activeHint?.focus as FloodFocus | undefined;
      for (const c of f?.gained ?? []) {
        overlay.append(s("rect", { x: (c % p.w) * SIZE + 0.6, y: Math.floor(c / p.w) * SIZE + 0.6, width: SIZE - 1.2, height: SIZE - 1.2, class: "mark" }));
      }
    };

    const onDown = (e: PointerEvent) => {
      const v = (e.target as Element).getAttribute("data-cell");
      if (v === null || e.button !== 0) return;
      e.preventDefault();
      session.dispatch({ type: "fill", colour: session.state.grid[Number(v)]! });
    };
    svg.addEventListener("pointerdown", onDown);

    const offs = [session.hooks.change.tap(render, { owner: "view" }), session.hooks.refresh.tap(render, { owner: "view" })];
    render();
    const rects = (list: Iterable<number>) => [...new Set(list)].map((c) => cells[c]!.getBoundingClientRect());
    const handlers = Object.fromEntries(Array.from({ length: p.colours }, (_, c) => [`flood.colour-${c + 1}`, () => session.dispatch({ type: "fill", colour: c })]));
    return {
      aspect: (p.w * SIZE + 1) / (p.h * SIZE + 1),
      cells: { cols: p.w, rows: p.h },
      commands: bindCommands(BINDINGS, handlers),
      preview: (state) => {
        previewing = state as FloodState | null;
        render();
      },
      locate: (focus) => rects((focus as FloodFocus | undefined)?.gained ?? []),
      locateChange: (a, b) => {
        const x = (a as FloodState).grid, y = (b as FloodState).grid;
        return rects(x.flatMap((c, i) => (c !== y[i] ? [i] : [])));
      },
      destroy() {
        offs.forEach((f) => f());
        svg.remove();
      },
    };
  },
};

export const movesWidget: WidgetDef<FloodPuzzle, FloodState, FloodAction, null> = {
  id: "flood.moves",
  name: "moves",
  description: "moves made and the limit",
  puzzles: [flood],
  defaultSlot: "top",
  order: 10,
  mount(el, { session, owner }) {
    style("flood", CSS);
    const box = h("div", { class: "flood-moves", "aria-live": "polite" });
    el.append(box);
    const render = () => {
      const { moves } = session.state, limit = session.puzzle.limit;
      box.textContent = `${moves} / ${limit} moves`;
      box.classList.toggle("over", moves >= limit && !session.solved);
    };
    session.hooks.change.tap(render, { owner });
    render();
  },
};
