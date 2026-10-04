import { Event as HookEvent } from "../../core/hooks";
import { defineSchema } from "../../core/schema";
import type { View } from "../../core/types";
import { clear, s, style } from "../../core/dom";
import { digits } from "./engine/bits";
import { insetOutline } from "./engine/constraints/draw";
import { modelOf } from "./engine/model";
import { constraintTypes } from "./engine/registry";
import { colName, type Margins, type RenderCtx } from "./engine/types";
import { boardCommands } from "./commands";
import { legendFor } from "./legend";
import { input, setSelection, selectSame } from "./input";
import { CANDIDATES, CONFLICTS, MISTAKES, PEERS, SAME, type SameDigit } from "./keys";
import type { GridAction, GridInteraction, GridState, HintFocus, LatinPuzzle } from "./puzzle";

const S = 100;

/** Cell colour palette (ids 1..9), as custom properties a theme can override (`--sdk-color-1` …). */
export const PALETTE = [
  "", "rgba(214, 214, 214, 0.45)", "rgba(120, 120, 120, 0.55)", "rgba(40, 40, 40, 0.8)",
  "rgba(170, 230, 120, 0.4)", "rgba(240, 140, 220, 0.4)", "rgba(250, 160, 80, 0.4)",
  "rgba(240, 90, 90, 0.4)", "rgba(250, 230, 100, 0.4)", "rgba(110, 170, 250, 0.45)",
];
export const colorVar = (id: number): string => `var(--sdk-color-${id}, ${PALETTE[id]})`;

const CSS = `
.sdk-board { width: 100%; height: 100%; max-height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; display: block; }
.sdk-board .cell { fill: transparent; }
.sdk-board .cell.peer { fill: color-mix(in srgb, var(--text) 6%, transparent); }
.sdk-board .cell.same { fill: color-mix(in srgb, var(--focus) 20%, transparent); }
.sdk-board .cell.sel { fill: color-mix(in srgb, var(--focus) 32%, transparent); }
.sdk-board .cell.hint-area { fill: color-mix(in srgb, var(--hint) 10%, transparent); }
.sdk-board .cell.hint { fill: var(--hint-soft); }
.sdk-board .cell.conflict { fill: var(--danger-soft); }
.sdk-board .open { fill: none; stroke: var(--warn); stroke-width: 3; stroke-dasharray: 10 6; pointer-events: none; }
.sdk-board .thin { stroke: var(--border); stroke-width: 1.5; fill: none; }
.sdk-board .thick { stroke: #777; stroke-width: 4; fill: none; stroke-linecap: square; }
.sdk-board .value { font: 600 ${S * 0.62}px var(--font); fill: var(--text); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.sdk-board .value.entered { fill: var(--focus); font-weight: 500; }
.sdk-board .value.conflict, .sdk-board .value.mistake { fill: var(--danger); }
.sdk-board .center-mark { font: 500 ${S * 0.26}px var(--font); fill: var(--focus); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.sdk-board .cand { font: 400 ${S * 0.24}px var(--font); fill: var(--text-dim); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.sdk-board .corner-mark { font: 500 ${S * 0.22}px var(--font); fill: var(--focus); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.sdk-board .lit { fill: var(--warn); font-weight: 700; }
.sdk-board .hint-place { font: 600 ${S * 0.62}px var(--font); fill: var(--hint); text-anchor: middle; dominant-baseline: central; opacity: 0.8; pointer-events: none; }
.sdk-board .hint-elim { font: 700 ${S * 0.24}px var(--font); fill: var(--danger); text-anchor: middle; dominant-baseline: central; text-decoration: line-through; pointer-events: none; }
.sdk-board .sel-outline { fill: none; stroke: var(--focus); stroke-width: 5; stroke-linejoin: round; pointer-events: none; }
.sdk-board .cursor { fill: none; stroke: var(--focus); stroke-width: 3; stroke-dasharray: 8 6; pointer-events: none; }
[data-input="pointer"] .sdk-board .cursor { display: none; }
.sdk-board .color { pointer-events: none; }
.sdk-board .sdk-diagonal { stroke: var(--text-dim); stroke-width: 2; opacity: 0.45; }
.sdk-board .sdk-cage { fill: none; stroke: var(--text); stroke-width: 1.6; stroke-dasharray: 7 5; opacity: 0.85; }
.sdk-board .sdk-keen { fill: none; stroke: #999; stroke-width: 5; stroke-linecap: square; }
.sdk-board .sdk-label-bg { fill: var(--bg); }
.sdk-board .sdk-label { font: 600 ${S * 0.19}px var(--font); fill: var(--text); dominant-baseline: auto; }
.sdk-board .sdk-thermo { stroke: #555; stroke-width: ${S * 0.26}; stroke-linecap: round; stroke-linejoin: round; fill: none; }
.sdk-board .sdk-thermo-bulb { fill: #555; }
.sdk-board .sdk-whispers { stroke: #3a8a4a; stroke-width: ${S * 0.16}; stroke-linecap: round; stroke-linejoin: round; fill: none; opacity: 0.85; }
.sdk-board .sdk-renban { stroke: #8a4ab0; stroke-width: ${S * 0.18}; stroke-linecap: round; stroke-linejoin: round; fill: none; opacity: 0.85; }
.sdk-board .sdk-arrow-circle { fill: none; stroke: #999; stroke-width: 3; }
.sdk-board .sdk-arrow { fill: none; stroke: #999; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.sdk-board .sdk-kropki { stroke: var(--text); stroke-width: 2.5; }
.sdk-board .sdk-kropki-white { fill: var(--bg); }
.sdk-board .sdk-kropki-black { fill: var(--text); }
.sdk-board .sdk-xv { font: 700 ${S * 0.26}px var(--font); fill: var(--text); text-anchor: middle; dominant-baseline: central; }
.sdk-board .sdk-unequal { fill: none; stroke: var(--text); stroke-width: 3.5; stroke-linecap: round; stroke-linejoin: round; }
.sdk-board .sdk-outside { font: 600 ${S * 0.42}px var(--font); fill: var(--text); text-anchor: middle; dominant-baseline: central; }
.sdk-board .sdk-lk { font-size: ${S * 0.32}px; }
.sdk-board .sdk-edge { font: 500 ${S * 0.3}px var(--font); fill: var(--text-dim); text-anchor: middle; dominant-baseline: central; }
.sdk-board .sdk-lk-arrow { fill: none; stroke: var(--text); stroke-width: 2.5; stroke-linecap: round; }
`;

