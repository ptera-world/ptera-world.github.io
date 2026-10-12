import { defineSchema } from "../../core/schema";
import type { View } from "../../core/types";
import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { s, style, inputIs } from "../../core/dom";
import { affected, flip, type FlipAction, type FlipInteraction, type FlipPuzzle, type FlipState } from "./logic";

/** Derived-annotation key: cells to press (from the solution assist). */
export const SOLUTION_KEY = "flip.solution";

const CSS = `
.flip-board { width: 100%; height: 100%; touch-action: manipulation; user-select: none; }
.flip-board .cell { fill: var(--cell); stroke: var(--border); stroke-width: 0.3; cursor: pointer; transition: fill 120ms; }
.flip-board .cell.lit { fill: var(--cell-lit); }
.flip-board .cell.preview { stroke: var(--accent); stroke-width: 0.8; }
.flip-board .cell.solution { stroke: var(--hint); stroke-width: 1; stroke-dasharray: 1.5 1; }
.flip-board .cell.hint { stroke: var(--hint); stroke-width: 1.4; }
.flip-board .ghost { pointer-events: none; opacity: 0.8; stroke: var(--text-dim); stroke-width: 0.4; stroke-dasharray: 1 0.7; }
.flip-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
${inputIs("pointer")} .flip-board .cursor { display: none; }
`;

const settings = defineSchema({
  preview: { type: "bool", label: "highlight affected cells on hover", default: true },
});

