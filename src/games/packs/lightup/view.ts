import { bindCommands, type BindingSchema } from "../../core/commands";
import { defineSchema } from "../../core/schema";
import type { CommandDef, View } from "../../core/types";
import { s, style } from "../../core/dom";
import { EMPTY, geometry, litCounts } from "./grid";
import {
  BULB, DOT, NONE, clueMet, toggleMark, type Conflicts, type Mark,
  type LightupAction, type LightupFocus, type LightupInteraction, type LightupPuzzle, type LightupState,
} from "./logic";

/** Derived: Conflicts to flag on the board. */
export const CONFLICTS_KEY = "lightup.conflicts";

/** Themed graphics this view draws, in a 10×10 cell box. */
export const ASSETS = {
  bulb: `<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="3" fill="var(--cell-lit)" stroke="var(--bg)" stroke-width="0.4"/></svg>`,
  dot: `<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="0.9" fill="var(--text-dim)"/></svg>`,
} as const;

export type Look = { asset(id: string, fallback: string): string };

const CSS = `
.lightup-board { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.lightup-board .cell { fill: var(--cell); stroke: var(--border); stroke-width: 0.25; }
.lightup-board .glow { fill: var(--cell-lit); opacity: 0; pointer-events: none; transition: opacity 140ms ease-out; }
.lightup-board .glow.lit { opacity: 0.26; }
.lightup-board .glow.beam { opacity: 0.12; }
.lightup-board .glow.dead { fill: var(--danger); opacity: 0.22; }
.lightup-board .wall { fill: var(--text); }
.lightup-board .num { fill: var(--bg); font: 600 6.4px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.lightup-board .num.done { opacity: var(--done-opacity); }
.lightup-board .num.bad { fill: var(--danger); opacity: 1; }
.lightup-board .wall.bad { fill: var(--danger-soft); stroke: var(--danger); stroke-width: 0.5; }
.lightup-board .mark { pointer-events: none; }
.lightup-board .ghost { opacity: 0.5; pointer-events: none; }
.lightup-board .ghost .glow { opacity: 0.4; transition: none; }
.lightup-board .clash { fill: none; stroke: var(--danger); stroke-width: 0.9; pointer-events: none; }
.lightup-board .focus { fill: none; stroke: var(--hint); stroke-width: 0.9; pointer-events: none; }
.lightup-board .focus.why { stroke-dasharray: 1.2 0.8; stroke-width: 0.6; }
.lightup-board .focus.related { stroke-width: 0.4; stroke-opacity: 0.7; }
.lightup-board .labels text { fill: var(--text-dim); font: 500 3.6px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.lightup-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
[data-input="pointer"] .lightup-board .cursor { display: none; }
@media (prefers-reduced-motion: reduce) { .lightup-board .glow { transition: none; } }
`;

const settings = defineSchema({
  beam: { type: "bool", label: "show where a light would shine on hover", default: true },
  spread: { type: "bool", label: "light spreads out from a new light", default: true },
  dimDone: { type: "bool", label: "fade numbers with all their lights and nothing left open around them", default: true },
  longPressMs: { type: "int", label: "touch long-press for a no-light mark (ms)", default: 400, min: 150, max: 1500, step: 50 },
});

const SIZE = 10;
const PAD = 0.25;
/** Milliseconds per cell for light spreading out from a new light. */
const SPREAD_MS = 28;
const SVG_NS = "http://www.w3.org/2000/svg";

/** An asset (SVG markup or image URL) as an element filling one cell box. */
function assetNode(markup: string): () => Element {
  const t = markup.trim();
  if (!t.startsWith("<")) return () => s("image", { href: t, width: SIZE, height: SIZE });
  const holder = document.createElementNS(SVG_NS, "g");
  holder.innerHTML = t;
  const el = holder.firstElementChild;
  if (el?.tagName.toLowerCase() === "svg") {
    el.setAttribute("width", String(SIZE));
    el.setAttribute("height", String(SIZE));
  }
  return () => (el ? el.cloneNode(true) as Element : s("g"));
}

