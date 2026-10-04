import { HOLD_MS } from "../../core/gestures";
import { defineSchema } from "../../core/schema";
import type { CommandDef, View } from "../../core/types";
import { colName, rowName, type Side } from "../../core/names";
import { s, style } from "../../core/dom";
import { CROSS, LINE, UNKNOWN, type EdgeState } from "./board";
import { gridOf, type LoopyAction, type LoopyFocus, type LoopyInteraction, type LoopyPuzzle, type LoopyState } from "./def";
import { edgeBetween, type Grid } from "./grid";
import { KEYS } from "./keys";

const CSS = `
.loopy-board { width: 100%; height: 100%; max-height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.loopy-board .face { fill: transparent; stroke: none; transition: fill 120ms; }
.loopy-board .face.inside { fill: var(--accent-soft); }
.loopy-board .face.outside { fill: var(--surface-2); }
.loopy-board .face.bad { fill: var(--danger-soft); }
.loopy-board .face.hint { fill: var(--hint-soft); }
.loopy-board .edge { stroke: var(--border); stroke-width: var(--uw); stroke-linecap: round; }
.loopy-board .edge.line { stroke: var(--text); stroke-width: var(--lw); }
.loopy-board .edge.cross { stroke: none; }
.loopy-board .edge.stray { stroke: var(--warn); }
.loopy-board .edge.wrong { stroke: var(--danger); }
.loopy-board .edge.seg0 { stroke: var(--loopy-seg0, #e8a46a); } .loopy-board .edge.seg1 { stroke: var(--loopy-seg1, #7ab8e8); }
.loopy-board .edge.seg2 { stroke: var(--loopy-seg2, #b48ce8); } .loopy-board .edge.seg3 { stroke: var(--loopy-seg3, #e87a9c); }
.loopy-board .edge.seg4 { stroke: var(--loopy-seg4, #8fd17a); } .loopy-board .edge.seg5 { stroke: var(--loopy-seg5, #e8d27a); }
.loopy-board.solved .edge.line { stroke: var(--accent); }
.loopy-board .x { stroke: var(--text-dim); color: var(--text-dim); display: none; pointer-events: none; }
.loopy-board .x.on { display: inline; }
.loopy-board .x.wrong { stroke: var(--danger); color: var(--danger); }
.loopy-board .dot { fill: var(--text-dim); }
.loopy-board .dot.bad { fill: var(--danger); }
.loopy-board .dot.end { fill: var(--warn); }
.loopy-board .dot.hint { fill: var(--hint); }
.loopy-board .clue { fill: var(--text); font-family: var(--font); font-weight: 600; text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.loopy-board .clue.done { fill: var(--text-dim); opacity: var(--done-opacity); }
.loopy-board .clue.bad { fill: var(--danger); }
.loopy-board .clue.hint { fill: var(--hint); }
.loopy-board .over { fill: none; stroke-linecap: round; pointer-events: none; }
.loopy-board .over.hover { stroke: var(--accent); stroke-width: var(--uw); opacity: 0.8; }
.loopy-board .over.cursor { stroke: var(--focus); stroke-width: var(--cw); opacity: 0.55; }
[data-input="pointer"] .loopy-board .over.cursor { display: none; }
.loopy-board .over.hint { stroke: var(--hint); stroke-width: var(--cw); stroke-dasharray: var(--dash); }
.loopy-board .over.preview { stroke: var(--accent); stroke-width: var(--lw); opacity: 0.75; }
.loopy-board .over.preview.erase { stroke: var(--danger); stroke-width: var(--uw); }
.loopy-board .over.preview.cross { stroke: var(--text-dim); stroke-width: var(--xw); }
.loopy-board:focus { outline: none; }
.loopy-board .label { fill: var(--text-dim); font-family: var(--mono); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
`;

const settings = defineSchema({
  touch: {
    type: "enum", label: "tap on touch screens", default: "cycle",
    options: [
      { value: "cycle", label: "cycles line → cross → empty" },
      { value: "line", label: "toggles a line (hold for the menu to cross)" },
    ],
  },
  hover: { type: "bool", label: "highlight the edge under the mouse", default: true },
  dots: { type: "bool", label: "show dots", default: true },
});

type Mode = "line" | "cross" | "erase";

/** Themed graphics this view draws; each is SVG markup in a -1..1 box, or an image URL. */
export interface Look {
  asset(id: string, fallback: string): string;
}

