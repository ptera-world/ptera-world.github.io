import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { h, s, style, inputIs } from "../../core/dom";
import type { View, WidgetDef } from "../../core/types";
import { pegs, pegCount, type PegsAction, type PegsFocus, type PegsInteraction, type PegsPuzzle, type PegsState } from "./logic";
import { HOLE, OBST, PEG, jumps } from "./solver";

const SIZE = 10;

const CSS = `
.pegs-board { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; }
.pegs-board .spot { fill: var(--surface-2); stroke: var(--border); stroke-width: 0.3; }
.pegs-board .hole { fill: color-mix(in srgb, var(--text) 18%, var(--surface)); pointer-events: none; }
.pegs-board .peg { fill: var(--accent); stroke: color-mix(in srgb, var(--accent) 60%, var(--text)); stroke-width: 0.5; pointer-events: none; }
.pegs-board .peg.held { fill: color-mix(in srgb, var(--accent) 55%, var(--surface)); }
.pegs-board .peg.dead { fill: var(--text-dim); stroke: var(--text-dim); }
.pegs-board .target { fill: none; stroke: var(--accent); stroke-width: 0.6; stroke-dasharray: 1 0.8; pointer-events: none; }
.pegs-board .mark { fill: none; stroke: var(--hint); pointer-events: none; }
.pegs-board .ghost-peg { fill: color-mix(in srgb, var(--accent) 35%, transparent); stroke: var(--accent); stroke-width: 0.5; stroke-dasharray: 1 0.7; pointer-events: none; }
.pegs-board .peg.faded { opacity: 0.35; }
.pegs-board .mark.from { stroke-width: 1; }
.pegs-board .mark.over { stroke-width: 0.5; stroke-dasharray: 1.2 0.8; }
.pegs-board .mark.to { stroke-width: 0.7; }
.pegs-board .arrow { stroke: var(--hint); stroke-width: 0.7; fill: none; pointer-events: none; }
.pegs-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
${inputIs("pointer")} .pegs-board .cursor { display: none; }
.pegs-count { font-family: var(--mono); color: var(--text-dim); min-height: 1.4em; }
`;