/** Ordered by how much a first-time player needs them; the how-to-play card lists them in this order. */
const BINDINGS: BindingSchema = {
  "lightup.light": { label: "light on / off", category: "light up", keys: ["space", "Enter"], description: "put a light on the selected cell, or take it away" },
  "lightup.mark": { label: "no-light mark on / off", category: "light up", keys: ["x", "period"], description: "put a small dot on the selected cell: your note that it can't hold a light. press again to remove it" },
  "lightup.clear": { label: "clear cell", category: "light up", keys: ["Backspace", "Delete"], description: "remove the light or no-light mark from the selected cell" },
  "lightup.mode": { label: "taps place marks", category: "light up", keys: ["m"], description: "while on, clicking or tapping a cell puts a no-light mark there instead of a light (useful on touch screens). turn it off to place lights again" },
  "lightup.left": { label: "cursor left", category: "light up", keys: ["ArrowLeft", "a"], description: "move the keyboard selection one cell left" },
  "lightup.right": { label: "cursor right", category: "light up", keys: ["ArrowRight", "d"], description: "move the keyboard selection one cell right" },
  "lightup.up": { label: "cursor up", category: "light up", keys: ["ArrowUp", "w"], description: "move the keyboard selection one cell up" },
  "lightup.down": { label: "cursor down", category: "light up", keys: ["ArrowDown", "s"], description: "move the keyboard selection one cell down" },
};

/** Inline markup for an asset inside a 10×10 sample. */
function assetMarkup(markup: string): string {
  const t = markup.trim();
  return t.startsWith("<") ? t.replace(/^<svg\b/, `<svg width="${SIZE}" height="${SIZE}"`) : `<image href="${t}" width="${SIZE}" height="${SIZE}"/>`;
}

/** Every color and mark the board draws, with the same tokens and the current theme's assets. */
function legend(look: Look): { sample: string; meaning: string }[] {
  const bulb = assetMarkup(look.asset("lightup.bulb", ASSETS.bulb));
  const dot = assetMarkup(look.asset("lightup.dot", ASSETS.dot));
  const svg = (body: string) => `<svg viewBox="-0.5 -0.5 11 11">${body}</svg>`;
  const cell = `<rect width="10" height="10" fill="var(--cell)" stroke="var(--border)" stroke-width="0.25"/>`;
  const glow = (opacity: number, fill = "var(--cell-lit)") => `<rect x="0.15" y="0.15" width="9.7" height="9.7" fill="${fill}" opacity="${opacity}"/>`;
  const wall = (fill = "var(--text)", extra = "") => `<rect width="10" height="10" fill="${fill}" ${extra}/>`;
  const num = (n: number, fill = "var(--bg)", opacity = "1") =>
    `<text x="5" y="5.3" fill="${fill}" style="opacity: ${opacity}" font-size="6.4" font-weight="600" font-family="var(--font)" text-anchor="middle" dominant-baseline="central">${n}</text>`;
  const box = (stroke: string, extra = "") => `<rect x="0.5" y="0.5" width="9" height="9" rx="1" fill="none" stroke="${stroke}" stroke-width="0.9" ${extra}/>`;
  return [
    { sample: svg(cell), meaning: "an empty cell that isn't lit yet" },
    { sample: svg(cell + glow(0.26) + bulb), meaning: "a light" },
    { sample: svg(cell + glow(0.26)), meaning: "a lit cell: a light shines on it" },
    { sample: svg(cell + glow(0.12)), meaning: "where a light would shine, while you point at an unlit cell" },
    { sample: svg(cell + dot), meaning: "a no-light mark: your note that this cell can't hold a light" },
    { sample: svg(wall()), meaning: "a wall: blocks light, can touch any number of lights" },
    { sample: svg(wall() + num(2)), meaning: "a numbered wall: exactly this many lights must touch it" },
    { sample: svg(wall() + num(2, "var(--bg)", "var(--done-opacity)")), meaning: "a faded number: it has all its lights and nothing open around it" },
    { sample: svg(cell + glow(0.26) + bulb + `<circle cx="5" cy="5" r="3.6" fill="none" stroke="var(--danger)" stroke-width="0.9"/>`), meaning: "a light that shines on another light" },
    { sample: svg(wall("var(--danger-soft)", `stroke="var(--danger)" stroke-width="0.5"`) + num(1, "var(--danger)")), meaning: "a number that can't get the right count of lights any more" },
    { sample: svg(cell + glow(0.22, "var(--danger)")), meaning: "a cell nothing can light any more" },
    { sample: svg(cell + box("var(--hint)")), meaning: "hint: the cell it changes" },
    { sample: svg(cell + box("var(--hint)", `stroke-dasharray="1.2 0.8" stroke-width="0.6"`)), meaning: "hint: the reason (a number, or a cell that needs light)" },
    { sample: svg(cell + box("var(--hint)", `stroke-width="0.4" stroke-opacity="0.7"`)), meaning: "hint: other cells it mentions" },
    { sample: svg(cell + box("var(--focus)", `stroke-width="0.6"`)), meaning: "the keyboard selection (shown while using the keyboard)" },
  ];
}

