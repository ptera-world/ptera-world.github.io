import { bindCommands, type BindingSchema, type Ids } from "../../core/commands";
import { s, style, inputIs } from "../../core/dom";
import { secondary } from "../../core/gestures";
import { defineSchema } from "../../core/schema";
import type { CommandDef, View } from "../../core/types";
import { geometry } from "./grid";
import {
  signpost, canLink, prevOf, stateChains,
  type Conflicts, type SignpostAction, type SignpostFocus, type SignpostInteraction, type SignpostPuzzle, type SignpostState,
} from "./logic";
import type { SignpostTarget } from "./techniques";

/** Derived: Conflicts to flag on the board. */
export const CONFLICTS_KEY = "signpost.conflicts";

const CSS = `
.signpost-board { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.signpost-board .cell { fill: var(--cell); stroke: var(--border); stroke-width: 0.25; }
.signpost-board .cell.target { fill: color-mix(in srgb, var(--accent) 22%, var(--cell)); }
.signpost-board .cell.source { fill: color-mix(in srgb, var(--accent) 40%, var(--cell)); }
.signpost-board .arrow { fill: var(--text); pointer-events: none; }
.signpost-board .arrow.done { fill: var(--text-dim); opacity: 0.45; }
.signpost-board .arrow.bad { fill: var(--danger); opacity: 1; }
.signpost-board .end { fill: none; stroke: var(--text); stroke-width: 0.7; pointer-events: none; }
.signpost-board .needs { fill: var(--text); pointer-events: none; }
.signpost-board .needs.bad { fill: var(--danger); }
.signpost-board .num { fill: var(--text); font: 500 3.1px var(--font); dominant-baseline: hanging; pointer-events: none; }
.signpost-board .num.given { font-weight: 700; }
.signpost-board .num.letter { font-style: italic; fill: var(--text-dim); }
.signpost-board .num.bad { fill: var(--danger); }
.signpost-board .link { stroke: var(--accent); stroke-width: 0.7; stroke-linecap: round; opacity: 0.7; pointer-events: none; fill: none; }
.signpost-board .link.faded { opacity: 0.2; }
.signpost-board .link.preview { stroke: var(--hint); stroke-dasharray: 1.2 0.8; opacity: 0.9; }
.signpost-board .link.drag { stroke: var(--focus); stroke-dasharray: 1 0.8; opacity: 1; }
.signpost-board .link.focus { stroke: var(--hint); stroke-width: 1.2; opacity: 1; }
.signpost-board .focus { fill: none; stroke: var(--hint); stroke-width: 0.9; pointer-events: none; }
.signpost-board .focus.why { stroke-dasharray: 1.2 0.8; stroke-width: 0.6; }
.signpost-board .focus.related { stroke-width: 0.4; stroke-opacity: 0.7; }
.signpost-board .labels text { fill: var(--text-dim); font: 500 3.6px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.signpost-board .cursor { fill: none; stroke: var(--focus); stroke-width: 0.6; pointer-events: none; }
${inputIs("pointer")} .signpost-board .cursor { display: none; }
`;

const settings = defineSchema({
  links: { type: "bool", label: "draw lines between linked cells", default: true },
  targets: { type: "bool", label: "shade the cells a link could go to", default: true },
  tint: { type: "bool", label: "tint chains that have no number yet", default: true },
});

const SIZE = 10;
const PAD = 0.25;
const LABEL = 6;
const HUES = [200, 30, 140, 300, 60, 250, 0, 170];

const BINDINGS = {
  "signpost.link": { label: "link from here / to here", category: "signpost", keys: ["Enter"], description: "start a link at the selected cell, then press again on the cell it leads to" },
  "signpost.link-back": { label: "link into here / from here", category: "signpost", keys: ["space"], description: "start a link into the selected cell, then press again on the cell that leads to it" },
  "signpost.cancel": { label: "cancel link", category: "signpost", keys: ["Escape"], description: "forget the link you started" },
  "signpost.cut": { label: "cut links", category: "signpost", keys: ["x", "Backspace"], description: "remove the links into and out of the selected cell" },
  "signpost.cut-chain": { label: "cut whole chain", category: "signpost", keys: ["shift+x", "shift+Backspace"], description: "remove every link in the selected cell's chain" },
  "signpost.left": { label: "cursor left", category: "signpost", keys: ["ArrowLeft", "a"] },
  "signpost.right": { label: "cursor right", category: "signpost", keys: ["ArrowRight", "d"] },
  "signpost.up": { label: "cursor up", category: "signpost", keys: ["ArrowUp", "w"] },
  "signpost.down": { label: "cursor down", category: "signpost", keys: ["ArrowDown", "s"] },
} satisfies BindingSchema;

