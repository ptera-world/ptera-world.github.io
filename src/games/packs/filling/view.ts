import { bindCommands, type BindingSchema } from "../../core/commands";
import { s, style } from "../../core/dom";
import type { CommandDef, View } from "../../core/types";
import { bit, isSingle, valueOf } from "../../lib/grid-kit/csp";
import type { Focus } from "../../lib/grid-kit/names";
import {
  KIT_CSS, SIZE, cursorRect, drawFocus, focusCells, focusLegend, frame, sample, sampleCell,
  type BoardPrefs,
} from "../../lib/grid-kit/view";
import {
  geometry, shownNumbers,
  type FillingAction, type FillingConflicts, type FillingInteraction, type FillingPuzzle, type FillingState,
} from "./logic";

/** Derived: FillingConflicts to flag on the board. */
export const CONFLICTS_KEY = "filling.conflicts";

const CSS = `
.filling-board .sel { fill: var(--accent-soft); }
.filling-board .bad { fill: var(--danger-soft); }
.filling-board .num { fill: var(--accent); font: 500 6px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.filling-board .num.given { fill: var(--text); font-weight: 700; }
.filling-board .num.bad { fill: var(--danger); }
.filling-board .pencil { fill: var(--text-dim); font: 500 2.6px var(--font); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.filling-board .border { stroke: var(--text); stroke-width: 0.9; stroke-linecap: round; }
.filling-board .rim { fill: none; stroke: var(--text); stroke-width: 0.9; }
`;

/** Commands the number pad widget runs; ids are `filling.d<n>`, `filling.clear`, `filling.notes`. */
export const digitCommand = (n: number): string => `filling.d${n}`;

function bindings(top: number): BindingSchema {
  const out: BindingSchema = {};
  for (let n = 1; n <= top; n++) out[digitCommand(n)] = { label: `${n}`, category: "filling", keys: [String(n)], description: `put ${n} in the selected cells (or toggle it as a note while notes are on)` };
  out["filling.clear"] = { label: "clear cells", category: "filling", keys: ["Backspace", "Delete", "0"], description: "rub out the numbers and notes in the selected cells" };
  out["filling.notes"] = { label: "notes on / off", category: "filling", keys: ["n"], description: "while on, typing a number toggles it as a small note instead of placing it" };
  for (const [id, label, key] of [["left", "cursor left", "ArrowLeft"], ["right", "cursor right", "ArrowRight"], ["up", "cursor up", "ArrowUp"], ["down", "cursor down", "ArrowDown"]] as const) {
    out[`filling.${id}`] = { label, category: "filling", keys: [key], description: `move the selection one cell ${id}` };
    out[`filling.extend-${id}`] = { label: `extend selection ${id}`, category: "filling", keys: [`shift+${key}`], description: `add the cell ${id === "up" ? "above" : id === "down" ? "below" : `to the ${id}`} to the selection` };
  }
  return out;
}

function legend(): { sample: string; meaning: string }[] {
  const num = (n: number, weight: number, fill = "var(--text)") => `<text x="5" y="5.3" fill="${fill}" font-size="6" font-weight="${weight}" font-family="var(--font)" text-anchor="middle" dominant-baseline="central">${n}</text>`;
  return [
    { sample: sample(sampleCell() + num(3, 700)), meaning: "a number that came with the puzzle" },
    { sample: sample(sampleCell() + num(3, 500, "var(--accent)")), meaning: "a number you placed" },
    { sample: sample(sampleCell() + `<text x="2.5" y="2.5" fill="var(--text-dim)" font-size="2.6" text-anchor="middle" dominant-baseline="central">1</text><text x="7.5" y="2.5" fill="var(--text-dim)" font-size="2.6" text-anchor="middle" dominant-baseline="central">3</text>`), meaning: "notes: the numbers a cell could still be" },
    { sample: sample(sampleCell() + sampleCell(10) + num(2, 500) + `<text x="15" y="5.3" fill="var(--text)" font-size="6" font-family="var(--font)" text-anchor="middle" dominant-baseline="central">3</text><line x1="10" y1="0" x2="10" y2="10" stroke="var(--text)" stroke-width="0.9"/>`, 2), meaning: "a thick line between different numbers: a region border" },
    { sample: sample(`<rect width="10" height="10" fill="var(--accent-soft)" stroke="var(--border)" stroke-width="0.25"/>`), meaning: "selected: typed numbers go here" },
    { sample: sample(`<rect width="10" height="10" fill="var(--danger-soft)" stroke="var(--border)" stroke-width="0.25"/>` + num(2, 500, "var(--danger)")), meaning: "a group of numbers that's too big, or walled in too small" },
    ...focusLegend("the cells it changes", "the numbers it comes from", "other cells it mentions"),
  ];
}

