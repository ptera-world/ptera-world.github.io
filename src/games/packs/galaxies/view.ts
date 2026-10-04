import { bindCommands, type BindingSchema } from "../../core/commands";
import { s, style } from "../../core/dom";
import { defineSchema } from "../../core/schema";
import type { CommandDef, View } from "../../core/types";
import type { Conflicts, GalaxiesAction, GalaxiesFocus, GalaxiesInteraction, GalaxiesPuzzle, GalaxiesState } from "./logic";
import { geometry } from "./solver";
import type { GalaxiesTarget } from "./techniques";

/** Derived: Conflicts to flag on the board. */
export const CONFLICTS_KEY = "galaxies.conflicts";

const CSS = `
.galaxies-board { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.galaxies-board .tile { fill: var(--cell); stroke: var(--border); stroke-width: 0.2; }
.galaxies-board .tile.bad { fill: var(--danger-soft); }
.galaxies-board .wall { stroke: var(--text); stroke-width: 0.8; stroke-linecap: round; fill: none; pointer-events: none; }
.galaxies-board .dot { stroke: var(--text); stroke-width: 0.5; pointer-events: none; }
.galaxies-board .dot.white { fill: var(--cell); }
.galaxies-board .dot.black { fill: var(--text); }
.galaxies-board .dot.brush { stroke: var(--focus); stroke-width: 0.9; }
.galaxies-board .focus { fill: none; stroke: var(--hint); stroke-width: 0.9; pointer-events: none; }
.galaxies-board .focus.why { stroke-dasharray: 1.2 0.8; stroke-width: 0.6; }
.galaxies-board .focus.dot { stroke-width: 0.7; }
.galaxies-board .labels text { fill: var(--text-dim); font: 500 3.6px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.galaxies-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
[data-input="pointer"] .galaxies-board .cursor { display: none; }
`;

const settings = defineSchema({
  tint: { type: "bool", label: "color each galaxy", default: true },
});

const SIZE = 10;
const PAD = 0.5;
const LABEL = 6;
const DOT_R = 1.6;

const BINDINGS: BindingSchema = {
  "galaxies.pick": { label: "pick galaxy", category: "galaxies", keys: ["space"], description: "take the galaxy of the selected tile (or the dot on it) as the one to paint with" },
  "galaxies.paint": { label: "paint tile", category: "galaxies", keys: ["Enter"], description: "put the selected tile in the picked galaxy, or take it out if it's already there" },
  "galaxies.clear": { label: "clear tile", category: "galaxies", keys: ["Backspace", "Delete"], description: "take the selected tile out of its galaxy" },
  "galaxies.left": { label: "cursor left", category: "galaxies", keys: ["ArrowLeft", "a"] },
  "galaxies.right": { label: "cursor right", category: "galaxies", keys: ["ArrowRight", "d"] },
  "galaxies.up": { label: "cursor up", category: "galaxies", keys: ["ArrowUp", "w"] },
  "galaxies.down": { label: "cursor down", category: "galaxies", keys: ["ArrowDown", "s"] },
};

export type Side = "top" | "right" | "bottom" | "left";
export type Board = { labelSides(): Set<Side>; colName(col: number): string; rowName(row: number): string };

/** A soft fill per galaxy, spread round the color wheel. */
const tintFor = (d: number, black: boolean) => (black
  ? "color-mix(in srgb, var(--text) 70%, var(--cell))"
  : `color-mix(in srgb, hsl(${Math.round((d * 137.5) % 360)} 65% 55%) 24%, var(--cell))`);

