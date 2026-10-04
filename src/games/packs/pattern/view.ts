import { defineSchema } from "../../core/schema";
import type { CommandDef, View } from "../../core/types";
import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { s, style, inputIs, inputKind } from "../../core/dom";
import { themedAssets } from "../../lib/assets";
import { pattern, type ClueRef, type PatternAction, type PatternFocus, type PatternInteraction, type PatternPuzzle, type PatternState, type PatternTarget } from "./logic";
import { EMPTY, FILLED, UNKNOWN, type Cell } from "./solver";

/** Derived: per-line flags for clue numbers already satisfied. */
export const CLUE_DONE_KEY = "pattern.clueDone";
/** Derived: line indices (rows 0..h-1, columns h..h+w-1) whose marks can't fit their clue. */
export const LINE_ERRORS_KEY = "pattern.lineErrors";
/** Derived: cells whose mark disagrees with the solution. */
export const MISTAKES_KEY = "pattern.mistakes";
/** Derived: where single-line logic can make progress. */
export const PROGRESS_KEY = "pattern.progress";
/** Derived: where the pointed-at clue number's block can go. */
export const BLOCK_RANGE_KEY = "pattern.blockRange";

export interface ClueDone {
  rows: boolean[][];
  cols: boolean[][];
}

export interface Progress {
  lines: number[];
  fill: number[];
  empty: number[];
}

/** Positions along the line: [start, end). Null when the line can't fit its clue. */
export interface BlockRange extends ClueRef {
  reach: [number, number] | null;
  sure: [number, number] | null;
}

/** Themed graphics, drawn in a 10×10 cell box. */
export const ASSETS = {
  filled: `<svg viewBox="0 0 10 10"><rect x="0.6" y="0.6" width="8.8" height="8.8" rx="0.6" fill="var(--text)"/></svg>`,
  cross: `<svg viewBox="0 0 10 10"><path d="M3 3L7 7M7 3L3 7" stroke="var(--text-dim)" stroke-width="0.9" stroke-linecap="round" fill="none"/></svg>`,
  dot: `<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="1.1" fill="var(--text-dim)"/></svg>`,
} as const;

export type Look = { asset(id: string, fallback: string): string };

const CSS = `
.pattern-board { width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.pattern-board .bg { fill: var(--cell); }
.pattern-board .cell { fill: transparent; }
.pattern-board .cell.p-fill { fill: color-mix(in srgb, var(--accent) 35%, transparent); }
.pattern-board .cell.p-empty { fill: color-mix(in srgb, var(--danger) 22%, transparent); }
.pattern-board .deco { pointer-events: none; transition: opacity 400ms; }
.pattern-board .deco.pv { opacity: 0.5; }
.pattern-board .pv-clear { fill: var(--surface-2); }
.pattern-board .gl { stroke: var(--border); stroke-width: 0.35; pointer-events: none; transition: opacity 600ms; }
.pattern-board .gl.major { stroke: var(--text-dim); stroke-width: 0.6; }
.pattern-board .frame { fill: none; stroke: var(--text-dim); stroke-width: 0.8; pointer-events: none; }
.pattern-board .band { fill: var(--accent-soft); pointer-events: none; }
.pattern-board .strip-bg { fill: var(--bg); }
.pattern-board .band.hint { fill: var(--hint-soft); }
.pattern-board .band.broken { fill: var(--danger-soft); }
.pattern-board .reach { fill: color-mix(in srgb, var(--hint) 18%, transparent); pointer-events: none; }
.pattern-board .sure { fill: color-mix(in srgb, var(--hint) 45%, transparent); pointer-events: none; }
.pattern-board .clue { fill: var(--text); font-family: var(--font); font-size: 5.6px; dominant-baseline: central; pointer-events: none; transition: opacity 200ms; }
.pattern-board .clue.done { opacity: var(--done-opacity); }
.pattern-board .clue.error { fill: var(--danger); opacity: 1; font-weight: 600; }
.pattern-board .clue.hint, .pattern-board .clue.pointed { fill: var(--hint); opacity: 1; font-weight: 700; }
.pattern-board .clue-hit { fill: transparent; cursor: help; }
.pattern-board .progress { fill: var(--accent); cursor: help; }
.pattern-board .count { fill: var(--accent); font-family: var(--mono); font-size: 7px; text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.pattern-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.9; pointer-events: none; }
.pattern-board .edge-label { fill: var(--text-dim); font-family: var(--mono); font-size: 4px; text-anchor: middle; dominant-baseline: central; pointer-events: none; }
${inputIs("pointer")} .pattern-board .cursor { display: none; }
.pattern-board .g-hint { fill: none; stroke: var(--hint); stroke-width: 1.2; pointer-events: none; }
.pattern-board .g-source { fill: none; stroke: var(--hint); stroke-width: 0.6; stroke-dasharray: 1.2 0.8; pointer-events: none; }
.pattern-board .g-mistake { fill: color-mix(in srgb, var(--danger) 25%, transparent); stroke: var(--danger); stroke-width: 1; pointer-events: none; }
.pattern-board .g-span { fill: none; stroke-width: 0.7; pointer-events: none; }
.pattern-board .g-span.left { stroke: var(--accent); fill: color-mix(in srgb, var(--accent) 18%, transparent); }
.pattern-board .g-span.right { stroke: var(--hint); fill: color-mix(in srgb, var(--hint) 18%, transparent); }
.pattern-board .g-span.reach { stroke: var(--text-dim); stroke-dasharray: 1 0.8; }
.pattern-board .g-span.place { stroke: var(--hint); fill: color-mix(in srgb, var(--hint) 14%, transparent); }
.pattern-board .g-suppose { opacity: 0.45; pointer-events: none; }
.pattern-board .g-suppose-cell { fill: none; stroke: var(--warn); stroke-width: 1.2; stroke-dasharray: 1.5 0.8; pointer-events: none; }
.pattern-board.solved .deco.mark, .pattern-board.solved .gl { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .pattern-board .deco, .pattern-board .gl, .pattern-board .clue { transition: none; } }
`;

