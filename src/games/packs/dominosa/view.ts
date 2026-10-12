import { bindCommands, bindingsOver, handlersOver, type BindingSchema, type Ids } from "../../core/commands";
import { s, style, inputIs } from "../../core/dom";
import { buttonsSwapped, secondary } from "../../core/gestures";
import { defineSchema } from "../../core/schema";
import type { CommandDef, View } from "../../core/types";
import { geometry } from "./grid";
import {
  dominosa, DOMINO, LINE, toggle,
  type Conflicts, type DominosaAction, type DominosaFocus, type DominosaInteraction, type DominosaPuzzle, type DominosaState,
} from "./logic";
import type { DominosaTarget } from "./techniques";

/** Derived: Conflicts to flag on the board. */
export const CONFLICTS_KEY = "dominosa.conflicts";

const CSS = `
.dominosa-board { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.dominosa-board .cell { fill: var(--cell); stroke: var(--border); stroke-width: 0.25; }
.dominosa-board .cell.hl1 { fill: color-mix(in srgb, var(--accent) 30%, var(--cell)); }
.dominosa-board .cell.hl2 { fill: color-mix(in srgb, var(--hint) 30%, var(--cell)); }
.dominosa-board .cell.stuck { fill: var(--danger-soft); }
.dominosa-board .num { fill: var(--text); font: 600 5.2px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.dominosa-board .num.on { fill: var(--bg); }
.dominosa-board .domino { fill: var(--text); pointer-events: none; }
.dominosa-board .domino.bad { fill: var(--danger); }
.dominosa-board .domino.ghost { fill: none; stroke: var(--text-dim); stroke-width: 0.5; stroke-dasharray: 1 0.8; }
.dominosa-board .domino.preview { fill: var(--hint); opacity: 0.45; }
.dominosa-board .line { stroke: var(--text); stroke-width: 0.9; stroke-linecap: round; pointer-events: none; }
.dominosa-board .faded { opacity: 0.25; }
.dominosa-board .line.preview { stroke: var(--hint); opacity: 0.6; }
.dominosa-board .focus { fill: none; stroke: var(--hint); stroke-width: 0.9; pointer-events: none; }
.dominosa-board .focus.why { stroke-dasharray: 1.2 0.8; stroke-width: 0.6; }
.dominosa-board .labels text { fill: var(--text-dim); font: 500 3.6px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.dominosa-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
${inputIs("pointer")} .dominosa-board .cursor { display: none; }
`;

const settings = defineSchema({
  ghost: { type: "bool", label: "outline the domino a click would place", default: true },
  longPressMs: { type: "int", label: "touch long-press for a line (ms)", default: 400, min: 150, max: 1500, step: 50 },
});

const SIZE = 10;
const PAD = 0.25;
const LABEL = 6;
/** Inset of a domino from its cells' edges. */
const INSET = 1.1;

const BINDINGS = {
  "dominosa.domino": { label: "domino on / off", category: "dominosa", keys: ["Enter"], description: "put a domino across the selected edge, or take it away" },
  "dominosa.line": { label: "line on / off", category: "dominosa", keys: ["space"], description: "draw a line on the selected edge: your note that those two cells aren't one domino. press again to remove it" },
  "dominosa.highlight": { label: "highlight this number", category: "dominosa", keys: ["h"], description: "highlight every cell with the selected cell's number (up to two numbers at once); again to stop" },
  "dominosa.left": { label: "cursor left", category: "dominosa", keys: ["ArrowLeft", "a"], description: "move the keyboard selection half a cell left (cells and the edges between them)" },
  "dominosa.right": { label: "cursor right", category: "dominosa", keys: ["ArrowRight", "d"], description: "move the keyboard selection half a cell right" },
  "dominosa.up": { label: "cursor up", category: "dominosa", keys: ["ArrowUp", "w"], description: "move the keyboard selection half a cell up" },
  "dominosa.down": { label: "cursor down", category: "dominosa", keys: ["ArrowDown", "s"], description: "move the keyboard selection half a cell down" },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS>, Ids<typeof DIGIT_BINDINGS> {}
}

/** Number keys 0-9 toggle highlighting of that number. */
const NUMBER_KEYS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const DIGIT_BINDINGS = bindingsOver("dominosa.number-", NUMBER_KEYS, (d) => (
  { label: `highlight ${d}s`, category: "dominosa", keys: [String(d)], hidden: true, description: `highlight every ${d} on the board; again to stop` }
));