function legend(): { sample: string; meaning: string }[] {
  const svg = (body: string, w = 10) => `<svg viewBox="-0.5 -0.5 ${w + 1} 11">${body}</svg>`;
  const tile = (x = 0, fill = "var(--cell)") => `<rect x="${x}" width="10" height="10" fill="${fill}" stroke="var(--border)" stroke-width="0.2"/>`;
  const dot = (cx: number, black = false) => `<circle cx="${cx}" cy="5" r="${DOT_R}" fill="${black ? "var(--text)" : "var(--cell)"}" stroke="var(--text)" stroke-width="0.5"/>`;
  return [
    { sample: svg(tile() + dot(5)), meaning: "a dot: the center of a galaxy (it can also sit on an edge or a corner)" },
    { sample: svg(tile(0, tintFor(1, false)) + tile(10, tintFor(1, false)) + dot(10), 20), meaning: "tiles you've put in a galaxy, colored by galaxy" },
    { sample: svg(tile(0, tintFor(1, false)) + tile(10, tintFor(4, false)) + `<line x1="10" y1="0" x2="10" y2="10" stroke="var(--text)" stroke-width="0.8"/>`, 20), meaning: "a wall: where two galaxies meet" },
    { sample: svg(tile(0, tintFor(0, true)) + dot(5, true)), meaning: "a black dot: its galaxy is shaded dark" },
    { sample: svg(tile(0, "var(--danger-soft)")), meaning: "a tile whose mirror image through its dot is missing, or that isn't joined to its dot" },
    { sample: svg(tile() + `<circle cx="5" cy="5" r="${DOT_R}" fill="var(--cell)" stroke="var(--focus)" stroke-width="0.9"/>`), meaning: "the galaxy you're painting with" },
    { sample: svg(tile() + `<rect x="0.5" y="0.5" width="9" height="9" rx="1" fill="none" stroke="var(--hint)" stroke-width="0.9"/>`), meaning: "hint: a tile it changes" },
    { sample: svg(tile() + `<rect x="0.5" y="0.5" width="9" height="9" rx="1" fill="none" stroke="var(--hint)" stroke-width="0.6" stroke-dasharray="1.2 0.8"/>`), meaning: "hint: the tiles behind it" },
    { sample: svg(tile() + `<rect x="0.3" y="0.3" width="9.4" height="9.4" rx="1" fill="none" stroke="var(--focus)" stroke-width="0.6"/>`), meaning: "the keyboard selection (shown while using the keyboard)" },
  ];
}

