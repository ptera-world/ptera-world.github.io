import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { s, style, inputIs } from "../../core/dom";
import { defineSchema } from "../../core/schema";
import type { CommandDef, View } from "../../core/types";
import { geometry, type Geometry } from "./grid";
import { map, COLOUR_NAMES, type Conflicts, type MapAction, type MapFocus, type MapInteraction, type MapPuzzle, type MapState } from "./logic";
import type { MapTarget } from "./techniques";

/** Derived: Conflicts to flag on the board. */
export const CONFLICTS_KEY = "map.conflicts";

const FILLS = [
  "var(--map-red, hsl(2 70% 64%))",
  "var(--map-yellow, hsl(46 85% 60%))",
  "var(--map-green, hsl(135 40% 52%))",
  "var(--map-blue, hsl(212 65% 62%))",
] as const;

const CSS = `
.map-board { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.map-board .cell { stroke: none; }
.map-board .cell.stuck { fill: var(--danger-soft); }
.map-board .border { stroke: var(--text); stroke-width: 0.7; stroke-linecap: round; fill: none; pointer-events: none; }
.map-board .grid { stroke: var(--border); stroke-width: 0.15; fill: none; pointer-events: none; opacity: 0.6; }
.map-board .outline { fill: none; stroke-linecap: round; pointer-events: none; }
.map-board .outline.clash { stroke: var(--danger); stroke-width: 1.2; stroke-dasharray: 1.4 0.8; }
.map-board .outline.focus { stroke: var(--hint); stroke-width: 1.3; }
.map-board .outline.why { stroke: var(--hint); stroke-width: 0.8; stroke-dasharray: 1.2 0.8; }
.map-board .outline.preview { stroke: var(--hint); stroke-width: 0.6; }
.map-board .pin { fill: var(--text); pointer-events: none; }
.map-board .num { fill: var(--text); font: 600 4px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.map-board .labels text { fill: var(--text-dim); font: 500 3.6px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.map-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
${inputIs("pointer")} .map-board .cursor { display: none; }
`;

const settings = defineSchema({
  numbers: { type: "bool", label: "number the colors (1-4) as well", default: false },
  grid: { type: "bool", label: "show faint lines between cells", default: false },
});

const SIZE = 10;
const PAD = 0.6;
const LABEL = 6;

