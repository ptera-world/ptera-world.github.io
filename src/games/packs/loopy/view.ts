import { defineSchema } from "../../core/schema";
import type { CommandDef, View } from "../../core/types";
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

type Mode = "line" | "cross" | "erase";

/** Themed graphics this view draws; each is SVG markup in a -1..1 box, or an image URL. */
export interface Look {
  asset(id: string, fallback: string): string;
}

const plainLook: Look = { asset: (_id, fallback) => fallback };

/** Default cross mark; its colour follows the mark's state (currentColor / inherited stroke). */
const CROSS_MARK = `<path d="M-1 -1L1 1M-1 1L1 -1" fill="none" stroke-width="0.5" stroke-linecap="round"/>`;

let mounts = 0;

interface Gesture {
  id: number;
  mode: Mode;
  touch: boolean;
  x0: number;
  y0: number;
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

/** The board. Every input goes through commands (keys and mouse buttons are rebindable); touch is handled here. */
export function makeLoopyView(look: Look = plainLook): View<LoopyPuzzle, LoopyState, LoopyAction, LoopyInteraction> {
  return {
    id: "loopy.svg",
    name: "board",
    puzzle: "loopy",
    settings,
    mount(root, { session, settings: cfg }) {
      style("loopy", CSS);
      const p = session.puzzle;
      const g = gridOf(p);
      const u = g.unit;
      const pad = u * 0.5;
      const vbW = g.maxX - g.minX + 2 * pad, vbH = g.maxY - g.minY + 2 * pad;
      const svg = s("svg", {
        viewBox: `${g.minX - pad} ${g.minY - pad} ${vbW} ${vbH}`,
        class: "loopy-board", role: "application", "aria-label": `slitherlink puzzle, ${g.nf} cells`,
        style: `--lw:${u * 0.11};--uw:${u * 0.025};--xw:${u * 0.05};--cw:${u * 0.22};--dash:${u * 0.12} ${u * 0.1}`,
      });
      const markId = `loopy-x-${++mounts}`;
      const mark = s("symbol", { id: markId, viewBox: "-1 -1 2 2", overflow: "visible" });
      const art = look.asset("loopy.cross", CROSS_MARK).trim();
      if (art.startsWith("<")) mark.innerHTML = art;
      else mark.append(s("image", { href: art, x: -1, y: -1, width: 2, height: 2 }));
      const gFaces = s("g"), gEdges = s("g"), gX = s("g"), gDots = s("g"), gClues = s("g"), gOver = s("g");
      svg.append(s("defs", null, mark), gFaces, gEdges, gX, gDots, gClues, gOver);

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
          id, mode, touch, x0: x, y0: y,
          edge0: nearestEdge(g, x, y, u * 0.5), dragging: false, value: null,
          path: v >= 0 ? [v] : [], edges: [], longPress: 0, longFired: false,
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
          // the mousedown that follows runs whichever pointer command is bound to it
          mousePointer = ev.pointerId;
          return;
        }
        ev.preventDefault();
        const gs = begin(ev, ev.pointerId, "line", true);
        if (cfg.touch === "line") {
          gs.longPress = window.setTimeout(() => {
            if (gesture !== gs || gs.dragging || gs.edge0 < 0) return;
            gs.longFired = true;
            toggle(gs.edge0, "cross");
            navigator.vibrate?.(15);
          }, 450);
        }
      };

      /** Pointer command: starts a drag in `mode` if the mouse went down on the board. */
      const pointerStart = (mode: Mode) => (_ctx: Record<string, unknown>, ev?: Event) => {
        if (!(ev instanceof MouseEvent) || !(ev.target instanceof Node) || !svg.contains(ev.target) || gesture || mousePointer < 0) return false;
        begin(ev, mousePointer, mode, false);
        return true;
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
        if (gs.longFired) return render();
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

      const commands: CommandDef[] = [
        { id: "loopy.left", label: "cursor left", category: "slitherlink", keys: ["ArrowLeft", "a"], run: move(-1, 0) },
        { id: "loopy.right", label: "cursor right", category: "slitherlink", keys: ["ArrowRight", "d"], run: move(1, 0) },
        { id: "loopy.up", label: "cursor up", category: "slitherlink", keys: ["ArrowUp", "w"], run: move(0, -1) },
        { id: "loopy.down", label: "cursor down", category: "slitherlink", keys: ["ArrowDown", "s"], run: move(0, 1) },
        { id: "loopy.line", label: "line on/off at the cursor", category: "slitherlink", keys: ["space", "Enter"], run: () => toggle(session.interaction.cursor, "line") },
        { id: "loopy.cross", label: "cross on/off at the cursor", category: "slitherlink", keys: ["x"], run: () => toggle(session.interaction.cursor, "cross") },
        { id: "loopy.clear", label: "clear the edge at the cursor", category: "slitherlink", keys: ["Backspace", "Delete"], run: () => toggle(session.interaction.cursor, "erase") },
        {
          id: "loopy.draw-at", label: "draw lines (press on an edge, or drag along dots)", category: "slitherlink",
          mouse: ["click"], hidden: true, run: pointerStart("line"),
        },
        {
          id: "loopy.cross-at", label: "cross edges (press, or drag across edges)", category: "slitherlink",
          mouse: ["rightclick", "shift+click", "$mod+click"], hidden: true, run: pointerStart("cross"),
        },
        {
          id: "loopy.erase-at", label: "clear edges (press, or drag across edges)", category: "slitherlink",
          mouse: ["middleclick"], hidden: true, run: pointerStart("erase"),
        },
      ];

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(render, { owner: "view" }),
      ];
      render();
      return {
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