const settings = defineSchema({
  candidateGrid: { type: "bool", label: "show auto candidates in fixed positions", default: true },
  shiftCorner: { type: "bool", label: "shift + digit writes a corner mark", default: true },
});

export interface SudokuViewHooks {
  /** After every render; plugin ui() can draw into `layers.overlay`. */
  render: HookEvent<{ svg: SVGSVGElement; layers: Record<string, SVGGElement>; S: number }>;
}

/** Corner-mark slots as (x, y) fractions of the cell: corners first, then edges. */
const CORNER_SLOTS: [number, number][] = [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8], [0.5, 0.2], [0.5, 0.8], [0.2, 0.5], [0.8, 0.5], [0.5, 0.5]];

function margins(p: LatinPuzzle): Required<Margins> {
  const out = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const c of p.constraints) {
    const mg = constraintTypes.get(c.type)?.margin?.(c, p.n);
    if (!mg) continue;
    for (const k of ["top", "right", "bottom", "left"] as const) out[k] = Math.max(out[k], mg[k] ?? 0);
  }
  return out;
}

/** Cell index → region id from "box" houses, or null when there are none. */
function regionMap(p: LatinPuzzle): number[] | null {
  const m = modelOf(p);
  const ids = Array.from({ length: m.size }, () => -1);
  let any = false;
  m.houses.forEach((hs, i) => {
    if (hs.kind !== "box") return;
    any = true;
    for (const c of hs.cells) ids[c] = i;
  });
  return any ? ids : null;
}

