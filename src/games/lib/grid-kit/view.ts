import type { Binding } from "../../core/commands";
import { s, inputIs } from "../../core/dom";
import type { Side } from "../../core/names";
import { buttonsSwapped, secondary } from "../../core/gestures";
import type { Session } from "../../core/session";
import type { Focus } from "./names";

/** Cell box size in SVG units. Everything a grid view draws is in these units. */
export const SIZE = 10;
const PAD = 0.25;
/** Space for an edge label, in SVG units. */
const LABEL = 6;

export type Look = { asset(id: string, fallback: string): string };
export type BoardPrefs = { labelSides(): Set<Side>; colName(col: number): string; rowName(row: number): string };

/** Room around the grid for clues outside it, in cells. */
export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_MARGIN: Margin = { top: 0, right: 0, bottom: 0, left: 0 };

export interface Frame {
  svg: SVGSVGElement;
  /** Layers, bottom to top. */
  base: SVGGElement;
  marks: SVGGElement;
  ghost: SVGGElement;
  over: SVGGElement;
  /** Left / top of cell c's box. */
  cx(c: number): number;
  cy(c: number): number;
  /** Position of grid point v on the (w + 1)-wide lattice of cell corners. */
  px(v: number): number;
  py(v: number): number;
  /** Cell under a pointer event, or -1. */
  cellAt(e: { clientX: number; clientY: number }): number;
  /** The pointer position in grid units (cell (0,0) spans 0..SIZE), or null. */
  point(e: { clientX: number; clientY: number }): { x: number; y: number } | null;
  aspect: number;
  /** Screen rects of the given elements' cells. */
  rects(cells: Iterable<number>): DOMRect[];
  /** Registers the element whose screen rect stands for cell c. */
  anchor(c: number, el: Element): void;
  destroy(): void;
}

/** CSS shared by every grid view; `.kit-board` is on each view's svg. */
export const KIT_CSS = `
.kit-board { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.kit-board .cell { fill: var(--cell); stroke: var(--border); stroke-width: 0.25; }
.kit-board .labels text { fill: var(--text-dim); font: 500 3.6px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.kit-board .focus { fill: none; stroke: var(--hint); stroke-width: 0.9; pointer-events: none; }
.kit-board .focus.why { stroke-dasharray: 1.2 0.8; stroke-width: 0.6; }
.kit-board .focus.related { stroke-width: 0.4; stroke-opacity: 0.7; }
.kit-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
.kit-board .ghost { opacity: 0.45; pointer-events: none; }
.kit-board .marks, .kit-board .over { pointer-events: none; }
${inputIs("pointer")} .kit-board .cursor { display: none; }
`;

/** Draws the grid's frame: viewBox with clue margins and edge labels, layers, and cell lookup. */
export function frame(root: HTMLElement, p: { w: number; h: number }, cls: string, label: string, board: BoardPrefs, margin: Margin = NO_MARGIN): Frame {
  const sides = board.labelSides();
  const m = (side: Side) => margin[side] * SIZE + (sides.has(side) ? LABEL : PAD);
  const vbW = p.w * SIZE + m("left") + m("right"), vbH = p.h * SIZE + m("top") + m("bottom");
  const svg = s("svg", {
    viewBox: `${-m("left")} ${-m("top")} ${vbW} ${vbH}`,
    class: `kit-board ${cls}`, role: "grid", "aria-label": `${label}, ${p.w} by ${p.h}`,
  });
  const labels = s("g", { class: "labels" });
  const outside = (side: Side) => margin[side] * SIZE + LABEL / 2;
  for (let x = 0; x < p.w; x++) {
    if (sides.has("top")) labels.append(s("text", { x: x * SIZE + SIZE / 2, y: -outside("top") }, board.colName(x)));
    if (sides.has("bottom")) labels.append(s("text", { x: x * SIZE + SIZE / 2, y: p.h * SIZE + outside("bottom") }, board.colName(x)));
  }
  for (let y = 0; y < p.h; y++) {
    if (sides.has("left")) labels.append(s("text", { x: -outside("left"), y: y * SIZE + SIZE / 2 }, board.rowName(y)));
    if (sides.has("right")) labels.append(s("text", { x: p.w * SIZE + outside("right"), y: y * SIZE + SIZE / 2 }, board.rowName(y)));
  }
  const base = s("g"), marks = s("g", { class: "marks" }), ghost = s("g", { class: "ghost" }), over = s("g", { class: "over" });
  svg.append(labels, base, marks, ghost, over);
  root.append(svg);
  const anchors = new Map<number, Element>();
  const point = (e: { clientX: number; clientY: number }) => {
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  };
  return {
    svg, base, marks, ghost, over,
    cx: (c) => (c % p.w) * SIZE,
    cy: (c) => Math.floor(c / p.w) * SIZE,
    px: (v) => (v % (p.w + 1)) * SIZE,
    py: (v) => Math.floor(v / (p.w + 1)) * SIZE,
    point,
    cellAt(e) {
      const pt = point(e);
      if (!pt) return -1;
      const x = Math.floor(pt.x / SIZE), y = Math.floor(pt.y / SIZE);
      return x < 0 || y < 0 || x >= p.w || y >= p.h ? -1 : y * p.w + x;
    },
    aspect: vbW / vbH,
    rects: (cells) => [...new Set(cells)].flatMap((c) => {
      const el = anchors.get(c);
      return el ? [el.getBoundingClientRect()] : [];
    }),
    anchor: (c, el) => void anchors.set(c, el),
    destroy: () => svg.remove(),
  };
}