export type Side = "top" | "right" | "bottom" | "left";
export type Board = { labelSides(): Set<Side>; colName(col: number): string; rowName(row: number): string };

function legend(): { sample: string; meaning: string }[] {
  const svg = (body: string, w = 10) => `<svg viewBox="-0.5 -0.5 ${w + 1} 11">${body}</svg>`;
  const cell = (x = 0, fill = "var(--cell)") => `<rect x="${x}" width="10" height="10" fill="${fill}" stroke="var(--border)" stroke-width="0.25"/>`;
  const num = (n: number, x = 0, fill = "var(--text)") => `<text x="${x + 5}" y="5.3" fill="${fill}" font-size="5.2" font-weight="600" font-family="var(--font)" text-anchor="middle" dominant-baseline="central">${n}</text>`;
  const domino = (fill: string, extra = "") => `<rect x="${INSET}" y="${INSET}" width="${20 - 2 * INSET}" height="${10 - 2 * INSET}" rx="2" fill="${fill}" ${extra}/>`;
  const pair = (a: number, b: number) => cell(0) + cell(10) + num(a) + num(b, 10);
  return [
    { sample: svg(cell() + num(3)), meaning: "a cell: the number on the domino half that covers it" },
    { sample: svg(cell(0) + cell(10) + domino("var(--text)") + num(2, 0, "var(--bg)") + num(5, 10, "var(--bg)"), 20), meaning: "a domino you placed" },
    { sample: svg(pair(2, 5) + `<line x1="10" y1="2" x2="10" y2="8" stroke="var(--text)" stroke-width="0.9" stroke-linecap="round"/>`, 20), meaning: "a line: your note that these two cells aren't one domino" },
    { sample: svg(pair(2, 5) + domino("none", `stroke="var(--text-dim)" stroke-width="0.5" stroke-dasharray="1 0.8"`), 20), meaning: "where a click would put a domino, while you point between two cells" },
    { sample: svg(cell(0, "color-mix(in srgb, var(--accent) 30%, var(--cell))") + num(4)), meaning: "a highlighted number (first)" },
    { sample: svg(cell(0, "color-mix(in srgb, var(--hint) 30%, var(--cell))") + num(1)), meaning: "a highlighted number (second)" },
    { sample: svg(cell(0) + cell(10) + domino("var(--danger)") + num(2, 0, "var(--bg)") + num(5, 10, "var(--bg)"), 20), meaning: "a domino placed more than once" },
    { sample: svg(cell(0, "var(--danger-soft)") + num(3)), meaning: "a cell nothing can cover any more" },
    { sample: svg(pair(1, 4) + `<rect x="0.5" y="0.5" width="19" height="9" rx="1" fill="none" stroke="var(--hint)" stroke-width="0.9"/>`, 20), meaning: "hint: the pair of cells it changes" },
    { sample: svg(cell() + num(1) + `<rect x="0.5" y="0.5" width="9" height="9" rx="1" fill="none" stroke="var(--hint)" stroke-width="0.6" stroke-dasharray="1.2 0.8"/>`), meaning: "hint: the reason" },
    { sample: svg(cell() + num(1) + `<rect x="0.3" y="0.3" width="9.4" height="9.4" rx="1" fill="none" stroke="var(--focus)" stroke-width="0.6"/>`), meaning: "the keyboard selection (shown while using the keyboard)" },
  ];
}