/** Cells a focus refers to: what it marks, else where it says to look. */
export function focusCells(focus: unknown): number[] {
  const f = focus as Partial<HintFocus> | null | undefined;
  if (!f || typeof f !== "object") return [];
  const out = new Set<number>([...(f.cells ?? []), ...(f.place ?? []).map(([c]) => c), ...(f.eliminate ?? []).map(([c]) => c)]);
  if (!out.size) for (const a of f.areas ?? []) for (const c of a) out.add(c);
  return [...out];
}

/** Cells whose digit, marks or colours differ between two states. */
export function changedCells(a: GridState, b: GridState): number[] {
  const out: number[] = [];
  for (let c = 0; c < a.values.length; c++) {
    if (a.values[c] !== b.values[c] || a.center[c] !== b.center[c] || a.corner[c] !== b.corner[c] || a.struck[c] !== b.struck[c] || a.colors[c] !== b.colors[c]) out.push(c);
  }
  return out;
}

type Side = "top" | "right" | "bottom" | "left";

/** The shared board conventions the view needs: which edges carry row and column labels. */
export interface BoardPrefs {
  labelSides(): Set<Side>;
}

const noLabels: BoardPrefs = { labelSides: () => new Set() };

/** Extra margin (in cells) for an edge label band. */
const LABEL_BAND = 0.45;

const CONTROLS = [
  { how: "click or tap a cell", what: "select it" },
  { how: "drag across cells, or shift-click", what: "select several (ctrl-click a selected cell to drop it)" },
  { how: "type a digit, or tap it on the pad", what: "write it in the selected cells: as the answer, a corner or centre mark, or a colour, depending on the input mode" },
  { how: "double-click a cell", what: "select every cell with the same digit" },
  { how: "shift + a digit key", what: "write a corner mark, whatever the input mode" },
];