const plainLook: Look = { asset: (_id, fallback) => fallback };

/** Which board edges carry column/row labels (a player setting owned by the shell). */
export interface Labels {
  labelSides(): ReadonlySet<Side>;
}

const noLabels: Labels = { labelSides: () => new Set() };

const sw = (body: string) => `<svg viewBox="0 0 20 20">${body}</svg>`;
const edge = (stroke: string, width: number, extra = "") => `<line x1="3" y1="10" x2="17" y2="10" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" ${extra}/>`;
const dots = `<circle cx="3" cy="10" r="1.2" fill="var(--text-dim)"/><circle cx="17" cy="10" r="1.2" fill="var(--text-dim)"/>`;
const dot = (fill: string) => `<circle cx="10" cy="10" r="2.6" fill="${fill}"/>`;
const num = (fill: string, extra = "") => `<text x="10" y="11" font-size="13" font-weight="600" text-anchor="middle" dominant-baseline="central" fill="${fill}" ${extra}>3</text>`;
const cell = (fill: string) => `<rect x="2" y="2" width="16" height="16" fill="${fill}" stroke="var(--border)" stroke-width="0.6"/>`;
const cross = (stroke: string) => `${edge("var(--border)", 0.6)}<path d="M8 8L12 12M8 12L12 8" stroke="${stroke}" stroke-width="1.2" stroke-linecap="round"/>`;

/** Every colour and mark the board can show, for the how-to-play card. */
const LEGEND: readonly { sample: string; meaning: string }[] = [
  { sample: sw(edge("var(--border)", 0.6) + dots), meaning: "an undecided edge between two dots" },
  { sample: sw(edge("var(--text)", 2.4) + dots), meaning: "a line you drew: part of the loop" },
  { sample: sw(cross("var(--text-dim)")), meaning: "a cross: your note that this edge isn't part of the loop" },
  { sample: sw(num("var(--text)")), meaning: "a number: how many sides of its cell the loop uses" },
  { sample: sw(num("var(--text-dim)", 'opacity="0.35" style="opacity: var(--done-opacity)"')), meaning: "a faded number already has all its lines" },
  { sample: sw(cell("var(--danger-soft)") + num("var(--danger)")), meaning: "a red number has too many lines, or too few edges left to reach its count" },
  { sample: sw(dot("var(--danger)")), meaning: "a red dot has three or more lines, or a line that can't carry on" },
  { sample: sw(dot("var(--warn)")), meaning: "an orange dot is where a line stops for now (a loose end)" },
  { sample: sw(edge("var(--warn)", 2.4) + dots), meaning: "orange lines form a loop that closed too early, leaving other lines out" },
  { sample: sw(edge("var(--danger)", 2.4) + dots), meaning: "a red line or cross disagrees with the answer (when \"show mistakes\" is on)" },
  { sample: sw(`<line x1="3" y1="10" x2="10" y2="10" stroke="var(--loopy-seg0, #e8a46a)" stroke-width="2.4" stroke-linecap="round"/><line x1="10" y1="10" x2="17" y2="10" stroke="var(--loopy-seg1, #7ab8e8)" stroke-width="2.4" stroke-linecap="round"/>`), meaning: "each separate piece of line in its own colour (when that check is on)" },
  { sample: sw(cell("var(--accent-soft)")), meaning: "shaded inside the loop, worked out from your lines and crosses (when shading is on)" },
  { sample: sw(cell("var(--surface-2)")), meaning: "shaded outside the loop (when outside shading is on)" },
  { sample: sw(cell("var(--hint-soft)") + edge("var(--hint)", 2.4, 'stroke-dasharray="2 1.6"')), meaning: "what the current hint is talking about" },
  { sample: sw(edge("var(--focus)", 4, 'opacity="0.55"')), meaning: "the keyboard cursor (only while you use the keyboard)" },
  { sample: sw(edge("var(--accent)", 2.4) + dots), meaning: "lines turn this colour once the puzzle is solved" },
];


/** Default cross mark; its colour follows the mark's state (currentColor / inherited stroke). */
const CROSS_MARK = `<path d="M-1 -1L1 1M-1 1L1 -1" fill="none" stroke-width="0.5" stroke-linecap="round"/>`;

let mounts = 0;

