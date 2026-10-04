import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { h, s, style, inputIs } from "../../core/dom";
import { defineSchema } from "../../core/schema";
import type { View, WidgetDef } from "../../core/types";
import { samegame, COLOUR_NAMES, group, type SamegameAction, type SamegameFocus, type SamegameInteraction, type SamegamePuzzle, type SamegameState } from "./logic";

const SIZE = 10;
const INSET = 0.6;

/** Tile colors by color number 1…9; a theme can override any with --samegame-1 … --samegame-9. */
export const PALETTE = ["", "#d9443f", "#3b6fd6", "#3fa34d", "#e8c62c", "#8b4fc7", "#ef8a2b", "#3fc1c9", "#ef7fb6", "#8f8f8f"] as const;
const colourVar = (c: number) => `var(--samegame-${c}, ${PALETTE[c]})`;

const CSS = `
.samegame-board { display: block; width: 100%; height: 100%; touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.samegame-board .bg { fill: var(--surface-2); }
.samegame-board .tile { cursor: pointer; }
.samegame-board .sel { fill: none; stroke: var(--text); stroke-width: 0.9; pointer-events: none; }
.samegame-board .num { font: 600 4px var(--mono); text-anchor: middle; dominant-baseline: central; fill: rgb(0 0 0 / 0.55); pointer-events: none; }
.samegame-board .mark { fill: none; stroke: var(--hint); stroke-width: 0.9; pointer-events: none; }
.samegame-board .ghost { pointer-events: none; }
.samegame-board .ghost .add { opacity: 0.6; stroke: var(--text); stroke-width: 0.35; stroke-dasharray: 1 0.7; }
.samegame-board .ghost .gone { fill: var(--surface-2); opacity: 0.7; }
.samegame-board .mark.nudge { stroke-width: 0.5; stroke-dasharray: 1.2 0.8; }
.samegame-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
${inputIs("pointer")} .samegame-board .cursor { display: none; }
.samegame-score { font-family: var(--mono); color: var(--text-dim); min-height: 1.4em; }
`;

const settings = defineSchema({
  confirm: {
    type: "enum", label: "removing a group", default: "touch",
    options: [
      { value: "never", label: "one click or tap" },
      { value: "touch", label: "tap twice on touch screens" },
      { value: "always", label: "always click twice" },
    ],
    description: "with two clicks, the first only highlights the group",
  },
  numbers: { type: "bool", label: "show a number on each color", default: false, description: "for telling colors apart without relying on hue" },
});