/** Hint outlines for a Focus, drawn into `layer` (which the caller clears). */
export function drawFocus(layer: SVGGElement, f: Frame, focus: Focus | undefined): void {
  if (!focus) return;
  for (const [list, cls] of [[focus.related ?? [], "focus related"], [focus.because, "focus why"], [focus.cells, "focus"]] as const) {
    for (const c of list) layer.append(s("rect", { x: f.cx(c) + 0.5, y: f.cy(c) + 0.5, width: SIZE - 1, height: SIZE - 1, rx: 1, class: cls }));
  }
  for (const v of focus.points ?? []) layer.append(s("circle", { cx: f.px(v), cy: f.py(v), r: 3.2, class: "focus" }));
}

export const focusCells = (focus: unknown): number[] => {
  const f = focus as Focus | undefined;
  return f ? [...(f.cells ?? []), ...(f.because ?? []), ...(f.related ?? [])] : [];
};

export interface Stroke {
  value: number;
  /** Mark the first cell had; only cells with this mark join the stroke. */
  from: number;
  cells: number[];
}

export interface StrokeSpec {
  /** Cells that take marks. */
  editable(c: number): boolean;
  /** Current mark of c. */
  mark(c: number): number;
  /** The mark a press of this kind puts on c. */
  next(c: number, kind: "primary" | "secondary"): number;
  /** Commit: put `value` on `cells` as one move. */
  commit(cells: number[], value: number): void;
  /** Redraw (the stroke changed). */
  redraw(): void;
  /** Touch hold that switches a stroke to the secondary press, in ms. */
  holdMs(): number;
}

/**
 * Pointer input shared by the grid views: every gesture is a stroke. A click or tap is a stroke
 * of one cell; dragging adds every cell entered that had the first cell's mark. Mouse: left is
 * primary, right is secondary. Touch: a tap is primary; holding still on the first cell switches
 * the stroke to secondary. The player's button swap for the puzzle exchanges both pairs.
 */
export class Strokes {
  stroke: Stroke | null = null;
  hover = -1;
  private pointerId = -1;
  private timer = 0;
  private offs: (() => void)[] = [];

  constructor(private f: Frame, private session: Session<any, any, any, { cursor: number }>, private spec: StrokeSpec) {
    const svg = f.svg;
    const on = <K extends keyof SVGElementEventMap>(type: K, fn: (e: SVGElementEventMap[K]) => void) => {
      svg.addEventListener(type, fn as EventListener);
      this.offs.push(() => svg.removeEventListener(type, fn as EventListener));
    };
    on("contextmenu", (e) => e.preventDefault());
    on("pointerdown", (e) => this.down(e));
    on("pointermove", (e) => this.move(e));
    on("pointerup", (e) => this.end(e, true));
    on("pointercancel", (e) => this.end(e, false));
    on("pointerleave", (e) => {
      if (e.pointerType !== "touch" && this.hover !== -1) {
        this.hover = -1;
        this.spec.redraw();
      }
    });
  }

  /** Marks with the stroke in progress applied. */
  shown(marks: readonly number[]): readonly number[] {
    if (!this.stroke) return marks;
    const out = marks.slice();
    for (const c of this.stroke.cells) out[c] = this.stroke.value;
    return out;
  }

  private start(c: number, kind: "primary" | "secondary"): void {
    this.stroke = { value: this.spec.next(c, kind), from: this.spec.mark(c), cells: [c] };
  }

  private down(e: PointerEvent): void {
    const c = this.f.cellAt(e);
    if (c < 0 || this.pointerId !== -1) return;
    e.preventDefault();
    this.session.setInteraction((i) => (i.cursor === c ? i : { ...i, cursor: c }));
    if (this.session.locked || !this.spec.editable(c)) return;
    if (e.pointerType !== "touch" && e.button !== 0 && e.button !== 2) return;
    this.pointerId = e.pointerId;
    this.f.svg.setPointerCapture?.(e.pointerId);
    const id = this.session.def.id;
    const touchFirst = buttonsSwapped(id) ? "secondary" : "primary";
    this.start(c, e.pointerType === "touch" ? touchFirst : secondary(e, id) ? "secondary" : "primary");
    if (e.pointerType === "touch") {
      this.timer = window.setTimeout(() => {
        this.timer = 0;
        if (this.stroke?.cells.length !== 1) return;
        navigator.vibrate?.(15);
        this.start(c, touchFirst === "primary" ? "secondary" : "primary");
        this.spec.redraw();
      }, this.spec.holdMs());
    }
    this.spec.redraw();
  }