const BINDINGS = {
  "flip.left": { label: "cursor left", category: "flip", keys: ["ArrowLeft", "a"] },
  "flip.right": { label: "cursor right", category: "flip", keys: ["ArrowRight", "d"] },
  "flip.up": { label: "cursor up", category: "flip", keys: ["ArrowUp", "w"] },
  "flip.down": { label: "cursor down", category: "flip", keys: ["ArrowDown", "s"] },
  "flip.press": { label: "press cell", category: "flip", keys: ["space", "Enter"] },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

export const flipView: View<FlipPuzzle, FlipState, FlipAction, FlipInteraction, typeof settings> & { bindings: typeof BINDINGS } = {
  id: "flip.svg",
  name: "grid",
  puzzle: flip,
  settings,
  controls: [{ how: "click or tap a light", what: "press it (toggles it and its neighbors)" }],
  bindings: BINDINGS,
  mount(root, { session, settings }) {
    style("flip", CSS);
    const p = session.puzzle;
    const hex = p.grid === "hex";
    const size = 10;
    const cellH = hex ? (size * 2) / Math.sqrt(3) : size;
    const boardW = p.w * size + (hex && p.h > 1 ? size / 2 : 0);
    const boardH = hex ? (p.h - 1) * 0.75 * cellH + cellH : p.h * size;
    const centre = (i: number): [number, number] => {
      const col = i % p.w, row = Math.floor(i / p.w);
      return hex
        ? [col * size + size / 2 + (row & 1) * (size / 2), cellH / 2 + row * 0.75 * cellH]
        : [col * size + size / 2, row * size + size / 2];
    };
    /** A cell-shaped element scaled about the cell's centre by k. */
    const shape = (i: number, k: number, attrs: Record<string, string | number>) => {
      const [cx, cy] = centre(i);
      if (!hex) return s("rect", { x: cx - (size * k) / 2, y: cy - (size * k) / 2, width: size * k, height: size * k, rx: 1.5 * k, ...attrs });
      const hw = (size / 2) * k, hh = (cellH / 2) * k;
      const pts = [[0, -hh], [hw, -hh / 2], [hw, hh / 2], [0, hh], [-hw, hh / 2], [-hw, -hh / 2]];
      return s("polygon", { points: pts.map(([x, y]) => `${cx + x!},${cy + y!}`).join(" "), ...attrs });
    };
    const svg = s("svg", {
      viewBox: `-1 -1 ${boardW + 2} ${boardH + 2}`,
      class: "flip-board", role: "grid", "aria-label": `${p.w} by ${p.h} lights`,
    });
    let hover = -1;
    const cells = p.lights.map((_, i) => {
      if (p.holes[i]) return null;
      const r = shape(i, 0.9, { class: "cell", "data-cell": i });
      svg.append(r);
      return r;
    });
    const ghost = s("g", { class: "ghost" });
    const cursor = s("g", { class: "cursor" });
    svg.append(ghost, cursor);
    let previewing: FlipState | null = null;
    root.append(svg);

    const render = () => {
      const st = session.state;
      const d = session.derived();
      const sol = new Set((d[SOLUTION_KEY] as number[] | undefined) ?? []);
      const hint = new Set((session.activeHint?.focus as number[] | undefined) ?? []);
      const prev = settings.preview && hover >= 0 ? new Set(affected(p, hover)) : new Set<number>();
      cells.forEach((r, i) => {
        if (!r) return;
        r.classList.toggle("lit", st.lights[i] === 1);
        r.classList.toggle("solution", sol.has(i));
        r.classList.toggle("hint", hint.has(i));
        r.classList.toggle("preview", prev.has(i));
      });
      ghost.replaceChildren();
      previewing?.lights.forEach((v, i) => {
        if (v === st.lights[i] || p.holes[i]) return;
        ghost.append(shape(i, 0.5, { fill: v ? "var(--cell-lit)" : "var(--cell)" }));
      });
      cursor.replaceChildren(shape(session.interaction.cursor, 1, { fill: "none" }));
    };

    const press = (cell: number) => {
      if (p.holes[cell]) return;
      session.setInteraction((i) => ({ ...i, cursor: cell }));
      session.dispatch({ type: "press", cell });
    };
    svg.addEventListener("pointerdown", (e) => {
      const cell = Number((e.target as Element).getAttribute("data-cell"));
      if (Number.isInteger(cell) && (e.target as Element).hasAttribute("data-cell")) press(cell);
    });
    svg.addEventListener("pointerover", (e) => {
      const attr = (e.target as Element).getAttribute("data-cell");
      hover = attr === null ? -1 : Number(attr);
      render();
    });
    svg.addEventListener("pointerleave", () => { hover = -1; render(); });

    /** Steps through rows and columns of the grid layout, landing on the next real cell, else staying. */
    const move = (dx: number, dy: number) => () => {
      session.setInteraction((i) => {
        let x = (i.cursor % p.w) + dx, y = Math.floor(i.cursor / p.w) + dy;
        while (x >= 0 && y >= 0 && x < p.w && y < p.h) {
          if (!p.holes[y * p.w + x]) return { ...i, cursor: y * p.w + x };
          x += dx;
          y += dy;
        }
        return i;
      });
    };

    const offs = [
      session.hooks.change.tap(render, { owner: "view" }),
      session.hooks.interaction.tap(render, { owner: "view" }),
      session.hooks.refresh.tap(render, { owner: "view" }),
    ];
    render();
    const rects = (list: Iterable<number>) => [...list].flatMap((i) => (cells[i] ? [cells[i]!.getBoundingClientRect()] : []));
    return {
      aspect: boardW / boardH,
      cells: { cols: (boardW + 2) / size, rows: (boardH + 2) / size },
      preview: (state) => {
        previewing = state as FlipState | null;
        render();
      },
      locate: (focus) => (Array.isArray(focus) ? rects(focus as number[]) : []),
      locateChange: (a, b) => {
        const x = (a as FlipState).lights, y = (b as FlipState).lights;
        return rects(x.flatMap((v, i) => (v !== y[i] ? [i] : [])));
      },
      destroy() {
        offs.forEach((f) => f());
        svg.remove();
      },
      commands: bindCommands(flipView.bindings, {
        "flip.left": move(-1, 0),
        "flip.right": move(1, 0),
        "flip.up": move(0, -1),
        "flip.down": move(0, 1),
        "flip.press": () => press(session.interaction.cursor),
      }, { "flip.press": { menu: "board" } }),
    };
  },
};
