import { Event as HookEvent } from "../../core/hooks";
import { defineSchema } from "../../core/schema";
import type { BindingSchema, CommandHandler, View } from "../../core/types";
import { clear, h, s, style } from "../../ui/dom";
import { bit, digits } from "./engine/bits";
import { insetOutline } from "./engine/constraints/draw";
import { modelOf } from "./engine/model";
import { constraintTypes } from "./engine/registry";
import type { Margins, RenderCtx } from "./engine/types";
import { CANDIDATES, CONFLICTS, COUNTS, INFO, MISTAKES, PEERS, SAME, type SameDigit } from "./keys";
import type { GridAction, GridInteraction, GridState, HintFocus, InputMode, LatinPuzzle } from "./puzzle";

const S = 100;
const MODES: readonly { id: InputMode; label: string }[] = [
  { id: "digit", label: "digit" },
  { id: "corner", label: "corner" },
  { id: "center", label: "centre" },
  { id: "color", label: "colour" },
];

const CSS = `
.sdk { display: flex; gap: 20px; width: 100%; height: 100%; align-items: center; justify-content: center; }
.sdk-boardwrap { flex: 1 1 auto; min-width: 0; height: 100%; display: flex; align-items: center; justify-content: center; }
.sdk-board { width: 100%; height: 100%; max-height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; display: block; }
.sdk-side { flex: 0 0 220px; display: flex; flex-direction: column; gap: 10px; max-height: 100%; overflow-y: auto; }
.sdk-modes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.sdk-modes button { padding: 6px 2px; font-size: 13px; }
.sdk-modes button[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); }
.sdk-pad { display: grid; gap: 6px; }
.sdk-pad button { position: relative; aspect-ratio: 1; font-size: 22px; padding: 0; display: flex; align-items: center; justify-content: center; }
.sdk-pad button.done { opacity: 0.35; }
.sdk-pad button small { position: absolute; right: 5px; bottom: 3px; font-size: 11px; color: var(--text-dim); }
.sdk-pad .swatch { width: 60%; height: 60%; border-radius: 4px; }
.sdk-pad[data-mode="corner"] button span { font-size: 13px; align-self: flex-start; justify-self: flex-start; position: absolute; left: 6px; top: 3px; }
.sdk-pad[data-mode="center"] button span { font-size: 14px; }
.sdk-actions { display: flex; gap: 6px; }
.sdk-actions button { flex: 1; }
.sdk-info { font-size: 13px; color: var(--text-dim); display: flex; flex-direction: column; gap: 2px; font-family: var(--mono); }
.sdk-info:empty { display: none; }
.sdk-rules { font-size: 13px; color: var(--text-dim); }
.sdk-rules summary { cursor: pointer; }
.sdk-rules ul { margin: 6px 0 0 16px; display: flex; flex-direction: column; gap: 4px; }

.sdk-board .cell { fill: transparent; }
.sdk-board .cell.peer { fill: rgba(255, 255, 255, 0.045); }
.sdk-board .cell.same { fill: rgba(140, 204, 255, 0.16); }
.sdk-board .cell.sel { fill: rgba(140, 204, 255, 0.28); }
.sdk-board .cell.hint-area { fill: rgba(204, 136, 255, 0.08); }
.sdk-board .cell.hint { fill: var(--hint-soft); }
.sdk-board .cell.conflict { fill: var(--danger-soft); }
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
.sdk-board .sdk-lk-arrow { fill: none; stroke: var(--text); stroke-width: 2.5; stroke-linecap: round; }
@media (max-width: 760px) {
  .sdk { flex-direction: column; gap: 8px; height: auto; justify-content: flex-start; }
  .sdk-boardwrap { width: 100%; height: auto; flex: 0 0 auto; }
  .sdk-board { height: auto; max-height: 62svh; }
  .sdk-side { flex: 0 0 auto; width: 100%; max-width: 480px; overflow: visible; max-height: none; }
  .sdk-pad { grid-template-columns: repeat(var(--pad-cols-narrow), 1fr) !important; gap: 4px; }
  .sdk-pad button { aspect-ratio: auto; height: 46px; font-size: 20px; }
}
`;

/** Cell colour palette (ids 1..9). */
export const PALETTE = [
  "", "rgba(214, 214, 214, 0.45)", "rgba(120, 120, 120, 0.55)", "rgba(40, 40, 40, 0.8)",
  "rgba(170, 230, 120, 0.4)", "rgba(240, 140, 220, 0.4)", "rgba(250, 160, 80, 0.4)",
  "rgba(240, 90, 90, 0.4)", "rgba(250, 230, 100, 0.4)", "rgba(110, 170, 250, 0.45)",
];