export function latinView(board: BoardPrefs = noLabels, puzzleId = "sudoku"): View<LatinPuzzle, GridState, GridAction, GridInteraction> {
  return {
    id: `${puzzleId}.svg`,
    name: "grid",
    puzzle: puzzleId,
    settings,
    controls: CONTROLS,
    legend: legendFor,
    mount(root, { session, settings: cfg }) {
      style("sudoku", CSS);
      const p = session.puzzle;
      const n = p.n, size = n * n;
      const sides = board.labelSides();
      const clueMg = margins(p);
      const mg = { ...clueMg };
      for (const sd of sides) mg[sd] += LABEL_BAND;
      const pad = 6;
      const vb = [-mg.left * S - pad, -mg.top * S - pad, (n + mg.left + mg.right) * S + 2 * pad, (n + mg.top + mg.bottom) * S + 2 * pad];
      const svg = s("svg", { viewBox: vb.join(" "), class: "sdk-board", role: "grid", "aria-label": `${n} by ${n} grid` });
      const layerNames = ["colors", "cells", "under", "grid", "over", "outside", "marks", "values", "hints", "selection", "overlay"] as const;
      const layers = Object.fromEntries(layerNames.map((k) => [k, s("g", { class: `layer-${k}` })])) as Record<(typeof layerNames)[number], SVGGElement>;
      for (const k of layerNames) svg.append(layers[k]);

      const xy = (c: number): [number, number] => [(c % n) * S, Math.floor(c / n) * S];
      const cellRects = Array.from({ length: size }, (_, c) => {
        const [x, y] = xy(c);
        const r = s("rect", { x, y, width: S, height: S, class: "cell" });
        layers.cells.append(r);
        return r;
      });

      const regions = regionMap(p);
      let thin = "", thick = "";
      for (let i = 1; i < n; i++) thin += `M${i * S} 0V${n * S}M0 ${i * S}H${n * S}`;
      for (let c = 0; c < size; c++) {
        const [x, y] = xy(c);
        const right = c % n < n - 1 ? c + 1 : -1, down = c + n < size ? c + n : -1;
        if (regions && right >= 0 && regions[c] !== regions[right]) thick += `M${x + S} ${y}V${y + S}`;
        if (regions && down >= 0 && regions[c] !== regions[down]) thick += `M${x} ${y + S}H${x + S}`;
      }
      thick += `M0 0H${n * S}V${n * S}H0Z`;
      layers.grid.append(s("path", { d: thin, class: "thin" }), s("path", { d: thick, class: "thick" }));

      const reserved = new Set<number>();
      const rctx: RenderCtx = {
        n, S,
        layer: { under: layers.under, over: layers.over, outside: layers.outside },
        svg: s,
        center: (c) => [(c % n) * S + S / 2, Math.floor(c / n) * S + S / 2],
        at: (r, c) => [c * S + S / 2, r * S + S / 2],
        reserveCorner: (c) => reserved.add(c),
      };
      for (const spec of p.constraints) {
        try {
          constraintTypes.get(spec.type)?.render?.(spec, rctx);
        } catch (e) {
          console.error(`[sudoku] rendering ${spec.type} failed`, e);
        }
      }

      // row and column labels sit outside any clues on that edge
      const edgeLabel = (x: number, y: number, text: string) => layers.outside.append(s("text", { x, y, class: "sdk-edge" }, text));
      for (let i = 0; i < n; i++) {
        const mid = i * S + S / 2;
        if (sides.has("top")) edgeLabel(mid, -(clueMg.top + LABEL_BAND / 2) * S, colName(i));
        if (sides.has("bottom")) edgeLabel(mid, (n + clueMg.bottom + LABEL_BAND / 2) * S, colName(i));
        if (sides.has("left")) edgeLabel(-(clueMg.left + LABEL_BAND / 2) * S, mid, String(i + 1));
        if (sides.has("right")) edgeLabel((n + clueMg.right + LABEL_BAND / 2) * S, mid, String(i + 1));
      }

      const valueTexts = Array.from({ length: size }, (_, c) => {
        const [x, y] = xy(c);
        const t = s("text", { x: x + S / 2, y: y + S / 2 + 2, class: "value" });
        layers.values.append(t);
        return t;
      });
      const markGroups = Array.from({ length: size }, () => {
        const g = s("g");
        layers.marks.append(g);
        return g;
      });
      const colorGroups = Array.from({ length: size }, () => {
        const g = s("g", { class: "color" });
        layers.colors.append(g);
        return g;
      });
      const markKeys: string[] = Array.from({ length: size }, () => "");
      const colorKeys: number[] = Array.from({ length: size }, () => 0);
      const openPath = s("path", { class: "open" });
      const selOutline = s("path", { class: "sel-outline" });
      const cursorRect = s("rect", { width: S - 14, height: S - 14, rx: 6, class: "cursor" });
      layers.selection.append(openPath, selOutline, cursorRect);
      root.append(svg);

      const hooks: SudokuViewHooks = { render: new HookEvent("render") };

      const render = () => {
        const st = session.state;
        const it = session.interaction;
        const d = session.derived();
        const sel = new Set(it.selection);
        const conflicts = new Set((d[CONFLICTS] as number[] | undefined) ?? []);
        const mistakes = new Set((d[MISTAKES] as number[] | undefined) ?? []);
        const peers = new Set((d[PEERS] as number[] | undefined) ?? []);
        const same = d[SAME] as SameDigit | undefined;
        const sameCells = new Set(same?.cells ?? []);
        const cands = d[CANDIDATES] as number[] | undefined;
        const raw = session.activeHint?.focus as Partial<HintFocus> | undefined;
        const hint = raw && typeof raw === "object" ? raw : undefined;
        const hintCells = new Set(hint?.cells ?? []);
        const hintArea = new Set((hint?.areas ?? []).flat());

        for (let c = 0; c < size; c++) {
          const cl = cellRects[c]!.classList;
          cl.toggle("sel", sel.has(c));
          cl.toggle("same", sameCells.has(c) && !sel.has(c));
          cl.toggle("peer", peers.has(c) && !sel.has(c));
          cl.toggle("hint", hintCells.has(c));
          cl.toggle("hint-area", hintArea.has(c) && !hintCells.has(c));

          const v = st.values[c]!;
          const t = valueTexts[c]!;
          const txt = v ? String(v) : "";
          if (t.textContent !== txt) t.textContent = txt;
          t.classList.toggle("entered", v > 0 && !p.givens[c]);
          t.classList.toggle("conflict", conflicts.has(c));
          t.classList.toggle("mistake", mistakes.has(c));

          if (colorKeys[c] !== st.colors[c]) {
            colorKeys[c] = st.colors[c]!;
            const g = colorGroups[c]!;
            clear(g);
            const ids = digits(st.colors[c]!);
            const [x, y] = xy(c);
            ids.forEach((id, i) => g.append(s("rect", {
              x: x + (S * i) / ids.length, y, width: S / ids.length, height: S, style: `fill: ${colorVar(id)}`,
            })));
          }

          const lit = same?.marks ? same.digit : 0;
          let key: string;
          if (v) key = "";
          else {
            const cm = cands ? cands[c]! : st.center[c]!;
            key = `${cands ? "a" : "m"}${cm}|${st.corner[c]}|${lit}`;
          }
          if (markKeys[c] !== key) {
            markKeys[c] = key;
            const g = markGroups[c]!;
            clear(g);
            if (!v) drawMarks(g, c, cands ? cands[c]! : st.center[c]!, !!cands, st.corner[c]!, lit);
          }
        }

        clear(layers.hints);
        for (const [c, dg] of hint?.place ?? []) {
          const [x, y] = xy(c);
          layers.hints.append(s("text", { x: x + S / 2, y: y + S / 2 + 2, class: "hint-place" }, String(dg)));
        }
        for (const [c, mask] of hint?.eliminate ?? []) {
          const [x, y] = xy(c);
          for (const dg of digits(mask)) {
            const [fx, fy] = candidateSlot(dg, c);
            layers.hints.append(s("text", { x: x + fx * S, y: y + fy * S, class: "hint-elim" }, String(dg)));
          }
        }

        openPath.setAttribute("d", (same?.open ?? []).map((c) => {
          const [x, y] = xy(c);
          return `M${x + 6} ${y + 6}h${S - 12}v${S - 12}h${-(S - 12)}Z`;
        }).join(""));
        selOutline.setAttribute("d", it.selection.length ? insetOutline(n, S, it.selection, 3) : "");
        const [cx, cy] = xy(it.cursor);
        cursorRect.setAttribute("x", String(cx + 7));
        cursorRect.setAttribute("y", String(cy + 7));
        hooks.render.call({ svg, layers, S });
      };

      /** Fixed position of a candidate digit, kept clear of a clue label in the top-left corner. */
      function candidateSlot(dg: number, cell: number): [number, number] {
        const side = n <= 4 ? 2 : 3;
        const i = dg - 1;
        const top = reserved.has(cell) ? 0.24 : 0.08;
        return [(0.5 + (i % side)) / side * 0.84 + 0.08, (0.5 + Math.floor(i / side)) / side * (0.92 - top) + top];
      }

      function drawMarks(g: SVGGElement, c: number, center: number, auto: boolean, corner: number, lit: number): void {
        const [x, y] = xy(c);
        if (center) {
          if (auto && cfg.candidateGrid) {
            for (const dg of digits(center)) {
              const [fx, fy] = candidateSlot(dg, c);
              g.append(s("text", { x: x + fx * S, y: y + fy * S, class: `cand${dg === lit ? " lit" : ""}` }, String(dg)));
            }
          } else {
            const ds = digits(center);
            const t = s("text", { x: x + S / 2, y: y + S / 2 + 1, class: "center-mark" });
            if (ds.length > 5) t.style.fontSize = `${S * (ds.length > 7 ? 0.16 : 0.19)}px`;
            for (const dg of ds) t.append(s("tspan", dg === lit ? { class: "lit" } : null, String(dg)));
            g.append(t);
          }
        }
        if (corner) {
          const slots = reserved.has(c) ? CORNER_SLOTS.slice(1) : CORNER_SLOTS;
          digits(corner).forEach((dg, i) => {
            const [fx, fy] = slots[Math.min(i, slots.length - 1)]!;
            g.append(s("text", { x: x + fx * S, y: y + fy * S, class: `corner-mark${dg === lit ? " lit" : ""}` }, String(dg)));
          });
        }
      }

      // --- pointer ---

      const toCell = (e: { clientX: number; clientY: number }, inner: number): number => {
        const ctm = svg.getScreenCTM();
        if (!ctm) return -1;
        const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
        const fx = pt.x / S, fy = pt.y / S;
        const col = Math.floor(fx), row = Math.floor(fy);
        if (col < 0 || row < 0 || col >= n || row >= n) return -1;
        const ix = fx - col, iy = fy - row;
        if (inner > 0 && (ix < inner || ix > 1 - inner || iy < inner || iy > 1 - inner)) return -1;
        return row * n + col;
      };

      let drag: "add" | "remove" | null = null;
      let lastTap = { cell: -1, t: 0 };
      const onDown = (e: PointerEvent) => {
        const cell = toCell(e, 0);
        if (e.button === 2) {
          // the context menu acts on the selection, so a right click outside it selects that cell first
          if (cell >= 0 && !session.interaction.selection.includes(cell)) setSelection(session, [cell], cell);
          return;
        }
        if (e.button !== 0) return;
        const multi = e.ctrlKey || e.metaKey || e.shiftKey;
        if (cell < 0) {
          if (!multi) setSelection(session, []);
          return;
        }
        e.preventDefault();
        svg.setPointerCapture(e.pointerId);
        const now = performance.now();
        if (!multi && lastTap.cell === cell && now - lastTap.t < 350) {
          lastTap = { cell: -1, t: 0 };
          selectSame(session, cell);
          return;
        }
        lastTap = { cell, t: now };
        const sel = session.interaction.selection;
        if (multi && (e.ctrlKey || e.metaKey) && sel.includes(cell)) {
          drag = "remove";
          setSelection(session, sel.filter((c) => c !== cell), cell);
        } else if (multi) {
          drag = "add";
          if (!sel.includes(cell)) setSelection(session, [...sel, cell], cell);
        } else {
          drag = "add";
          setSelection(session, [cell], cell);
        }
      };
      const onMove = (e: PointerEvent) => {
        if (!drag) return;
        const cell = toCell(e, 0.12);
        if (cell < 0) return;
        const sel = session.interaction.selection;
        if (drag === "add" && !sel.includes(cell)) setSelection(session, [...sel, cell], cell);
        else if (drag === "remove" && sel.includes(cell)) setSelection(session, sel.filter((c) => c !== cell), cell);
      };
      const onUp = () => {
        drag = null;
      };
      // shift + digit arrives as a symbol ("!", "@", …) that key bindings can't name, so it is read by physical key
      const onKey = (e: KeyboardEvent) => {
        if (!cfg.shiftCorner || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target as HTMLElement | null;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
        if (!m) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        input(session, Number(m[1]), "corner");
      };
      window.addEventListener("keydown", onKey, true);
      svg.addEventListener("pointerdown", onDown);
      svg.addEventListener("pointermove", onMove);
      svg.addEventListener("pointerup", onUp);
      svg.addEventListener("pointercancel", onUp);

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(render, { owner: "view" }),
      ];
      render();

      const rects = (cells: Iterable<number>) => [...cells].map((c) => cellRects[c]!.getBoundingClientRect());
      const cellAt = (e: Event | undefined): number =>
        e instanceof MouseEvent && svg.contains(e.target as Node) ? toCell(e, 0) : -1;

      return {
        aspect: vb[2]! / vb[3]!,
          locate: (focus) => rects(focusCells(focus)),
        locateChange: (a, b) => rects(changedCells(a as GridState, b as GridState)),
        destroy() {
          offs.forEach((f) => f());
          window.removeEventListener("keydown", onKey, true);
          svg.remove();
        },
        commands: boardCommands(session, cellAt),
        hooks,
      };
    },
  };
}

/** The same view registered for each puzzle on the engine. */
export function viewFor(puzzleId: string, board?: BoardPrefs): View<LatinPuzzle, GridState, GridAction, GridInteraction> {
  return latinView(board, puzzleId);
}