export function fillingView(board: BoardPrefs): View<FillingPuzzle, FillingState, FillingAction, FillingInteraction> {
  return {
    id: "filling.svg",
    name: "grid",
    puzzle: "filling",
    controls: [
      { how: "click or tap a cell", what: "select it; drag to select several. type a number (or use the number pad) to fill them" },
      { how: "shift-click", what: "add a cell to the selection" },
    ],
    legend: legend(),
    mount(root, { session }) {
      style("kit", KIT_CSS);
      style("filling", CSS);
      const p = session.puzzle;
      const g = geometry(p);
      const f = frame(root, p, "filling-board", "filling", board);
      const tint: SVGRectElement[] = [];
      for (let c = 0; c < g.n; c++) {
        const cell = s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, class: "cell" });
        f.base.append(cell);
        f.anchor(c, cell);
        f.base.append(tint[c] = s("rect", { x: f.cx(c), y: f.cy(c), width: SIZE, height: SIZE, visibility: "hidden" }));
      }
      const borders = s("g");
      f.marks.before(borders);
      f.over.before(s("rect", { x: 0, y: 0, width: p.w * SIZE, height: p.h * SIZE, class: "rim" }));
      const placeCursor = cursorRect(f);
      let preview: FillingState | null = null;
      let hover = -1;

      const drawCell = (el: Element, c: number, mask: number, bad: boolean) => {
        const x = f.cx(c), y = f.cy(c);
        if (p.clues[c]! > 0) {
          el.append(s("text", { x: x + SIZE / 2, y: y + SIZE / 2 + 0.3, class: `num given${bad ? " bad" : ""}` }, String(p.clues[c])));
        } else if (isSingle(mask)) {
          el.append(s("text", { x: x + SIZE / 2, y: y + SIZE / 2 + 0.3, class: `num${bad ? " bad" : ""}` }, String(valueOf(mask))));
        } else if (mask !== g.full) {
          for (let v = 1; v <= g.top; v++) {
            if (!(mask & bit(v))) continue;
            el.append(s("text", { x: x + 2 + ((v - 1) % 3) * 3, y: y + 2.2 + Math.floor((v - 1) / 3) * 3, class: "pencil" }, String(v)));
          }
        }
      };

      const render = () => {
        const doms = session.state.doms;
        const nums = shownNumbers(p, doms);
        const bad = new Set((session.derived()[CONFLICTS_KEY] as FillingConflicts | undefined)?.regions);
        const sel = new Set(session.interaction.selection);
        for (let c = 0; c < g.n; c++) {
          const cls = bad.has(c) ? "bad" : sel.has(c) ? "sel" : "";
          tint[c]!.setAttribute("class", cls);
          tint[c]!.setAttribute("visibility", cls ? "visible" : "hidden");
        }
        while (borders.firstChild) borders.firstChild.remove();
        for (let c = 0; c < g.n; c++) {
          for (const d of g.nbrs[c]!) {
            if (d < c || !nums[c] || !nums[d] || nums[c] === nums[d]) continue;
            const horiz = d === c + 1;
            const x = horiz ? f.cx(d) : f.cx(c), y = horiz ? f.cy(c) : f.cy(d);
            borders.append(s("line", { x1: x, y1: y, x2: horiz ? x : x + SIZE, y2: horiz ? y + SIZE : y, class: "border" }));
          }
        }
        while (f.marks.firstChild) f.marks.firstChild.remove();
        for (let c = 0; c < g.n; c++) drawCell(f.marks, c, doms[c]!, bad.has(c));
        while (f.ghost.firstChild) f.ghost.firstChild.remove();
        if (preview) for (let c = 0; c < g.n; c++) if (preview.doms[c] !== doms[c]) drawCell(f.ghost, c, preview.doms[c]!, false);
        while (f.over.firstChild) f.over.firstChild.remove();
        drawFocus(f.over, f, session.activeHint?.focus as Focus | undefined);
        placeCursor(session.interaction.cursor);
      };

      let pointerId = -1;
      const select = (c: number, add: boolean) =>
        session.setInteraction((i) => ({ ...i, cursor: c, selection: add ? (i.selection.includes(c) ? i.selection : [...i.selection, c]) : [c] }));
      const listeners: [string, EventListener][] = [
        ["pointerdown", ((ev: PointerEvent) => {
          const c = f.cellAt(ev);
          if (c < 0 || pointerId !== -1) return;
          ev.preventDefault();
          pointerId = ev.pointerId;
          f.svg.setPointerCapture?.(ev.pointerId);
          select(c, ev.shiftKey);
        }) as EventListener],
        ["pointermove", ((ev: PointerEvent) => {
          const c = f.cellAt(ev);
          if (ev.pointerId !== pointerId) {
            if (ev.pointerType !== "touch") hover = c;
            return;
          }
          if (c >= 0 && !session.interaction.selection.includes(c)) select(c, true);
        }) as EventListener],
        ["pointerup", ((ev: PointerEvent) => { if (ev.pointerId === pointerId) pointerId = -1; }) as EventListener],
        ["pointercancel", ((ev: PointerEvent) => { if (ev.pointerId === pointerId) pointerId = -1; }) as EventListener],
        ["pointerleave", ((ev: PointerEvent) => { if (ev.pointerType !== "touch") hover = -1; }) as EventListener],
      ];
      for (const [type, fn] of listeners) f.svg.addEventListener(type, fn);

      const offs = [
        session.hooks.change.tap(render, { owner: "view" }),
        session.hooks.interaction.tap(render, { owner: "view" }),
        session.hooks.refresh.tap(render, { owner: "view" }),
      ];
      render();

      const targets = () => {
        const sel = session.interaction.selection;
        return (sel.length ? sel : [session.interaction.cursor]).filter((c) => p.clues[c] === 0);
      };
      const handlers: Record<string, () => void> = {};
      for (let n = 1; n <= g.top; n++) {
        handlers[digitCommand(n)] = () => {
          const cells = targets();
          if (!cells.length || session.locked) return;
          session.dispatch(session.interaction.candidates ? { type: "toggle", cells, value: n } : { type: "set", cells, mask: bit(n) });
        };
      }
      handlers["filling.clear"] = () => {
        const cells = targets();
        if (cells.length && !session.locked) session.dispatch({ type: "clear", cells });
      };
      handlers["filling.notes"] = () => session.setInteraction((i) => ({ ...i, candidates: !i.candidates }));
      for (const [id, dx, dy] of [["left", -1, 0], ["right", 1, 0], ["up", 0, -1], ["down", 0, 1]] as const) {
        const step = (extend: boolean) => () => {
          const c = session.interaction.cursor;
          const x = Math.min(p.w - 1, Math.max(0, (c % p.w) + dx)), y = Math.min(p.h - 1, Math.max(0, Math.floor(c / p.w) + dy));
          select(y * p.w + x, extend);
        };
        handlers[`filling.${id}`] = step(false);
        handlers[`filling.extend-${id}`] = step(true);
      }
      const commands: CommandDef[] = bindCommands(bindings(g.top), handlers, {
        "filling.clear": { menu: "board" },
        "filling.notes": { menu: "board", checked: () => session.interaction.candidates },
      });
      return {
        aspect: f.aspect,
        cells: { cols: p.w, rows: p.h },
        commands,
        context: () => ({ fillingNotes: session.interaction.candidates }),
        target: () => (hover >= 0 ? hover : session.interaction.cursor),
        preview: (st) => {
          preview = st as FillingState | null;
          render();
        },
        locate: (focus) => f.rects(focusCells(focus)),
        locateChange: (a, b) => {
          const x = (a as FillingState).doms, y = (b as FillingState).doms;
          return f.rects(x.flatMap((m, c) => (m !== y[c] ? [c] : [])));
        },
        destroy() {
          for (const [type, fn] of listeners) f.svg.removeEventListener(type, fn);
          offs.forEach((o) => o());
          f.destroy();
        },
      };
    },
  };
}