export type Side = "top" | "right" | "bottom" | "left";
export type Board = { labelSides(): Set<Side>; colName(col: number): string; rowName(row: number): string };

/** Space for edge labels, in cell units of SIZE. */
const LABEL = 6;

export function lightupView(look: Look, board: Board): View<LightupPuzzle, LightupState, LightupAction, LightupInteraction> {
  return {
    id: "lightup.svg",
    name: "grid",
    puzzle: "lightup",
    settings,
    controls: [
      { how: "click or tap an empty cell", what: "put a light there, or take it away" },
      { how: "right-click, or hold on a touch screen", what: "put a no-light mark (a dot) there, or take it away. keep holding and drag to mark several cells" },
      { how: "point at an unlit cell", what: "shows where a light there would shine" },
    ],
    get legend() {
      return legend(look);
    },
    mount(root, { session, settings }) {
      style("lightup", CSS);
      const p = session.puzzle;
      const g = geometry(p);
      const bulbNode = assetNode(look.asset("lightup.bulb", ASSETS.bulb));
      const dotNode = assetNode(look.asset("lightup.dot", ASSETS.dot));
      const sides = board.labelSides();
      const m = (side: Side) => (sides.has(side) ? LABEL : PAD);
      const vbW = p.w * SIZE + m("left") + m("right"), vbH = p.h * SIZE + m("top") + m("bottom");
      const svg = s("svg", {
        viewBox: `${-m("left")} ${-m("top")} ${vbW} ${vbH}`,
        class: "lightup-board", role: "grid", "aria-label": `light up, ${p.w} by ${p.h}`,
      });
      const labels = s("g", { class: "labels" });
      for (let x = 0; x < p.w; x++) {
        if (sides.has("top")) labels.append(s("text", { x: x * SIZE + SIZE / 2, y: -LABEL / 2 }, board.colName(x)));
        if (sides.has("bottom")) labels.append(s("text", { x: x * SIZE + SIZE / 2, y: p.h * SIZE + LABEL / 2 }, board.colName(x)));
      }
      for (let y = 0; y < p.h; y++) {
        if (sides.has("left")) labels.append(s("text", { x: -LABEL / 2, y: y * SIZE + SIZE / 2 }, board.rowName(y)));
        if (sides.has("right")) labels.append(s("text", { x: p.w * SIZE + LABEL / 2, y: y * SIZE + SIZE / 2 }, board.rowName(y)));
      }
      const base = s("g"), glowL = s("g"), marksL = s("g"), ghostL = s("g", { class: "ghost" }), over = s("g");
      const cursor = s("rect", { width: SIZE - 0.6, height: SIZE - 0.6, rx: 1, class: "cursor" });
      svg.append(labels, base, glowL, marksL, ghostL, over, cursor);
      root.append(svg);

      const cx = (i: number) => (i % p.w) * SIZE;
      const cy = (i: number) => Math.floor(i / p.w) * SIZE;
      const tiles: SVGRectElement[] = [];
      const glow: SVGRectElement[] = [];
      const marks: SVGGElement[] = [];
      const nums: SVGTextElement[] = [];
      for (let i = 0; i < g.n; i++) {
        const v = p.cells[i]!;
        if (v === EMPTY) {
          base.append(tiles[i] = s("rect", { x: cx(i), y: cy(i), width: SIZE, height: SIZE, class: "cell", "data-cell": i }));
          glowL.append(glow[i] = s("rect", { x: cx(i) + 0.15, y: cy(i) + 0.15, width: SIZE - 0.3, height: SIZE - 0.3, class: "glow" }));
          marksL.append(marks[i] = s("g", { transform: `translate(${cx(i)} ${cy(i)})`, class: "mark" }));
        } else {
          base.append(tiles[i] = s("rect", { x: cx(i), y: cy(i), width: SIZE, height: SIZE, class: "wall", "data-cell": i }));
          if (v >= 0) base.append(nums[i] = s("text", { x: cx(i) + SIZE / 2, y: cy(i) + SIZE / 2 + 0.3, class: "num" }, String(v)));
        }
      }

      let hover = -1;
      let previewing: LightupState | null = null;
      let paint: { from: number; value: Mark; cells: number[] } | null = null;
      /** Per-cell glow delay for the change being drawn; cleared once drawn. */
      let spread: Map<number, number> | null = null;
      const drawn: number[] = Array.from({ length: g.n }, () => NONE);

      const shownMarks = (): readonly number[] => {
        if (!paint) return session.state.marks;
        const out = session.state.marks.slice();
        for (const c of paint.cells) out[c] = paint.value;
        return out;
      };

      const render = () => {
        const m = shownMarks();
        const lit = litCounts(g, m);
        const conf = session.derived()[CONFLICTS_KEY] as Conflicts | undefined;
        const badLights = new Set(conf?.lights), badClues = new Set(conf?.clues), dead = new Set(conf?.dark);
        const beam = settings.beam && !session.locked && hover >= 0 && p.cells[hover] === EMPTY && m[hover] === NONE && !lit[hover]
          ? new Set([hover, ...g.sees[hover]!]) : null;
        for (const c of g.empties) {
          const gl = glow[c]!;
          gl.style.transitionDelay = `${spread?.get(c) ?? 0}ms`;
          gl.classList.toggle("lit", lit[c]! > 0);
          gl.classList.toggle("beam", !lit[c] && !!beam?.has(c));
          gl.classList.toggle("dead", dead.has(c));
          const mark = m[c]!;
          if (drawn[c] === mark) continue;
          drawn[c] = mark;
          const holder = marks[c]!;
          while (holder.firstChild) holder.firstChild.remove();
          if (mark === BULB) holder.append(bulbNode());
          else if (mark === DOT) holder.append(dotNode());
        }
        ghostL.replaceChildren();
        if (previewing) {
          const pm = previewing.marks, plit = litCounts(g, pm);
          for (const c of g.empties) {
            if (plit[c]! > 0 && !lit[c]) ghostL.append(s("rect", { x: cx(c) + 0.15, y: cy(c) + 0.15, width: SIZE - 0.3, height: SIZE - 0.3, class: "glow" }));
            if (pm[c] === m[c] || pm[c] === NONE) continue;
            const at = s("g", { transform: `translate(${cx(c)} ${cy(c)})` });
            at.append(pm[c] === BULB ? bulbNode() : dotNode());
            ghostL.append(at);
          }
        }
        spread = null;
        for (const q of g.clues) {
          const done = !!settings.dimDone && !badClues.has(q) && clueMet(p, m, q) && g.adj[q]!.every((a) => m[a] !== NONE || lit[a]! > 0);
          nums[q]!.classList.toggle("done", done);
          nums[q]!.classList.toggle("bad", badClues.has(q));
          tiles[q]!.classList.toggle("bad", badClues.has(q));
        }
        while (over.firstChild) over.firstChild.remove();
        for (const c of badLights) over.append(s("circle", { cx: cx(c) + SIZE / 2, cy: cy(c) + SIZE / 2, r: 3.6, class: "clash" }));
        const focus = session.activeHint?.focus as LightupFocus | undefined;
        if (focus) {
          for (const [list, cls] of [[focus.related ?? [], "focus related"], [focus.because, "focus why"], [focus.cells, "focus"]] as const) {
            for (const c of list) over.append(s("rect", { x: cx(c) + 0.5, y: cy(c) + 0.5, width: SIZE - 1, height: SIZE - 1, rx: 1, class: cls }));
          }
        }
        const cur = session.interaction.cursor;
        cursor.setAttribute("x", String(cx(cur) + 0.3));
        cursor.setAttribute("y", String(cy(cur) + 0.3));
      };

      /** Delays that make newly lit cells light up outward from the lights that lit them. */
      const spreadFrom = (prev: LightupState, next: LightupState): Map<number, number> | null => {
        const added = g.empties.filter((c) => next.marks[c] === BULB && prev.marks[c] !== BULB);
        if (!added.length) return null;
        const out = new Map<number, number>();
        for (const b of added) {
          for (const c of [b, ...g.sees[b]!]) {
            const d = (Math.abs(cx(c) - cx(b)) + Math.abs(cy(c) - cy(b))) / SIZE * SPREAD_MS;
            out.set(c, Math.min(out.get(c) ?? Infinity, d));
          }
        }
        return out;
      };

      const cellAt = (e: PointerEvent): number => {
        const m = svg.getScreenCTM();
        if (!m) return -1;
        const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
        const x = Math.floor(pt.x / SIZE), y = Math.floor(pt.y / SIZE);
        return x < 0 || y < 0 || x >= p.w || y >= p.h ? -1 : y * p.w + x;
      };
      const setCursor = (c: number) => session.setInteraction((i) => (i.cursor === c ? i : { ...i, cursor: c }));
      const toggleLight = (c: number) => {
        if (p.cells[c] === EMPTY) session.dispatch(toggleMark(session.state, c, BULB));
      };
      const startPaint = (c: number) => {
        if (p.cells[c] !== EMPTY) return;
        const from = session.state.marks[c]!;
        paint = { from, value: from === DOT ? NONE : DOT, cells: [c] };
        render();
      };
      const finishPaint = () => {
        if (!paint) return;
        const { cells, value } = paint;
        paint = null;
        if (!session.dispatch({ type: "set", cells, value })) render();
      };

      let pressTimer = 0;
      let pressCell = -1;
      let pointerId = -1;
      const cancelPress = () => {
        clearTimeout(pressTimer);
        pressTimer = 0;
      };

      const onContext = (e: Event) => e.preventDefault();
      const onDown = (e: PointerEvent) => {
        const c = cellAt(e);
        if (c < 0 || pointerId !== -1) return;
        e.preventDefault();
        setCursor(c);
        if (session.locked) return;
        pointerId = e.pointerId;
        svg.setPointerCapture?.(e.pointerId);
        const markMode = session.interaction.markMode;
        if (e.pointerType === "touch") {
          if (markMode) startPaint(c);
          else {
            pressCell = c;
            pressTimer = window.setTimeout(() => {
              pressTimer = 0;
              pressCell = -1;
              navigator.vibrate?.(15);
              startPaint(c);
            }, settings.longPressMs as number);
          }
        } else if (e.button === 2 || (e.button === 0 && markMode)) startPaint(c);
        else if (e.button === 0) toggleLight(c);
      };
      const onMove = (e: PointerEvent) => {
        const c = cellAt(e);
        if (e.pointerId !== pointerId) {
          if (e.pointerType !== "touch" && c !== hover) {
            hover = c;
            render();
          }
          return;
        }
        if (pressTimer && c !== pressCell) {
          cancelPress();
          pressCell = -1;
        }
        if (paint && c >= 0 && p.cells[c] === EMPTY && session.state.marks[c] === paint.from && !paint.cells.includes(c)) {
          paint.cells.push(c);
          setCursor(c);
          render();
        }
      };
      const end = (e: PointerEvent, commit: boolean) => {
        if (e.pointerId !== pointerId) return;
        pointerId = -1;
        if (pressTimer) {
          cancelPress();
          if (commit && pressCell >= 0) toggleLight(pressCell);
          pressCell = -1;
        }
        if (commit) finishPaint();
        else if (paint) {
          paint = null;
          render();
        }
      };
      const onUp = (e: PointerEvent) => end(e, true);
      const onCancel = (e: PointerEvent) => end(e, false);
      const onLeave = (e: PointerEvent) => {
        if (e.pointerType !== "touch" && hover !== -1) {
          hover = -1;
          render();
        }
      };
      svg.addEventListener("contextmenu", onContext);
      svg.addEventListener("pointerdown", onDown);
      svg.addEventListener("pointermove", onMove);
      svg.addEventListener("pointerup", onUp);
      svg.addEventListener("pointercancel", onCancel);
      svg.addEventListener("pointerleave", onLeave);

      const move = (dx: number, dy: number) => () => {
        session.setInteraction((i) => {
          const x = Math.min(p.w - 1, Math.max(0, (i.cursor % p.w) + dx));
          const y = Math.min(p.h - 1, Math.max(0, Math.floor(i.cursor / p.w) + dy));
          return { ...i, cursor: y * p.w + x };
        });
      };
      const atCursor = (fn: (c: number) => void) => () => {
        const c = session.interaction.cursor;
        if (p.cells[c] === EMPTY) fn(c);
      };

      const offs = [
        session.hooks.change.tap(({ prev, state, cause }) => {
          if (settings.spread && cause !== "undo") spread = spreadFrom(prev, state);
          render();
        }, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(() => {
          if (session.locked && (paint || pressTimer)) {
            cancelPress();
            pressCell = -1;
            paint = null;
          }
          render();
        }, { owner: "view" }),
      ];
      render();

      const rects = (list: Iterable<number>) => [...new Set(list)].flatMap((c) => (tiles[c] ? [tiles[c].getBoundingClientRect()] : []));
      const commands: CommandDef[] = bindCommands(BINDINGS, {
        "lightup.light": atCursor((c) => session.dispatch(toggleMark(session.state, c, BULB))),
        "lightup.mark": atCursor((c) => session.dispatch(toggleMark(session.state, c, DOT))),
        "lightup.clear": atCursor((c) => session.dispatch({ type: "set", cells: [c], value: NONE })),
        "lightup.mode": () => session.setInteraction((i) => ({ ...i, markMode: !i.markMode })),
        "lightup.left": move(-1, 0),
        "lightup.right": move(1, 0),
        "lightup.up": move(0, -1),
        "lightup.down": move(0, 1),
      }, {
        "lightup.mode": { menu: "board", checked: () => session.interaction.markMode },
      });
      return {
        gestures: { secondaryClick: true, hold: true },
        aspect: vbW / vbH,
        cells: { cols: vbW / SIZE, rows: vbH / SIZE },
        commands,
        context: () => ({ lightupMarkMode: session.interaction.markMode }),
        preview: (st) => {
          previewing = st as LightupState | null;
          render();
        },
        locate: (focus) => {
          const f = focus as LightupFocus | undefined;
          return f ? rects([...(f.cells ?? []), ...(f.because ?? []), ...(f.related ?? [])]) : [];
        },
        locateChange: (a, b) => {
          const x = (a as LightupState).marks, y = (b as LightupState).marks;
          return rects(g.empties.filter((c) => x[c] !== y[c]));
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