const BINDINGS = {
  "map.colour-1": { label: "red", category: "map", keys: ["1", "r"], description: "color the selected region red (or add a red pencil mark, in pencil mode). again to remove it" },
  "map.colour-2": { label: "yellow", category: "map", keys: ["2", "y"], description: "color the selected region yellow (or a pencil mark). again to remove it" },
  "map.colour-3": { label: "green", category: "map", keys: ["3", "g"], description: "color the selected region green (or a pencil mark). again to remove it" },
  "map.colour-4": { label: "blue", category: "map", keys: ["4", "b"], description: "color the selected region blue (or a pencil mark). again to remove it" },
  "map.clear": { label: "clear region", category: "map", keys: ["Backspace", "Delete", "0"], description: "remove the color or pencil marks from the selected region" },
  "map.pencil": { label: "pencil mode", category: "map", keys: ["p"], description: "while on, typed colors go in as small pencil marks: your notes of what a region could still be" },
  "map.left": { label: "cursor left", category: "map", keys: ["ArrowLeft", "a"] },
  "map.right": { label: "cursor right", category: "map", keys: ["ArrowRight", "d"] },
  "map.up": { label: "cursor up", category: "map", keys: ["ArrowUp", "w"] },
  "map.down": { label: "cursor down", category: "map", keys: ["ArrowDown", "s"] },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

export type Side = "top" | "right" | "bottom" | "left";
export type Board = { labelSides(): Set<Side>; colName(col: number): string; rowName(row: number): string };

/** Path data tracing the outline of a set of cells (every cell edge with a cell outside the set across it). */
function outline(g: Geometry, regions: Iterable<number>, inset = 0): string {
  const set = new Set<number>();
  for (const r of regions) for (const c of g.cells[r]!) set.add(c);
  let d = "";
  const i = inset;
  for (const c of set) {
    const x = (c % g.w) * SIZE, y = Math.floor(c / g.w) * SIZE;
    const has = (dx: number, dy: number) => {
      const nx = (c % g.w) + dx, ny = Math.floor(c / g.w) + dy;
      return nx >= 0 && ny >= 0 && nx < g.w && ny < g.h && set.has(ny * g.w + nx);
    };
    if (!has(0, -1)) d += `M${x + i} ${y + i}H${x + SIZE - i}`;
    if (!has(0, 1)) d += `M${x + i} ${y + SIZE - i}H${x + SIZE - i}`;
    if (!has(-1, 0)) d += `M${x + i} ${y + i}V${y + SIZE - i}`;
    if (!has(1, 0)) d += `M${x + SIZE - i} ${y + i}V${y + SIZE - i}`;
  }
  return d;
}

function legend(): { sample: string; meaning: string }[] {
  const svg = (body: string, w = 10) => `<svg viewBox="-0.5 -0.5 ${w + 1} 11">${body}</svg>`;
  const cell = (fill: string, x = 0) => `<rect x="${x}" width="10" height="10" fill="${fill}"/>`;
  const border = (w = 10) => `<rect width="${w}" height="10" fill="none" stroke="var(--text)" stroke-width="0.7"/>`;
  const dots = [0, 1, 2, 3].map((c) => `<circle cx="${3.2 + (c % 2) * 3.6}" cy="${3.2 + Math.floor(c / 2) * 3.6}" r="1.2" fill="${FILLS[c]}" stroke="var(--text)" stroke-width="0.2"/>`);
  return [
    { sample: svg(cell("var(--cell)") + border()), meaning: "a region with no color yet" },
    ...FILLS.map((f, c) => ({ sample: svg(cell(f) + border()), meaning: `${COLOUR_NAMES[c]} (${c + 1})` })),
    { sample: svg(cell(FILLS[2]) + border() + `<circle cx="5" cy="5" r="0.9" fill="var(--text)"/>`), meaning: "a region colored from the start: fixed" },
    { sample: svg(cell("var(--cell)") + border() + dots[0] + dots[3]), meaning: "pencil marks: your notes of which colors a region could still be" },
    { sample: svg(cell(FILLS[0]) + cell(FILLS[0], 10) + `<rect width="20" height="10" fill="none" stroke="var(--danger)" stroke-width="1.2" stroke-dasharray="1.4 0.8"/>` + `<line x1="10" y1="0" x2="10" y2="10" stroke="var(--text)" stroke-width="0.7"/>`, 20), meaning: "neighboring regions with the same color" },
    { sample: svg(cell("var(--danger-soft)") + border()), meaning: "a region its neighbors leave with no color" },
    { sample: svg(cell("var(--cell)") + `<rect width="10" height="10" fill="none" stroke="var(--hint)" stroke-width="1.3"/>`), meaning: "hint: a region it changes" },
    { sample: svg(cell("var(--cell)") + `<rect width="10" height="10" fill="none" stroke="var(--hint)" stroke-width="0.8" stroke-dasharray="1.2 0.8"/>`), meaning: "hint: the regions behind it" },
    { sample: svg(cell("var(--cell)") + border() + `<rect x="0.3" y="0.3" width="9.4" height="9.4" rx="1" fill="none" stroke="var(--focus)" stroke-width="0.6"/>`), meaning: "the keyboard selection (shown while using the keyboard)" },
  ];
}

/** The keys this view adds to the command context. */
export interface MapContext {
  mapPencil: boolean;
}

declare module "../../core/types" {
  interface CommandContext extends Partial<MapContext> {}
}

export function mapView(board: Board): View<MapPuzzle, MapState, MapAction, MapInteraction, typeof settings> {
  return {
    id: "map.svg",
    name: "map",
    puzzle: map,
    settings,
    controls: [
      { how: "click or tap a region", what: "cycle its color: red, yellow, green, blue, none" },
      { how: "right-click a region", what: "cycle the other way" },
      { how: "drag from a colored region to another", what: "copy the color across" },
    ],
    legend: legend(),
    mount(root, { session, settings }) {
      style("map", CSS);
      const p = session.puzzle;
      const g = geometry(p);
      const sides = board.labelSides();
      const m = (side: Side) => (sides.has(side) ? LABEL : PAD);
      const vbW = p.w * SIZE + m("left") + m("right"), vbH = p.h * SIZE + m("top") + m("bottom");
      const svg = s("svg", { viewBox: `${-m("left")} ${-m("top")} ${vbW} ${vbH}`, class: "map-board", role: "img", "aria-label": `map, ${p.n} regions` });
      const labels = s("g", { class: "labels" });
      for (let x = 0; x < p.w; x++) {
        if (sides.has("top")) labels.append(s("text", { x: x * SIZE + SIZE / 2, y: -LABEL / 2 }, board.colName(x)));
        if (sides.has("bottom")) labels.append(s("text", { x: x * SIZE + SIZE / 2, y: p.h * SIZE + LABEL / 2 }, board.colName(x)));
      }
      for (let y = 0; y < p.h; y++) {
        if (sides.has("left")) labels.append(s("text", { x: -LABEL / 2, y: y * SIZE + SIZE / 2 }, board.rowName(y)));
        if (sides.has("right")) labels.append(s("text", { x: p.w * SIZE + LABEL / 2, y: y * SIZE + SIZE / 2 }, board.rowName(y)));
      }
      const base = s("g"), marksL = s("g"), lines = s("g"), over = s("g");
      const cursor = s("rect", { width: SIZE - 0.6, height: SIZE - 0.6, rx: 1, class: "cursor" });
      svg.append(labels, base, marksL, lines, over, cursor);
      root.append(svg);

      const cx = (c: number) => (c % p.w) * SIZE;
      const cy = (c: number) => Math.floor(c / p.w) * SIZE;
      const tiles = Array.from({ length: p.w * p.h }, (_, c) => {
        const r = s("rect", { x: cx(c), y: cy(c), width: SIZE + 0.05, height: SIZE + 0.05, class: "cell" });
        base.append(r);
        return r;
      });
      if (settings.grid) {
        let d = "";
        for (let x = 1; x < p.w; x++) d += `M${x * SIZE} 0V${p.h * SIZE}`;
        for (let y = 1; y < p.h; y++) d += `M0 ${y * SIZE}H${p.w * SIZE}`;
        lines.append(s("path", { d, class: "grid" }));
      }
      let bd = `M0 0H${p.w * SIZE}V${p.h * SIZE}H0Z`;
      for (let c = 0; c < p.w * p.h; c++) {
        if (c % p.w < p.w - 1 && p.map[c] !== p.map[c + 1]) bd += `M${cx(c) + SIZE} ${cy(c)}v${SIZE}`;
        if (c + p.w < p.w * p.h && p.map[c] !== p.map[c + p.w]) bd += `M${cx(c)} ${cy(c) + SIZE}h${SIZE}`;
      }
      lines.append(s("path", { d: bd, class: "border" }));
      for (let r = 0; r < p.n; r++) {
        if (p.given[r]! >= 0) {
          const a = g.anchor[r]!;
          lines.append(s("circle", { cx: cx(a) + SIZE / 2, cy: cy(a) + SIZE / 2, r: 0.9, class: "pin" }));
        }
      }

      let preview: MapState | null = null;
      let hoverRegion = -1;

      const render = () => {
        const st = session.state;
        const conf = session.derived()[CONFLICTS_KEY] as Conflicts | undefined;
        const stuck = new Set(conf?.stuck);
        for (let c = 0; c < p.w * p.h; c++) {
          const r = p.map[c]!;
          const col = st.colours[r]!;
          tiles[c]!.style.fill = col >= 0 ? FILLS[col]! : stuck.has(r) ? "" : "var(--cell)";
          tiles[c]!.classList.toggle("stuck", col < 0 && stuck.has(r));
        }
        while (marksL.firstChild) marksL.firstChild.remove();
        for (let r = 0; r < p.n; r++) {
          const a = g.anchor[r]!;
          const pv = preview && (preview.colours[r] !== st.colours[r] || preview.marks[r] !== st.marks[r]) ? preview : null;
          if (pv && pv.colours[r] !== st.colours[r]) {
            const fill = pv.colours[r]! >= 0 ? FILLS[pv.colours[r]!] : "var(--cell)";
            for (const c of g.cells[r]!) marksL.append(s("rect", { x: cx(c) + 2.5, y: cy(c) + 2.5, width: 5, height: 5, rx: 1, fill, opacity: 0.85 }));
          }
          const mk = (pv ?? st).colours[r]! < 0 ? (pv ?? st).marks[r]! : 0;
          for (let c = 0; c < 4; c++) {
            if (!(mk & (1 << c))) continue;
            marksL.append(s("circle", { cx: cx(a) + 3.2 + (c % 2) * 3.6, cy: cy(a) + 3.2 + Math.floor(c / 2) * 3.6, r: 1.2, fill: FILLS[c], stroke: "var(--text)", "stroke-width": 0.2 }));
          }
          if (settings.numbers && st.colours[r]! >= 0) marksL.append(s("text", { x: cx(a) + SIZE / 2, y: cy(a) + SIZE / 2 + (p.given[r]! >= 0 ? 2.6 : 0.3), class: "num" }, String(st.colours[r]! + 1)));
        }
        while (over.firstChild) over.firstChild.remove();
        if (conf?.clashes.length) for (const r of conf.clashes) over.append(s("path", { d: outline(g, [r], 0.6), class: "outline clash" }));
        const focus = session.activeHint?.focus as MapFocus | undefined;
        if (focus) {
          if (focus.because?.length) over.append(s("path", { d: focus.because.map((r) => outline(g, [r], 0.8)).join(""), class: "outline why" }));
          if (focus.regions?.length) over.append(s("path", { d: focus.regions.map((r) => outline(g, [r], 0.65)).join(""), class: "outline focus" }));
        }
        const cur = session.interaction.cursor;
        cursor.setAttribute("x", String(cx(cur) + 0.3));
        cursor.setAttribute("y", String(cy(cur) + 0.3));
      };

      const cellAt = (e: PointerEvent): number => {
        const mtx = svg.getScreenCTM();
        if (!mtx) return -1;
        const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(mtx.inverse());
        const x = Math.floor(pt.x / SIZE), y = Math.floor(pt.y / SIZE);
        return x < 0 || y < 0 || x >= p.w || y >= p.h ? -1 : y * p.w + x;
      };
      const editable = (r: number) => r >= 0 && p.given[r]! < 0;
      const cycle = (r: number, dir: 1 | -1) => {
        if (!editable(r)) return;
        const cur = session.state.colours[r]!;
        const next = ((cur + 1 + dir + 5) % 5) - 1;
        session.dispatch({ type: "colour", regions: [r], colour: next });
      };
      let press: { region: number; button: number; pointerId: number } | null = null;
      const onContext = (e: Event) => e.preventDefault();
      const onDown = (e: PointerEvent) => {
        const c = cellAt(e);
        if (c < 0 || press) return;
        e.preventDefault();
        session.setInteraction((i) => ({ ...i, cursor: c }));
        if (session.locked) return;
        press = { region: p.map[c]!, button: e.button, pointerId: e.pointerId };
        svg.setPointerCapture?.(e.pointerId);
      };
      const onUp = (e: PointerEvent) => {
        if (!press || e.pointerId !== press.pointerId) return;
        const from = press;
        press = null;
        const c = cellAt(e);
        const to = c < 0 ? -1 : p.map[c]!;
        if (to === from.region) cycle(to, from.button === 2 ? -1 : 1);
        else if (to >= 0 && editable(to) && session.state.colours[from.region]! >= 0) {
          session.dispatch({ type: "colour", regions: [to], colour: session.state.colours[from.region]! });
        }
      };
      const onCancel = () => { press = null; };
      const onMove = (e: PointerEvent) => {
        if (e.pointerType === "touch") return;
        const c = cellAt(e);
        hoverRegion = c < 0 ? -1 : p.map[c]!;
      };
      svg.addEventListener("contextmenu", onContext);
      svg.addEventListener("pointerdown", onDown);
      svg.addEventListener("pointerup", onUp);
      svg.addEventListener("pointercancel", onCancel);
      svg.addEventListener("pointermove", onMove);
      svg.addEventListener("pointerleave", () => { hoverRegion = -1; });

      const move = (dx: number, dy: number) => () => session.setInteraction((i) => {
        const x = Math.min(p.w - 1, Math.max(0, (i.cursor % p.w) + dx));
        const y = Math.min(p.h - 1, Math.max(0, Math.floor(i.cursor / p.w) + dy));
        return { ...i, cursor: y * p.w + x };
      });
      const colourAt = (col: number) => () => {
        const r = p.map[session.interaction.cursor]!;
        if (!editable(r)) return;
        if (session.interaction.pencil) session.dispatch({ type: "toggle-mark", region: r, colour: col });
        else session.dispatch({ type: "colour", regions: [r], colour: session.state.colours[r] === col ? -1 : col });
      };

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(() => {
          if (session.locked) press = null;
          render();
        }, { owner: "view" }),
      ];
      render();

      const rects = (regions: Iterable<number>) => [...new Set(regions)].flatMap((r) => g.cells[r]!.map((c) => tiles[c]!.getBoundingClientRect()));
      const commands: CommandDef[] = bindCommands(BINDINGS, {
        "map.colour-1": colourAt(0),
        "map.colour-2": colourAt(1),
        "map.colour-3": colourAt(2),
        "map.colour-4": colourAt(3),
        "map.clear": () => {
          const r = p.map[session.interaction.cursor]!;
          if (!editable(r)) return;
          if (session.state.colours[r]! >= 0) session.dispatch({ type: "colour", regions: [r], colour: -1 });
          else session.dispatch({ type: "marks", regions: [r], marks: 0 });
        },
        "map.pencil": () => session.setInteraction((i) => ({ ...i, pencil: !i.pencil })),
        "map.left": move(-1, 0),
        "map.right": move(1, 0),
        "map.up": move(0, -1),
        "map.down": move(0, 1),
      }, {
        "map.colour-1": { menu: "board" },
        "map.colour-2": { menu: "board" },
        "map.colour-3": { menu: "board" },
        "map.colour-4": { menu: "board" },
        "map.clear": { menu: "board" },
        "map.pencil": { menu: "board", checked: () => session.interaction.pencil },
      });
      return {
        gestures: { secondaryClick: true },
        aspect: vbW / vbH,
        cells: { cols: p.w, rows: p.h },
        commands,
        context: (): MapContext => ({ mapPencil: session.interaction.pencil }),
        target: (): MapTarget => ({ region: hoverRegion >= 0 ? hoverRegion : p.map[session.interaction.cursor]! }),
        preview: (st) => {
          preview = st as MapState | null;
          render();
        },
        locate: (focus) => {
          const f = focus as MapFocus | undefined;
          return f ? rects([...(f.regions ?? []), ...(f.because ?? [])]) : [];
        },
        locateChange: (a, b) => {
          const x = a as MapState, y = b as MapState;
          const changed: number[] = [];
          for (let r = 0; r < p.n; r++) if (x.colours[r] !== y.colours[r] || x.marks[r] !== y.marks[r]) changed.push(r);
          return rects(changed);
        },
        destroy() {
          offs.forEach((f) => f());
          svg.remove();
        },
      };
    },
  };
}