export function galaxiesView(board: Board): View<GalaxiesPuzzle, GalaxiesState, GalaxiesAction, GalaxiesInteraction> {
  return {
    id: "galaxies.svg",
    name: "grid",
    puzzle: "galaxies",
    settings,
    controls: [
      { how: "press on a dot (or a tile of its galaxy) and drag", what: "paint tiles into that galaxy" },
      { how: "tap a dot, then tap or drag over tiles", what: "paint them into its galaxy (tap a painted tile again to take it out)" },
      { how: "right-drag", what: "take tiles out of their galaxy" },
    ],
    legend: legend(),
    mount(root, { session, settings }) {
      style("galaxies", CSS);
      const p = session.puzzle;
      const g = geometry(p);
      const sides = board.labelSides();
      const m = (side: Side) => (sides.has(side) ? LABEL : PAD);
      const vbW = p.w * SIZE + m("left") + m("right"), vbH = p.h * SIZE + m("top") + m("bottom");
      const svg = s("svg", { viewBox: `${-m("left")} ${-m("top")} ${vbW} ${vbH}`, class: "galaxies-board", role: "grid", "aria-label": `galaxies, ${p.w} by ${p.h}` });
      const labels = s("g", { class: "labels" });
      for (let x = 0; x < p.w; x++) {
        if (sides.has("top")) labels.append(s("text", { x: x * SIZE + SIZE / 2, y: -LABEL / 2 }, board.colName(x)));
        if (sides.has("bottom")) labels.append(s("text", { x: x * SIZE + SIZE / 2, y: p.h * SIZE + LABEL / 2 }, board.colName(x)));
      }
      for (let y = 0; y < p.h; y++) {
        if (sides.has("left")) labels.append(s("text", { x: -LABEL / 2, y: y * SIZE + SIZE / 2 }, board.rowName(y)));
        if (sides.has("right")) labels.append(s("text", { x: p.w * SIZE + LABEL / 2, y: y * SIZE + SIZE / 2 }, board.rowName(y)));
      }
      const base = s("g"), walls = s("g"), dotsL = s("g"), over = s("g");
      const cursor = s("rect", { width: SIZE - 0.6, height: SIZE - 0.6, rx: 1, class: "cursor" });
      svg.append(labels, base, walls, dotsL, over, cursor);
      root.append(svg);

      const tx = (t: number) => (t % p.w) * SIZE;
      const ty = (t: number) => Math.floor(t / p.w) * SIZE;
      const tiles = Array.from({ length: g.n }, (_, t) => {
        const r = s("rect", { x: tx(t), y: ty(t), width: SIZE, height: SIZE, class: "tile" });
        base.append(r);
        return r;
      });
      const dots = p.dots.map((d) => {
        const c = s("circle", { cx: (d.x * SIZE) / 2, cy: (d.y * SIZE) / 2, r: DOT_R, class: `dot ${d.black ? "black" : "white"}` });
        dotsL.append(c);
        return c;
      });

      let preview: GalaxiesState | null = null;
      let hover = -1;

      const render = () => {
        const st = preview ?? session.state;
        const conf = session.derived()[CONFLICTS_KEY] as Conflicts | undefined;
        const bad = new Set([...(conf?.asymmetric ?? []), ...(conf?.detached ?? [])]);
        for (let t = 0; t < g.n; t++) {
          const d = st.owner[t]!;
          tiles[t]!.style.fill = bad.has(t) ? "" : settings.tint && d >= 0 ? tintFor(d, p.dots[d]!.black) : "";
          tiles[t]!.classList.toggle("bad", bad.has(t));
        }
        let wd = `M0 0H${p.w * SIZE}V${p.h * SIZE}H0Z`;
        for (let t = 0; t < g.n; t++) {
          const a = st.owner[t]!;
          if (t % p.w < p.w - 1) {
            const b = st.owner[t + 1]!;
            if (a >= 0 && b >= 0 && a !== b) wd += `M${tx(t) + SIZE} ${ty(t)}v${SIZE}`;
          }
          if (t + p.w < g.n) {
            const b = st.owner[t + p.w]!;
            if (a >= 0 && b >= 0 && a !== b) wd += `M${tx(t)} ${ty(t) + SIZE}h${SIZE}`;
          }
        }
        while (walls.firstChild) walls.firstChild.remove();
        walls.append(s("path", { d: wd, class: "wall" }));
        const brush = session.interaction.brush;
        dots.forEach((c, d) => c.classList.toggle("brush", d === brush));
        while (over.firstChild) over.firstChild.remove();
        const focus = session.activeHint?.focus as GalaxiesFocus | undefined;
        if (focus) {
          const box = (t: number, cls: string) => over.append(s("rect", { x: tx(t) + 0.5, y: ty(t) + 0.5, width: SIZE - 1, height: SIZE - 1, rx: 1, class: cls }));
          for (const t of focus.because ?? []) box(t, "focus why");
          for (const t of focus.tiles ?? []) box(t, "focus");
          for (const d of focus.dots ?? []) over.append(s("circle", { cx: (p.dots[d]!.x * SIZE) / 2, cy: (p.dots[d]!.y * SIZE) / 2, r: DOT_R + 1, class: "focus dot" }));
        }
        const cur = session.interaction.cursor;
        cursor.setAttribute("x", String(tx(cur) + 0.3));
        cursor.setAttribute("y", String(ty(cur) + 0.3));
      };

      /** The tile under the pointer, and the dot within reach of it (-1 if none). */
      const pointAt = (e: PointerEvent): { tile: number; dot: number } => {
        const mtx = svg.getScreenCTM();
        if (!mtx) return { tile: -1, dot: -1 };
        const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(mtx.inverse());
        const x = Math.floor(pt.x / SIZE), y = Math.floor(pt.y / SIZE);
        const tile = x < 0 || y < 0 || x >= p.w || y >= p.h ? -1 : y * p.w + x;
        let dot = -1, best = (DOT_R + 1.5) ** 2;
        p.dots.forEach((d, i) => {
          const dd = ((d.x * SIZE) / 2 - pt.x) ** 2 + ((d.y * SIZE) / 2 - pt.y) ** 2;
          if (dd < best) { best = dd; dot = i; }
        });
        return { tile, dot };
      };
      const setBrush = (d: number) => session.setInteraction((i) => (i.brush === d ? i : { ...i, brush: d }));
      let drag: { pointerId: number; brush: number; painted: Set<number>; moved: boolean; start: number; toggle: boolean; drawn: number } | null = null;
      const paint = (t: number) => {
        if (!drag || t < 0 || drag.painted.has(t) || g.coreOf[t] !== -1) return;
        drag.painted.add(t);
        if (session.dispatch({ type: "paint", tiles: [t], dot: drag.brush }, { extend: drag.drawn > 0 })) drag.drawn++;
      };
      const onContext = (e: Event) => e.preventDefault();
      const onDown = (e: PointerEvent) => {
        const at = pointAt(e);
        if (at.tile < 0 && at.dot < 0) return;
        e.preventDefault();
        if (at.tile >= 0) session.setInteraction((i) => ({ ...i, cursor: at.tile }));
        if (session.locked || drag) return;
        svg.setPointerCapture?.(e.pointerId);
        let brush = -1, toggle = false;
        if (e.button === 2) brush = -1;
        else if (at.dot >= 0) brush = at.dot;
        else if (session.state.owner[at.tile]! >= 0) {
          brush = session.state.owner[at.tile]!;
          toggle = brush === session.interaction.brush && g.coreOf[at.tile] === -1;
        } else brush = session.interaction.brush;
        if (e.button !== 2 && brush >= 0) setBrush(brush);
        drag = { pointerId: e.pointerId, brush, painted: new Set(), moved: false, start: at.tile, toggle, drawn: 0 };
        if (at.dot < 0 && !toggle && (brush >= 0 || e.button === 2)) paint(at.tile);
      };
      const onMove = (e: PointerEvent) => {
        const at = pointAt(e);
        if (!drag || e.pointerId !== drag.pointerId) {
          if (e.pointerType !== "touch") hover = at.tile;
          return;
        }
        if (at.tile !== drag.start) drag.moved = true;
        if (drag.moved) paint(at.tile);
      };
      const onUp = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const d = drag;
        drag = null;
        if (!d.moved && d.toggle) session.dispatch({ type: "paint", tiles: [d.start], dot: -1 });
      };
      const onCancel = (e: PointerEvent) => { if (drag && e.pointerId === drag.pointerId) drag = null; };
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

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(() => {
          if (session.locked) drag = null;
          render();
        }, { owner: "view" }),
      ];
      render();

      const rects = (list: Iterable<number>) => [...new Set(list)].map((t) => tiles[t]!.getBoundingClientRect());
      const commands: CommandDef[] = bindCommands(BINDINGS, {
        "galaxies.pick": () => {
          const t = session.interaction.cursor;
          const d = session.state.owner[t]!;
          if (d >= 0) setBrush(d);
        },
        "galaxies.paint": () => {
          const t = session.interaction.cursor, b = session.interaction.brush;
          if (b < 0) return;
          session.dispatch({ type: "paint", tiles: [t], dot: session.state.owner[t] === b ? -1 : b });
        },
        "galaxies.clear": () => session.dispatch({ type: "paint", tiles: [session.interaction.cursor], dot: -1 }),
        "galaxies.left": move(-1, 0),
        "galaxies.right": move(1, 0),
        "galaxies.up": move(0, -1),
        "galaxies.down": move(0, 1),
      }, {
        "galaxies.pick": { menu: "board" },
        "galaxies.paint": { menu: "board" },
        "galaxies.clear": { menu: "board" },
      });
      return {
        gestures: { secondaryClick: true },
        aspect: vbW / vbH,
        cells: { cols: p.w, rows: p.h },
        commands,
        target: (): GalaxiesTarget => ({ tile: hover >= 0 ? hover : session.interaction.cursor }),
        preview: (st) => {
          preview = st as GalaxiesState | null;
          render();
        },
        locate: (focus) => {
          const f = focus as GalaxiesFocus | undefined;
          if (!f) return [];
          const out = rects([...(f.tiles ?? []), ...(f.because ?? [])]);
          for (const d of f.dots ?? []) out.push(dots[d]!.getBoundingClientRect());
          return out;
        },
        locateChange: (a, b) => {
          const x = (a as GalaxiesState).owner, y = (b as GalaxiesState).owner;
          return rects(x.flatMap((d, t) => (d !== y[t] ? [t] : [])));
        },
        destroy() {
          offs.forEach((f) => f());
          svg.remove();
        },
      };
    },
  };
}