const BINDINGS = {
  "pegs.left": { label: "cursor left", category: "pegs", keys: ["ArrowLeft", "a"] },
  "pegs.right": { label: "cursor right", category: "pegs", keys: ["ArrowRight", "d"] },
  "pegs.up": { label: "cursor up", category: "pegs", keys: ["ArrowUp", "w"] },
  "pegs.down": { label: "cursor down", category: "pegs", keys: ["ArrowDown", "s"] },
  "pegs.select": { label: "pick up / jump", category: "pegs", keys: ["space", "Enter"], description: "pick up the peg under the cursor, or jump the picked-up peg into the hole under the cursor" },
  "pegs.drop": { label: "put the peg back", category: "pegs", keys: ["Escape"], description: "let go of the picked-up peg without jumping" },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

const swatch = (body: string) => `<svg viewBox="-0.5 -0.5 11 11"><rect width="10" height="10" rx="1.5" fill="var(--surface-2)" stroke="var(--border)" stroke-width="0.3"/>${body}</svg>`;
const pegSvg = (fill = "var(--accent)") => `<circle cx="5" cy="5" r="3.4" fill="${fill}" stroke="color-mix(in srgb, var(--accent) 60%, var(--text))" stroke-width="0.5"/>`;
const holeSvg = `<circle cx="5" cy="5" r="1.6" fill="color-mix(in srgb, var(--text) 18%, var(--surface))"/>`;

/** The keys this view adds to the command context. */
export interface PegsContext {
  pegsHolding: boolean;
}

declare module "../../core/types" {
  interface CommandContext extends Partial<PegsContext> {}
}

export const pegsView: View<PegsPuzzle, PegsState, PegsAction, PegsInteraction> = {
  id: "pegs.svg",
  name: "board",
  puzzle: pegs,
  controls: [
    { how: "drag a peg into a hole two places away", what: "jump it over the peg between, which is removed" },
    { how: "or click a peg, then the hole to jump into", what: "the same jump; click the peg again to put it back" },
  ],
  legend: [
    { sample: swatch(pegSvg()), meaning: "a peg" },
    { sample: swatch(holeSvg), meaning: "an empty hole" },
    { sample: swatch(pegSvg("color-mix(in srgb, var(--accent) 55%, var(--surface))") + `<circle cx="5" cy="5" r="4.3" fill="none" stroke="var(--accent)" stroke-width="0.6" stroke-dasharray="1 0.8"/>`), meaning: "the picked-up peg, and holes it can jump into" },
  ],
  mount(root, { session }) {
    style("pegs", CSS);
    const p = session.puzzle;
    const n = p.w * p.h;
    const svg = s("svg", { viewBox: `-0.5 -0.5 ${p.w * SIZE + 1} ${p.h * SIZE + 1}`, class: "pegs-board", role: "grid", "aria-label": "peg solitaire board" });
    const spots: (SVGRectElement | null)[] = [];
    const pins: (SVGCircleElement | null)[] = [];
    for (let c = 0; c < n; c++) {
      if (p.grid[c] === OBST) { spots.push(null); pins.push(null); continue; }
      const x = (c % p.w) * SIZE, y = Math.floor(c / p.w) * SIZE;
      const spot = s("rect", { x: x + 0.3, y: y + 0.3, width: SIZE - 0.6, height: SIZE - 0.6, rx: 1.5, class: "spot", "data-cell": c });
      const hole = s("circle", { cx: x + SIZE / 2, cy: y + SIZE / 2, r: 1.6, class: "hole" });
      const pin = s("circle", { cx: x + SIZE / 2, cy: y + SIZE / 2, r: 3.4, class: "peg" });
      svg.append(spot, hole, pin);
      spots.push(spot); pins.push(pin);
    }
    const ghost = s("g");
    const overlay = s("g");
    const cursor = s("rect", { width: SIZE, height: SIZE, rx: 1.6, class: "cursor" });
    svg.append(ghost, overlay, cursor);
    let previewing: PegsState | null = null;
    root.append(svg);

    const centre = (c: number) => [(c % p.w) * SIZE + SIZE / 2, Math.floor(c / p.w) * SIZE + SIZE / 2] as const;
    const render = () => {
      const g = session.state.grid;
      const held = session.interaction.held;
      const stuck = session.lost;
      for (let c = 0; c < n; c++) {
        const pin = pins[c];
        if (!pin) continue;
        pin.setAttribute("visibility", g[c] === PEG ? "visible" : "hidden");
        pin.classList.toggle("held", c === held);
        pin.classList.toggle("dead", stuck);
        pin.classList.toggle("faded", !!previewing && g[c] === PEG && previewing.grid[c] !== PEG);
      }
      ghost.replaceChildren();
      previewing?.grid.forEach((v, c) => {
        if (v !== PEG || g[c] === PEG) return;
        const [cx, cy] = centre(c);
        ghost.append(s("circle", { cx, cy, r: 3.4, class: "ghost-peg" }));
      });
      overlay.replaceChildren();
      if (held >= 0) {
        for (const j of jumps(p.w, p.h, g)) {
          if (j.from !== held) continue;
          const [cx, cy] = centre(j.to);
          overlay.append(s("circle", { cx, cy, r: 4.3, class: "target" }));
        }
      }
      const f = session.activeHint?.focus as PegsFocus | undefined;
      const ring = (c: number | undefined, cls: string) => {
        if (c === undefined) return;
        const [cx, cy] = centre(c);
        overlay.append(s("circle", { cx, cy, r: 4.4, class: `mark ${cls}` }));
      };
      ring(f?.from, "from");
      ring(f?.over, "over");
      ring(f?.to, "to");
      for (const c of f?.cells ?? []) ring(c, "from");
      if (f?.from !== undefined && f.to !== undefined) {
        const [x1, y1] = centre(f.from), [x2, y2] = centre(f.to);
        overlay.append(s("path", { d: `M${x1} ${y1}Q${(x1 + x2) / 2 + (y2 - y1) * 0.25} ${(y1 + y2) / 2 - (x2 - x1) * 0.25} ${x2} ${y2}`, class: "arrow" }));
      }
      const cur = session.interaction.cursor;
      cursor.setAttribute("x", String((cur % p.w) * SIZE));
      cursor.setAttribute("y", String(Math.floor(cur / p.w) * SIZE));
    };

    const setHeld = (held: number) => session.setInteraction((i) => (i.held === held ? i : { ...i, held }));
    /** Pick up, put back, or jump into `cell`, depending on what's held. */
    const choose = (cell: number) => {
      const g = session.state.grid;
      const held = session.interaction.held;
      if (held >= 0 && g[cell] === HOLE) {
        if (session.dispatch({ type: "jump", from: held, to: cell })) setHeld(-1);
        return;
      }
      if (g[cell] === PEG) setHeld(held === cell ? -1 : cell);
    };
    const cellAt = (e: PointerEvent): number => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const v = el?.getAttribute("data-cell");
      return v === null || v === undefined ? -1 : Number(v);
    };
    let down: { cell: number; id: number; wasHeld: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      const cell = cellAt(e);
      if (cell < 0 || e.button !== 0) return;
      e.preventDefault();
      session.setInteraction((i) => ({ ...i, cursor: cell }));
      const g = session.state.grid;
      if (g[cell] === PEG) {
        down = { cell, id: e.pointerId, wasHeld: session.interaction.held === cell };
        setHeld(cell);
        svg.setPointerCapture(e.pointerId);
      } else choose(cell);
    };
    const onUp = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.id) return;
      const d = down;
      down = null;
      const cell = cellAt(e);
      if (cell === d.cell) { if (d.wasHeld) setHeld(-1); return; }
      if (cell >= 0 && session.state.grid[cell] === HOLE && e.type === "pointerup") choose(cell);
    };
    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onUp);

    const moveCursor = (dx: number, dy: number) => () => session.setInteraction((i) => {
      let x = i.cursor % p.w, y = Math.floor(i.cursor / p.w);
      for (let k = 0; k < Math.max(p.w, p.h); k++) {
        x += dx; y += dy;
        if (x < 0 || y < 0 || x >= p.w || y >= p.h) return i;
        if (p.grid[y * p.w + x] !== OBST) return { ...i, cursor: y * p.w + x };
      }
      return i;
    });

    const offs = [
      session.hooks.change.tap(render, { owner: "view" }),
      session.hooks.interaction.tap(render, { owner: "view" }),
      session.hooks.refresh.tap(render, { owner: "view" }),
    ];
    if (p.grid[session.interaction.cursor] === OBST) session.setInteraction((i) => ({ ...i, cursor: p.grid.findIndex((v) => v !== OBST) }));
    render();
    const rects = (list: Iterable<number>) => [...new Set(list)].flatMap((c) => (spots[c] ? [spots[c]!.getBoundingClientRect()] : []));
    return {
      aspect: (p.w * SIZE + 1) / (p.h * SIZE + 1),
      cells: { cols: p.w, rows: p.h },
      commands: bindCommands(BINDINGS, {
        "pegs.left": moveCursor(-1, 0),
        "pegs.right": moveCursor(1, 0),
        "pegs.up": moveCursor(0, -1),
        "pegs.down": moveCursor(0, 1),
        "pegs.select": () => choose(session.interaction.cursor),
        "pegs.drop": () => setHeld(-1),
      }, {
        "pegs.select": { menu: "board" },
        "pegs.drop": { menu: "board", when: (c) => !!c.pegsHolding },
      }),
      context: (): PegsContext => ({ pegsHolding: session.interaction.held >= 0 }),
      preview: (state) => {
        previewing = state as PegsState | null;
        render();
      },
      locate: (focus) => {
        const f = focus as PegsFocus | undefined;
        if (!f) return [];
        return rects([f.from, f.over, f.to, ...(f.cells ?? [])].filter((c): c is number => c !== undefined));
      },
      locateChange: (a, b) => {
        const x = (a as PegsState).grid, y = (b as PegsState).grid;
        return rects(x.flatMap((v, c) => (v !== y[c] ? [c] : [])));
      },
      destroy() {
        offs.forEach((f) => f());
        svg.remove();
      },
    };
  },
};

export const countWidget: WidgetDef<PegsPuzzle, PegsState, PegsAction, PegsInteraction> = {
  id: "pegs.count",
  name: "pegs left",
  description: "how many pegs are still on the board",
  puzzles: [pegs],
  defaultSlot: "top",
  order: 10,
  mount(el, { session, owner }) {
    style("pegs", CSS);
    const box = h("div", { class: "pegs-count", "aria-live": "polite" });
    el.append(box);
    const render = () => {
      const n = pegCount(session.state.grid);
      box.textContent = `${n} ${n === 1 ? "peg" : "pegs"} left`;
    };
    session.hooks.change.tap(render, { owner });
    render();
  },
};