interface Gesture {
  id: number;
  mode: Mode;
  touch: boolean;
  x0: number;
  y0: number;
  /** Where it went down on screen, to tell a hold from a drag the same way the shell does. */
  cx: number;
  cy: number;
  edge0: number;
  dragging: boolean;
  value: EdgeState | null;
  /** Line mode: dots visited, in order. */
  path: number[];
  /** Edges this drag will set. */
  edges: number[];
  longPress: number;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function nearestEdge(g: Grid, x: number, y: number, max: number): number {
  let best = -1, bd = max;
  for (let e = 0; e < g.ne; e++) {
    const a = g.ev[2 * e]!, b = g.ev[2 * e + 1]!;
    const d = segDist(x, y, g.vx[a]!, g.vy[a]!, g.vx[b]!, g.vy[b]!);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

function nearestVertex(g: Grid, x: number, y: number, max: number): number {
  let best = -1, bd = max;
  for (let v = 0; v < g.nv; v++) {
    const d = Math.hypot(g.vx[v]! - x, g.vy[v]! - y);
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  return best;
}

function mid(g: Grid, e: number): [number, number] {
  const a = g.ev[2 * e]!, b = g.ev[2 * e + 1]!;
  return [(g.vx[a]! + g.vx[b]!) / 2, (g.vy[a]! + g.vy[b]!) / 2];
}

/** The edge whose midpoint lies most directly in direction (dx, dy) from edge `from`. */
function step(g: Grid, from: number, dx: number, dy: number): number {
  const [mx, my] = mid(g, from);
  let best = from, bs = Infinity;
  for (let e = 0; e < g.ne; e++) {
    if (e === from) continue;
    const [x, y] = mid(g, e);
    const along = (x - mx) * dx + (y - my) * dy;
    if (along < g.unit * 0.2) continue;
    const perp = Math.abs((x - mx) * dy - (y - my) * dx);
    if (perp > along * 1.8) continue;
    const score = along + 2.5 * perp;
    if (score < bs) {
      bs = score;
      best = e;
    }
  }
  return best;
}

function inradius(g: Grid, f: number): number {
  let r = Infinity;
  const cx = g.fcx[f]!, cy = g.fcy[f]!;
  for (const e of g.fe[f]!) {
    const a = g.ev[2 * e]!, b = g.ev[2 * e + 1]!;
    r = Math.min(r, segDist(cx, cy, g.vx[a]!, g.vy[a]!, g.vx[b]!, g.vy[b]!));
  }
  return r;
}

/** The board. Every input goes through commands (keys and mouse buttons are rebindable); touch is handled here. */
/**
 * `holdMs` is the shell's touch hold: held that long without moving 10px, it opens the board
 * menu and swallows the lifting finger, so the press must end here without becoming a tap.
 */
export function makeLoopyView(look: Look = plainLook, labels: Labels = noLabels, holdMs: number = HOLD_MS): View<LoopyPuzzle, LoopyState, LoopyAction, LoopyInteraction> {
  return {
    id: "loopy.svg",
    name: "board",
    puzzle: "loopy",
    settings,
    legend: LEGEND,
    controls: [
      { how: "tap an edge (touch)", what: "cycles it: line, then cross, then empty. in settings, taps can draw lines only" },
      { how: "drag along the dots (touch)", what: "draws a line through them; starting on a line rubs lines out instead" },
      { how: "hold an edge (touch)", what: "opens a menu to draw, cross or clear that edge" },
    ],
    mount(root, { session, settings: cfg }) {
      style("loopy", CSS);
      const p = session.puzzle;
      const g = gridOf(p);
      const u = g.unit;
      const pad = u * 0.5;
      const sides = g.cells ? labels.labelSides() : new Set<Side>();
      const lab = u * 0.6;
      const x0 = g.minX - pad - (sides.has("left") ? lab : 0), y0 = g.minY - pad - (sides.has("top") ? lab : 0);
      const vbW = g.maxX + pad + (sides.has("right") ? lab : 0) - x0, vbH = g.maxY + pad + (sides.has("bottom") ? lab : 0) - y0;
      const svg = s("svg", {
        viewBox: `${x0} ${y0} ${vbW} ${vbH}`,
        class: "loopy-board", role: "application", "aria-label": `slitherlink puzzle, ${g.nf} cells`,
        style: `--lw:${u * 0.11};--uw:${u * 0.025};--xw:${u * 0.05};--cw:${u * 0.22};--dash:${u * 0.12} ${u * 0.1}`,
      });
      const markId = `loopy-x-${++mounts}`;
      const mark = s("symbol", { id: markId, viewBox: "-1 -1 2 2", overflow: "visible" });
      const art = look.asset("loopy.cross", CROSS_MARK).trim();
      if (art.startsWith("<")) mark.innerHTML = art;
      else mark.append(s("image", { href: art, x: -1, y: -1, width: 2, height: 2 }));
      const gFaces = s("g"), gEdges = s("g"), gX = s("g"), gDots = s("g"), gClues = s("g"), gOver = s("g"), gLabels = s("g");
      svg.append(s("defs", null, mark), gFaces, gEdges, gX, gDots, gClues, gOver, gLabels);
      if (g.cells && sides.size) {
        // a column's label sits at the mean x of its cells' centres; a row's at the mean y
        const colX = new Map<number, number[]>(), rowY = new Map<number, number[]>();
        g.cells.forEach(([c, r], f) => {
          (colX.get(c) ?? colX.set(c, []).get(c)!).push(g.fcx[f]!);
          (rowY.get(r) ?? rowY.set(r, []).get(r)!).push(g.fcy[f]!);
        });
        const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
        const size = u * 0.36;
        const text = (x: number, y: number, t: string) => gLabels.append(s("text", { class: "label", x, y, "font-size": size }, t));
        for (const [c, xs] of colX) {
          if (sides.has("top")) text(mean(xs), g.minY - pad - lab / 2 + pad / 2, colName(c));
          if (sides.has("bottom")) text(mean(xs), g.maxY + pad + lab / 2 - pad / 2, colName(c));
        }
        for (const [r, ys] of rowY) {
          if (sides.has("left")) text(g.minX - pad - lab / 2 + pad / 2, mean(ys), rowName(r));
          if (sides.has("right")) text(g.maxX + pad + lab / 2 - pad / 2, mean(ys), rowName(r));
        }
      }

      const faceEls = g.fv.map((vs) => {
        const el = s("polygon", { class: "face", points: vs.map((v) => `${g.vx[v]},${g.vy[v]}`).join(" ") });
        gFaces.append(el);
        return el;
      });
      const xr = u * 0.1;
      const edgeEls: SVGLineElement[] = [], xEls: SVGUseElement[] = [];
      for (let e = 0; e < g.ne; e++) {
        const a = g.ev[2 * e]!, b = g.ev[2 * e + 1]!;
        const el = s("line", { class: "edge", x1: g.vx[a], y1: g.vy[a], x2: g.vx[b], y2: g.vy[b] });
        gEdges.append(el);
        edgeEls.push(el);
        const [mx, my] = mid(g, e);
        const x = s("use", { class: "x", href: `#${markId}`, x: mx - xr, y: my - xr, width: 2 * xr, height: 2 * xr });
        gX.append(x);
        xEls.push(x);
      }
      const dotEls: SVGCircleElement[] = [];
      for (let v = 0; v < g.nv; v++) {
        const el = s("circle", { class: "dot", cx: g.vx[v], cy: g.vy[v], r: u * 0.055 });
        if (cfg.dots) gDots.append(el);
        dotEls.push(el);
      }
      const clueEls = new Map<number, SVGTextElement>();
      p.clues.forEach((c, f) => {
        if (c < 0) return;
        const size = Math.min(u * 0.55, inradius(g, f) * 1.25);
        const el = s("text", { class: "clue", x: g.fcx[f], y: g.fcy[f], "font-size": size }, String(c));
        gClues.append(el);
        clueEls.set(f, el);
      });
      const edgeLine = (e: number, cls: string) => {
        const a = g.ev[2 * e]!, b = g.ev[2 * e + 1]!;
        return s("line", { class: `over ${cls}`, x1: g.vx[a], y1: g.vy[a], x2: g.vx[b], y2: g.vy[b] });
      };
      root.append(svg);

      let hover = -1;
      let gesture: Gesture | null = null;
      /** The mouse pointer that last went down on the board; mouse commands continue its drag. */
      let mousePointer = -1;

      const render = () => {
        const st = session.state;
        const d = session.derived();
        const focus = (session.activeHint?.focus ?? {}) as LoopyFocus;
        const set = (k: string) => new Set((d[k] as number[] | undefined) ?? []);
        const badF = set(KEYS.badFaces), doneF = set(KEYS.doneFaces), badV = set(KEYS.badVertices);
        const ends = set(KEYS.ends), stray = set(KEYS.strayLoop), wrong = set(KEYS.wrong);
        const hintF = new Set(focus.faces ?? []), hintV = new Set(focus.vertices ?? []);
        const sides = d[KEYS.sides] as number[] | undefined;
        const segs = d[KEYS.segments] as number[] | undefined;
        svg.classList.toggle("solved", session.solved);
        faceEls.forEach((el, f) => {
          el.classList.toggle("inside", sides?.[f] === 1);
          el.classList.toggle("outside", sides?.[f] === 2);
          el.classList.toggle("bad", badF.has(f));
          el.classList.toggle("hint", hintF.has(f));
        });
        for (let e = 0; e < g.ne; e++) {
          const m = st.edges[e];
          const el = edgeEls[e]!;
          el.classList.toggle("line", m === LINE);
          el.classList.toggle("cross", m === CROSS);
          el.classList.toggle("stray", m === LINE && stray.has(e));
          el.classList.toggle("wrong", m === LINE && wrong.has(e));
          const seg = m === LINE && segs ? segs[e]! : -1;
          for (let k = 0; k < 6; k++) el.classList.toggle(`seg${k}`, seg === k);
          xEls[e]!.classList.toggle("on", m === CROSS);
          xEls[e]!.classList.toggle("wrong", m === CROSS && wrong.has(e));
        }
        dotEls.forEach((el, v) => {
          el.classList.toggle("bad", badV.has(v));
          el.classList.toggle("end", ends.has(v) && !badV.has(v));
          el.classList.toggle("hint", hintV.has(v));
        });
        for (const [f, el] of clueEls) {
          el.classList.toggle("bad", badF.has(f));
          el.classList.toggle("done", doneF.has(f) && !badF.has(f));
          el.classList.toggle("hint", hintF.has(f));
        }
        while (gOver.firstChild) gOver.firstChild.remove();
        for (const e of focus.edges ?? []) gOver.append(edgeLine(e, "hint"));
        gOver.append(edgeLine(session.interaction.cursor, "cursor"));
        if (hover >= 0 && !gesture && !session.locked) gOver.append(edgeLine(hover, "hover"));
        if (gesture?.dragging && gesture.value !== null) {
          const cls = gesture.value === UNKNOWN ? "preview erase" : gesture.value === CROSS ? "preview cross" : "preview";
          for (const e of gesture.edges) gOver.append(edgeLine(e, cls));
        }
      };

      const commit = (edges: number[], value: EdgeState) => {
        if (edges.length) session.dispatch({ type: "set", edges, value });
      };
      const toggle = (e: number, mode: Mode | "cycle") => {
        const m = session.state.edges[e];
        let value: EdgeState;
        if (mode === "line") value = m === LINE ? UNKNOWN : LINE;
        else if (mode === "cross") value = m === CROSS ? UNKNOWN : CROSS;
        else if (mode === "erase") value = UNKNOWN;
        else value = m === UNKNOWN ? LINE : m === LINE ? CROSS : UNKNOWN;
        session.setInteraction((i) => ({ ...i, cursor: e }));
        commit([e], value);
      };

      const toLocal = (ev: { clientX: number; clientY: number }): [number, number] => {
        const ctm = svg.getScreenCTM();
        if (!ctm) return [0, 0];
        const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
        return [pt.x, pt.y];
      };

      const extendLine = (gs: Gesture, x: number, y: number) => {
        const v = nearestVertex(g, x, y, u * 0.42);
        const cur = gs.path[gs.path.length - 1];
        if (v < 0 || v === cur) return;
        if (cur === undefined) {
          gs.path.push(v);
          return;
        }
        if (gs.path.length >= 2 && gs.path[gs.path.length - 2] === v) {
          gs.path.pop();
          gs.edges.pop();
          return;
        }
        const e = edgeBetween(g, cur, v);
        if (e < 0) return;
        if (gs.value === null) gs.value = session.state.edges[e] === LINE ? UNKNOWN : LINE;
        gs.path.push(v);
        if (!gs.edges.includes(e)) gs.edges.push(e);
      };

      /** Cross and erase drags sweep over edges. */
      const extendSweep = (gs: Gesture, x: number, y: number) => {
        const e = nearestEdge(g, x, y, u * 0.3);
        if (e < 0 || gs.edges.includes(e)) return;
        if (gs.value === null) gs.value = gs.mode === "erase" ? UNKNOWN : session.state.edges[e] === CROSS ? UNKNOWN : CROSS;
        gs.edges.push(e);
      };

      const begin = (ev: { clientX: number; clientY: number }, id: number, mode: Mode, touch: boolean): Gesture => {
        const [x, y] = toLocal(ev);
        const v = nearestVertex(g, x, y, u * 0.6);
        gesture = {
          id, mode, touch, x0: x, y0: y, cx: ev.clientX, cy: ev.clientY,
          edge0: nearestEdge(g, x, y, u * 0.5), dragging: false, value: null,
          path: v >= 0 ? [v] : [], edges: [], longPress: 0,
        };
        return gesture;
      };

      const onDown = (ev: PointerEvent) => {
        if (gesture) return;
        svg.focus({ preventScroll: true });
        try {
          svg.setPointerCapture(ev.pointerId);
        } catch {
          // pointer already released
        }
        if (ev.pointerType === "mouse") {
          // the mousedown that follows runs whichever command is bound to this button
          mousePointer = ev.pointerId;
          return;
        }
        ev.preventDefault();
        const gs = begin(ev, ev.pointerId, "line", true);
        // the board menu (opened by holding) acts on the cursor, so it must be the held edge
        if (gs.edge0 >= 0) session.setInteraction((i) => ({ ...i, cursor: gs.edge0 }));
        gs.longPress = window.setTimeout(() => {
          if (gesture !== gs || gs.dragging) return;
          gesture = null;
          render();
        }, holdMs);
      };

      /**
       * One command per mark. From a mouse button pressed on the board it starts a drag in that
       * mode; from a key, the palette or the board menu it toggles the cursor edge (which pointer
       * presses move, so the menu acts on the edge it was opened on).
       */
      const markCmd = (mode: Mode) => (_ctx: Record<string, unknown>, ev?: Event) => {
        if (ev instanceof MouseEvent) {
          if (!(ev.target instanceof Node) || !svg.contains(ev.target) || gesture || mousePointer < 0) return false;
          begin(ev, mousePointer, mode, false);
          return true;
        }
        toggle(session.interaction.cursor, mode);
        return true;
      };

      const onMove = (ev: PointerEvent) => {
        const [x, y] = toLocal(ev);
        if (!gesture) {
          if (ev.pointerType === "mouse" && cfg.hover && !session.locked) {
            const e = nearestEdge(g, x, y, u * 0.5);
            if (e !== hover) {
              hover = e;
              render();
            }
          }
          return;
        }
        const gs = gesture;
        if (ev.pointerId !== gs.id) return;
        if (Math.hypot(ev.clientX - gs.cx, ev.clientY - gs.cy) > 10) clearTimeout(gs.longPress);
        // a finished board refuses moves: no drag previews, a press still reports why
        if (session.locked) return;
        if (!gs.dragging) {
          if (Math.hypot(x - gs.x0, y - gs.y0) < u * 0.3) return;
          gs.dragging = true;
          clearTimeout(gs.longPress);
          if (gs.mode !== "line") extendSweep(gs, gs.x0, gs.y0);
        }
        if (gs.mode === "line") extendLine(gs, x, y);
        else extendSweep(gs, x, y);
        render();
      };

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerType === "mouse") mousePointer = -1;
        const gs = gesture;
        if (!gs || ev.pointerId !== gs.id) return;
        gesture = null;
        clearTimeout(gs.longPress);
        if (gs.dragging) {
          if (gs.value !== null && gs.edges.length) {
            session.setInteraction((i) => ({ ...i, cursor: gs.edges[gs.edges.length - 1]! }));
            commit(gs.edges, gs.value);
          }
          return render();
        }
        if (gs.edge0 < 0) return render();
        if (gs.touch && cfg.touch === "cycle") toggle(gs.edge0, "cycle");
        else toggle(gs.edge0, gs.mode);
      };

      const onCancel = (ev: PointerEvent) => {
        if (gesture && ev.pointerId === gesture.id) {
          clearTimeout(gesture.longPress);
          gesture = null;
          render();
        }
      };

      svg.setAttribute("tabindex", "0");
      svg.addEventListener("pointerdown", onDown);
      svg.addEventListener("pointermove", onMove);
      svg.addEventListener("pointerup", onUp);
      svg.addEventListener("pointercancel", onCancel);
      svg.addEventListener("pointerleave", () => {
        if (hover >= 0) {
          hover = -1;
          render();
        }
      });
      svg.addEventListener("contextmenu", (ev) => ev.preventDefault());

      const move = (dx: number, dy: number) => () => {
        session.setInteraction((i) => ({ ...i, cursor: step(g, i.cursor, dx, dy) }));
      };

      /** Screen rect of a board-space box. */
      const screenBox = (x0: number, y0: number, x1: number, y1: number): DOMRect => {
        const ctm = svg.getScreenCTM();
        if (!ctm) return new DOMRect();
        const a = new DOMPoint(x0, y0).matrixTransform(ctm), b = new DOMPoint(x1, y1).matrixTransform(ctm);
        return new DOMRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      };
      const pointsBox = (vs: Iterable<number>, r: number): DOMRect => {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const v of vs) {
          x0 = Math.min(x0, g.vx[v]!);
          y0 = Math.min(y0, g.vy[v]!);
          x1 = Math.max(x1, g.vx[v]!);
          y1 = Math.max(y1, g.vy[v]!);
        }
        return screenBox(x0 - r, y0 - r, x1 + r, y1 + r);
      };
      const edgeRect = (e: number) => pointsBox([g.ev[2 * e]!, g.ev[2 * e + 1]!], u * 0.12);
      const locate = (focus: unknown): DOMRect[] => {
        if (!focus || typeof focus !== "object") return [];
        const f = focus as LoopyFocus;
        return [
          ...(f.faces ?? []).filter((x) => x >= 0 && x < g.nf).map((x) => pointsBox(g.fv[x]!, 0)),
          ...(f.vertices ?? []).filter((v) => v >= 0 && v < g.nv).map((v) => pointsBox([v], u * 0.15)),
          ...(f.edges ?? []).filter((e) => e >= 0 && e < g.ne).map(edgeRect),
        ];
      };

      const cursorMove = (id: string, label: string, keys: string[], dx: number, dy: number): CommandDef => ({
        id, label, category: "slitherlink", keys, run: move(dx, dy),
        description: "moves the keyboard cursor (the outlined edge) one edge over; draw line, cross out and clear edge keys act on it",
      });
      const commands: CommandDef[] = [
        {
          id: "loopy.line", label: "draw line", category: "slitherlink", menu: "board",
          keys: ["space", "Enter"], mouse: ["click"],
          description: "puts a line on an edge, or takes it away if there is one. press an edge, or hold the button and drag from dot to dot to draw several; a drag that starts on a line rubs lines out",
          run: markCmd("line"),
        },
        {
          id: "loopy.cross", label: "cross out", category: "slitherlink", menu: "board",
          keys: ["x"], mouse: ["rightclick", "shift+click", "$mod+click"],
          description: "marks an edge as not part of the loop (a note for yourself), or removes the cross. press an edge, or drag across several",
          run: markCmd("cross"),
        },
        {
          id: "loopy.clear", label: "clear edge", category: "slitherlink", menu: "board",
          keys: ["Backspace", "Delete"], mouse: ["middleclick"],
          description: "empties an edge: no line and no cross. press an edge, or drag across several",
          run: markCmd("erase"),
        },
        cursorMove("loopy.left", "cursor left", ["ArrowLeft", "a"], -1, 0),
        cursorMove("loopy.right", "cursor right", ["ArrowRight", "d"], 1, 0),
        cursorMove("loopy.up", "cursor up", ["ArrowUp", "w"], 0, -1),
        cursorMove("loopy.down", "cursor down", ["ArrowDown", "s"], 0, 1),
      ];

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(render, { owner: "view" }),
      ];
      render();
      return {
        gestures: { secondaryClick: true },
        aspect: vbW / vbH,
        locate,
        locateChange: (a, b) => {
          const x = (a as LoopyState | undefined)?.edges, y = (b as LoopyState | undefined)?.edges;
          if (!x || !y) return [];
          const out: DOMRect[] = [];
          for (let e = 0; e < g.ne; e++) if (x[e] !== y[e]) out.push(edgeRect(e));
          return out;
        },
        commands,
        destroy() {
          offs.forEach((f) => f());
          if (gesture) clearTimeout(gesture.longPress);
          svg.remove();
        },
      };
    },
  };
}