declare module "../../core/commands" {
  interface CommandNames extends Ids<typeof BINDINGS> {}
}

export type Side = "top" | "right" | "bottom" | "left";
export type Board = { labelSides(): Set<Side>; colName(col: number): string; rowName(row: number): string };

/** Arrow polygon in a 10×10 cell pointing up, rotated to direction d (0 = north, clockwise). */
function arrowPath(d: number): string {
  const pts = [[0, -2.2], [2, 0.2], [0.8, 0.2], [0.8, 2.2], [-0.8, 2.2], [-0.8, 0.2], [-2, 0.2]];
  const a = (d * Math.PI) / 4;
  const ca = Math.cos(a), sa = Math.sin(a);
  return pts.map(([x, y]) => `${(5.8 + x! * ca - y! * sa).toFixed(2)},${(6 + x! * sa + y! * ca).toFixed(2)}`).join(" ");
}

function legend(): { sample: string; meaning: string }[] {
  const svg = (body: string) => `<svg viewBox="-0.5 -0.5 11 11">${body}</svg>`;
  const cell = (fill = "var(--cell)") => `<rect width="10" height="10" fill="${fill}" stroke="var(--border)" stroke-width="0.25"/>`;
  const arrow = (fill = "var(--text)", extra = "") => `<polygon points="${arrowPath(2)}" fill="${fill}" ${extra}/>`;
  const num = (t: string, extra = "") => `<text x="0.8" y="0.8" font-size="3.4" font-family="var(--font)" dominant-baseline="hanging" ${extra}>${t}</text>`;
  const dot = `<circle cx="1.6" cy="8.4" r="0.7" fill="var(--text)"/>`;
  return [
    { sample: svg(cell() + arrow() + dot), meaning: "a cell: its arrow points along the line where the next cell is" },
    { sample: svg(cell() + arrow() + num("3", `font-weight="700" fill="var(--text)"`)), meaning: "a shown number: fixed" },
    { sample: svg(cell() + arrow("var(--text-dim)", `opacity="0.45"`) + num("4", `fill="var(--text)"`)), meaning: "a faded arrow: this cell already links on to its next cell (the number came from its chain)" },
    { sample: svg(cell() + arrow() + dot), meaning: "a dot in the corner: nothing links into this cell yet" },
    { sample: svg(cell(`color-mix(in srgb, hsl(200 70% 50%) 18%, var(--cell))`) + arrow() + num("b+1", `font-style="italic" fill="var(--text-dim)"`)), meaning: "a chain with no number yet: lettered and tinted until it joins a number" },
    { sample: svg(cell() + `<circle cx="5.8" cy="6" r="2.4" fill="none" stroke="var(--text)" stroke-width="0.7"/>` + num("16", `font-weight="700" fill="var(--text)"`)), meaning: "the end: the last number, with no arrow" },
    { sample: svg(cell() + `<line x1="0" y1="5" x2="10" y2="5" stroke="var(--accent)" stroke-width="0.7" opacity="0.7"/>`), meaning: "a link between two cells" },
    { sample: svg(cell("color-mix(in srgb, var(--accent) 22%, var(--cell))") + arrow()), meaning: "a cell the link you're making could go to" },
    { sample: svg(cell() + arrow() + num("7", `fill="var(--danger)"`)), meaning: "a number that clashes (twice on the board, or out of range)" },
    { sample: svg(cell() + arrow("var(--danger)")), meaning: "a cell with nowhere left to link to" },
    { sample: svg(cell() + `<circle cx="1.6" cy="8.4" r="0.7" fill="var(--danger)"/>` + arrow()), meaning: "a cell nothing can link into any more" },
    { sample: svg(cell() + `<line x1="0" y1="5" x2="10" y2="5" stroke="var(--hint)" stroke-width="1.2"/>`), meaning: "hint: the link it makes" },
    { sample: svg(cell() + `<rect x="0.5" y="0.5" width="9" height="9" rx="1" fill="none" stroke="var(--hint)" stroke-width="0.6" stroke-dasharray="1.2 0.8"/>`), meaning: "hint: the reason" },
    { sample: svg(cell() + `<rect x="0.5" y="0.5" width="9" height="9" rx="1" fill="none" stroke="var(--hint)" stroke-width="0.4" stroke-opacity="0.7"/>`), meaning: "hint: other cells it mentions" },
    { sample: svg(cell() + `<rect x="0.3" y="0.3" width="9.4" height="9.4" rx="1" fill="none" stroke="var(--focus)" stroke-width="0.6"/>`), meaning: "the keyboard selection (shown while using the keyboard)" },
  ];
}