const BINDINGS = {
  "samegame.left": { label: "cursor left", category: "same game", keys: ["ArrowLeft", "a"] },
  "samegame.right": { label: "cursor right", category: "same game", keys: ["ArrowRight", "d"] },
  "samegame.up": { label: "cursor up", category: "same game", keys: ["ArrowUp", "w"] },
  "samegame.down": { label: "cursor down", category: "same game", keys: ["ArrowDown", "s"] },
  "samegame.remove": { label: "remove group", category: "same game", keys: ["space", "Enter"], description: "remove the group under the keyboard cursor" },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

const swatch = (body: string) => `<svg viewBox="-0.5 -0.5 11 11">${body}</svg>`;

function legend(p: SamegamePuzzle) {
  return [
    ...Array.from({ length: p.colours }, (_, i) => ({
      sample: swatch(`<rect x="${INSET}" y="${INSET}" width="${SIZE - 2 * INSET}" height="${SIZE - 2 * INSET}" rx="1.4" fill="${colourVar(i + 1)}"/>`),
      meaning: `color ${i + 1}, ${COLOUR_NAMES[i + 1]}`,
    })),
    { sample: swatch(`<rect x="${INSET}" y="${INSET}" width="${SIZE - 2 * INSET}" height="${SIZE - 2 * INSET}" rx="1.4" fill="${colourVar(1)}"/><rect x="0.4" y="0.4" width="9.2" height="9.2" rx="1.6" fill="none" stroke="var(--text)" stroke-width="0.9"/>`), meaning: "the group a click would remove" },
    { sample: swatch(`<rect x="${INSET}" y="${INSET}" width="${SIZE - 2 * INSET}" height="${SIZE - 2 * INSET}" rx="1.4" fill="${colourVar(2)}"/><rect x="0.4" y="0.4" width="9.2" height="9.2" rx="1.6" fill="none" stroke="var(--hint)" stroke-width="0.9"/>`), meaning: "hint: the group to remove" },
  ];
}

export const samegameView: View<SamegamePuzzle, SamegameState, SamegameAction, SamegameInteraction, typeof settings> = {
  id: "samegame.svg",
  name: "tiles",
  puzzle: samegame,
  settings,
  controls: [
    { how: "point at a tile", what: "outline the group it belongs to" },
    { how: "click or tap a group of two or more", what: "remove it (on touch screens, tap once to outline and again to remove, unless changed in settings)" },
  ],
  legend,
  mount(root, { session, settings }) {
    style("samegame", CSS);
    const p = session.puzzle;
    const n = p.w * p.h;
    const svg = s("svg", { viewBox: `0 0 ${p.w * SIZE} ${p.h * SIZE}`, class: "samegame-board", role: "grid", "aria-label": `${p.w} by ${p.h} same game` });
    svg.append(s("rect", { x: 0, y: 0, width: p.w * SIZE, height: p.h * SIZE, class: "bg" }));
    const tiles = Array.from({ length: n }, (_, c) => s("rect", { "data-cell": c, class: "tile" }));
    const nums = settings.numbers ? Array.from({ length: n }, (_, c) => s("text", { x: (c % p.w) * SIZE + SIZE / 2, y: Math.floor(c / p.w) * SIZE + SIZE / 2, class: "num" })) : [];
    const selLayer = s("g"), overlay = s("g");
    const cursor = s("rect", { width: SIZE, height: SIZE, rx: 1.4, class: "cursor" });
    const ghost = s("g", { class: "ghost" });
    svg.append(...tiles, ...nums, ghost, selLayer, overlay, cursor);
    let previewing: SamegameState | null = null;
    root.append(svg);

    let selected: number[] = [];
    const outline = (cells: number[], cls: string, layer: SVGGElement) => {
      if (!cells.length) return;
      const set = new Set(cells);
      let d = "";
      for (const c of cells) {
        const x = (c % p.w) * SIZE, y = Math.floor(c / p.w) * SIZE;
        if ((c % p.w) === p.w - 1 || !set.has(c + 1)) d += `M${x + SIZE - 0.4} ${y}V${y + SIZE}`;
        if ((c % p.w) === 0 || !set.has(c - 1)) d += `M${x + 0.4} ${y}V${y + SIZE}`;
        if (c < p.w || !set.has(c - p.w)) d += `M${x} ${y + 0.4}H${x + SIZE}`;
        if (c + p.w >= n || !set.has(c + p.w)) d += `M${x} ${y + SIZE - 0.4}H${x + SIZE}`;
      }
      layer.append(s("path", { d, class: cls }));
    };

    const render = () => {
      const g = session.state.grid;
      for (let c = 0; c < n; c++) {
        const v = g[c]!;
        const t = tiles[c]!;
        const x = c % p.w, y = Math.floor(c / p.w);
        if (!v) { t.setAttribute("visibility", "hidden"); if (nums[c]) nums[c]!.textContent = ""; continue; }
        const right = x < p.w - 1 && g[c + 1] === v, down = y < p.h - 1 && g[c + p.w] === v;
        const left = x > 0 && g[c - 1] === v, up = y > 0 && g[c - p.w] === v;
        const x0 = x * SIZE + (left ? 0 : INSET), y0 = y * SIZE + (up ? 0 : INSET);
        const x1 = (x + 1) * SIZE - (right ? 0 : INSET), y1 = (y + 1) * SIZE - (down ? 0 : INSET);
        t.setAttribute("x", String(x0));
        t.setAttribute("y", String(y0));
        t.setAttribute("width", String(x1 - x0));
        t.setAttribute("height", String(y1 - y0));
        t.setAttribute("rx", left || right || up || down ? "0.4" : "1.4");
        t.setAttribute("fill", colourVar(v));
        t.setAttribute("visibility", "visible");
        if (nums[c]) nums[c]!.textContent = String(v);
      }
      ghost.replaceChildren();
      previewing?.grid.forEach((v, c) => {
        if (v === g[c]) return;
        const x = (c % p.w) * SIZE, y = Math.floor(c / p.w) * SIZE;
        ghost.append(v
          ? s("rect", { x: x + 1.2, y: y + 1.2, width: SIZE - 2.4, height: SIZE - 2.4, rx: 1.2, fill: colourVar(v), class: "add" })
          : s("rect", { x, y, width: SIZE, height: SIZE, class: "gone" }));
      });
      selLayer.replaceChildren();
      if (selected.length >= 2 && selected.every((c) => g[c] === g[selected[0]!])) outline(selected, "sel", selLayer);
      overlay.replaceChildren();
      const f = session.activeHint?.focus as SamegameFocus | undefined;
      if (f?.cells?.length) outline(f.cells, session.activeHint?.level === 1 ? "mark nudge" : "mark", overlay);
      const cur = session.interaction.cursor;
      cursor.setAttribute("x", String((cur % p.w) * SIZE));
      cursor.setAttribute("y", String(Math.floor(cur / p.w) * SIZE));
    };

    const groupAt = (cell: number) => group(p.w, p.h, session.state.grid, cell);
    const select = (cell: number) => {
      const g = cell < 0 ? [] : groupAt(cell);
      selected = g.length >= 2 ? g : [];
      render();
    };
    const remove = (cell: number) => {
      selected = [];
      session.setInteraction((i) => ({ ...i, cursor: cell }));
      if (!session.dispatch({ type: "remove", cell })) render();
    };
    const onDown = (e: PointerEvent) => {
      const v = (e.target as Element).getAttribute("data-cell");
      if (v === null || e.button !== 0) return;
      e.preventDefault();
      const cell = Number(v);
      const twice = settings.confirm === "always" || (settings.confirm === "touch" && e.pointerType !== "mouse");
      if (twice && !selected.includes(cell)) select(cell);
      else remove(cell);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || settings.confirm === "always") return;
      const v = (e.target as Element).getAttribute("data-cell");
      const cell = v === null ? -1 : Number(v);
      if (cell >= 0 && selected.includes(cell)) return;
      select(cell);
    };
    const onLeave = (e: PointerEvent) => { if (e.pointerType === "mouse" && settings.confirm !== "always") select(-1); };
    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerleave", onLeave);

    const moveCursor = (dx: number, dy: number) => () => session.setInteraction((i) => {
      const x = Math.min(p.w - 1, Math.max(0, (i.cursor % p.w) + dx));
      const y = Math.min(p.h - 1, Math.max(0, Math.floor(i.cursor / p.w) + dy));
      return { ...i, cursor: y * p.w + x };
    });

    const offs = [
      session.hooks.change.tap(() => { selected = []; render(); }, { owner: "view" }),
      session.hooks.interaction.tap(render, { owner: "view" }),
      session.hooks.refresh.tap(render, { owner: "view" }),
    ];
    render();
    const rects = (list: Iterable<number>) => [...new Set(list)].map((c) => {
      const r = svg.getBoundingClientRect();
      const k = r.width / (p.w * SIZE);
      return new DOMRect(r.left + (c % p.w) * SIZE * k, r.top + Math.floor(c / p.w) * SIZE * k, SIZE * k, SIZE * k);
    });
    return {
      aspect: p.w / p.h,
      cells: { cols: p.w, rows: p.h },
      commands: bindCommands(BINDINGS, {
        "samegame.left": moveCursor(-1, 0),
        "samegame.right": moveCursor(1, 0),
        "samegame.up": moveCursor(0, -1),
        "samegame.down": moveCursor(0, 1),
        "samegame.remove": () => remove(session.interaction.cursor),
      }),
      preview: (state) => {
        previewing = state as SamegameState | null;
        render();
      },
      locate: (focus) => rects((focus as SamegameFocus | undefined)?.cells ?? []),
      locateChange: (a, b) => {
        const x = (a as SamegameState).grid, y = (b as SamegameState).grid;
        return rects(x.flatMap((c, i) => (c !== y[i] ? [i] : [])));
      },
      destroy() {
        offs.forEach((f) => f());
        svg.remove();
      },
    };
  },
};

export const scoreWidget: WidgetDef<SamegamePuzzle, SamegameState, SamegameAction, SamegameInteraction> = {
  id: "samegame.score",
  name: "score",
  description: "points so far and tiles left",
  puzzles: [samegame],
  defaultSlot: "top",
  order: 10,
  mount(el, { session, owner }) {
    style("samegame", CSS);
    const box = h("div", { class: "samegame-score", "aria-live": "polite" });
    el.append(box);
    const render = () => {
      const left = session.state.grid.filter(Boolean).length;
      box.textContent = `score ${session.state.score} · ${left} ${left === 1 ? "tile" : "tiles"} left`;
    };
    session.hooks.change.tap(render, { owner });
    render();
  },
};
