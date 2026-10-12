import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { s, style, inputIs } from "../../core/dom";
import { buttonsSwapped, secondary } from "../../core/gestures";
import { defineSchema } from "../../core/schema";
import type { CommandDef, View } from "../../core/types";
import { DOWN, LEFT, RIGHT, UP, edgeAt, edgeGrid, step } from "../../lib/edges";
import {
  tracks, CROSS, EMPTY, LINE, NONE, TRACK, trackCells,
  type Conflicts, type TracksAction, type TracksFocus, type TracksInteraction, type TracksPuzzle, type TracksState,
} from "./logic";
import { BIT, countCells, entryCell, exitCell, target } from "./solver";
import type { TracksTarget } from "./techniques";

/** Derived: Conflicts to flag on the board. */
export const CONFLICTS_KEY = "tracks.conflicts";

const CSS = `
.tracks-board { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.tracks-board .cell { fill: var(--cell); stroke: var(--border); stroke-width: 0.25; }
.tracks-board .cell.given { fill: var(--surface-2, var(--cell)); }
.tracks-board .cell.bad { fill: var(--danger-soft); }
.tracks-board .rail { stroke: var(--accent); stroke-width: 2; stroke-linecap: round; pointer-events: none; fill: none; }
.tracks-board .faded { opacity: 0.25; }
.tracks-board .rail.given { stroke: var(--text); }
.tracks-board .rail.loop-bad { stroke: var(--danger); }
.tracks-board .rail.preview { stroke: var(--hint); opacity: 0.6; }
.tracks-board .cross { stroke: var(--text-dim); stroke-width: 0.5; stroke-linecap: round; pointer-events: none; }
.tracks-board .cross.preview { stroke: var(--hint); }
.tracks-board .has { fill: var(--accent); opacity: 0.5; pointer-events: none; }
.tracks-board .has.preview { fill: var(--hint); }
.tracks-board .none { stroke: var(--text-dim); stroke-width: 0.6; stroke-linecap: round; pointer-events: none; }
.tracks-board .none.preview { stroke: var(--hint); }
.tracks-board .count { fill: var(--text); font: 600 4.6px var(--font); text-anchor: middle; dominant-baseline: central; }
.tracks-board .count.done { opacity: var(--done-opacity); }
.tracks-board .count.bad { fill: var(--danger); opacity: 1; }
.tracks-board .end { fill: var(--text); font: 700 4.4px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.tracks-board .focus { fill: none; stroke: var(--hint); stroke-width: 0.9; pointer-events: none; }
.tracks-board .focus.why { stroke-dasharray: 1.2 0.8; stroke-width: 0.6; }
.tracks-board .focus-edge { stroke: var(--hint); stroke-width: 3.4; stroke-linecap: round; opacity: 0.45; pointer-events: none; }
.tracks-board .labels text { fill: var(--text-dim); font: 500 3.4px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.tracks-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
${inputIs("pointer")} .tracks-board .cursor { display: none; }
`;

const settings = defineSchema({
  longPressMs: { type: "int", label: "touch long-press for a cross or a no-track mark (ms)", default: 400, min: 150, max: 1500, step: 50 },
});

const SIZE = 10;
const LABEL = 5;
/** Margins: counts above and to the right, the entrance's A on the left, the exit's B below. */
const TOP = 7, RIGHT_M = 7, LEFT_M = 6, BOTTOM_M = 6;