export function signpostView(board: Board): View<SignpostPuzzle, SignpostState, SignpostAction, SignpostInteraction, typeof settings> {
  return {
    id: "signpost.svg",
    name: "grid",
    puzzle: signpost,
    settings,
    controls: [
      { how: "drag from a cell to the cell it leads to", what: "link them (replacing either end's old link)" },
      { how: "right-drag from a cell to the cell that leads into it", what: "link them the other way round" },
      { how: "tap a cell, then tap where it leads", what: "link them without dragging" },
      { how: "drag a cell off the board", what: "remove its links (right-drag: its whole chain)" },
    ],
    legend: legend(),
    mount(root, { session, settings }) {
      style("signpost", CSS);
      const p = session.puzzle;
      const g = geometry(p);
      const sides = board.labelSides();
      const m = (side: Side) => (sides.has(side) ? LABEL : PAD);
      const vbW = p.w * SIZE + m("left") + m("right"), vbH = p.h * SIZE + m("top") + m("bottom");
      const svg = s("svg", { viewBox: `${-m("left")} ${-m("top")} ${vbW} ${vbH}`, class: "signpost-board", role: "grid", "aria-label": `signpost, ${p.w} by ${p.h}` });
      const labels = s("g", { class: "labels" });
      for (let x = 0; x < p.w; x++) {
        if (sides.has("top")) labels.append(s("text", { x: x * SIZE + SIZE / 2, y: -LABEL / 2 }, board.colName(x)));
        if (sides.has("bottom")) labels.append(s("text", { x: x * SIZE + SIZE / 2, y: p.h * SIZE + LABEL / 2 }, board.colName(x)));
      }
      for (let y = 0; y < p.h; y++) {
        if (sides.has("left")) labels.append(s("text", { x: -LABEL / 2, y: y * SIZE + SIZE / 2 }, board.rowName(y)));
        if (sides.has("right")) labels.append(s("text", { x: p.w * SIZE + LABEL / 2, y: y * SIZE + SIZE / 2 }, board.rowName(y)));
      }
      const base = s("g"), linksL = s("g"), marks = s("g"), over = s("g");
      const cursor = s("rect", { width: SIZE - 0.6, height: SIZE - 0.6, rx: 1, class: "cursor" });
      svg.append(labels, base, linksL, marks, over, cursor);
      root.append(svg);

      const cx = (c: number) => (c % p.w) * SIZE;
      const cy = (c: number) => Math.floor(c / p.w) * SIZE;
      const tiles: SVGRectElement[] = [], arrows: SVGElement[] = [], dots: SVGCircleElement[] = [], nums: SVGTextElement[] = [];
      for (let c = 0; c < g.n; c++) {
        base.append(tiles[c] = s("rect", { x: cx(c), y: cy(c), width: SIZE, height: SIZE, class: "cell" }));
        const holder = s("g", { transform: `translate(${cx(c)} ${cy(c)})` });
        arrows[c] = c === g.last ? s("circle", { cx: 5.8, cy: 6, r: 2.4, class: "end" }) : s("polygon", { points: arrowPath(p.dirs[c]!), class: "arrow" });
        holder.append(arrows[c]!, dots[c] = s("circle", { cx: 1.6, cy: 8.4, r: 0.7, class: "needs" }), nums[c] = s("text", { x: 0.8, y: 0.8, class: "num" }));
        marks.append(holder);
      }

      let hover = -1;
      let drag: { from: number; back: boolean; x: number; y: number; moved: boolean } | null = null;
      let preview: SignpostState | null = null;
      const centre = (c: number) => [cx(c) + SIZE / 2, cy(c) + SIZE / 2] as const;

      /** Cells the pending or dragged link could go to. */
      const targets = (): Set<number> => {
        const from = drag ?? session.interaction.pending;
        if (!from) return new Set();
        const st = session.state;
        const c = "from" in from ? from.from : from.cell;
        const back = from.back;
        const out = new Set<number>();
        for (let o = 0; o < g.n; o++) if (back ? canLink(p, st, o, c) : canLink(p, st, c, o)) out.add(o);
        return out;
      };

      const render = () => {
        const st = session.state;
        const ch = stateChains(p, st);
        const prev = prevOf(st.next);
        const conf = session.derived()[CONFLICTS_KEY] as Conflicts | undefined;
        const badNum = new Set(conf?.numbers), badOut = new Set(conf?.stuckOut), badIn = new Set(conf?.stuckIn);
        const tg = settings.targets ? targets() : new Set<number>();
        const src = drag ? drag.from : session.interaction.pending?.cell ?? -1;
        const letters = new Map<number, number>();
        for (let c = 0; c < g.n; c++) if (ch.head[c] === c && !ch.num[c] && ch.length[c]! > 1) letters.set(c, letters.size);
        for (let c = 0; c < g.n; c++) {
          const tile = tiles[c]!;
          const letter = letters.get(ch.head[c]!);
          tile.classList.toggle("target", tg.has(c));
          tile.classList.toggle("source", c === src);
          tile.style.fill = settings.tint && letter !== undefined && !tg.has(c) && c !== src
            ? `color-mix(in srgb, hsl(${HUES[letter % HUES.length]} 70% 50%) 18%, var(--cell))` : "";
          arrows[c]!.classList.toggle("done", st.next[c] !== -1);
          arrows[c]!.classList.toggle("bad", badOut.has(c));
          dots[c]!.style.display = c !== g.first && prev[c] === -1 ? "" : "none";
          dots[c]!.classList.toggle("bad", badIn.has(c));
          const t = nums[c]!;
          const v = ch.num[c]!;
          let text = "";
          if (p.nums[c]) text = String(p.nums[c]);
          else if (v) text = String(v);
          else if (letter !== undefined) {
            const name = letter < 26 ? String.fromCharCode(97 + letter) : `${String.fromCharCode(97 + Math.floor(letter / 26) - 1)}${String.fromCharCode(97 + (letter % 26))}`;
            text = ch.offset[c] ? `${name}+${ch.offset[c]}` : name;
          }
          if (t.textContent !== text) t.textContent = text;
          t.classList.toggle("given", p.nums[c]! > 0);
          t.classList.toggle("letter", !p.nums[c] && !v && letter !== undefined);
          t.classList.toggle("bad", badNum.has(c));
        }
        while (linksL.firstChild) linksL.firstChild.remove();
        const line = (a: number, b: number, cls: string) => {
          const [x1, y1] = centre(a), [x2, y2] = centre(b);
          linksL.append(s("line", { x1, y1, x2, y2, class: cls }));
        };
        if (settings.links) st.next.forEach((t, c) => { if (t >= 0) line(c, t, preview && preview.next[c] !== t ? "link faded" : "link"); });
        if (preview) preview.next.forEach((t, c) => { if (t >= 0 && st.next[c] !== t) line(c, t, "link preview"); });
        if (drag?.moved) {
          const [x1, y1] = centre(drag.from);
          linksL.append(s("line", { x1, y1, x2: drag.x, y2: drag.y, class: "link drag" }));
        }
        while (over.firstChild) over.firstChild.remove();
        const focus = session.activeHint?.focus as SignpostFocus | undefined;
        if (focus) {
          for (const [a, b] of focus.links ?? []) {
            const [x1, y1] = centre(a), [x2, y2] = centre(b);
            over.append(s("line", { x1, y1, x2, y2, class: "link focus" }));
          }
          const box = (c: number, cls: string) => over.append(s("rect", { x: cx(c) + 0.5, y: cy(c) + 0.5, width: SIZE - 1, height: SIZE - 1, rx: 1, class: cls }));
          for (const c of focus.related ?? []) box(c, "focus related");
          for (const c of focus.because ?? []) box(c, "focus why");
          for (const [a, b] of focus.links ?? []) { box(a, "focus"); box(b, "focus"); }
        }
        const cur = session.interaction.cursor;
        cursor.setAttribute("x", String(cx(cur) + 0.3));
        cursor.setAttribute("y", String(cy(cur) + 0.3));
      };

      const pointAt = (e: PointerEvent): { cell: number; x: number; y: number } => {
        const mtx = svg.getScreenCTM();
        if (!mtx) return { cell: -1, x: 0, y: 0 };
        const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(mtx.inverse());
        const x = Math.floor(pt.x / SIZE), y = Math.floor(pt.y / SIZE);
        const cell = x < 0 || y < 0 || x >= p.w || y >= p.h ? -1 : y * p.w + x;
        return { cell, x: pt.x, y: pt.y };
      };
      const linkPair = (a: number, b: number, back: boolean) => session.dispatch(back ? { type: "link", from: b, to: a } : { type: "link", from: a, to: b });
      const setPending = (v: SignpostInteraction["pending"]) => session.setInteraction((i) => ({ ...i, pending: v }));
      /** A tap or key press on cell c while a link may be pending. */
      const tapCell = (c: number, back: boolean) => {
        const pend = session.interaction.pending;
        if (pend && pend.cell !== c) {
          linkPair(pend.cell, c, pend.back);
          setPending(null);
        } else if (pend) setPending(null);
        else setPending({ cell: c, back });
      };

      let pointerId = -1;
      const onContext = (e: Event) => e.preventDefault();
      const onDown = (e: PointerEvent) => {
        const at = pointAt(e);
        if (at.cell < 0 || pointerId !== -1) return;
        e.preventDefault();
        session.setInteraction((i) => ({ ...i, cursor: at.cell }));
        if (session.locked) return;
        pointerId = e.pointerId;
        svg.setPointerCapture?.(e.pointerId);
        drag = { from: at.cell, back: e.button !== 1 && secondary(e, session.def.id), x: at.x, y: at.y, moved: false };
        render();
      };
      const onMove = (e: PointerEvent) => {
        const at = pointAt(e);
        if (e.pointerId !== pointerId) {
          if (e.pointerType !== "touch" && at.cell !== hover) {
            hover = at.cell;
            render();
          }
          return;
        }
        if (!drag) return;
        drag.x = at.x;
        drag.y = at.y;
        if (at.cell !== drag.from) drag.moved = true;
        render();
      };
      const onUp = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        pointerId = -1;
        const d = drag;
        drag = null;
        if (!d) return;
        const at = pointAt(e);
        if (!d.moved) tapCell(d.from, d.back);
        else if (at.cell < 0) session.dispatch(d.back ? { type: "cut-chain", cell: d.from } : { type: "cut", cell: d.from });
        else if (at.cell !== d.from) {
          setPending(null);
          linkPair(d.from, at.cell, d.back);
        }
        render();
      };
      const onCancel = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        pointerId = -1;
        drag = null;
        render();
      };
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

      const move = (dx: number, dy: number) => () => session.setInteraction((i) => {
        const x = Math.min(p.w - 1, Math.max(0, (i.cursor % p.w) + dx));
        const y = Math.min(p.h - 1, Math.max(0, Math.floor(i.cursor / p.w) + dy));
        return { ...i, cursor: y * p.w + x };
      });

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(() => {
          if (session.locked && drag) drag = null;
          render();
        }, { owner: "view" }),
      ];
      render();

      const rects = (cells: Iterable<number>) => [...new Set(cells)].map((c) => tiles[c]!.getBoundingClientRect());
      const commands: CommandDef[] = bindCommands(BINDINGS, {
        "signpost.link": () => tapCell(session.interaction.cursor, false),
        "signpost.link-back": () => tapCell(session.interaction.cursor, true),
        "signpost.cancel": () => setPending(null),
        "signpost.cut": () => session.dispatch({ type: "cut", cell: session.interaction.cursor }),
        "signpost.cut-chain": () => session.dispatch({ type: "cut-chain", cell: session.interaction.cursor }),
        "signpost.left": move(-1, 0),
        "signpost.right": move(1, 0),
        "signpost.up": move(0, -1),
        "signpost.down": move(0, 1),
      }, {
        "signpost.link": { menu: "board" },
        "signpost.link-back": { menu: "board" },
        "signpost.cut": { menu: "board" },
        "signpost.cut-chain": { menu: "board" },
        "signpost.cancel": { menu: "board", when: () => session.interaction.pending !== null },
      });
      return {
        gestures: { secondaryClick: true },
        aspect: vbW / vbH,
        cells: { cols: p.w, rows: p.h },
        commands,
        target: (): SignpostTarget => ({ cell: hover >= 0 ? hover : session.interaction.cursor }),
        preview: (st) => {
          preview = st as SignpostState | null;
          render();
        },
        locate: (focus) => {
          const f = focus as SignpostFocus | undefined;
          return f ? rects([...(f.links ?? []).flat(), ...(f.because ?? []), ...(f.related ?? [])]) : [];
        },
        locateChange: (a, b) => {
          const x = (a as SignpostState).next, y = (b as SignpostState).next;
          const cells: number[] = [];
          x.forEach((t, c) => { if (t !== y[c]) cells.push(c, ...(t >= 0 ? [t] : []), ...(y[c]! >= 0 ? [y[c]!] : [])); });
          return rects(cells);
        },
        destroy() {
          offs.forEach((f) => f());
          svg.remove();
        },
      };
    },
  };
}