const settings = defineSchema({
  modifiers: { type: "bool", label: "shift / ctrl + digit write corner / centre marks", default: true },
  candidateGrid: { type: "bool", label: "show auto candidates in fixed positions", default: true },
  pad: { type: "bool", label: "show digit pad", default: true },
  rules: { type: "bool", label: "show rules", default: true },
});

const bindings: BindingSchema = {
  ...Object.fromEntries([...Array(9).keys()].map((i) => [`sudoku.d${i + 1}`, { label: `Enter ${i + 1}`, category: "Sudoku", keys: [String(i + 1)] }])),
  "sudoku.clear": { label: "Erase", category: "Sudoku", keys: ["delete", "backspace", "0"] },
  "sudoku.mode-digit": { label: "Digit mode", category: "Sudoku", keys: ["z"] },
  "sudoku.mode-corner": { label: "Corner mark mode", category: "Sudoku", keys: ["x"] },
  "sudoku.mode-center": { label: "Centre mark mode", category: "Sudoku", keys: ["c"] },
  "sudoku.mode-color": { label: "Colour mode", category: "Sudoku", keys: ["v"] },
  "sudoku.mode-next": { label: "Next mode", category: "Sudoku", keys: ["space"] },
  "sudoku.up": { label: "Move up", category: "Sudoku", keys: ["arrowup", "w"] },
  "sudoku.down": { label: "Move down", category: "Sudoku", keys: ["arrowdown", "s"] },
  "sudoku.left": { label: "Move left", category: "Sudoku", keys: ["arrowleft", "a"] },
  "sudoku.right": { label: "Move right", category: "Sudoku", keys: ["arrowright", "d"] },
  "sudoku.extend-up": { label: "Extend selection up", category: "Sudoku", keys: ["shift+arrowup"] },
  "sudoku.extend-down": { label: "Extend selection down", category: "Sudoku", keys: ["shift+arrowdown"] },
  "sudoku.extend-left": { label: "Extend selection left", category: "Sudoku", keys: ["shift+arrowleft"] },
  "sudoku.extend-right": { label: "Extend selection right", category: "Sudoku", keys: ["shift+arrowright"] },
  "sudoku.select-all": { label: "Select all", category: "Sudoku", keys: ["$mod+a"] },
  "sudoku.select-same": { label: "Select cells with the same digit", category: "Sudoku", keys: ["e"] },
  "sudoku.deselect": { label: "Clear selection", category: "Sudoku", keys: ["escape"] },
};

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

function rulesList(p: LatinPuzzle): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of p.constraints) {
    const t = constraintTypes.get(c.type);
    if (!t?.rule || seen.has(t.type)) continue;
    seen.add(t.type);
    out.push(t.rule);
  }
  return out;
}