export function dominosaView(board: Board): View<DominosaPuzzle, DominosaState, DominosaAction, DominosaInteraction, typeof settings> {
  return {
    id: "dominosa.svg",
    name: "grid",
    puzzle: dominosa,
    settings,
    controls: [
      { how: "click or tap between two cells", what: "put a domino on them, or take it away. a new domino replaces any it overlaps" },
      { how: "right-click between two cells, or hold on a touch screen", what: "draw a line between them, or take it away" },
      { how: "right-click the middle of a cell", what: "highlight every cell with that number (up to two numbers); again to stop" },
    ],
    legend: legend(),
    mount(root, { session, settings }) {
      style("dominosa", CSS);
      const p = session.puzzle;
      const g = geometry(p);
      const sides = board.labelSides();
      const m = (side: Side) => (sides.has(side) ? LABEL : PAD);
      const vbW = p.w * SIZE + m("left") + m("right"), vbH = p.h * SIZE + m("top") + m("bottom");
      const svg = s("svg", { viewBox: `${-m("left")} ${-m("top")} ${vbW} ${vbH}`, class: "dominosa-board", role: "grid", "aria-label": `dominosa, numbers 0 to ${p.n}` });
      const labels = s("g", { class: "labels" });
      for (let x = 0; x < p.w; x++) {
        if (sides.has("top")) labels.append(s("text", { x: x * SIZE + SIZE / 2, y: -LABEL / 2 }, board.colName(x)));
        if (sides.has("bottom")) labels.append(s("text", { x: x * SIZE + SIZE / 2, y: p.h * SIZE + LABEL / 2 }, board.colName(x)));
      }
      for (let y = 0; y < p.h; y++) {
        if (sides.has("left")) labels.append(s("text", { x: -LABEL / 2, y: y * SIZE + SIZE / 2 }, board.rowName(y)));
        if (sides.has("right")) labels.append(s("text", { x: p.w * SIZE + LABEL / 2, y: y * SIZE + SIZE / 2 }, board.rowName(y)));
      }
      const base = s("g"), pieces = s("g"), numsL = s("g"), over = s("g");
      const cursor = s("rect", { class: "cursor", rx: 1 });
      svg.append(labels, base, pieces, numsL, over, cursor);
      root.append(svg);

      const cx = (c: number) => (c % p.w) * SIZE;
      const cy = (c: number) => Math.floor(c / p.w) * SIZE;
      const tiles: SVGRectElement[] = [];
      const nums: SVGTextElement[] = [];
      for (let c = 0; c < g.wh; c++) {
        base.append(tiles[c] = s("rect", { x: cx(c), y: cy(c), width: SIZE, height: SIZE, class: "cell" }));
        numsL.append(nums[c] = s("text", { x: cx(c) + SIZE / 2, y: cy(c) + SIZE / 2 + 0.3, class: "num" }, String(p.numbers[c])));
      }
      /** Box around both cells of a placement, inset by `inset`. */
      const box = (q: number, inset: number) => {
        const a = g.pa[q]!, b = g.pb[q]!;
        return { x: cx(a) + inset, y: cy(a) + inset, width: cx(b) - cx(a) + SIZE - 2 * inset, height: cy(b) - cy(a) + SIZE - 2 * inset };
      };
      const lineAt = (q: number) => {
        const a = g.pa[q]!, b = g.pb[q]!;
        if (b === a + 1) return { x1: cx(b), y1: cy(a) + 2, x2: cx(b), y2: cy(a) + SIZE - 2 };
        return { x1: cx(a) + 2, y1: cy(b), x2: cx(a) + SIZE - 2, y2: cy(b) };
      };

      let hover = -1;
      let hoverCell = -1;
      let preview: DominosaState | null = null;

      const render = () => {
        const marks = session.state.marks;
        const conf = session.derived()[CONFLICTS_KEY] as Conflicts | undefined;
        const dup = new Set(conf?.duplicates), stuck = new Set(conf?.stuck);
        const [h1, h2] = session.interaction.highlight;
        const on = new Uint8Array(g.wh);
        while (pieces.firstChild) pieces.firstChild.remove();
        for (let q = 0; q < g.np; q++) {
          const pv = preview && preview.marks[q] !== marks[q] ? preview.marks[q] : undefined;
          if (marks[q] === DOMINO) {
            pieces.append(s("rect", { ...box(q, INSET), rx: 2, class: `${dup.has(q) ? "domino bad" : "domino"}${pv !== undefined ? " faded" : ""}` }));
            on[g.pa[q]!] = on[g.pb[q]!] = 1;
          } else if (marks[q] === LINE) pieces.append(s("line", { ...lineAt(q), class: pv !== undefined ? "line faded" : "line" }));
          if (pv === DOMINO) pieces.append(s("rect", { ...box(q, INSET), rx: 2, class: "domino preview" }));
          else if (pv === LINE) pieces.append(s("line", { ...lineAt(q), class: "line preview" }));
        }
        if (settings.ghost && hover >= 0 && !session.locked && marks[hover] !== DOMINO) {
          pieces.append(s("rect", { ...box(hover, INSET), rx: 2, class: "domino ghost" }));
        }
        for (let c = 0; c < g.wh; c++) {
          const v = p.numbers[c];
          tiles[c]!.classList.toggle("hl1", v === h1);
          tiles[c]!.classList.toggle("hl2", v === h2);
          tiles[c]!.classList.toggle("stuck", stuck.has(c));
          nums[c]!.classList.toggle("on", on[c] === 1);
        }
        while (over.firstChild) over.firstChild.remove();
        const focus = session.activeHint?.focus as DominosaFocus | undefined;
        if (focus) {
          for (const c of focus.because ?? []) over.append(s("rect", { x: cx(c) + 0.5, y: cy(c) + 0.5, width: SIZE - 1, height: SIZE - 1, rx: 1, class: "focus why" }));
          for (const q of focus.placements ?? []) over.append(s("rect", { ...box(q, 0.5), rx: 1, class: "focus" }));
        }
        const { cx: kx, cy: ky } = session.interaction;
        const half = SIZE / 2;
        cursor.setAttribute("x", String(kx * half + (kx % 2 ? half / 2 : 0.3)));
        cursor.setAttribute("y", String(ky * half + (ky % 2 ? half / 2 : 0.3)));
        cursor.setAttribute("width", String(kx % 2 ? half : SIZE - 0.6));
        cursor.setAttribute("height", String(ky % 2 ? half : SIZE - 0.6));
      };

      /** The placement whose edge is nearest the pointer inside its cell, and the cell under it, and whether the pointer is near that cell's center. */
      const pointAt = (e: PointerEvent): { q: number; cell: number; centre: boolean } => {
        const mtx = svg.getScreenCTM();
        if (!mtx) return { q: -1, cell: -1, centre: false };
        const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(mtx.inverse());
        const x = Math.floor(pt.x / SIZE), y = Math.floor(pt.y / SIZE);
        if (x < 0 || y < 0 || x >= p.w || y >= p.h) return { q: -1, cell: -1, centre: false };
        const cell = y * p.w + x;
        const dx = pt.x - (x * SIZE + SIZE / 2), dy = pt.y - (y * SIZE + SIZE / 2);
        const centre = Math.abs(dx) < SIZE * 0.2 && Math.abs(dy) < SIZE * 0.2;
        let nb = -1;
        if (Math.abs(dx) > Math.abs(dy)) nb = dx < 0 ? (x > 0 ? cell - 1 : -1) : (x < p.w - 1 ? cell + 1 : -1);
        else if (Math.abs(dy) > Math.abs(dx)) nb = dy < 0 ? (y > 0 ? cell - p.w : -1) : (y < p.h - 1 ? cell + p.w : -1);
        return { q: nb < 0 ? -1 : g.between(cell, nb), cell, centre };
      };
      const cursorTo = (q: number) => {
        const a = g.pa[q]!, b = g.pb[q]!;
        session.setInteraction((i) => ({ ...i, cx: (a % p.w) + (b % p.w), cy: Math.floor(a / p.w) + Math.floor(b / p.w) }));
      };
      const toggleHighlight = (v: number) => session.setInteraction((i) => {
        if (i.highlight.includes(v)) return { ...i, highlight: i.highlight.filter((x) => x !== v) };
        return i.highlight.length >= 2 ? i : { ...i, highlight: [...i.highlight, v] };
      });

      let pressTimer = 0;
      let pressQ = -1;
      const cancelPress = () => {
        clearTimeout(pressTimer);
        pressTimer = 0;
      };
      const onContext = (e: Event) => e.preventDefault();
      const onDown = (e: PointerEvent) => {
        const at = pointAt(e);
        if (at.cell < 0) return;
        e.preventDefault();
        const second = secondary(e, session.def.id);
        if (e.pointerType !== "touch" && (e.button === 0 || e.button === 2) && second && at.centre) {
          toggleHighlight(p.numbers[at.cell]!);
          return;
        }
        if (at.q < 0 || session.locked) return;
        cursorTo(at.q);
        if (e.pointerType === "touch") {
          pressQ = at.q;
          pressTimer = window.setTimeout(() => {
            pressTimer = 0;
            navigator.vibrate?.(15);
            session.dispatch(toggle(session.state, pressQ, buttonsSwapped(session.def.id) ? DOMINO : LINE));
            pressQ = -1;
          }, settings.longPressMs as number);
        } else if (e.button === 0 || e.button === 2) session.dispatch(toggle(session.state, at.q, second ? LINE : DOMINO));
      };
      const onUp = (e: PointerEvent) => {
        if (e.pointerType !== "touch") return;
        if (pressTimer) {
          cancelPress();
          if (pressQ >= 0) session.dispatch(toggle(session.state, pressQ, buttonsSwapped(session.def.id) ? LINE : DOMINO));
        }
        pressQ = -1;
      };
      const onCancel = () => {
        cancelPress();
        pressQ = -1;
      };
      const onMove = (e: PointerEvent) => {
        if (e.pointerType === "touch") {
          if (pressTimer && pointAt(e).q !== pressQ) onCancel();
          return;
        }
        const at = pointAt(e);
        const q = at.centre ? -1 : at.q;
        if (q !== hover || at.cell !== hoverCell) {
          hover = q;
          hoverCell = at.cell;
          render();
        }
      };
      const onLeave = () => {
        if (hover !== -1 || hoverCell !== -1) {
          hover = -1;
          hoverCell = -1;
          render();
        }
      };
      svg.addEventListener("contextmenu", onContext);
      svg.addEventListener("pointerdown", onDown);
      svg.addEventListener("pointerup", onUp);
      svg.addEventListener("pointercancel", onCancel);
      svg.addEventListener("pointermove", onMove);
      svg.addEventListener("pointerleave", onLeave);

      const move = (dx: number, dy: number) => () => session.setInteraction((i) => ({
        ...i,
        cx: Math.min(2 * p.w - 2, Math.max(0, i.cx + dx)),
        cy: Math.min(2 * p.h - 2, Math.max(0, i.cy + dy)),
      }));
      /** Placement at the keyboard cursor, or -1 on a cell or corner. */
      const cursorQ = (): number => {
        const { cx: x, cy: y } = session.interaction;
        if (((x ^ y) & 1) === 0) return -1;
        const a = Math.floor(y / 2) * p.w + Math.floor(x / 2);
        const b = Math.floor((y + 1) / 2) * p.w + Math.floor((x + 1) / 2);
        return g.between(a, b);
      };
      const cursorCell = (): number => {
        const { cx: x, cy: y } = session.interaction;
        return Math.floor(y / 2) * p.w + Math.floor(x / 2);
      };
      const atCursor = (value: typeof DOMINO | typeof LINE) => () => {
        const q = cursorQ();
        if (q >= 0) session.dispatch(toggle(session.state, q, value));
      };

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(() => {
          if (session.locked) onCancel();
          render();
        }, { owner: "view" }),
      ];
      render();

      const rects = (cells: Iterable<number>) => [...new Set(cells)].map((c) => tiles[c]!.getBoundingClientRect());
      const cellsOf = (qs: readonly number[]) => qs.flatMap((q) => [g.pa[q]!, g.pb[q]!]);
      const commands: CommandDef[] = [...bindCommands(BINDINGS, {
        "dominosa.domino": atCursor(DOMINO),
        "dominosa.line": atCursor(LINE),
        "dominosa.highlight": () => toggleHighlight(p.numbers[cursorCell()]!),
        "dominosa.left": move(-1, 0),
        "dominosa.right": move(1, 0),
        "dominosa.up": move(0, -1),
        "dominosa.down": move(0, 1),
      }, {
        "dominosa.domino": { menu: "board" },
        "dominosa.line": { menu: "board" },
        "dominosa.highlight": { menu: "board" },
      }), ...bindCommands(DIGIT_BINDINGS, handlersOver("dominosa.number-", NUMBER_KEYS, (d) => () => { if (d <= p.n) toggleHighlight(d); }))];
      return {
        gestures: { secondaryClick: true, hold: true, labels: ["domino", "line"] },
        aspect: vbW / vbH,
        cells: { cols: p.w, rows: p.h },
        commands,
        target: (): DominosaTarget | undefined => {
          if (hover >= 0) return { placement: hover };
          if (hoverCell >= 0) return { cell: hoverCell };
          const q = cursorQ();
          return q >= 0 ? { placement: q } : { cell: cursorCell() };
        },
        preview: (st) => {
          preview = st as DominosaState | null;
          render();
        },
        locate: (focus) => {
          const f = focus as DominosaFocus | undefined;
          return f ? rects([...cellsOf(f.placements ?? []), ...(f.because ?? [])]) : [];
        },
        locateChange: (a, b) => {
          const x = (a as DominosaState).marks, y = (b as DominosaState).marks;
          const qs: number[] = [];
          for (let q = 0; q < g.np; q++) if (x[q] !== y[q]) qs.push(q);
          return rects(cellsOf(qs));
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