const settings = defineSchema({
  marks: {
    type: "enum", label: "empty cell mark", default: "cross",
    options: [{ value: "cross", label: "cross" }, { value: "dot", label: "dot" }],
  },
  guides: { type: "int", label: "thick line every (0 = off)", default: 5, min: 0, max: 10 },
  band: { type: "bool", label: "highlight the row and column under the pointer", default: true },
  longPressMs: { type: "int", label: "touch: hold a cell this long to cross it (ms, 0 = holding opens the menu)", default: 400, min: 0, max: 2000 },
});

const SIZE = 10;
const CLUE_H = 6.5;
/** Room left of the row clues and above the column clues for progress dots. */
const MARGIN = 3.5;
/** Depth of an edge label strip (row numbers / column letters). */
const LABEL = 5.5;
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

interface Drag {
  pointerId: number;
  start: number;
  cur: number;
  /** Value of the start cell when the drag began; only cells with this value get painted. */
  from: number;
  target: Cell;
  secondary: boolean;
  prior: readonly number[];
  timer: number;
}

function targetFor(from: number, secondary: boolean): Cell {
  if (secondary) return from === EMPTY ? UNKNOWN : EMPTY;
  return from === FILLED ? UNKNOWN : FILLED;
}

const BINDINGS = {
  "pattern.left": { label: "cursor left", category: "nonogram", description: "move the keyboard cursor one cell left", keys: ["ArrowLeft", "a"] },
  "pattern.right": { label: "cursor right", category: "nonogram", description: "move the keyboard cursor one cell right", keys: ["ArrowRight", "d"] },
  "pattern.up": { label: "cursor up", category: "nonogram", description: "move the keyboard cursor one cell up", keys: ["ArrowUp", "w"] },
  "pattern.down": { label: "cursor down", category: "nonogram", description: "move the keyboard cursor one cell down", keys: ["ArrowDown", "s"] },
  "pattern.paint-left": { label: "paint left", category: "nonogram", description: "move the cursor left and give that cell the same mark you made last", keys: ["shift+ArrowLeft", "shift+a"] },
  "pattern.paint-right": { label: "paint right", category: "nonogram", description: "move the cursor right and give that cell the same mark you made last", keys: ["shift+ArrowRight", "shift+d"] },
  "pattern.paint-up": { label: "paint up", category: "nonogram", description: "move the cursor up and give that cell the same mark you made last", keys: ["shift+ArrowUp", "shift+w"] },
  "pattern.paint-down": { label: "paint down", category: "nonogram", description: "move the cursor down and give that cell the same mark you made last", keys: ["shift+ArrowDown", "shift+s"] },
  "pattern.fill": { label: "fill / unfill", category: "nonogram", description: "fill the selected cell, or clear it if it's already filled", keys: ["space", "Enter"] },
  "pattern.cross": { label: "cross / uncross", category: "nonogram", description: "cross out the selected cell (mark it as empty), or clear the cross", keys: ["x", "period"] },
  "pattern.clear": { label: "clear cell", category: "nonogram", description: "remove the fill or cross from the selected cell", keys: ["Backspace", "Delete"] },
  "pattern.mode": { label: "cross mode", category: "nonogram", description: "when on, a tap or left-click crosses cells out instead of filling them (right-click does the opposite)", keys: ["m"] },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

/** The keys this view adds to the command context. */
export interface PatternContext {
  patternCrossMode: boolean;
}

declare module "../../core/types" {
  interface CommandContext extends Partial<PatternContext> {}
}

/** A 10×10 cell sample on the board background; the same colors the board CSS uses. */
const cellSample = (inner: string) =>
  `<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="var(--cell)" stroke="var(--border)" stroke-width="0.4"/>${inner}</svg>`;
/** An asset's markup as it sits inside a cell sample (image URLs become <image>). */
const assetInner = (markup: string) => {
  const t = markup.trim();
  return t.startsWith("<") ? t.replace(/^<svg\b/, `<svg width="10" height="10"`) : `<image href="${t}" width="10" height="10"/>`;
};
const clueSample = (style: string) =>
  `<svg viewBox="0 0 10 10"><text x="5" y="5.4" text-anchor="middle" dominant-baseline="central" font-size="7" style="font-family: var(--font); ${style}">3</text></svg>`;
const BAR = { inset: 0.8, width: 8.4 };
const barSample = (y: number, h: number, style: string) => cellSample(`<rect x="${BAR.inset}" y="${y}" width="${BAR.width}" height="${h}" rx="0.8" style="${style}"/>`);
const boxSample = (style: string) => cellSample(`<rect x="0.6" y="0.6" width="8.8" height="8.8" rx="0.8" style="${style}"/>`);

function legendFor(look: Look): { sample: string; meaning: string }[] {
  const art = themedAssets(look, "pattern", ASSETS);
  const filled = assetInner(art("filled"));
  const cross = assetInner(art("cross"));
  const dot = assetInner(art("dot"));
  return [
    { sample: cellSample(filled), meaning: "filled cell: part of the picture" },
    { sample: cellSample(cross), meaning: "crossed-out cell: you've decided it's empty (crosses don't count toward the answer)" },
    { sample: cellSample(dot), meaning: "the same, if you picked dots for empty cells in settings" },
    { sample: clueSample("fill: var(--text); opacity: var(--done-opacity)"), meaning: "faded clue number: your marks already account for that block" },
    { sample: clueSample("fill: var(--danger); font-weight: 600"), meaning: "red clue: the marks in that line can't fit its numbers any more" },
    { sample: boxSample("fill: color-mix(in srgb, var(--danger) 25%, transparent); stroke: var(--danger); stroke-width: 1"), meaning: "red cell: a mark that doesn't match the solution (only with \"show mistakes\" on, or when a hint points it out)" },
    { sample: barSample(0, 10, "fill: var(--accent-soft)"), meaning: "tinted row and column: where your pointer or cursor is" },
    { sample: cellSample(`<g opacity="0.5">${filled}</g>`), meaning: "half-faded marks while dragging: what letting go will do" },
    { sample: boxSample("fill: none; stroke: var(--focus); stroke-width: 0.9"), meaning: "outlined cell: the keyboard cursor" },
    { sample: clueSample("fill: var(--hint); font-weight: 700"), meaning: "highlighted clue number: the one a hint talks about, or the one you're pointing at" },
    { sample: barSample(0, 10, "fill: var(--hint-soft)"), meaning: "tinted line behind a hint: the row or column it's about" },
    { sample: barSample(0, 10, "fill: var(--danger-soft)"), meaning: "red line behind a hint: the row or column that can't fit its clue" },
    { sample: boxSample("fill: none; stroke: var(--hint); stroke-width: 1.2"), meaning: "outlined cell in a hint: what the hint decides" },
    { sample: boxSample("fill: none; stroke: var(--hint); stroke-width: 0.6; stroke-dasharray: 1.2 0.8"), meaning: "dashed outline in a hint: a mark the reasoning uses" },
    { sample: barSample(1.2, 3.4, "fill: color-mix(in srgb, var(--accent) 18%, transparent); stroke: var(--accent); stroke-width: 0.7"), meaning: "upper (or left) bar in a hint: a block pushed as far left (or up) as it goes" },
    { sample: barSample(5.4, 3.4, "fill: color-mix(in srgb, var(--hint) 18%, transparent); stroke: var(--hint); stroke-width: 0.7"), meaning: "lower (or right) bar in a hint: the same block pushed as far right (or down); where the two overlap is filled" },
    { sample: barSample(4.3, 1.4, "fill: none; stroke: var(--text-dim); stroke-width: 0.7; stroke-dasharray: 1 0.8"), meaning: "thin dashed bar in a hint: everywhere a block could reach" },
    { sample: barSample(1.2, 7.6, "fill: color-mix(in srgb, var(--hint) 14%, transparent); stroke: var(--hint); stroke-width: 0.7"), meaning: "full bar in a hint: the only place a block fits" },
    { sample: cellSample(`<g opacity="0.45">${filled}</g><rect x="0.6" y="0.6" width="8.8" height="8.8" rx="0.8" style="fill: none; stroke: var(--warn); stroke-width: 1.2; stroke-dasharray: 1.5 0.8"/>`), meaning: "\"what if\" hint: the cell with the dashed warning outline is supposed, faded marks are what would follow" },
    { sample: boxSample("fill: color-mix(in srgb, var(--hint) 18%, transparent)"), meaning: "lightly shaded cells: everywhere the pointed-at clue number's block can still go" },
    { sample: boxSample("fill: color-mix(in srgb, var(--hint) 45%, transparent)"), meaning: "darker shaded cells: that block covers them however it sits" },
    { sample: `<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="2" fill="var(--accent)"/></svg>`, meaning: "dot beside a clue: that line alone can decide more cells (\"show where progress is\" assist)" },
    { sample: boxSample("fill: color-mix(in srgb, var(--accent) 35%, transparent)"), meaning: "accent-tinted cell: can be proven filled (same assist, showing cells)" },
    { sample: boxSample("fill: color-mix(in srgb, var(--danger) 22%, transparent)"), meaning: "red-tinted cell: can be proven empty (same assist, showing cells)" },
  ];
}

export type Board = Pick<typeof import("../../core/board"), "labelSides" | "colName" | "rowName">;

/** `menuHoldMs` is the shell's board-menu hold time (games.HOLD_MS). */
export function patternView(look: Look, board: Board, menuHoldMs: number): View<PatternPuzzle, PatternState, PatternAction, PatternInteraction, typeof settings> {
  return {
    id: "pattern.svg",
    name: "grid",
    puzzle: pattern,
    settings,
    controls: [
      { how: "click or tap a cell", what: "fill it; again to clear it" },
      { how: "right-click a cell", what: "cross it out (you know it's empty); again to clear it" },
      { how: "drag along a row or column", what: "do the same to the whole stretch; the number in the top-left corner counts the cells" },
      { how: "middle-click a cell", what: "clear it" },
      { how: "point at or tap a clue number", what: "shade where that block can still go" },
      { how: "hold a cell (touch)", what: "cross it out instead of filling it (in settings this can open the menu instead)" },
    ],
    /** Read when shown, so the samples use the current theme's graphics. */
    get legend() {
      return legendFor(look);
    },
    mount(root, { session, settings }) {
      style("pattern", CSS);
      const p = session.puzzle;
      const n = p.w * p.h;
      const art = themedAssets(look, "pattern", ASSETS);
      const filledNode = assetNode(art("filled"));
      const markNode = settings.marks === "dot"
        ? assetNode(art("dot"))
        : assetNode(art("cross"));
      const numW = (num: number) => String(num).length * 3.3 + 2.4;
      const rowW = (clue: readonly number[]) => (clue.length ? clue : [0]).reduce((a, num) => a + numW(num), 0);
      const colLen = Math.max(1, ...p.cols.map((c) => c.length));
      const sides = board.labelSides();
      const lab = { top: 0, left: 0, right: 0, bottom: 0 };
      for (const side of sides) lab[side] = LABEL;
      const gx = MARGIN + Math.max(...p.rows.map(rowW), 6) + 3 + lab.left;
      const gy = MARGIN + colLen * CLUE_H + 3 + lab.top;
      const W = gx + p.w * SIZE + 1 + lab.right;
      const H = gy + p.h * SIZE + 1 + lab.bottom;
      const svg = s("svg", {
        viewBox: `0 0 ${W} ${H}`, class: "pattern-board", role: "grid",
        "aria-label": `${p.w} by ${p.h} nonogram`,
      });
      const cx = (c: number) => gx + (c % p.w) * SIZE;
      const cy = (c: number) => gy + Math.floor(c / p.w) * SIZE;
      /** Board cell at position `i` along line `l`. */
      const cellOf = (l: number, i: number) => (l < p.h ? l * p.w + i : i * p.w + (l - p.h));

      svg.append(s("rect", { x: gx, y: gy, width: p.w * SIZE, height: p.h * SIZE, class: "bg" }));
      const bandRow = s("rect", { x: gx, height: SIZE, width: W - gx, class: "band", visibility: "hidden" });
      const bandCol = s("rect", { y: gy, width: SIZE, height: H - gy, class: "band", visibility: "hidden" });
      const under = s("g");
      svg.append(bandRow, bandCol, under);
      // clues (and the top/left labels) live in strips that stay in view when the board scrolls
      const strip = (width: number, height: number) => {
        const bg = s("rect", { x: 0, y: 0, width, height, class: "strip-bg", visibility: "hidden" });
        return { g: s("g", { class: "strip" }, bg), bg };
      };
      const colStrip = strip(W, gy), rowStrip = strip(gx, H), corner = strip(gx, gy);
      const bandColS = s("rect", { y: 0, width: SIZE, height: gy, class: "band", visibility: "hidden" });
      const bandRowS = s("rect", { x: 0, height: SIZE, width: gx, class: "band", visibility: "hidden" });
      const colUnder = s("g"), rowUnder = s("g");
      colStrip.g.append(bandColS, colUnder);
      rowStrip.g.append(bandRowS, rowUnder);

      const cells: SVGRectElement[] = [];
      const deco: SVGGElement[] = [];
      for (let i = 0; i < n; i++) {
        const r = s("rect", { x: cx(i), y: cy(i), width: SIZE, height: SIZE, class: "cell" });
        const g = s("g", { transform: `translate(${cx(i)} ${cy(i)})`, class: "deco" });
        svg.append(r, g);
        cells.push(r);
        deco.push(g);
      }
      const guide = settings.guides as number;
      for (let x = 0; x <= p.w; x++) {
        const major = guide > 0 && x % guide === 0;
        svg.append(s("line", { x1: gx + x * SIZE, x2: gx + x * SIZE, y1: gy, y2: gy + p.h * SIZE, class: major ? "gl major" : "gl" }));
      }
      for (let y = 0; y <= p.h; y++) {
        const major = guide > 0 && y % guide === 0;
        svg.append(s("line", { y1: gy + y * SIZE, y2: gy + y * SIZE, x1: gx, x2: gx + p.w * SIZE, class: major ? "gl major" : "gl" }));
      }
      svg.append(s("rect", { x: gx, y: gy, width: p.w * SIZE, height: p.h * SIZE, class: "frame" }));
      const label = (to: Element, x: number, y: number, text: string) => to.append(s("text", { x, y, class: "edge-label" }, text));
      for (let x = 0; x < p.w; x++) {
        const mid = gx + x * SIZE + SIZE / 2;
        if (lab.top) label(colStrip.g, mid, gy - LABEL / 2, board.colName(x));
        if (lab.bottom) label(svg, mid, gy + p.h * SIZE + 1 + LABEL / 2, board.colName(x));
      }
      for (let y = 0; y < p.h; y++) {
        const mid = gy + y * SIZE + SIZE / 2;
        if (lab.left) label(rowStrip.g, gx - LABEL / 2, mid, board.rowName(y));
        if (lab.right) label(svg, gx + p.w * SIZE + 1 + LABEL / 2, mid, board.rowName(y));
      }

      const hit = (x: number, y: number, width: number, height: number, ref: ClueRef) =>
        (ref.line < p.h ? rowStrip : colStrip).g.append(s("rect", { x, y, width, height, class: "clue-hit", "data-clue": `${ref.line}:${ref.block}` }));
      const rowClues = p.rows.map((clue, y) => {
        const nums = clue.length ? clue : [0];
        let right = gx - 2 - lab.left;
        const texts: SVGTextElement[] = [];
        for (let k = nums.length - 1; k >= 0; k--) {
          const num = nums[k]!;
          const t = s("text", { x: right, y: gy + y * SIZE + SIZE / 2, "text-anchor": "end", class: "clue" }, String(num));
          if (clue.length) hit(right - numW(num) + 1, gy + y * SIZE, numW(num), SIZE, { line: y, block: k });
          right -= numW(num);
          rowStrip.g.append(t);
          texts[k] = t;
        }
        return texts;
      });
      const colClues = p.cols.map((clue, x) => {
        const nums = clue.length ? clue : [0];
        return nums.map((num, k) => {
          const ty = gy - lab.top - 2 -(nums.length - 1 - k) * CLUE_H - CLUE_H / 2 + 1;
          const t = s("text", { x: gx + x * SIZE + SIZE / 2, y: ty, "text-anchor": "middle", class: "clue" }, String(num));
          if (clue.length) hit(gx + x * SIZE, ty - CLUE_H / 2, SIZE, CLUE_H, { line: p.h + x, block: k });
          colStrip.g.append(t);
          return t;
        });
      });
      const progressDots = Array.from({ length: p.w + p.h }, (_, l) => {
        const d = l < p.h
          ? s("circle", { cx: MARGIN / 2, cy: gy + l * SIZE + SIZE / 2, r: 0.9, class: "progress", visibility: "hidden" })
          : s("circle", { cx: gx + (l - p.h) * SIZE + SIZE / 2, cy: MARGIN / 2, r: 0.9, class: "progress", visibility: "hidden" });
        d.append(s("title", null, "this line alone decides more cells"));
        (l < p.h ? rowStrip : colStrip).g.append(d);
        return d;
      });

      const over = s("g");
      const count = s("text", { x: (gx + MARGIN) / 2, y: (gy + MARGIN) / 2, class: "count" });
      const cursor = s("rect", { width: SIZE, height: SIZE, rx: 1, class: "cursor" });
      corner.g.append(count);
      svg.append(over, cursor, colStrip.g, rowStrip.g, corner.g);
      root.append(svg);

      /** Shift the strips by however much of the board is scrolled out of view above / left. */
      const stick = () => {
        const m = svg.getScreenCTM();
        let clip: Element | null = svg.parentElement;
        while (clip && getComputedStyle(clip).overflow === "visible") clip = clip.parentElement;
        if (!m || !clip) return;
        const r = clip.getBoundingClientRect();
        const pt = new DOMPoint(r.left, r.top).matrixTransform(m.inverse());
        const dx = Math.min(p.w * SIZE, Math.max(0, pt.x)), dy = Math.min(p.h * SIZE, Math.max(0, pt.y));
        colStrip.g.setAttribute("transform", `translate(0 ${dy})`);
        rowStrip.g.setAttribute("transform", `translate(${dx} 0)`);
        corner.g.setAttribute("transform", `translate(${dx} ${dy})`);
        colStrip.bg.setAttribute("visibility", dy > 0 ? "visible" : "hidden");
        rowStrip.bg.setAttribute("visibility", dx > 0 ? "visible" : "hidden");
        corner.bg.setAttribute("visibility", dx > 0 || dy > 0 ? "visible" : "hidden");
      };
      let stickFrame = 0;
      const queueStick = () => { stickFrame ||= requestAnimationFrame(() => { stickFrame = 0; stick(); }); };
      document.addEventListener("scroll", queueStick, true);
      const resize = new ResizeObserver(queueStick);
      resize.observe(svg);

      let drag: Drag | null = null;
      let hover = -1;
      let ghost: PatternState | null = null;
      const lineTarget = (cell: number): PatternTarget => ({ cell, lines: [Math.floor(cell / p.w), p.h + (cell % p.w)] });
      /** Last cell or clue pointed at, or the keyboard cursor after it moves. */
      let aim: PatternTarget = lineTarget(session.interaction.cursor);
      let lastKeyValue: Cell = FILLED;
      const drawn: string[] = Array.from({ length: n }, () => "");
      const keyboardInput = () => inputKind(root) === "keyboard";

      const dragCells = (d: Drag): number[] => {
        const sx = d.start % p.w, sy = Math.floor(d.start / p.w);
        const ex = d.cur % p.w, ey = Math.floor(d.cur / p.w);
        const out: number[] = [];
        if (Math.abs(ex - sx) >= Math.abs(ey - sy)) {
          const step = ex >= sx ? 1 : -1;
          for (let x = sx; ; x += step) { out.push(sy * p.w + x); if (x === ex) break; }
        } else {
          const step = ey >= sy ? 1 : -1;
          for (let y = sy; ; y += step) { out.push(y * p.w + sx); if (y === ey) break; }
        }
        return out.filter((c) => d.prior[c] === d.from);
      };

      /** A rect covering positions [from, to) of line l, inset across the line by [a, b) of the cell. */
      const lineRect = (l: number, from: number, to: number, a: number, b: number, cls: string) => (l < p.h
        ? s("rect", { x: gx + from * SIZE + 0.8, y: gy + l * SIZE + a, width: (to - from) * SIZE - 1.6, height: b - a, rx: 0.8, class: cls })
        : s("rect", { x: gx + (l - p.h) * SIZE + a, y: gy + from * SIZE + 0.8, width: b - a, height: (to - from) * SIZE - 1.6, rx: 0.8, class: cls }));
      const fullBand = (l: number, cls: string) => {
        if (l < p.h) {
          under.append(s("rect", { x: gx, y: gy + l * SIZE, width: W - gx, height: SIZE, class: cls }));
          rowUnder.append(s("rect", { x: 0, y: gy + l * SIZE, width: gx, height: SIZE, class: cls }));
        } else {
          under.append(s("rect", { x: gx + (l - p.h) * SIZE, y: gy, width: SIZE, height: H - gy, class: cls }));
          colUnder.append(s("rect", { x: gx + (l - p.h) * SIZE, y: 0, width: SIZE, height: gy, class: cls }));
        }
      };
      const box = (c: number, cls: string) => s("rect", { x: cx(c) + 0.6, y: cy(c) + 0.6, width: SIZE - 1.2, height: SIZE - 1.2, rx: 0.8, class: cls });

      const render = () => {
        const st = session.state;
        const d = session.derived();
        const done = d[CLUE_DONE_KEY] as ClueDone | undefined;
        const errors = new Set((d[LINE_ERRORS_KEY] as number[] | undefined) ?? []);
        const wrong = (d[MISTAKES_KEY] as number[] | undefined) ?? [];
        const prog = d[PROGRESS_KEY] as Progress | undefined;
        const range = d[BLOCK_RANGE_KEY] as BlockRange | undefined;
        const focus = (session.activeHint?.focus as PatternFocus | undefined) ?? {};
        const solved = session.solved;
        svg.classList.toggle("solved", solved);
        const preview = drag ? new Set(dragCells(drag)) : null;
        const pFill = new Set(prog?.fill ?? []), pEmpty = new Set(prog?.empty ?? []);
        for (let i = 0; i < n; i++) {
          const dragged = preview?.has(i) ?? false;
          const pv = dragged || (!!ghost && ghost.cells[i] !== st.cells[i]);
          const v = dragged ? drag!.target : pv ? ghost!.cells[i]! : st.cells[i]!;
          let cls = "cell";
          if (pv && v === UNKNOWN) cls += " pv-clear";
          else if (!pv && v === UNKNOWN && pFill.has(i)) cls += " p-fill";
          else if (!pv && v === UNKNOWN && pEmpty.has(i)) cls += " p-empty";
          cells[i]!.setAttribute("class", cls);
          const key = v === FILLED ? (pv ? "fpv" : "f") : v === EMPTY ? (pv ? "epv" : "e") : "";
          if (drawn[i] === key) continue;
          drawn[i] = key;
          const g = deco[i]!;
          while (g.firstChild) g.firstChild.remove();
          g.setAttribute("class", `deco${key === "e" || key === "epv" ? " mark" : ""}${pv ? " pv" : ""}`);
          if (v === FILLED) g.append(filledNode());
          else if (v === EMPTY) g.append(markNode());
        }

        const hintClues = new Set((focus.clues ?? []).map((r) => `${r.line}:${r.block}`));
        const paint = (texts: SVGTextElement[], line: number, flags: boolean[] | undefined) => {
          texts.forEach((t, k) => {
            t.classList.toggle("done", flags?.[k] ?? false);
            t.classList.toggle("error", errors.has(line));
            t.classList.toggle("hint", hintClues.has(`${line}:${k}`) || (!focus.clues && (focus.lines ?? []).includes(line)));
            t.classList.toggle("pointed", !!range && range.line === line && range.block === k);
          });
        };
        rowClues.forEach((t, y) => paint(t, y, done?.rows[y]));
        colClues.forEach((t, x) => paint(t, p.h + x, done?.cols[x]));
        const progLines = new Set(prog?.lines ?? []);
        progressDots.forEach((dot, l) => dot.setAttribute("visibility", progLines.has(l) && !solved ? "visible" : "hidden"));

        under.replaceChildren();
        rowUnder.replaceChildren();
        colUnder.replaceChildren();
        for (const l of focus.lines ?? []) fullBand(l, l === focus.broken ? "band broken" : "band hint");
        if (range?.reach) {
          for (let i = range.reach[0]; i < range.reach[1]; i++) under.append(box(cellOf(range.line, i), "reach"));
          if (range.sure) for (let i = range.sure[0]; i < range.sure[1]; i++) under.append(box(cellOf(range.line, i), "sure"));
        }

        over.replaceChildren();
        for (const c of wrong) over.append(box(c, "g-mistake"));
        for (const sp of focus.spans ?? []) {
          const [a, b] = sp.kind === "left" ? [1.2, 4.6] : sp.kind === "right" ? [5.4, 8.8] : sp.kind === "reach" ? [4.3, 5.7] : [1.2, 8.8];
          over.append(lineRect(sp.line, sp.from, sp.to, a, b, `g-span ${sp.kind}`));
        }
        for (const c of focus.sources ?? []) over.append(box(c, "g-source"));
        if (focus.suppose) {
          const sup = focus.suppose;
          const ghost = s("g", { class: "g-suppose" });
          const at = (c: number, node: Element) => {
            const g = s("g", { transform: `translate(${cx(c)} ${cy(c)})` });
            g.append(node);
            ghost.append(g);
          };
          at(sup.cell, sup.value === FILLED ? filledNode() : markNode());
          for (const c of sup.fill) at(c, filledNode());
          for (const c of sup.empty) at(c, markNode());
          over.append(ghost, box(sup.cell, "g-suppose-cell"));
        } else for (const c of focus.cells ?? []) over.append(box(c, "g-hint"));

        const kb = keyboardInput();
        const focusCell = drag ? drag.cur : kb ? session.interaction.cursor : hover;
        const band = settings.band && focusCell >= 0 && !solved;
        for (const el of [bandRow, bandCol, bandRowS, bandColS]) el.setAttribute("visibility", band ? "visible" : "hidden");
        if (band) {
          bandRow.setAttribute("y", String(cy(focusCell)));
          bandRowS.setAttribute("y", String(cy(focusCell)));
          bandCol.setAttribute("x", String(cx(focusCell)));
          bandColS.setAttribute("x", String(cx(focusCell)));
        }
        count.textContent = preview && preview.size > 1 ? String(preview.size) : "";
        const c = session.interaction.cursor;
        cursor.setAttribute("x", String(cx(c)));
        cursor.setAttribute("y", String(cy(c)));
      };

      const pointToCell = (e: PointerEvent, clamp: boolean): number => {
        if (!clamp && (e.target as Element | null)?.closest?.(".strip")) return -1;
        const m = svg.getScreenCTM();
        if (!m) return -1;
        const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
        let x = Math.floor((pt.x - gx) / SIZE), y = Math.floor((pt.y - gy) / SIZE);
        if (clamp) {
          x = Math.max(0, Math.min(p.w - 1, x));
          y = Math.max(0, Math.min(p.h - 1, y));
        } else if (x < 0 || y < 0 || x >= p.w || y >= p.h) return -1;
        return y * p.w + x;
      };
      const clueAt = (e: Event): ClueRef | null => {
        const v = (e.target as Element | null)?.getAttribute?.("data-clue");
        if (!v) return null;
        const [line, block] = v.split(":").map(Number) as [number, number];
        return { line, block };
      };
      const sameClue = (a: ClueRef | null | undefined, b: ClueRef | null) => (!a && !b) || (!!a && !!b && a.line === b.line && a.block === b.block);
      const pointClue = (ref: ClueRef | null) => {
        if (sameClue(session.interaction.clue, ref)) return;
        session.setInteraction((i) => ({ ...i, clue: ref }));
      };

      const endDrag = (commit: boolean) => {
        const d = drag;
        if (!d) return;
        clearTimeout(d.timer);
        drag = null;
        if (commit) {
          const list = dragCells(d);
          if (list.length) session.dispatch({ type: "set", cells: list, value: d.target });
        }
        render();
      };

      const onDown = (e: PointerEvent) => {
        if (drag || e.button > 2 || session.locked) return;
        const ref = clueAt(e);
        if (ref) {
          aim = { lines: [ref.line] };
          // touch has no hover: a tap toggles the guide for that number
          if (e.pointerType !== "mouse") pointClue(sameClue(session.interaction.clue, ref) ? null : ref);
          return;
        }
        const cell = pointToCell(e, false);
        if (cell < 0) {
          if (session.interaction.clue) pointClue(null);
          return;
        }
        e.preventDefault();
        aim = lineTarget(cell);
        svg.setPointerCapture(e.pointerId);
        const swap = session.interaction.crossMode && e.button === 0;
        const secondary = (e.button === 2) !== swap;
        const from = session.state.cells[cell]!;
        const target: Cell = e.button === 1 ? UNKNOWN : targetFor(from, secondary);
        drag = { pointerId: e.pointerId, start: cell, cur: cell, from, target, secondary, prior: session.state.cells, timer: 0 };
        const lp = settings.longPressMs;
        if (e.pointerType !== "mouse" && lp > 0 && e.button === 0) {
          drag.timer = window.setTimeout(() => {
            if (!drag || drag.cur !== drag.start) return;
            drag.secondary = !drag.secondary;
            drag.target = targetFor(drag.from, drag.secondary);
            navigator.vibrate?.(10);
            render();
          }, lp);
        } else if (e.pointerType === "touch") {
          // a still hold is a menu press: drop the pending mark so letting go doesn't also paint
          drag.timer = window.setTimeout(() => { if (drag && drag.cur === drag.start) endDrag(false); }, menuHoldMs);
        }
        session.setInteraction((i) => ({ ...i, cursor: cell, clue: null }));
        render();
      };
      const onMove = (e: PointerEvent) => {
        if (drag && e.pointerId === drag.pointerId) {
          const cell = pointToCell(e, true);
          if (cell !== drag.cur) {
            drag.cur = cell;
            clearTimeout(drag.timer);
            render();
          }
          return;
        }
        if (e.pointerType !== "mouse") return;
        const ref = clueAt(e);
        pointClue(session.locked ? null : ref);
        const cell = pointToCell(e, false);
        if (ref) aim = { lines: [ref.line] };
        else if (cell >= 0) aim = lineTarget(cell);
        if (cell !== hover) { hover = cell; render(); }
      };
      const onLeave = (e: PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        if (session.interaction.clue) pointClue(null);
        if (hover >= 0) { hover = -1; render(); }
      };
      svg.addEventListener("pointerdown", onDown);
      svg.addEventListener("pointermove", onMove);
      svg.addEventListener("pointerup", (e) => { if (drag && e.pointerId === drag.pointerId) endDrag(true); });
      svg.addEventListener("pointercancel", () => endDrag(false));
      svg.addEventListener("pointerleave", onLeave);
      svg.addEventListener("contextmenu", (e) => e.preventDefault());

      const move = (dx: number, dy: number, paintMove: boolean) => () => {
        session.setInteraction((i) => {
          const x = Math.min(p.w - 1, Math.max(0, (i.cursor % p.w) + dx));
          const y = Math.min(p.h - 1, Math.max(0, Math.floor(i.cursor / p.w) + dy));
          return { ...i, cursor: y * p.w + x };
        });
        if (paintMove) session.dispatch({ type: "set", cells: [session.interaction.cursor], value: lastKeyValue });
      };
      const mark = (kind: "fill" | "cross" | "clear") => () => {
        const c = session.interaction.cursor;
        const value: Cell = kind === "clear" ? UNKNOWN : targetFor(session.state.cells[c]!, kind === "cross");
        lastKeyValue = value;
        session.dispatch({ type: "set", cells: [c], value });
      };

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(({ prev, interaction }) => {
          if (prev.cursor !== interaction.cursor) aim = lineTarget(interaction.cursor);
          render();
        }, { owner: "view" }),
        session.hooks.refresh.tap(() => {
          if (session.locked && drag) endDrag(false);
          if (session.locked && session.interaction.clue) pointClue(null);
          render();
        }, { owner: "view" }),
        session.hooks.solved.tap(render, { owner: "view" }),
      ];
      render();

      const rects = (list: Iterable<number>) => [...new Set(list)].map((c) => cells[c]!.getBoundingClientRect());
      const lineBox = (l: number): DOMRect => {
        const a = cells[cellOf(l, 0)]!.getBoundingClientRect();
        const b = cells[cellOf(l, l < p.h ? p.w - 1 : p.h - 1)]!.getBoundingClientRect();
        return new DOMRect(a.left, a.top, b.right - a.left, b.bottom - a.top);
      };
      const commands: CommandDef[] = bindCommands(BINDINGS, {
        "pattern.left": move(-1, 0, false),
        "pattern.right": move(1, 0, false),
        "pattern.up": move(0, -1, false),
        "pattern.down": move(0, 1, false),
        "pattern.paint-left": move(-1, 0, true),
        "pattern.paint-right": move(1, 0, true),
        "pattern.paint-up": move(0, -1, true),
        "pattern.paint-down": move(0, 1, true),
        "pattern.fill": mark("fill"),
        "pattern.cross": mark("cross"),
        "pattern.clear": mark("clear"),
        "pattern.mode": () => session.setInteraction((i) => ({ ...i, crossMode: !i.crossMode })),
      }, {
        "pattern.mode": { checked: () => session.interaction.crossMode, menu: "board" },
      });
      return {
        aspect: W / H,
        // the whole board (clues included) in cell units, so grid cells themselves meet the minimum size
        cells: { cols: W / SIZE, rows: H / SIZE },
        target: () => aim,
        preview: (state) => {
          ghost = state as PatternState | null;
          render();
        },
        // right-click crosses; a touch hold crosses unless hold-to-cross is off, then it is the shell menu
        gestures: { secondaryClick: true, hold: (settings.longPressMs) > 0 },
        commands,
        context: (): PatternContext => ({ patternCrossMode: session.interaction.crossMode }),
        locate: (f) => {
          const focus = f as PatternFocus | undefined;
          if (!focus) return [];
          const cellsList = [...(focus.cells ?? []), ...(focus.suppose ? [focus.suppose.cell] : [])];
          return cellsList.length ? rects(cellsList) : (focus.lines ?? []).map(lineBox);
        },
        locateChange: (a, b) => {
          const x = (a as PatternState).cells, y = (b as PatternState).cells;
          const out: number[] = [];
          for (let c = 0; c < n; c++) if (x[c] !== y[c]) out.push(c);
          return rects(out);
        },
        destroy() {
          if (drag) clearTimeout(drag.timer);
          document.removeEventListener("scroll", queueStick, true);
          resize.disconnect();
          cancelAnimationFrame(stickFrame);
          offs.forEach((f) => f());
          svg.remove();
        },
      };
    },
  };
}
