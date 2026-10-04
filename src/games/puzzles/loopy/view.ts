import { defineSchema } from "../../core/schema";
import type { View } from "../../core/types";
import { s, style } from "../../ui/dom";
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
.loopy-board .edge.seg0 { stroke: #e8a46a; } .loopy-board .edge.seg1 { stroke: #7ab8e8; }
.loopy-board .edge.seg2 { stroke: #b48ce8; } .loopy-board .edge.seg3 { stroke: #e87a9c; }
.loopy-board .edge.seg4 { stroke: #8fd17a; } .loopy-board .edge.seg5 { stroke: #e8d27a; }
.loopy-board.solved .edge.line { stroke: var(--accent); }
.loopy-board .x { stroke: var(--text-dim); stroke-width: var(--xw); stroke-linecap: round; display: none; }
.loopy-board .x.on { display: inline; }
.loopy-board .x.wrong { stroke: var(--danger); }
.loopy-board .dot { fill: var(--text-dim); }
.loopy-board .dot.bad { fill: var(--danger); }
.loopy-board .dot.end { fill: var(--warn); }
.loopy-board .dot.hint { fill: var(--hint); }
.loopy-board .clue { fill: var(--text); font-family: var(--font); font-weight: 600; text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.loopy-board .clue.done { fill: var(--text-dim); opacity: 0.55; }
.loopy-board .clue.bad { fill: var(--danger); }
.loopy-board .clue.hint { fill: var(--hint); }
.loopy-board .over { fill: none; stroke-linecap: round; pointer-events: none; }
.loopy-board .over.hover { stroke: var(--accent); stroke-width: var(--uw); opacity: 0.8; }
.loopy-board .over.cursor { stroke: var(--focus); stroke-width: var(--cw); opacity: 0.55; }
.loopy-board .over.hint { stroke: var(--hint); stroke-width: var(--cw); stroke-dasharray: var(--dash); }
.loopy-board .over.preview { stroke: var(--accent); stroke-width: var(--lw); opacity: 0.75; }
.loopy-board .over.preview.erase { stroke: var(--danger); stroke-width: var(--uw); }
.loopy-board .over.preview.cross { stroke: var(--text-dim); stroke-width: var(--xw); }
.loopy-board:focus { outline: none; }
`;

const settings = defineSchema({
  touch: {
    type: "enum", label: "tap on touch screens", default: "cycle",
    options: [
      { value: "cycle", label: "cycles line → cross → empty" },
      { value: "line", label: "toggles a line (long-press to cross)" },
    ],
  },
  hover: { type: "bool", label: "highlight the edge under the mouse", default: true },
  dots: { type: "bool", label: "show dots", default: true },
});

type Mode = "line" | "cross";

interface Gesture {
  id: number;
  mode: Mode;
  touch: boolean;
  x0: number;
  y0: number;
  start: number;
  edge0: number;
  dragging: boolean;
  value: EdgeState | null;
  /** Line mode: dots visited, in order. */
  path: number[];
  /** Edges this drag will set. */
  edges: number[];
  longPress: number;
  longFired: boolean;
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

export const loopyView: View<LoopyPuzzle, LoopyState, LoopyAction, LoopyInteraction> = {
  id: "loopy.svg",
  name: "board",
  puzzle: "loopy",
  settings,
  bindings: {
    "loopy.left": { label: "Cursor left", category: "Loopy", keys: ["ArrowLeft", "a"] },
    "loopy.right": { label: "Cursor right", category: "Loopy", keys: ["ArrowRight", "d"] },
    "loopy.up": { label: "Cursor up", category: "Loopy", keys: ["ArrowUp", "w"] },
    "loopy.down": { label: "Cursor down", category: "Loopy", keys: ["ArrowDown", "s"] },
    "loopy.line": { label: "Toggle line", category: "Loopy", keys: ["space", "Enter"] },
    "loopy.cross": { label: "Toggle cross", category: "Loopy", keys: ["x"] },
    "loopy.clear": { label: "Clear edge", category: "Loopy", keys: ["Backspace", "Delete"] },
  },
  mount(root, { session, settings: cfg }) {
    style("loopy", CSS);
    const p = session.puzzle;
    const g = gridOf(p);
    const u = g.unit;
    const pad = u * 0.5;
    const svg = s("svg", {
      viewBox: `${g.minX - pad} ${g.minY - pad} ${g.maxX - g.minX + 2 * pad} ${g.maxY - g.minY + 2 * pad}`,
      class: "loopy-board", role: "application", "aria-label": `loopy puzzle, ${g.nf} cells`,
      style: `--lw:${u * 0.11};--uw:${u * 0.025};--xw:${u * 0.05};--cw:${u * 0.22};--dash:${u * 0.12} ${u * 0.1}`,
    });
    const gFaces = s("g"), gEdges = s("g"), gX = s("g"), gDots = s("g"), gClues = s("g"), gOver = s("g");
    svg.append(gFaces, gEdges, gX, gDots, gClues, gOver);

    const faceEls = g.fv.map((vs) => {
      const el = s("polygon", { class: "face", points: vs.map((v) => `${g.vx[v]},${g.vy[v]}`).join(" ") });
      gFaces.append(el);
      return el;
    });
    const xr = u * 0.1;
    const edgeEls: SVGLineElement[] = [], xEls: SVGPathElement[] = [];
    for (let e = 0; e < g.ne; e++) {
      const a = g.ev[2 * e]!, b = g.ev[2 * e + 1]!;
      const el = s("line", { class: "edge", x1: g.vx[a], y1: g.vy[a], x2: g.vx[b], y2: g.vy[b] });
      gEdges.append(el);
      edgeEls.push(el);
      const [mx, my] = mid(g, e);
      const x = s("path", { class: "x", d: `M${mx - xr} ${my - xr}L${mx + xr} ${my + xr}M${mx - xr} ${my + xr}L${mx + xr} ${my - xr}` });
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
    let keyboardUsed = false;

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
      if (document.activeElement === svg || keyboardUsed) gOver.append(edgeLine(session.interaction.cursor, "cursor"));
      if (hover >= 0 && !gesture) gOver.append(edgeLine(hover, "hover"));
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
      else value = m === UNKNOWN ? LINE : m === LINE ? CROSS : UNKNOWN;
      session.setInteraction((i) => ({ ...i, cursor: e }));
      commit([e], value);
    };

    const toLocal = (ev: PointerEvent): [number, number] => {
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

    const extendCross = (gs: Gesture, x: number, y: number) => {
      const e = nearestEdge(g, x, y, u * 0.3);
      if (e < 0 || gs.edges.includes(e)) return;
      if (gs.value === null) gs.value = session.state.edges[e] === CROSS ? UNKNOWN : CROSS;
      gs.edges.push(e);
    };

    const onDown = (ev: PointerEvent) => {
      if (gesture || (ev.button !== 0 && ev.button !== 2)) return;
      ev.preventDefault();
      svg.focus({ preventScroll: true });
      const [x, y] = toLocal(ev);
      const touch = ev.pointerType !== "mouse";
      const mode: Mode = ev.button === 2 || ev.shiftKey || ev.ctrlKey ? "cross" : "line";
      const v = nearestVertex(g, x, y, u * 0.6);
      gesture = {
        id: ev.pointerId, mode, touch, x0: x, y0: y, start: performance.now(),
        edge0: nearestEdge(g, x, y, u * 0.5), dragging: false, value: null,
        path: v >= 0 ? [v] : [], edges: [], longPress: 0, longFired: false,
      };
      try {
        svg.setPointerCapture(ev.pointerId);
      } catch {
        // pointer already released
      }
      if (touch && cfg.touch === "line") {
        const gs = gesture;
        gs.longPress = window.setTimeout(() => {
          if (gesture !== gs || gs.dragging || gs.edge0 < 0) return;
          gs.longFired = true;
          toggle(gs.edge0, "cross");
          navigator.vibrate?.(15);
        }, 450);
      }
    };

    const onMove = (ev: PointerEvent) => {
      const [x, y] = toLocal(ev);
      if (!gesture) {
        if (ev.pointerType === "mouse" && cfg.hover) {
          const e = nearestEdge(g, x, y, u * 0.5);
          if (e !== hover) {
            hover = e;
            render();
          }
        }
        return;
      }
      const gs = gesture;
      if (ev.pointerId !== gs.id || gs.longFired) return;
      if (!gs.dragging) {
        if (Math.hypot(x - gs.x0, y - gs.y0) < u * 0.3) return;
        gs.dragging = true;
        clearTimeout(gs.longPress);
        if (gs.mode === "cross") extendCross(gs, gs.x0, gs.y0);
      }
      if (gs.mode === "line") extendLine(gs, x, y);
      else extendCross(gs, x, y);
      render();
    };

    const onUp = (ev: PointerEvent) => {
      const gs = gesture;
      if (!gs || ev.pointerId !== gs.id) return;
      gesture = null;
      clearTimeout(gs.longPress);
      if (gs.longFired) return render();
      if (gs.dragging) {
        if (gs.value !== null && gs.edges.length) {
          session.setInteraction((i) => ({ ...i, cursor: gs.edges[gs.edges.length - 1]! }));
          commit(gs.edges, gs.value);
        }
        return render();
      }
      if (gs.edge0 < 0) return render();
      if (gs.touch && cfg.touch === "cycle" && gs.mode === "line") toggle(gs.edge0, "cycle");
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
    svg.addEventListener("focus", render);
    svg.addEventListener("blur", render);

    const move = (dx: number, dy: number) => () => {
      keyboardUsed = true;
      session.setInteraction((i) => ({ ...i, cursor: step(g, i.cursor, dx, dy) }));
    };
    const key = (mode: Mode) => () => {
      keyboardUsed = true;
      toggle(session.interaction.cursor, mode);
    };

    const offs = [
      session.hooks.change.tap(render, { owner: "view" }),
      session.hooks.interaction.tap(render, { owner: "view" }),
      session.hooks.refresh.tap(render, { owner: "view" }),
    ];
    render();
    return {
      destroy() {
        offs.forEach((f) => f());
        if (gesture) clearTimeout(gesture.longPress);
        svg.remove();
      },
      handlers: {
        "loopy.left": move(-1, 0),
        "loopy.right": move(1, 0),
        "loopy.up": move(0, -1),
        "loopy.down": move(0, 1),
        "loopy.line": key("line"),
        "loopy.cross": key("cross"),
        "loopy.clear": () => {
          keyboardUsed = true;
          commit([session.interaction.cursor], UNKNOWN);
        },
      },
    };
  },
};