const BINDINGS = {
  "tracks.has-track": { label: "track here mark", category: "tracks", keys: ["space", "t"], description: "mark the selected cell as having track (before you know which way it runs), or remove the mark" },
  "tracks.no-track": { label: "no track here mark", category: "tracks", keys: ["x", "period"], description: "mark the selected cell as having no track, or remove the mark" },
  "tracks.line-up": { label: "track up", category: "tracks", keys: ["shift+ArrowUp", "shift+w"], description: "lay (or remove) track from the selected cell upwards, and move there" },
  "tracks.line-right": { label: "track right", category: "tracks", keys: ["shift+ArrowRight", "shift+d"], description: "lay (or remove) track to the right, and move there" },
  "tracks.line-down": { label: "track down", category: "tracks", keys: ["shift+ArrowDown", "shift+s"], description: "lay (or remove) track downwards, and move there" },
  "tracks.line-left": { label: "track left", category: "tracks", keys: ["shift+ArrowLeft", "shift+a"], description: "lay (or remove) track to the left, and move there" },
  "tracks.cross-up": { label: "cross up", category: "tracks", keys: ["alt+ArrowUp"], description: "cross off the edge above the selected cell (no track there), or remove the cross" },
  "tracks.cross-right": { label: "cross right", category: "tracks", keys: ["alt+ArrowRight"], description: "cross off the edge to the right, or remove the cross" },
  "tracks.cross-down": { label: "cross down", category: "tracks", keys: ["alt+ArrowDown"], description: "cross off the edge below, or remove the cross" },
  "tracks.cross-left": { label: "cross left", category: "tracks", keys: ["alt+ArrowLeft"], description: "cross off the edge to the left, or remove the cross" },
  "tracks.left": { label: "cursor left", category: "tracks", keys: ["ArrowLeft", "a"] },
  "tracks.right": { label: "cursor right", category: "tracks", keys: ["ArrowRight", "d"] },
  "tracks.up": { label: "cursor up", category: "tracks", keys: ["ArrowUp", "w"] },
  "tracks.down": { label: "cursor down", category: "tracks", keys: ["ArrowDown", "s"] },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

export type Side = "top" | "right" | "bottom" | "left";
export type Board = { labelSides(): Set<Side>; colName(col: number): string; rowName(row: number): string };

function legend(): { sample: string; meaning: string }[] {
  const svg = (body: string, w = 10) => `<svg viewBox="-0.5 -0.5 ${w + 1} 11">${body}</svg>`;
  const cell = (x = 0, fill = "var(--cell)") => `<rect x="${x}" width="10" height="10" fill="${fill}" stroke="var(--border)" stroke-width="0.25"/>`;
  const rail = (stroke: string, d = "M5 5H15") => `<path d="${d}" stroke="${stroke}" stroke-width="2" stroke-linecap="round" fill="none"/>`;
  const box = (stroke: string, extra = "") => `<rect x="0.5" y="0.5" width="9" height="9" rx="1" fill="none" stroke="${stroke}" ${extra}/>`;
  return [
    { sample: svg(cell(0) + cell(10) + rail("var(--accent)"), 20), meaning: "track you laid between two cells" },
    { sample: svg(cell(0, "var(--surface-2, var(--cell))") + rail("var(--text)", "M0 5H5V10")), meaning: "a piece of track shown from the start" },
    { sample: svg(`<text x="5" y="5.3" font-size="4.6" font-weight="600" font-family="var(--font)" fill="var(--text)" text-anchor="middle" dominant-baseline="central">3</text>`), meaning: "a count: how many cells in that row or column the track passes through" },
    { sample: svg(`<text x="5" y="5.3" font-size="4.4" font-weight="700" font-family="var(--font)" fill="var(--text)" text-anchor="middle" dominant-baseline="central">A</text>`), meaning: "A is where the track enters, B where it leaves" },
    { sample: svg(cell(0) + cell(10) + `<path d="M9 4l2 2M11 4l-2 2" stroke="var(--text-dim)" stroke-width="0.5" stroke-linecap="round"/>`, 20), meaning: "a cross: your note that no track crosses this edge" },
    { sample: svg(cell() + `<rect x="3" y="3" width="4" height="4" rx="1" fill="var(--accent)" opacity="0.5"/>`), meaning: "your note that this cell has track" },
    { sample: svg(cell() + `<path d="M3.5 3.5l3 3M6.5 3.5l-3 3" stroke="var(--text-dim)" stroke-width="0.6" stroke-linecap="round"/>`), meaning: "your note that this cell has no track" },
    { sample: svg(`<text x="5" y="5.3" font-size="4.6" font-weight="600" font-family="var(--font)" fill="var(--danger)" text-anchor="middle" dominant-baseline="central">3</text>`), meaning: "a count already passed, or out of reach" },
    { sample: svg(cell(0, "var(--danger-soft)")), meaning: "a cell whose track can't be right (three ends, or nowhere to go)" },
    { sample: svg(cell(0) + cell(10) + `<path d="M5 5H15" stroke="var(--hint)" stroke-width="3.4" stroke-linecap="round" opacity="0.45"/>`, 20), meaning: "hint: the edges it changes" },
    { sample: svg(cell() + box("var(--hint)", `stroke-width="0.9"`)), meaning: "hint: a cell it marks" },
    { sample: svg(cell() + box("var(--hint)", `stroke-width="0.6" stroke-dasharray="1.2 0.8"`)), meaning: "hint: the reason (a cell or a count)" },
    { sample: svg(cell() + box("var(--focus)", `stroke-width="0.6"`)), meaning: "the keyboard selection (shown while using the keyboard)" },
  ];
}

export function tracksView(board: Board): View<TracksPuzzle, TracksState, TracksAction, TracksInteraction, typeof settings> {
  return {
    id: "tracks.svg",
    name: "grid",
    puzzle: tracks,
    settings,
    controls: [
      { how: "drag from cell to cell", what: "lay track (dragging over track you laid removes it)" },
      { how: "click or tap near the side of a cell", what: "lay or remove the track across that side" },
      { how: "right-click near the side of a cell, or hold it on a touch screen", what: "put a cross there (no track), or take it away" },
      { how: "click the middle of a cell (right-click: no track)", what: "mark that it has track, or that it doesn't. tapping the middle cycles through both" },
    ],
    legend: legend(),
    mount(root, { session, settings }) {
      style("tracks", CSS);
      const p = session.puzzle;
      const g = edgeGrid(p.w, p.h);
      const sides = board.labelSides();
      const m = (side: Side) => (sides.has(side) ? LABEL : 0);
      const left = LEFT_M + m("left"), top = TOP + m("top");
      const vbW = p.w * SIZE + left + RIGHT_M + m("right"), vbH = p.h * SIZE + top + BOTTOM_M + m("bottom");
      const svg = s("svg", { viewBox: `${-left} ${-top} ${vbW} ${vbH}`, class: "tracks-board", role: "grid", "aria-label": `tracks, ${p.w} by ${p.h}` });
      const labels = s("g", { class: "labels" });
      for (let x = 0; x < p.w; x++) {
        if (sides.has("top")) labels.append(s("text", { x: x * SIZE + SIZE / 2, y: -TOP - LABEL / 2 }, board.colName(x)));
        if (sides.has("bottom")) labels.append(s("text", { x: x * SIZE + SIZE / 2, y: p.h * SIZE + BOTTOM_M + LABEL / 2 }, board.colName(x)));
      }
      for (let y = 0; y < p.h; y++) {
        if (sides.has("left")) labels.append(s("text", { x: -LEFT_M - LABEL / 2, y: y * SIZE + SIZE / 2 }, board.rowName(y)));
        if (sides.has("right")) labels.append(s("text", { x: p.w * SIZE + RIGHT_M + LABEL / 2, y: y * SIZE + SIZE / 2 }, board.rowName(y)));
      }
      const base = s("g"), marks = s("g"), rails = s("g"), over = s("g");
      const cursor = s("rect", { width: SIZE - 0.6, height: SIZE - 0.6, rx: 1, class: "cursor" });
      svg.append(labels, base, marks, rails, over, cursor);
      root.append(svg);

      const cx = (c: number) => (c % p.w) * SIZE + SIZE / 2;
      const cy = (c: number) => Math.floor(c / p.w) * SIZE + SIZE / 2;
      const tiles: SVGRectElement[] = [];
      for (let c = 0; c < g.n; c++) base.append(tiles[c] = s("rect", { x: cx(c) - SIZE / 2, y: cy(c) - SIZE / 2, width: SIZE, height: SIZE, class: p.given[c] ? "cell given" : "cell" }));
      const counts: SVGTextElement[] = [];
      const countPos = (i: number) => (i < p.w ? { x: i * SIZE + SIZE / 2, y: -TOP / 2 } : { x: p.w * SIZE + RIGHT_M / 2, y: (i - p.w) * SIZE + SIZE / 2 });
      for (let i = 0; i < p.w + p.h; i++) {
        const { x, y } = countPos(i);
        base.append(counts[i] = s("text", { x, y: y + 0.3, class: "count" }, String(target(p, i))));
      }
      const en = entryCell(p), ex = exitCell(p);
      base.append(s("text", { x: -LEFT_M / 2, y: cy(en) - 3.4, class: "end" }, "A"));
      base.append(s("text", { x: cx(ex) + 3.4, y: p.h * SIZE + BOTTOM_M / 2, class: "end" }, "B"));

      /** Fixed rails: given pieces, plus the stubs off the board at the entrance and exit. */
      const fixed = s("g");
      for (let c = 0; c < g.n; c++) {
        const bits = p.given[c]!;
        if (!bits) continue;
        let d = "";
        for (let dir = 0; dir < 4; dir++) {
          if (!(bits & BIT[dir]!)) continue;
          const len = (c === en && dir === LEFT) || (c === ex && dir === DOWN) ? SIZE / 2 + 2 : SIZE / 2;
          const dx = [0, 1, 0, -1][dir]! * len, dy = [-1, 0, 1, 0][dir]! * len;
          d += `M${cx(c)} ${cy(c)}l${dx} ${dy}`;
        }
        fixed.append(s("path", { d, class: "rail given" }));
      }
      rails.append(fixed);
      const dyn = s("g");
      rails.append(dyn);
      const mid = (e: number) => [(cx(g.ea[e]!) + cx(g.eb[e]!)) / 2, (cy(g.ea[e]!) + cy(g.eb[e]!)) / 2] as const;

      let preview: TracksState | null = null;
      let hover = -1;

      const render = () => {
        const st = session.state;
        const conf = session.derived()[CONFLICTS_KEY] as Conflicts | undefined;
        const badCells = new Set(conf?.cells), badCounts = new Set(conf?.counts), loop = new Set(conf?.loop);
        for (let c = 0; c < g.n; c++) tiles[c]!.classList.toggle("bad", badCells.has(c));
        const on = trackCells(p, st);
        for (let i = 0; i < p.w + p.h; i++) {
          const n = countCells(p, i).filter((c) => on[c]).length;
          counts[i]!.classList.toggle("done", n === target(p, i) && !badCounts.has(i));
          counts[i]!.classList.toggle("bad", badCounts.has(i));
        }
        while (dyn.firstChild) dyn.firstChild.remove();
        while (marks.firstChild) marks.firstChild.remove();
        const drawEdge = (e: number, v: number, extra = "") => {
          if (v === LINE) {
            const bad = loop.has(g.ea[e]!) && loop.has(g.eb[e]!);
            dyn.append(s("line", { x1: cx(g.ea[e]!), y1: cy(g.ea[e]!), x2: cx(g.eb[e]!), y2: cy(g.eb[e]!), class: `rail${bad ? " loop-bad" : ""}${extra}` }));
          } else if (v === CROSS) {
            const [x, y] = mid(e);
            dyn.append(s("path", { d: `M${x - 1} ${y - 1}l2 2M${x + 1} ${y - 1}l-2 2`, class: `cross${extra}` }));
          }
        };
        for (let e = 0; e < g.ne; e++) {
          const changed = !!preview && preview.edges[e] !== st.edges[e];
          drawEdge(e, st.edges[e]!, changed ? " faded" : "");
          if (changed) drawEdge(e, preview!.edges[e]!, " preview");
        }
        const drawMark = (c: number, v: number, extra = "") => {
          if (v === TRACK) marks.append(s("rect", { x: cx(c) - 2, y: cy(c) - 2, width: 4, height: 4, rx: 1, class: `has${extra}` }));
          else if (v === EMPTY) marks.append(s("path", { d: `M${cx(c) - 1.5} ${cy(c) - 1.5}l3 3M${cx(c) + 1.5} ${cy(c) - 1.5}l-3 3`, class: `none${extra}` }));
        };
        for (let c = 0; c < g.n; c++) {
          const changed = !!preview && preview.cells[c] !== st.cells[c];
          drawMark(c, st.cells[c]!, changed ? " faded" : "");
          if (changed) drawMark(c, preview!.cells[c]!, " preview");
        }
        while (over.firstChild) over.firstChild.remove();
        const focus = session.activeHint?.focus as TracksFocus | undefined;
        if (focus) {
          const box = (x: number, y: number, cls: string) => over.append(s("rect", { x: x - SIZE / 2 + 0.5, y: y - SIZE / 2 + 0.5, width: SIZE - 1, height: SIZE - 1, rx: 1, class: cls }));
          for (const i of focus.counts ?? []) { const c = countPos(i); box(c.x, c.y, "focus why"); }
          for (const c of focus.because ?? []) box(cx(c), cy(c), "focus why");
          for (const c of focus.cells ?? []) box(cx(c), cy(c), "focus");
          for (const e of focus.edges ?? []) over.append(s("line", { x1: cx(g.ea[e]!), y1: cy(g.ea[e]!), x2: cx(g.eb[e]!), y2: cy(g.eb[e]!), class: "focus-edge" }));
        }
        const cur = session.interaction.cursor;
        cursor.setAttribute("x", String(cx(cur) - SIZE / 2 + 0.3));
        cursor.setAttribute("y", String(cy(cur) - SIZE / 2 + 0.3));
      };

      /** The cell under the pointer, and the edge it is near (-1 near the middle). */
      const pointAt = (e: PointerEvent): { cell: number; edge: number; centre: boolean } => {
        const mtx = svg.getScreenCTM();
        if (!mtx) return { cell: -1, edge: -1, centre: false };
        const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(mtx.inverse());
        const x = Math.floor(pt.x / SIZE), y = Math.floor(pt.y / SIZE);
        if (x < 0 || y < 0 || x >= p.w || y >= p.h) return { cell: -1, edge: -1, centre: false };
        const cell = y * p.w + x;
        const dx = pt.x - (x * SIZE + SIZE / 2), dy = pt.y - (y * SIZE + SIZE / 2);
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SIZE * 0.22) return { cell, edge: -1, centre: true };
        const d = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? LEFT : RIGHT) : (dy < 0 ? UP : DOWN);
        return { cell, edge: edgeAt(g, cell, d), centre: false };
      };
      const toggleEdge = (e: number, v: number) => session.dispatch({ type: "edge", edges: [e], value: session.state.edges[e] === v ? NONE : v });
      const toggleCell = (c: number, v: number) => session.dispatch({ type: "cell", cells: [c], value: session.state.cells[c] === v ? NONE : v });
      const cycleCell = (c: number) => {
        const v = session.state.cells[c];
        session.dispatch({ type: "cell", cells: [c], value: v === NONE ? TRACK : v === TRACK ? EMPTY : NONE });
      };

      let drag: { pointerId: number; from: number; mode: number | null; moved: boolean; at: ReturnType<typeof pointAt>; sec: boolean; touch: boolean; drawn: number } | null = null;
      let pressTimer = 0;
      const cancelPress = () => { clearTimeout(pressTimer); pressTimer = 0; };
      const onContext = (e: Event) => e.preventDefault();
      const onDown = (e: PointerEvent) => {
        const at = pointAt(e);
        if (at.cell < 0 || drag) return;
        e.preventDefault();
        session.setInteraction((i) => ({ ...i, cursor: at.cell }));
        if (session.locked) return;
        svg.setPointerCapture?.(e.pointerId);
        drag = { pointerId: e.pointerId, from: at.cell, mode: null, moved: false, at, sec: secondary(e, session.def.id), touch: e.pointerType === "touch", drawn: 0 };
        if (drag.touch) {
          pressTimer = window.setTimeout(() => {
            pressTimer = 0;
            if (!drag || drag.moved) return;
            navigator.vibrate?.(15);
            if (drag.at.centre) toggleCell(drag.at.cell, buttonsSwapped(session.def.id) ? TRACK : EMPTY);
            else if (drag.at.edge >= 0) toggleEdge(drag.at.edge, buttonsSwapped(session.def.id) ? LINE : CROSS);
            drag = null;
          }, settings.longPressMs as number);
        }
      };
      const onMove = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointerId) {
          if (e.pointerType !== "touch") hover = pointAt(e).cell;
          return;
        }
        const at = pointAt(e);
        if (at.cell < 0 || at.cell === drag.from || (drag.sec && !drag.touch)) return;
        let edge = -1;
        for (let d = 0; d < 4; d++) if (step(g, drag.from, d) === at.cell) edge = edgeAt(g, drag.from, d);
        if (edge < 0) return;
        cancelPress();
        drag.moved = true;
        if (drag.mode === null) drag.mode = session.state.edges[edge] === LINE ? NONE : LINE;
        if (session.dispatch({ type: "edge", edges: [edge], value: drag.mode }, { extend: drag.drawn > 0 })) drag.drawn++;
        drag.from = at.cell;
        session.setInteraction((i) => ({ ...i, cursor: at.cell }));
      };
      const onUp = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const d = drag;
        drag = null;
        const pending = pressTimer !== 0;
        cancelPress();
        if (d.moved || (d.touch && !pending)) return;
        if (d.at.centre) {
          if (d.touch && !d.sec) cycleCell(d.at.cell);
          else toggleCell(d.at.cell, d.sec ? EMPTY : TRACK);
        } else if (d.at.edge >= 0) toggleEdge(d.at.edge, d.sec ? CROSS : LINE);
      };
      const onCancel = (e: PointerEvent) => {
        if (drag && e.pointerId === drag.pointerId) drag = null;
        cancelPress();
      };
      svg.addEventListener("contextmenu", onContext);
      svg.addEventListener("pointerdown", onDown);
      svg.addEventListener("pointermove", onMove);
      svg.addEventListener("pointerup", onUp);
      svg.addEventListener("pointercancel", onCancel);
      svg.addEventListener("pointerleave", () => { hover = -1; });

      const move = (dx: number, dy: number) => () => session.setInteraction((i) => {
        const x = Math.min(p.w - 1, Math.max(0, (i.cursor % p.w) + dx));
        const y = Math.min(p.h - 1, Math.max(0, Math.floor(i.cursor / p.w) + dy));
        return { ...i, cursor: y * p.w + x };
      });
      const lineTo = (d: number) => () => {
        const c = session.interaction.cursor;
        const e = edgeAt(g, c, d);
        if (e < 0) return;
        toggleEdge(e, LINE);
        session.setInteraction((i) => ({ ...i, cursor: step(g, c, d) }));
      };
      const crossAt = (d: number) => () => {
        const e = edgeAt(g, session.interaction.cursor, d);
        if (e >= 0) toggleEdge(e, CROSS);
      };

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(() => {
          if (session.locked) { drag = null; cancelPress(); }
          render();
        }, { owner: "view" }),
      ];
      render();

      const rects = (cells: Iterable<number>) => [...new Set(cells)].map((c) => tiles[c]!.getBoundingClientRect());
      const commands: CommandDef[] = bindCommands(BINDINGS, {
        "tracks.has-track": () => toggleCell(session.interaction.cursor, TRACK),
        "tracks.no-track": () => toggleCell(session.interaction.cursor, EMPTY),
        "tracks.line-up": lineTo(UP),
        "tracks.line-right": lineTo(RIGHT),
        "tracks.line-down": lineTo(DOWN),
        "tracks.line-left": lineTo(LEFT),
        "tracks.cross-up": crossAt(UP),
        "tracks.cross-right": crossAt(RIGHT),
        "tracks.cross-down": crossAt(DOWN),
        "tracks.cross-left": crossAt(LEFT),
        "tracks.left": move(-1, 0),
        "tracks.right": move(1, 0),
        "tracks.up": move(0, -1),
        "tracks.down": move(0, 1),
      }, {
        "tracks.has-track": { menu: "board" },
        "tracks.no-track": { menu: "board" },
        "tracks.line-up": { menu: "board" },
        "tracks.line-right": { menu: "board" },
        "tracks.line-down": { menu: "board" },
        "tracks.line-left": { menu: "board" },
        "tracks.cross-up": { menu: "board" },
        "tracks.cross-right": { menu: "board" },
        "tracks.cross-down": { menu: "board" },
        "tracks.cross-left": { menu: "board" },
      });
      return {
        gestures: { secondaryClick: true, hold: true },
        aspect: vbW / vbH,
        cells: { cols: p.w + 1, rows: p.h + 1 },
        commands,
        target: (): TracksTarget => ({ cell: hover >= 0 ? hover : session.interaction.cursor }),
        preview: (st) => {
          preview = st as TracksState | null;
          render();
        },
        locate: (focus) => {
          const f = focus as TracksFocus | undefined;
          if (!f) return [];
          const out = rects([...(f.edges ?? []).flatMap((e) => [g.ea[e]!, g.eb[e]!]), ...(f.cells ?? []), ...(f.because ?? [])]);
          for (const i of f.counts ?? []) out.push(counts[i]!.getBoundingClientRect());
          return out;
        },
        locateChange: (a, b) => {
          const x = a as TracksState, y = b as TracksState;
          const cells: number[] = [];
          x.edges.forEach((v, e) => { if (v !== y.edges[e]) cells.push(g.ea[e]!, g.eb[e]!); });
          x.cells.forEach((v, c) => { if (v !== y.cells[c]) cells.push(c); });
          return rects(cells);
        },
        destroy() {
          cancelPress();
          offs.forEach((f) => f());
          svg.remove();
        },
      };
    },
  };
}