export const sudokuView: View<LatinPuzzle, GridState, GridAction, GridInteraction> = {
  id: "sudoku.svg",
  name: "grid",
  puzzle: "sudoku",
  settings,
  bindings,
  mount(root, { session, settings: cfg }) {
    style("sudoku", CSS);
    const p = session.puzzle;
    const n = p.n, size = n * n;
    const mg = margins(p);
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

    // grid lines
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

    // constraints
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
    const selOutline = s("path", { class: "sel-outline" });
    layers.selection.append(selOutline);

    // side panel
    const side = h("div", { class: "sdk-side" });
    const modeBar = h("div", { class: "sdk-modes", role: "group", "aria-label": "input mode" });
    const modeButtons = MODES.map((md) => {
      const b = h("button", { "aria-pressed": "false", onclick: () => setMode(md.id) }, md.label);
      modeBar.append(b);
      return b;
    });
    const padGrid = h("div", { class: "sdk-pad" });
    const cols = n <= 4 ? 2 : 3;
    padGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    padGrid.style.setProperty("--pad-cols-narrow", String(n));
    const padButtons = Array.from({ length: n }, (_, i) => {
      const b = h("button", {
        "aria-label": String(i + 1),
        onpointerdown: (e: PointerEvent) => e.preventDefault(),
        onclick: () => input(i + 1, null),
      });
      padGrid.append(b);
      return b;
    });
    const info = h("div", { class: "sdk-info", "aria-live": "polite" });
    const actions = h("div", { class: "sdk-actions" },
      h("button", { onpointerdown: (e: PointerEvent) => e.preventDefault(), onclick: () => erase() }, "erase"));
    if (cfg.pad) side.append(modeBar, padGrid, actions);
    side.append(info);
    if (cfg.rules) {
      const rules = rulesList(p);
      if (rules.length) side.append(h("details", { class: "sdk-rules" }, h("summary", null, "rules"), h("ul", null, rules.map((r) => h("li", null, r)))));
    }
    const wrap = h("div", { class: "sdk-boardwrap" }, svg);
    const container = h("div", { class: "sdk" }, wrap, side);
    root.append(container);

    const hooks: SudokuViewHooks = { render: new HookEvent("render") };

    // --- render ---

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
      const hint = session.activeHint?.focus as HintFocus | undefined;
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
            x: x + (S * i) / ids.length, y, width: S / ids.length, height: S, fill: PALETTE[id],
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
      if (hint) {
        for (const [c, dg] of hint.place) {
          const [x, y] = xy(c);
          layers.hints.append(s("text", { x: x + S / 2, y: y + S / 2 + 2, class: "hint-place" }, String(dg)));
        }
        for (const [c, mask] of hint.eliminate) {
          const [x, y] = xy(c);
          for (const dg of digits(mask)) {
            const [fx, fy] = candidateSlot(dg, c);
            layers.hints.append(s("text", { x: x + fx * S, y: y + fy * S, class: "hint-elim" }, String(dg)));
          }
        }
      }

      selOutline.setAttribute("d", it.selection.length ? insetOutline(n, S, it.selection, 3) : "");

      modeButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(MODES[i]!.id === it.mode)));
      padGrid.dataset.mode = it.mode;
      const counts = d[COUNTS] as number[] | undefined;
      padButtons.forEach((b, i) => {
        const dg = i + 1;
        const k = `${it.mode}|${counts ? counts[dg] : -1}`;
        if (b.dataset.k === k) return;
        b.dataset.k = k;
        clear(b);
        if (it.mode === "color") {
          if (dg <= 9) b.append(h("span", { class: "swatch", style: `background:${PALETTE[dg]}` }));
          b.classList.remove("done");
          return;
        }
        b.append(h("span", null, String(dg)));
        if (counts) {
          const left = n - counts[dg]!;
          b.classList.toggle("done", left <= 0);
          if (left > 0) b.append(h("small", null, String(left)));
        } else b.classList.remove("done");
      });

      const lines = (d[INFO] as string[] | undefined) ?? [];
      const infoKey = lines.join("\n");
      if (info.dataset.k !== infoKey) {
        info.dataset.k = infoKey;
        clear(info);
        for (const l of lines) info.append(h("div", null, l));
      }
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

    // --- input ---

    const setSelection = (cells: number[], cursor?: number) => {
      session.setInteraction((i) => ({ ...i, selection: cells, cursor: cursor ?? i.cursor }));
    };

    const setMode = (mode: InputMode) => session.setInteraction((i) => (i.mode === mode ? i : { ...i, mode }));

    function shownCenter(c: number): number {
      const cands = session.derived()[CANDIDATES] as number[] | undefined;
      return cands ? cands[c]! : session.state.center[c]!;
    }

    function input(dg: number, override: InputMode | null): void {
      if (dg < 1 || dg > n) return;
      const st = session.state;
      const it = session.interaction;
      const mode = override ?? it.mode;
      const sel = it.selection;
      if (!sel.length) return;
      if (mode === "color") {
        if (dg > 9) return;
        const on = !sel.every((c) => st.colors[c]! & bit(dg));
        session.dispatch({ type: "color", cells: sel, color: dg, on });
        return;
      }
      if (mode === "digit") {
        const cells = sel.filter((c) => !p.givens[c]);
        if (!cells.length) return;
        const all = cells.every((c) => st.values[c] === dg);
        session.dispatch({ type: "set", cells, digit: all ? 0 : dg });
        return;
      }
      const cells = sel.filter((c) => !p.givens[c] && !st.values[c]);
      if (!cells.length) return;
      const has = (c: number) => ((mode === "center" ? shownCenter(c) : st.corner[c]!) & bit(dg)) !== 0;
      session.dispatch({ type: "mark", layer: mode, cells, digit: dg, on: !cells.every(has) });
    }

    function erase(): void {
      const st = session.state;
      const it = session.interaction;
      const cells = it.selection;
      if (!cells.length) return;
      const hasValue = cells.some((c) => !p.givens[c] && st.values[c]);
      const hasMarks = cells.some((c) => st.center[c] || st.corner[c] || st.struck[c]);
      const hasColor = cells.some((c) => st.colors[c]);
      const layer = it.mode === "color" && hasColor ? "colors" : hasValue ? "values" : hasMarks ? "marks" : hasColor ? "colors" : null;
      if (layer) session.dispatch({ type: "clear", cells, layer });
    }

    function move(dr: number, dc: number, extend: boolean): void {
      const it = session.interaction;
      const r = (Math.floor(it.cursor / n) + dr + n) % n, c = (it.cursor % n + dc + n) % n;
      const next = r * n + c;
      if (extend) setSelection(it.selection.includes(next) ? it.selection : [...it.selection, next], next);
      else setSelection([next], next);
    }

    function selectSame(cell: number): void {
      const v = session.state.values[cell]!;
      if (!v) return setSelection([cell], cell);
      setSelection([...Array(size).keys()].filter((c) => session.state.values[c] === v), cell);
    }

    const toCell = (e: PointerEvent, inner: number): number => {
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
      if (e.button !== 0) return;
      const cell = toCell(e, 0);
      const multi = e.ctrlKey || e.metaKey || e.shiftKey;
      if (cell < 0) {
        if (!multi) setSelection([]);
        return;
      }
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      const now = performance.now();
      if (!multi && lastTap.cell === cell && now - lastTap.t < 350) {
        lastTap = { cell: -1, t: 0 };
        selectSame(cell);
        return;
      }
      lastTap = { cell, t: now };
      const sel = session.interaction.selection;
      if (multi && (e.ctrlKey || e.metaKey) && sel.includes(cell)) {
        drag = "remove";
        setSelection(sel.filter((c) => c !== cell), cell);
      } else if (multi) {
        drag = "add";
        if (!sel.includes(cell)) setSelection([...sel, cell], cell);
      } else {
        drag = "add";
        setSelection([cell], cell);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const cell = toCell(e, 0.12);
      if (cell < 0) return;
      const sel = session.interaction.selection;
      if (drag === "add" && !sel.includes(cell)) setSelection([...sel, cell], cell);
      else if (drag === "remove" && sel.includes(cell)) setSelection(sel.filter((c) => c !== cell), cell);
    };
    const onUp = () => {
      drag = null;
    };
    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onUp);

    // shift/ctrl/alt + digit: the keybinding layer can't see these (the key becomes "!" etc.), so read the physical key.
    const onKey = (e: KeyboardEvent) => {
      if (!cfg.modifiers) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (!m) return;
      const override: InputMode | null = e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey ? "corner"
        : (e.ctrlKey || e.metaKey) && !e.shiftKey ? "center"
          : e.altKey && !e.shiftKey ? "color" : null;
      if (!override) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      input(Number(m[1]), override);
    };
    window.addEventListener("keydown", onKey, true);

    const offs = [
      session.hooks.change.tap(render, { owner: "view" }),
      session.hooks.interaction.tap(render, { owner: "view" }),
      session.hooks.refresh.tap(render, { owner: "view" }),
    ];
    render();

    const handlers: Record<string, CommandHandler> = {
      ...Object.fromEntries([...Array(9).keys()].map((i) => [`sudoku.d${i + 1}`, () => input(i + 1, null)])),
      "sudoku.clear": () => erase(),
      "sudoku.mode-digit": () => setMode("digit"),
      "sudoku.mode-corner": () => setMode("corner"),
      "sudoku.mode-center": () => setMode("center"),
      "sudoku.mode-color": () => setMode("color"),
      "sudoku.mode-next": () => {
        const i = MODES.findIndex((md) => md.id === session.interaction.mode);
        setMode(MODES[(i + 1) % MODES.length]!.id);
      },
      "sudoku.up": () => move(-1, 0, false),
      "sudoku.down": () => move(1, 0, false),
      "sudoku.left": () => move(0, -1, false),
      "sudoku.right": () => move(0, 1, false),
      "sudoku.extend-up": () => move(-1, 0, true),
      "sudoku.extend-down": () => move(1, 0, true),
      "sudoku.extend-left": () => move(0, -1, true),
      "sudoku.extend-right": () => move(0, 1, true),
      "sudoku.select-all": () => setSelection([...Array(size).keys()]),
      "sudoku.select-same": () => selectSame(session.interaction.cursor),
      "sudoku.deselect": () => setSelection([]),
    };

    return {
      destroy() {
        offs.forEach((f) => f());
        window.removeEventListener("keydown", onKey, true);
        container.remove();
      },
      handlers,
      hooks,
    };
  },
};

/** The same view registered for each puzzle on the engine. */
export function viewFor(puzzleId: string): View<LatinPuzzle, GridState, GridAction, GridInteraction> {
  return puzzleId === "sudoku" ? sudokuView : { ...sudokuView, id: `${puzzleId}.svg`, puzzle: puzzleId, bindings: sudokuView.bindings };
}