  private move(e: PointerEvent): void {
    const c = this.f.cellAt(e);
    if (e.pointerId !== this.pointerId) {
      if (e.pointerType !== "touch" && c !== this.hover) {
        this.hover = c;
        this.spec.redraw();
      }
      return;
    }
    const st = this.stroke;
    if (!st || c < 0 || st.cells.includes(c) || !this.spec.editable(c) || this.spec.mark(c) !== st.from) return;
    this.cancelTimer();
    st.cells.push(c);
    this.session.setInteraction((i) => (i.cursor === c ? i : { ...i, cursor: c }));
    this.spec.redraw();
  }

  private end(e: PointerEvent, commit: boolean): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = -1;
    this.cancelTimer();
    const st = this.stroke;
    this.stroke = null;
    if (st && commit) this.spec.commit(st.cells, st.value);
    this.spec.redraw();
  }

  private cancelTimer(): void {
    clearTimeout(this.timer);
    this.timer = 0;
  }

  /** Drop any stroke in progress (e.g. the board got locked). */
  cancel(): void {
    this.cancelTimer();
    this.stroke = null;
    this.pointerId = -1;
  }

  /** What the player points at: the hovered cell, else the keyboard cursor. */
  target(): number {
    return this.hover >= 0 ? this.hover : this.session.interaction.cursor;
  }

  destroy(): void {
    this.cancel();
    this.offs.forEach((f) => f());
  }
}

export type CursorId<P extends string> = `${P}.${"left" | "right" | "up" | "down"}`;

/** Cursor movement bindings for a `<prefix>` category. */
export function cursorBindings<P extends string>(prefix: P, category: string): Record<CursorId<P>, Binding> {
  return <Record<CursorId<P>, Binding>>{
    [`${prefix}.left`]: { label: "cursor left", category, keys: ["ArrowLeft", "a"], description: "move the keyboard selection one cell left" },
    [`${prefix}.right`]: { label: "cursor right", category, keys: ["ArrowRight", "d"], description: "move the keyboard selection one cell right" },
    [`${prefix}.up`]: { label: "cursor up", category, keys: ["ArrowUp", "w"], description: "move the keyboard selection one cell up" },
    [`${prefix}.down`]: { label: "cursor down", category, keys: ["ArrowDown", "s"], description: "move the keyboard selection one cell down" },
  };
}

/** Handlers for cursorBindings. */
export function cursorHandlers<P extends string>(prefix: P, p: { w: number; h: number }, session: Session<any, any, any, { cursor: number }>): Record<CursorId<P>, () => void> {
  const move = (dx: number, dy: number) => () => {
    session.setInteraction((i) => {
      const x = Math.min(p.w - 1, Math.max(0, (i.cursor % p.w) + dx));
      const y = Math.min(p.h - 1, Math.max(0, Math.floor(i.cursor / p.w) + dy));
      const c = y * p.w + x;
      return c === i.cursor ? i : { ...i, cursor: c };
    });
  };
  return <Record<CursorId<P>, () => void>>{ [`${prefix}.left`]: move(-1, 0), [`${prefix}.right`]: move(1, 0), [`${prefix}.up`]: move(0, -1), [`${prefix}.down`]: move(0, 1) };
}

/** Keyboard cursor outline, positioned on cell c. */
export function cursorRect(f: Frame): (c: number) => void {
  const el = s("rect", { width: SIZE - 0.6, height: SIZE - 0.6, rx: 1, class: "cursor" });
  f.svg.append(el);
  return (c) => {
    el.setAttribute("x", String(f.cx(c) + 0.3));
    el.setAttribute("y", String(f.cy(c) + 0.3));
  };
}

/** A legend sample: an svg of `cells` × 1 cell boxes holding `body`. */
export const sample = (body: string, cells = 1): string => `<svg viewBox="-0.5 -0.5 ${cells * SIZE + 1} ${SIZE + 1}">${body}</svg>`;
export const sampleCell = (x = 0): string => `<rect x="${x}" width="${SIZE}" height="${SIZE}" fill="var(--cell)" stroke="var(--border)" stroke-width="0.25"/>`;
export const sampleBox = (stroke: string, extra = ""): string => `<rect x="0.5" y="0.5" width="9" height="9" rx="1" fill="none" stroke="${stroke}" stroke-width="0.9" ${extra}/>`;

/** Standard hint-outline legend rows. */
export const focusLegend = (changes: string, why: string, related?: string): { sample: string; meaning: string }[] => [
  { sample: sample(sampleCell() + sampleBox("var(--hint)")), meaning: `hint: ${changes}` },
  { sample: sample(sampleCell() + sampleBox("var(--hint)", `stroke-dasharray="1.2 0.8" stroke-width="0.6"`)), meaning: `hint: ${why}` },
  ...(related ? [{ sample: sample(sampleCell() + sampleBox("var(--hint)", `stroke-width="0.4" stroke-opacity="0.7"`)), meaning: `hint: ${related}` }] : []),
  { sample: sample(sampleCell() + sampleBox("var(--focus)", `stroke-width="0.6"`)), meaning: "the keyboard selection (shown while using the keyboard)" },
];
